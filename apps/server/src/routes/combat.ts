import { Hono } from 'hono';
import { eq, desc, and, asc, isNull } from 'drizzle-orm';
import { db, sqlite } from '../db/client.js';
import {
  combats,
  combat_participants,
  combat_log,
  characters,
  images,
  items,
  weapons,
  rule_constants,
  scenario_sessions,
  boards,
  board_tokens,
  board_objects,
} from '../db/schema.js';
import { requireGm } from '../auth.js';
import { sessionManager } from '../session.js';
import { formatCharacterRow, maskAmmoForPlayer, effectiveForChecks } from '../character-helper.js';
import { loadRoleData } from './character-creation.js';
import {
  CreateCombatInputSchema,
  AddParticipantInputSchema,
  UpdateParticipantInputSchema,
  SetInitiativeInputSchema,
  ResolveActionInputSchema,
  ApplyActionInputSchema,
  generateUlid,
  CombatParticipant,
  CombatLogEntry,
  Combat,
  CombatChange,
  skillNameToKey,
  burnDamage,
  soloEffects,
  roleRank,
} from '@cyberpgm/shared';
import { resolveCombatAction, actionsAllowed, WEAPON_NAME_ALIASES } from '../services/combat-resolver.js';
import { woundState, initiativeTotal, resolveDamage } from '@cyberpgm/rules';
import { randomInt } from 'node:crypto';
import { linkTextWeapons } from '../weapon-link.js';
import { attackLine } from '../services/attack-line.js';

export const combatRoutes = new Hono();

/**
 * Hydrates a combat record with its participants (including character stats) and logs.
 */
export function getHydratedCombat(combatId: string): Combat | null {
  const cb = db.select().from(combats).where(eq(combats.id, combatId)).get();
  if (!cb) return null;

  const partRows = db
    .select()
    .from(combat_participants)
    .where(eq(combat_participants.combat_id, combatId))
    .orderBy(asc(combat_participants.order_index))
    .all();

  const allImages = db.select().from(images).all();
  const imageMap = new Map<string, string>();
  for (const img of allImages) {
    imageMap.set(img.id, img.path);
  }

  const participants: CombatParticipant[] = partRows.map((p) => {
    let charObj = null;
    if (p.character_id) {
      const charRow = db.select().from(characters).where(eq(characters.id, p.character_id)).get();
      if (charRow) {
        const imgPath = charRow.image_id ? imageMap.get(charRow.image_id) ?? null : null;
        const formatted = formatCharacterRow(charRow, imgPath);
        const hydratedInventory = formatted.inventory.map((inv) => {
          let kind = inv.kind;
          let wRow: any = null;
          if (inv.item_id) {
            const it = db.select({ kind: items.kind }).from(items).where(eq(items.id, inv.item_id)).get();
            if (!kind) kind = it?.kind;
            wRow = db.select().from(weapons).where(eq(weapons.item_id, inv.item_id)).get();
          }
          if (!kind || !wRow) {
            const alias = WEAPON_NAME_ALIASES[inv.name];
            const it =
              db.select({ id: items.id, kind: items.kind }).from(items).where(eq(items.name_ja, inv.name)).get() ||
              db.select({ id: items.id, kind: items.kind }).from(items).where(eq(items.name_ja_override, inv.name)).get() ||
              db.select({ id: items.id, kind: items.kind }).from(items).where(eq(items.name_en, inv.name)).get() ||
              (alias ? db.select({ id: items.id, kind: items.kind }).from(items).where(eq(items.name_ja, alias)).get() : undefined) ||
              (alias ? db.select({ id: items.id, kind: items.kind }).from(items).where(eq(items.name_en, alias)).get() : undefined);
            if (!kind) kind = it?.kind;
            if (it && !wRow) {
              wRow = db.select().from(weapons).where(eq(weapons.item_id, it.id)).get();
            }
          }
          if (wRow) {
            kind = 'weapon';
          }
          let ammo = inv.ammo;
          if (
            (ammo === undefined || ammo === null) &&
            wRow &&
            wRow.magazine_max !== null &&
            wRow.magazine_max !== undefined
          ) {
            ammo = wRow.magazine_max;
          }
          const ignoreArmorPercent =
            wRow && typeof wRow.ignore_armor_percent === 'number'
              ? wRow.ignore_armor_percent
              : (inv.ignore_armor_percent ?? null);

          return {
            ...inv,
            ...(kind ? { kind } : {}),
            ...(ammo !== undefined ? { ammo } : {}),
            ignore_armor_percent: ignoreArmorPercent,
            // スマホの攻撃ボタンの基準値を武器に合わせるため（Phase 5k）
            ...(wRow
              ? { skill_key: skillNameToKey(wRow.skill), is_ranged: Boolean(wRow.is_ranged), autofire: wRow.autofire ?? null }
              : {}),
          };
        });
        charObj = {
          id: formatted.id,
          name: formatted.name,
          kind: formatted.kind,
          role: formatted.role,
          image_path: formatted.image_path,
          // 判定にはドラッグ・依存症の修正を入れた値を使う（Phase 5w）
          stats: effectiveForChecks(formatted.stats, formatted.skills, formatted.extra, formatted.role).stats,
          skills: effectiveForChecks(formatted.stats, formatted.skills, formatted.extra, formatted.role).skills,
          hp: formatted.hp,
          hp_max: formatted.hp_max,
          sp_head: formatted.sp_head,
          sp_body: formatted.sp_body,
          weapons: formatted.weapons,
          inventory: hydratedInventory,
          cyberware: formatted.cyberware,
          status: formatted.status,
          crit_injuries: formatted.crit_injuries,
          extra: formatted.extra,
          armor_penalty: formatted.armor_penalty,
        };
      }
    }

    return {
      id: p.id,
      combat_id: p.combat_id,
      character_id: p.character_id,
      side: p.side as 'ally' | 'enemy',
      name: p.name,
      initiative: p.initiative,
      initiative_roll: JSON.parse(p.initiative_roll || '{}'),
      order_index: p.order_index,
      active: p.active,
      out: p.out,
      move_used: p.move_used,
      action_used: p.action_used,
      state: JSON.parse(p.state || '{}'),
      character: charObj,
    };
  });

  const logRows = db
    .select()
    .from(combat_log)
    .where(eq(combat_log.combat_id, combatId))
    .orderBy(desc(combat_log.at))
    .limit(50)
    .all();

  const logs: CombatLogEntry[] = logRows.map((l) => ({
    id: l.id,
    combat_id: l.combat_id,
    round: l.round,
    actor_id: l.actor_id,
    action_key: l.action_key,
    input: JSON.parse(l.input || '{}'),
    breakdown: JSON.parse(l.breakdown || '{}'),
    changes: JSON.parse(l.changes || '[]'),
    undone: l.undone,
    at: l.at,
  }));

  return {
    id: cb.id,
    board_id: cb.board_id ?? null,
    status: cb.status as 'setup' | 'active' | 'ended',
    round: cb.round,
    turn_index: cb.turn_index,
    settings: JSON.parse(cb.settings || '{}'),
    created_at: cb.created_at,
    ended_at: cb.ended_at,
    participants,
    logs,
  };
}

/**
 * Returns current combat in setup or active state.
 */
export function getCurrentCombat(): Combat | null {
  const activeCombat = db
    .select()
    .from(combats)
    .where(eq(combats.status, 'active'))
    .orderBy(desc(combats.created_at))
    .get();

  if (activeCombat) {
    return getHydratedCombat(activeCombat.id);
  }

  const setupCombat = db
    .select()
    .from(combats)
    .where(eq(combats.status, 'setup'))
    .orderBy(desc(combats.created_at))
    .get();

  if (setupCombat) {
    return getHydratedCombat(setupCombat.id);
  }

  return null;
}

/**
 * GET /api/combat-actions: Get list of defined combat actions.
 */
combatRoutes.get('/combat-actions', async (c) => {
  const row = db.select().from(rule_constants).where(eq(rule_constants.key, 'combat_actions')).get();
  if (!row) {
    return c.json({ actions: [] });
  }
  try {
    const actions = JSON.parse(row.value);
    return c.json({ actions: Array.isArray(actions) ? actions : actions.actions || [] });
  } catch {
    return c.json({ actions: [] });
  }
});

/**
 * POST /api/combats/:id/line（GM）: 出目を入れる前の計算式と成功ライン（Phase 5n）
 */
combatRoutes.post('/combats/:id/line', requireGm, async (c) => {
  const combat = getHydratedCombat(c.req.param('id')!);
  if (!combat) return c.json({ error: 'Combat not found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const actor = combat.participants.find((p) => p.id === body.actor_id);
  if (!actor) return c.json({ line: null });
  const target = combat.participants.find((p) => p.id === body.target_id);
  return c.json({ line: attackLine(body, actor, target) });
});

/**
 * GET /api/combats/current/my-lines?weapon_entry_id=（スマホ）: 自分の攻撃の成功ライン。射撃は距離帯ごと（Phase 5n）
 */
combatRoutes.get('/combats/current/my-lines', async (c) => {
  const charId = c.get('characterId');
  const combat = getCurrentCombat();
  const me = combat?.participants.find((p) => p.character_id === charId);
  if (!combat || !me) return c.json({ lines: {} });
  const weapon_entry_id = c.req.query('weapon_entry_id') || undefined;
  const lines: Record<string, unknown> = {};
  for (const key of ['ranged', 'aimed', 'autofire', 'melee', 'brawl', 'martial_arts']) {
    lines[key] = attackLine({ action_key: key, weapon_entry_id }, me);
  }
  return c.json({ lines });
});

/**
 * GET /api/combats/current: Returns active or setup combat.
 */
combatRoutes.get('/combats/current', async (c) => {
  const role = c.get('role');
  const userCharId = c.get('characterId');
  const current = getCurrentCombat();

  if (!current) {
    return c.json({ combat: null });
  }

  // If player, filter out other participants' private stats
  if (role === 'player') {
    const hideEnemy = current.settings.hideEnemyStats ?? true;
    const ammoHidden = current.settings.playerAmmoVisible === false;
    const sanitizedParticipants = current.participants.map((p) => {
      const isMine = p.character_id === userCharId;
      if (isMine) return p.character ? { ...p, character: maskAmmoForPlayer(p.character, ammoHidden) } : p;

      // For others, mask detailed skills and stats if enemy or if settings dictate
      if (p.side === 'enemy' && hideEnemy) {
        return {
          ...p,
          character: p.character
            ? {
                id: p.character.id,
                kind: p.character.kind,
                role: p.character.role,
                image_path: p.character.image_path,
                // Mask stats and skills
                stats: {} as any,
                skills: {},
                hp: p.character.hp,
                hp_max: p.character.hp_max,
                sp_head: p.character.sp_head,
                sp_body: p.character.sp_body,
                weapons: [],
                inventory: [],
                status: p.character.status,
                crit_injuries: [],
              }
            : null,
        };
      }
      return p.character ? { ...p, character: maskAmmoForPlayer(p.character, ammoHidden) } : p;
    });

    return c.json({
      combat: {
        ...current,
        participants: sanitizedParticipants,
      },
    });
  }

  return c.json({ combat: current });
});

/**
 * 戦闘の参加者チェックで、最初からチェックを入れておく PC（Phase 5l）。
 * 進行中のシナリオに入っている PC と、いまスマホでつながっている PC。どれも当てはまらなければ全員（今までどおり）。
 * 死亡した PC は外す。チェックを外した PC も一覧には残るので、GM が入れ直せる
 */
export function pcsInPlay(pcRows: Array<typeof characters.$inferSelect>): Set<string> {
  const active = db.select().from(scenario_sessions).where(isNull(scenario_sessions.ended_at)).get();
  const connected = new Set(sessionManager.getConnectedCharacterIds());
  const alive = pcRows.filter((pc) => !(JSON.parse(pc.status || '[]') as string[]).includes('dead'));
  const inPlay = alive.filter((pc) => (active && pc.scenario_id === active.scenario_id) || connected.has(pc.id));
  return new Set((inPlay.length > 0 ? inPlay : alive).map((pc) => pc.id));
}

/**
 * スマホから届いたイニシアチブの出目を、準備中の戦闘のその PC の参加者に残す（Phase 5l）
 */
export function saveInitiativeRoll(characterId: string, payload: { first?: unknown; extra?: unknown }) {
  const first = Number(payload.first);
  if (!Number.isInteger(first) || first < 1 || first > 10) return;
  const extra = Number(payload.extra);
  const roll = { first, ...(Number.isInteger(extra) && extra >= 1 && extra <= 10 ? { extra } : {}) };
  const setup = db.select().from(combats).where(eq(combats.status, 'setup')).orderBy(desc(combats.created_at)).get();
  if (!setup) return;
  db.update(combat_participants)
    .set({ initiative_roll: JSON.stringify(roll) })
    .where(and(eq(combat_participants.combat_id, setup.id), eq(combat_participants.character_id, characterId)))
    .run();
  sessionManager.broadcastCombatUpdate(getHydratedCombat(setup.id));
}

/**
 * POST /api/combats: Create a new combat (GM only).
 */
combatRoutes.post('/combats', requireGm, async (c) => {
  linkTextWeapons(); // 文字だけの武器も選べるように（Phase 5j）
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateCombatInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const existing = getCurrentCombat();
  if (existing) {
    return c.json({ combat: existing });
  }

  const id = generateUlid();
  const now = Date.now();
  const defaultSettings = {
    tieBreak: 'reroll',
    autoRollNpc: true,
    autoRollPc: false,
    hideEnemyStats: true,
    ...(parsed.data.settings || {}),
  };

  db.insert(combats)
    .values({
      id,
      board_id: parsed.data.board_id ?? null,
      status: 'setup',
      round: 1,
      turn_index: 0,
      settings: JSON.stringify(defaultSettings),
      created_at: now,
    })
    .run();

  // Automatically add all PCs; only those in play start checked (Phase 5l)
  const pcRows = db.select().from(characters).where(eq(characters.kind, 'pc')).all();
  const inPlay = pcsInPlay(pcRows);
  let order = 0;
  for (const pc of pcRows) {
    db.insert(combat_participants)
      .values({
        id: generateUlid(),
        combat_id: id,
        character_id: pc.id,
        side: 'ally',
        name: pc.name,
        initiative: 0,
        initiative_roll: '{}',
        order_index: order++,
        active: inPlay.has(pc.id),
        out: false,
        move_used: false,
        action_used: false,
        state: '{}',
      })
      .run();
  }

  const created = getHydratedCombat(id);
  sessionManager.broadcastCombatUpdate(created);

  return c.json({ combat: created }, 201);
});

export interface AddParticipantsInput {
  character_id?: string | null;
  name: string;
  side: 'ally' | 'enemy' | 'neutral';
  count: number;
}

/**
 * Adds participants to a combat. Mooks (or count > 1) are duplicated into their own
 * character rows so each copy tracks HP/SP/ammo independently.
 * Returns the character_id of each added participant (null for custom ones).
 */
export function addCombatParticipants(combatId: string, input: AddParticipantsInput): Array<string | null> {
  const created: Array<string | null> = [];
  const { character_id, name, side, count } = input;
  const currentCount = db
    .select()
    .from(combat_participants)
    .where(eq(combat_participants.combat_id, combatId))
    .all().length;

  if (character_id) {
    const baseChar = db.select().from(characters).where(eq(characters.id, character_id)).get();
    if (!baseChar) return created;

    if (count > 1 || baseChar.kind === 'mook') {
      // Replicate mooks: "Name #1", "Name #2", ...
      for (let i = 1; i <= count; i++) {
        const mookName = `${name} #${i}`;
        const newCharId = generateUlid();
        const now = Date.now();

        // Duplicate character row for independent HP/SP/ammo tracking
        db.insert(characters)
          .values({
            id: newCharId,
            kind: 'mook',
            name: mookName,
            role: baseChar.role,
            image_id: baseChar.image_id,
            stats: baseChar.stats,
            skills: baseChar.skills,
            hp: baseChar.hp,
            hp_max: baseChar.hp_max,
            sp_head: baseChar.sp_head,
            sp_body: baseChar.sp_body,
            humanity: baseChar.humanity,
            emp_max: baseChar.emp_max,
            cyberware: baseChar.cyberware,
            weapons: baseChar.weapons,
            inventory: baseChar.inventory,
            status: baseChar.status,
            crit_injuries: baseChar.crit_injuries,
            eb: baseChar.eb,
            notes_gm: baseChar.notes_gm,
            created_at: now,
            updated_at: now,
          })
          .run();

        created.push(newCharId);
        db.insert(combat_participants)
          .values({
            id: generateUlid(),
            combat_id: combatId,
            character_id: newCharId,
            side,
            name: mookName,
            initiative: 0,
            initiative_roll: '{}',
            order_index: currentCount + i - 1,
            active: true,
            out: false,
            move_used: false,
            action_used: false,
            state: '{}',
          })
          .run();
      }
    } else {
      // Single PC or NPC addition
      created.push(character_id);
      db.insert(combat_participants)
        .values({
          id: generateUlid(),
          combat_id: combatId,
          character_id,
          side,
          name,
          initiative: 0,
          initiative_roll: '{}',
          order_index: currentCount,
          active: true,
          out: false,
          move_used: false,
          action_used: false,
          state: '{}',
        })
        .run();
    }
  } else {
    // Custom participant without character row
    for (let i = 1; i <= count; i++) {
      created.push(null);
      const partName = count > 1 ? `${name} #${i}` : name;
      db.insert(combat_participants)
        .values({
          id: generateUlid(),
          combat_id: combatId,
          character_id: null,
          side,
          name: partName,
          initiative: 0,
          initiative_roll: '{}',
          order_index: currentCount + i - 1,
          active: true,
          out: false,
          move_used: false,
          action_used: false,
          state: '{}',
        })
        .run();
    }
  }

  return created;
}

/**
 * POST /api/combats/:id/participants: Add participant (GM only).
 */
combatRoutes.post('/combats/:id/participants', requireGm, async (c) => {
  linkTextWeapons(); // 文字だけの武器も選べるように（Phase 5j）
  const combatId = c.req.param('id');
  if (!combatId) return c.json({ error: 'Missing combat ID' }, 400);
  const body = await c.req.json();
  const parsed = AddParticipantInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const cb = db.select().from(combats).where(eq(combats.id, combatId)).get();
  if (!cb) return c.json({ error: 'Combat not found' }, 404);

  if (parsed.data.character_id) {
    const baseChar = db.select().from(characters).where(eq(characters.id, parsed.data.character_id)).get();
    if (!baseChar) return c.json({ error: 'Character not found' }, 404);
  }
  addCombatParticipants(combatId, parsed.data);

  const updated = getHydratedCombat(combatId);
  sessionManager.broadcastCombatUpdate(updated);

  return c.json({ combat: updated }, 201);
});

/**
 * POST /api/combats/:id/join: 戦闘中に参加者を足す（Phase 5e）。
 * 行動順に差し込み（今の手番の人は変えない）、盤面があれば選んだマスにコマを置く。取り消せる。
 * body: { character_id, side, count?, rolls?: Array<{ first, extra? }>, positions?: Array<{ x, y }> }
 *  - rolls: 足す人ごとのイニシアチブの出目（PC は GM かスマホの出目を入れる）。ない人はアプリで振る（NPC の自動ロールと同じ。SPEC §5.1）
 */
combatRoutes.post('/combats/:id/join', requireGm, async (c) => {
  linkTextWeapons(); // 文字だけの武器も選べるように（Phase 5j）
  const combatId = c.req.param('id')!;
  const body = await c.req.json();
  const cb = db.select().from(combats).where(eq(combats.id, combatId)).get();
  if (!cb) return c.json({ error: 'Combat not found' }, 404);
  const baseChar = body.character_id ? db.select().from(characters).where(eq(characters.id, body.character_id)).get() : null;
  if (!baseChar) return c.json({ error: 'Character not found' }, 404);
  const side = body.side === 'ally' ? 'ally' : 'enemy';
  const count = Math.max(1, Math.min(20, Number(body.count) || 1));
  const rolls: Array<{ first: number; extra?: number } | undefined> = Array.isArray(body.rolls) ? body.rolls : [];
  const positions: Array<{ x: number; y: number } | undefined> = Array.isArray(body.positions) ? body.positions : [];

  const before = db.select().from(combat_participants).where(eq(combat_participants.combat_id, combatId)).all();
  const currentActorId = before.slice().sort((a, b) => a.order_index - b.order_index)[cb.turn_index]?.id ?? null;
  const roll = () => randomInt(1, 11);

  const result = sqlite.transaction(() => {
    const createdCharIds = addCombatParticipants(combatId, { character_id: baseChar.id, name: baseChar.name, side, count });
    const after = db.select().from(combat_participants).where(eq(combat_participants.combat_id, combatId)).all();
    const added = after.filter((p) => !before.some((b) => b.id === p.id));
    const tokenIds: string[] = [];

    added.forEach((p, i) => {
      const ch = p.character_id ? db.select().from(characters).where(eq(characters.id, p.character_id)).get() : null;
      const ref = ch ? (JSON.parse(ch.stats).ref as number) + soloEffects(ch.role, JSON.parse(ch.extra || '{}')).initiative : 0;
      const given = rolls[i];
      const first = given?.first ?? roll();
      let extra = given?.extra;
      if (!given && (first === 10 || first === 1)) extra = roll();
      if (given && (first === 10 || first === 1) && extra === undefined) {
        throw new Error('出目 10 か 1 のときは追加の出目も入れてください');
      }
      const total = initiativeTotal(ref, first, extra).total;
      sqlite
        .prepare('UPDATE combat_participants SET initiative = ?, initiative_roll = ? WHERE id = ?')
        .run(total, JSON.stringify({ first, extra, total, auto: !given }), p.id);
      const pos = positions[i];
      if (pos && cb.board_id && p.character_id) {
        const tokenId = generateUlid();
        sqlite
          .prepare('INSERT INTO board_tokens (id, board_id, character_id, x, y, gm_only) VALUES (?, ?, ?, ?, ?, 0)')
          .run(tokenId, cb.board_id, p.character_id, pos.x, pos.y);
        tokenIds.push(tokenId);
      }
    });

    // 行動順を並べ直す（イニシアチブの高い順。同じなら REF、それも同じなら元の順）。今の手番の人を指したままにする
    const all = db.select().from(combat_participants).where(eq(combat_participants.combat_id, combatId)).all();
    const refOf = (p: (typeof all)[number]) => {
      const ch = p.character_id ? db.select().from(characters).where(eq(characters.id, p.character_id)).get() : null;
      return ch ? (JSON.parse(ch.stats).ref as number) : 0;
    };
    const sorted = all.slice().sort((a, b) => b.initiative - a.initiative || refOf(b) - refOf(a) || a.order_index - b.order_index);
    sorted.forEach((p, idx) => sqlite.prepare('UPDATE combat_participants SET order_index = ? WHERE id = ?').run(idx, p.id));
    const newTurnIndex = currentActorId ? sorted.findIndex((p) => p.id === currentActorId) : cb.turn_index;
    sqlite.prepare('UPDATE combats SET turn_index = ? WHERE id = ?').run(Math.max(0, newTurnIndex), combatId);

    const change: CombatChange = {
      target_id: combatId,
      target_name: baseChar.name,
      field: 'participant_join',
      before: { order: before.map((p) => ({ id: p.id, order_index: p.order_index })), turn_index: cb.turn_index },
      after: {
        participant_ids: added.map((p) => p.id),
        created_character_ids: createdCharIds.filter((id): id is string => !!id && id !== baseChar.id),
        token_ids: tokenIds,
      },
      desc: `途中参加: ${added.map((p) => p.name).join('、')}`,
    };
    sqlite
      .prepare(
        `INSERT INTO combat_log (id, combat_id, round, actor_id, action_key, input, breakdown, changes, undone, at)
         VALUES (?, ?, ?, ?, 'join', ?, '{}', ?, 0, ?)`,
      )
      .run(generateUlid(), combatId, cb.round, added[0]?.id ?? combatId, JSON.stringify(body), JSON.stringify([change]), Date.now());
    return added.map((p) => p.id);
  });

  let addedIds: string[];
  try {
    addedIds = result();
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
  const updated = getHydratedCombat(combatId);
  sessionManager.broadcastCombatUpdate(updated);
  if (updated?.board_id) sessionManager.broadcastBoardUpdate({ id: updated.board_id });
  sessionManager.broadcastScreenUpdate();
  return c.json({ combat: updated, added_participant_ids: addedIds }, 201);
});

/**
 * POST /api/combats/:id/participants/:pid/leave: 退場させる（逃げた・離脱した）。グレーにして手番を飛ばす。取り消せる
 */
combatRoutes.post('/combats/:id/participants/:pid/leave', requireGm, async (c) => {
  const combatId = c.req.param('id')!;
  const pid = c.req.param('pid')!;
  const cb = db.select().from(combats).where(eq(combats.id, combatId)).get();
  const part = db.select().from(combat_participants).where(eq(combat_participants.id, pid)).get();
  if (!cb || !part || part.combat_id !== combatId) return c.json({ error: 'Participant not found' }, 404);
  const change: CombatChange = { target_id: pid, target_name: part.name, field: 'out', before: !!part.out, after: true, desc: `退場: ${part.name}` };
  sqlite.transaction(() => {
    sqlite.prepare('UPDATE combat_participants SET out = 1 WHERE id = ?').run(pid);
    sqlite
      .prepare(
        `INSERT INTO combat_log (id, combat_id, round, actor_id, action_key, input, breakdown, changes, undone, at)
         VALUES (?, ?, ?, ?, 'leave', '{}', '{}', ?, 0, ?)`,
      )
      .run(generateUlid(), combatId, cb.round, pid, JSON.stringify([change]), Date.now());
  })();
  const updated = getHydratedCombat(combatId);
  sessionManager.broadcastCombatUpdate(updated);
  sessionManager.broadcastScreenUpdate();
  return c.json({ combat: updated });
});

/**
 * PATCH /api/combats/:id/participants/:pid: Update participant.
 */
combatRoutes.patch('/combats/:id/participants/:pid', requireGm, async (c) => {
  const { id: combatId, pid } = c.req.param();
  if (!combatId || !pid) return c.json({ error: 'Missing parameters' }, 400);
  const body = await c.req.json();
  const parsed = UpdateParticipantInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const part = db
    .select()
    .from(combat_participants)
    .where(and(eq(combat_participants.id, pid), eq(combat_participants.combat_id, combatId)))
    .get();
  if (!part) return c.json({ error: 'Participant not found' }, 404);

  const updates: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.side !== undefined) updates.side = d.side;
  if (d.name !== undefined) updates.name = d.name;
  if (d.initiative !== undefined) updates.initiative = d.initiative;
  if (d.initiative_roll !== undefined) updates.initiative_roll = JSON.stringify(d.initiative_roll);
  if (d.order_index !== undefined) updates.order_index = d.order_index;
  if (d.active !== undefined) updates.active = d.active;
  if (d.out !== undefined) updates.out = d.out;
  if (d.move_used !== undefined) updates.move_used = d.move_used;
  if (d.action_used !== undefined) updates.action_used = d.action_used;
  if (d.state !== undefined) updates.state = JSON.stringify(d.state);

  db.update(combat_participants).set(updates).where(eq(combat_participants.id, pid)).run();

  const updated = getHydratedCombat(combatId);
  sessionManager.broadcastCombatUpdate(updated);

  return c.json({ combat: updated });
});

/**
 * DELETE /api/combats/:id/participants/:pid: Delete participant.
 */
combatRoutes.delete('/combats/:id/participants/:pid', requireGm, async (c) => {
  const { id: combatId, pid } = c.req.param();
  if (!combatId || !pid) return c.json({ error: 'Missing parameters' }, 400);
  db.delete(combat_participants)
    .where(and(eq(combat_participants.id, pid), eq(combat_participants.combat_id, combatId)))
    .run();

  const updated = getHydratedCombat(combatId);
  sessionManager.broadcastCombatUpdate(updated);

  return c.json({ combat: updated });
});

/**
 * POST /api/combats/:id/initiative: Set initiative ordering.
 */
combatRoutes.post('/combats/:id/initiative', requireGm, async (c) => {
  const combatId = c.req.param('id');
  if (!combatId) return c.json({ error: 'Missing combat ID' }, 400);
  const body = await c.req.json();
  const parsed = SetInitiativeInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const updateTx = sqlite.transaction(() => {
    for (const p of parsed.data.participants) {
      const initRollStr = p.initiative_roll ? JSON.stringify(p.initiative_roll) : '{}';
      sqlite
        .prepare(
          'UPDATE combat_participants SET initiative = ?, initiative_roll = ?, order_index = ? WHERE id = ? AND combat_id = ?',
        )
        .run(p.initiative, initRollStr, p.order_index, p.id, combatId);
    }
  });
  updateTx();

  const updated = getHydratedCombat(combatId);
  sessionManager.broadcastCombatUpdate(updated);

  return c.json({ combat: updated });
});

interface TurnSnapshot {
  turn_index: number;
  round: number;
  participants: Array<{ id: string; move_used: boolean; action_used: boolean; state: string }>;
  // 時間切れで外した状態（気絶など）や、環境ダメージで変わる前の値。戻すときに使う（Phase 5r・5v）
  characters?: Array<{ id: string; status: string; hp?: number; stats?: string; extra?: string }>;
}

/**
 * 続いている環境ダメージを入れる（Phase 5v。日本語版 p.180〜181）。
 * ターンの終わり: 着火・放射線（HP に直接 2/4/6）、感電（6d6、防具で減るが損耗しない）、真空（【知力】【反応】【敏捷】に 1d6 ずつ）
 * ターンの始め: 溺れ（【体格】ぶん HP に直接）。ダイスはアプリが振る
 */
function applyTurnHazards(characterId: string | null, phase: 'start' | 'end', snapshot: TurnSnapshot, name: string) {
  if (!characterId) return;
  const ch = db.select().from(characters).where(eq(characters.id, characterId)).get();
  if (!ch) return;
  const status = JSON.parse(ch.status || '[]') as string[];
  const stats = JSON.parse(ch.stats) as Record<string, number>;
  const extra = JSON.parse(ch.extra || '{}') as Record<string, any>;
  let hp = ch.hp;
  const notes: string[] = [];
  const d6 = () => randomInt(1, 7);
  if (phase === 'end') {
    const burn = burnDamage(status);
    if (burn > 0) {
      hp = Math.max(0, hp - burn);
      notes.push(`燃えて HP に直接 ${burn}`);
    }
    if (status.includes('感電')) {
      const dice = Array.from({ length: 6 }, d6);
      const res = resolveDamage({ dice, location: 'body', sp: ch.sp_body, currentHp: hp, ablation: 0 });
      hp = Math.max(0, hp - res.hpLoss);
      notes.push(`感電 6d6（${dice.join(', ')}）− SP ${ch.sp_body} → ${res.hpLoss}`);
    }
    if (status.includes('真空')) {
      const loss = { ...(extra.vacuum_loss ?? {}) };
      const parts: string[] = [];
      for (const k of ['int', 'ref', 'dex']) {
        const n = d6();
        const take = Math.min(n, stats[k]);
        stats[k] -= take;
        loss[k] = (loss[k] ?? 0) + take;
        parts.push(`${k.toUpperCase()} −${n}`);
      }
      extra.vacuum_loss = loss;
      notes.push(`真空: ${parts.join('、')}${stats.int <= 0 ? '。【知力】が 0 になり死亡' : ''}`);
      if (stats.int <= 0 && !status.includes('dead')) status.push('dead');
    }
  } else if (status.includes('溺れ')) {
    hp = Math.max(0, hp - stats.body);
    notes.push(`溺れて HP に直接 ${stats.body}`);
  }
  if (notes.length === 0) return;
  (snapshot.characters ??= []).push({ id: ch.id, status: ch.status || '[]', hp: ch.hp, stats: ch.stats, extra: ch.extra || '{}' });
  const ws = woundState(hp, ch.hp_max);
  const nextStatus = [...status.filter((s) => s !== 'seriously' && s !== 'mortally'), ...(ws === 'seriously' ? ['seriously'] : ws === 'mortally' ? ['mortally'] : [])];
  db.update(characters)
    .set({ hp, stats: JSON.stringify(stats), extra: JSON.stringify(extra), status: JSON.stringify(nextStatus), updated_at: Date.now() })
    .where(eq(characters.id, ch.id))
    .run();
  sessionManager.announceCombat('環境ダメージ', `${name}: ${notes.join(' / ')}（HP ${ch.hp} → ${hp}）`);
  sessionManager.updateCharacterSheet(ch.id);
}

/**
 * 次の手番へ進める。今の手番の人の行動済みを戻し、退場・離脱した人は飛ばす。一周したらラウンドを進める。
 * 戻せるように、進める前の状態を 'turn' の変化として返す（Phase 5j）
 */
function advanceTurn(combatId: string): CombatChange | null {
  const cb = db.select().from(combats).where(eq(combats.id, combatId)).get();
  if (!cb) return null;
  const parts = db
    .select()
    .from(combat_participants)
    .where(eq(combat_participants.combat_id, combatId))
    .orderBy(asc(combat_participants.order_index))
    .all();
  if (parts.length === 0) return null;

  const before: TurnSnapshot = {
    turn_index: cb.turn_index,
    round: cb.round,
    participants: parts.map((p) => ({ id: p.id, move_used: p.move_used, action_used: p.action_used, state: p.state || '{}' })),
  };

  // 今の手番の人: 行動済みと、このターンだけの回数を戻す
  const curPart = parts[cb.turn_index];
  if (curPart) applyTurnHazards(curPart.character_id, 'end', before, curPart.name);
  if (curPart) {
    const st = JSON.parse(curPart.state || '{}');
    delete st.actions_taken;
    delete st.bonus_actions;
    if (st.net && typeof st.net === 'object') {
      st.net.net_used = 0;
      st.net.slid_this_turn = false;
      st.net.controlled_used_this_turn = [];
      if (st.net.slowed) {
        if (st.net.slowed_just_set) delete st.net.slowed_just_set;
        else st.net.slowed = false;
      }
    }
    db.update(combat_participants)
      .set({ move_used: false, action_used: false, state: JSON.stringify(st) })
      .where(eq(combat_participants.id, curPart.id))
      .run();
  }

  let nextIndex = (cb.turn_index + 1) % parts.length;
  let roundIncrement = nextIndex === 0 ? 1 : 0;
  let searched = 0;
  while ((!parts[nextIndex].active || parts[nextIndex].out) && searched < parts.length) {
    nextIndex = (nextIndex + 1) % parts.length;
    if (nextIndex === 0) roundIncrement++;
    searched++;
  }

  const updates: Record<string, unknown> = { turn_index: nextIndex };
  const expired: Array<{ name: string; status: string }> = [];
  if (roundIncrement > 0) {
    updates.round = cb.round + roundIncrement;
    // Decrement status rounds on participants。0 になった状態（気絶など）はキャラから外して告知する（Phase 5r）
    for (const p of db.select().from(combat_participants).where(eq(combat_participants.combat_id, combatId)).all()) {
      try {
        const st = JSON.parse(p.state || '{}');
        if (st.statusRounds) {
          const updatedRounds: Record<string, number> = {};
          const ended: string[] = [];
          for (const [sKey, rNum] of Object.entries(st.statusRounds as Record<string, number>)) {
            if (rNum > roundIncrement) updatedRounds[sKey] = rNum - roundIncrement;
            else ended.push(sKey);
          }
          st.statusRounds = updatedRounds;
          db.update(combat_participants)
            .set({ state: JSON.stringify(st) })
            .where(eq(combat_participants.id, p.id))
            .run();
          if (ended.length > 0 && p.character_id) {
            const ch = db.select().from(characters).where(eq(characters.id, p.character_id)).get();
            if (ch) {
              const status = JSON.parse(ch.status || '[]') as string[];
              if (status.some((s) => ended.includes(s))) {
                (before.characters ??= []).push({ id: ch.id, status: ch.status || '[]' });
                db.update(characters)
                  .set({ status: JSON.stringify(status.filter((s) => !ended.includes(s))), updated_at: Date.now() })
                  .where(eq(characters.id, ch.id))
                  .run();
                for (const s of ended) if (status.includes(s)) expired.push({ name: p.name, status: s });
              }
            }
          }
        }
      } catch {
        // ignore
      }
    }
  }
  db.update(combats).set(updates).where(eq(combats.id, combatId)).run();
  applyTurnHazards(parts[nextIndex]?.character_id ?? null, 'start', before, parts[nextIndex]?.name ?? '');
  for (const e of expired) sessionManager.announceCombat('状態が解けた', `${e.name} の「${e.status}」が解けた（時間切れ）`);

  const next = parts[nextIndex];
  return {
    target_id: combatId,
    target_name: next.name,
    field: 'turn',
    before,
    after: { turn_index: nextIndex, round: (updates.round as number | undefined) ?? cb.round },
    desc: `手番終了 → ${next.name} の手番${roundIncrement > 0 ? `（ラウンド ${(updates.round as number)}）` : ''}`,
  };
}

const STATUS_NAMES: Record<string, string> = { seriously: '重傷（すべての行動に −2）', mortally: '瀕死（すべての行動に −4、毎ターン死亡セーブ）', dead: '死亡', 気絶: '気絶（1 分 = 20 ラウンド行動できない）' };

/**
 * 行動の結果を告知する（Phase 5r）。
 * - 状態異常（重傷・瀕死・気絶・死亡）や致命的損傷を受けたら、GM と全員のスマホに知らせる
 * - 弾が切れたら GM に知らせ、次にどうするか（リロードはアクション 1 回）を伝える。残弾を見せる設定なら本人のスマホにも
 */
function announceResult(
  changes: CombatChange[],
  actor: CombatParticipant,
  actionUsed: boolean,
  settings: Record<string, unknown>,
) {
  // トラウマ・チームの自動呼び出し: 契約者の HP が【体格】未満になるか、体の一部を失う致命的損傷を受けたら（p.224。Phase 5w）
  const DISMEMBER = ['片腕喪失', '片手喪失', '片脚喪失', '片目喪失', '片耳喪失'];
  for (const ch of changes) {
    const lost = ch.field === 'crit_injuries' && ((ch.after as Array<{ name?: string }>) ?? []).slice(((ch.before as unknown[]) ?? []).length).some((x) => DISMEMBER.includes(x.name ?? ''));
    if (ch.field !== 'hp' && !lost) continue;
    const row = db.select().from(characters).where(eq(characters.id, ch.target_id)).get();
    if (!row) continue;
    const extra = JSON.parse(row.extra || '{}');
    if (!extra.trauma_plan || extra.trauma_called) continue;
    const body = JSON.parse(row.stats).body;
    if (lost || (typeof ch.after === 'number' && ch.after < body)) {
      const rounds = randomInt(1, 7);
      db.update(characters).set({ extra: JSON.stringify({ ...extra, trauma_called: true }) }).where(eq(characters.id, row.id)).run();
      sessionManager.announceCombat('トラウマ・チーム', `${row.name} のエージェントがトラウマ・チーム（${extra.trauma_plan === 'executive' ? 'エグゼクティヴ' : 'シルバー'}）を呼んだ。${rounds} ラウンド後に AV-4 で到着し、行動順の先頭に入る`);
    }
  }
  for (const ch of changes) {
    if (ch.field === 'status') {
      const before = (ch.before as string[] | undefined) ?? [];
      for (const s of ((ch.after as string[] | undefined) ?? []).filter((x) => !before.includes(x))) {
        if (STATUS_NAMES[s]) sessionManager.announceCombat('状態異常', `${ch.target_name} が ${STATUS_NAMES[s]} になった`);
      }
    } else if (ch.field === 'crit_injuries') {
      const before = (ch.before as unknown[] | undefined) ?? [];
      const added = ((ch.after as Array<{ name?: string; summary?: string }> | undefined) ?? []).slice(before.length);
      for (const inj of added) {
        sessionManager.announceCombat('致命的損傷', `${ch.target_name}: ${inj.name ?? ''}${inj.summary ? `（${inj.summary}）` : ''}`);
      }
    } else if (ch.field === 'ammo' && ch.after === 0 && typeof ch.before === 'number' && ch.before > 0) {
      const next = actionUsed
        ? '次の手番でリロード（アクション 1 回）するか、別の武器・行動を選ぶ'
        : 'このターンにアクションが残っているので、今リロード（アクション 1 回）できる。別の武器・行動を選んでもよい';
      const showPlayer = settings.playerAmmoVisible !== false && actor.character_id ? [actor.character_id] : [];
      sessionManager.announceCombat('弾切れ', `${actor.name} の武器の弾が切れた。${next}`, showPlayer);
    }
  }
}

function broadcastTurn(combatId: string) {
  const updated = getHydratedCombat(combatId);
  const activePart = updated?.participants[updated.turn_index];
  if (!updated || !activePart) return;
  sessionManager.broadcastCombatTurn({
    combat_id: combatId,
    round: updated.round,
    turn_index: updated.turn_index,
    actor_id: activePart.id,
    actor_name: activePart.name,
    actor_char_id: activePart.character_id,
  });
}

/**
 * POST /api/combats/:id/participants/:pid/actions: 1 ターンのアクション回数（Phase 5j）
 * { actions_per_turn?: 1-5 } 毎ターンの回数（ボスの 2 回行動など） / { bonus?: 1 | -1 } このターンだけ増減
 */
combatRoutes.post('/combats/:id/participants/:pid/actions', requireGm, async (c) => {
  const combatId = c.req.param('id')!;
  const pid = c.req.param('pid')!;
  const body = await c.req.json().catch(() => ({}));
  const part = db.select().from(combat_participants).where(eq(combat_participants.id, pid)).get();
  if (!part || part.combat_id !== combatId) return c.json({ error: 'Participant not found' }, 404);

  const st = JSON.parse(part.state || '{}');
  if (body.actions_per_turn !== undefined) {
    const n = Number(body.actions_per_turn);
    if (!Number.isInteger(n) || n < 1 || n > 5) return c.json({ error: 'actions_per_turn は 1〜5' }, 400);
    st.actions_per_turn = n;
  }
  if (body.bonus !== undefined) {
    const b = Number(body.bonus);
    if (b !== 1 && b !== -1) return c.json({ error: 'bonus は 1 か -1' }, 400);
    st.bonus_actions = Math.max(0, Number(st.bonus_actions ?? 0) + b);
  }
  const actionUsed = Number(st.actions_taken ?? 0) >= actionsAllowed({ state: st });
  db.update(combat_participants)
    .set({ state: JSON.stringify(st), action_used: actionUsed })
    .where(eq(combat_participants.id, pid))
    .run();

  const updated = getHydratedCombat(combatId);
  sessionManager.broadcastCombatUpdate(updated);
  return c.json({ combat: updated });
});

/**
 * PATCH /api/combats/:id: Update combat state (settings, next turn, start, end).
 */
combatRoutes.patch('/combats/:id', requireGm, async (c) => {
  const combatId = c.req.param('id');
  if (!combatId) return c.json({ error: 'Missing combat ID' }, 400);
  const body = await c.req.json();
  const cb = db.select().from(combats).where(eq(combats.id, combatId)).get();
  if (!cb) return c.json({ error: 'Combat not found' }, 404);

  const updates: Record<string, unknown> = {};

  if (body.board_id !== undefined) {
    updates.board_id = body.board_id;
  }

  if (body.settings) {
    const curSettings = JSON.parse(cb.settings || '{}');
    updates.settings = JSON.stringify({ ...curSettings, ...body.settings });
  }

  if (body.action === 'start') {
    // 参加者チェックで外した人は戦闘に入れない（Phase 5l）。あとから「参加者を足す」で入れられる
    db.delete(combat_participants)
      .where(and(eq(combat_participants.combat_id, combatId), eq(combat_participants.active, false)))
      .run();
    updates.status = 'active';
    updates.round = 1;
    updates.turn_index = 0;
  } else if (body.action === 'end') {
    updates.status = 'ended';
    updates.ended_at = Date.now();

    // Optionally delete replicated mooks from DB
    if (body.deleteMooks) {
      const parts = db
        .select()
        .from(combat_participants)
        .where(eq(combat_participants.combat_id, combatId))
        .all();
      for (const p of parts) {
        if (p.character_id) {
          const char = db.select().from(characters).where(eq(characters.id, p.character_id)).get();
          if (char && char.kind === 'mook') {
            db.delete(characters).where(eq(characters.id, p.character_id)).run();
          }
        }
      }
    }
  } else if (body.action === 'next_turn') {
    // 「一手戻る」で戻せるようにログに残す（Phase 5j）
    const turnChange = advanceTurn(combatId);
    if (turnChange) {
      const curPart = (turnChange.before as TurnSnapshot).participants[cb.turn_index];
      sqlite
        .prepare(
          `INSERT INTO combat_log (id, combat_id, round, actor_id, action_key, input, breakdown, changes, undone, at)
           VALUES (?, ?, ?, ?, 'next_turn', '{}', '{}', ?, 0, ?)`,
        )
        .run(generateUlid(), combatId, cb.round, curPart?.id ?? combatId, JSON.stringify([turnChange]), Date.now());
    }
  }

  if (Object.keys(updates).length > 0) {
    db.update(combats).set(updates).where(eq(combats.id, combatId)).run();
  }

  const updated = getHydratedCombat(combatId);
  sessionManager.broadcastCombatUpdate(updated);
  // 残弾を見せるかを変えた・戦闘が終わったら、スマホのキャラシートを送り直す（Phase 5r）
  if (body.settings?.playerAmmoVisible !== undefined || body.action === 'end') sessionManager.updateAllCharacterSheets();

  if (body.action === 'next_turn' && updated) broadcastTurn(combatId);

  return c.json({ combat: updated });
});

/**
 * POST /api/combats/:id/resolve: Preview combat action calculation (No DB changes).
 */
combatRoutes.post('/combats/:id/resolve', requireGm, async (c) => {
  const combatId = c.req.param('id');
  if (!combatId) return c.json({ error: 'Missing combat ID' }, 400);
  const body = await c.req.json();
  const parsed = ResolveActionInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const combat = getHydratedCombat(combatId);
  if (!combat) return c.json({ error: 'Combat not found' }, 404);

  const actor = combat.participants.find((p) => p.id === parsed.data.actor_id);
  if (!actor) return c.json({ error: 'Actor not found in combat' }, 404);

  const targetId = parsed.data.target_id || parsed.data.attacks?.[0]?.target_id;
  const target = targetId
    ? combat.participants.find((p) => p.id === targetId)
    : undefined;

  // ラウンドも渡す（ソロのダメージ軽減・弱点看破は各ラウンドの最初の 1 回。Phase 5x）
  const result = resolveCombatAction(db, parsed.data, actor, target, combat.participants, combat.board_id, { ...combat.settings, __round: combat.round });
  return c.json({ result });
});

/**
 * POST /api/combats/:id/apply: Commit combat action result (Atomic DB transaction).
 */
combatRoutes.post('/combats/:id/apply', requireGm, async (c) => {
  const combatId = c.req.param('id');
  if (!combatId) return c.json({ error: 'Missing combat ID' }, 400);
  const body = await c.req.json();
  const parsed = ApplyActionInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const combat = getHydratedCombat(combatId);
  if (!combat) return c.json({ error: 'Combat not found' }, 404);

  const actor = combat.participants.find((p) => p.id === parsed.data.actor_id);
  if (!actor) return c.json({ error: 'Actor not found in combat' }, 404);

  const targetId = parsed.data.target_id || parsed.data.attacks?.[0]?.target_id;
  const target = targetId
    ? combat.participants.find((p) => p.id === targetId)
    : undefined;

  // Re-resolve calculation on server
  // ラウンドも渡す（ソロのダメージ軽減・弱点看破は各ラウンドの最初の 1 回。Phase 5x）
  const result = resolveCombatAction(db, parsed.data, actor, target, combat.participants, combat.board_id, { ...combat.settings, __round: combat.round });
  if (result.missing_inputs?.length && result.changes.length === 0) {
    return c.json({ error: result.missing_inputs.join(' / '), result }, 400);
  }
  const now = Date.now();
  const logId = generateUlid();

  const applyTx = sqlite.transaction(() => {
    // 1. Write to combat_log
    sqlite
      .prepare(
        `INSERT INTO combat_log (id, combat_id, round, actor_id, action_key, input, breakdown, changes, undone, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        logId,
        combatId,
        combat.round,
        actor.id,
        parsed.data.action_key,
        JSON.stringify(parsed.data),
        JSON.stringify(result.breakdown),
        JSON.stringify(result.changes),
        0,
        now,
      );

    // 2. Apply each change
    for (const ch of result.changes) {
      if (ch.field === 'hp') {
        sqlite.prepare('UPDATE characters SET hp = ?, updated_at = ? WHERE id = ?').run(
          ch.after as number,
          now,
          ch.target_id,
        );
      } else if (ch.field === 'sp_head') {
        sqlite.prepare('UPDATE characters SET sp_head = ?, updated_at = ? WHERE id = ?').run(
          ch.after as number,
          now,
          ch.target_id,
        );
      } else if (ch.field === 'sp_body') {
        sqlite.prepare('UPDATE characters SET sp_body = ?, updated_at = ? WHERE id = ?').run(
          ch.after as number,
          now,
          ch.target_id,
        );
      } else if (ch.field === 'status') {
        sqlite.prepare('UPDATE characters SET status = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(ch.after),
          now,
          ch.target_id,
        );
      } else if (ch.field === 'crit_injuries') {
        sqlite.prepare('UPDATE characters SET crit_injuries = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(ch.after),
          now,
          ch.target_id,
        );
      } else if (ch.field === 'extra' || ch.field === 'stats') {
        // 【運命】点・環境の状態など（extra）と、真空で減った能力値（stats）（Phase 5v）
        sqlite.prepare(`UPDATE characters SET ${ch.field} = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(ch.after), now, ch.target_id);
      } else if (ch.field === 'initiative_top') {
        // ヴィークルを始動した操縦者は行動順の先頭へ（p.192。Phase 5y）。戻せるように前の並びを残す
        const parts = sqlite.prepare('SELECT id, initiative, order_index FROM combat_participants WHERE combat_id = ?').all(combatId) as Array<{ id: string; initiative: number; order_index: number }>;
        ch.before = { order: parts.map((p) => ({ id: p.id, initiative: p.initiative, order_index: p.order_index })), turn_index: (sqlite.prepare('SELECT turn_index FROM combats WHERE id = ?').get(combatId) as any)?.turn_index };
        const top = Math.max(0, ...parts.map((p) => p.initiative)) + 1;
        sqlite.prepare('UPDATE combat_participants SET initiative = ? WHERE id = ?').run(top, ch.target_id);
        const sorted = (sqlite.prepare('SELECT id FROM combat_participants WHERE combat_id = ? ORDER BY initiative DESC, order_index ASC').all(combatId) as Array<{ id: string }>);
        sorted.forEach((p, idx) => sqlite.prepare('UPDATE combat_participants SET order_index = ? WHERE id = ?').run(idx, p.id));
        // 今の手番の人を指したままにする
        sqlite.prepare('UPDATE combats SET turn_index = ? WHERE id = ?').run(sorted.findIndex((p) => p.id === ch.target_id), combatId);
      } else if (ch.field === 'humanity') {
        // 人間性の増減（after に差分。Phase 5w）
        sqlite.prepare('UPDATE characters SET humanity = humanity + ?, updated_at = ? WHERE id = ?').run(Number(ch.after) || 0, now, ch.target_id);
      } else if (ch.field === 'state') {
        // Participant state update (move_used, action_used, deathSavePenalty, etc.)
        const part = sqlite
          .prepare('SELECT state, move_used, action_used FROM combat_participants WHERE id = ?')
          .get(ch.target_id) as any;
        if (part) {
          const curState = JSON.parse(part.state || '{}');
          const afterObj = ch.after as Record<string, unknown>;
          const newState = { ...curState };
          let moveUsed = part.move_used;
          let actionUsed = part.action_used;

          if (afterObj.move_used !== undefined) moveUsed = afterObj.move_used ? 1 : 0;
          if (afterObj.action_used !== undefined) actionUsed = afterObj.action_used ? 1 : 0;
          // ほかの値（死亡セーブの修正、状態の残りラウンド、つかみの相手など）はそのまま入れる。null は消す（Phase 5u）
          for (const [k, v] of Object.entries(afterObj)) {
            if (k === 'move_used' || k === 'action_used') continue;
            if (v === null) delete newState[k];
            else newState[k] = v;
          }

          sqlite
            .prepare('UPDATE combat_participants SET state = ?, move_used = ?, action_used = ? WHERE id = ?')
            .run(JSON.stringify(newState), moveUsed, actionUsed, ch.target_id);
        }
      } else if (ch.field === 'out') {
        sqlite.prepare('UPDATE combat_participants SET out = ? WHERE id = ?').run(
          ch.after ? 1 : 0,
          ch.target_id,
        );
      } else if (ch.field === 'inventory') {
        sqlite
          .prepare('UPDATE characters SET inventory = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(ch.after), now, ch.target_id);
      } else if (ch.field === 'dropped' && target) {
        // Drop held item
        if (target.character_id && typeof ch.after === 'string') {
          const charRow = sqlite
            .prepare('SELECT inventory FROM characters WHERE id = ?')
            .get(target.character_id) as any;
          if (charRow) {
            try {
              const inv = JSON.parse(charRow.inventory || '[]');
              const unequipped = inv.map((it: any) =>
                it.entry_id === ch.after || it.item_id === ch.after ? { ...it, equipped: false } : it,
              );
              sqlite
                .prepare('UPDATE characters SET inventory = ?, updated_at = ? WHERE id = ?')
                .run(JSON.stringify(unequipped), now, target.character_id);
            } catch {
              // ignore
            }
          }
        }
      } else if (ch.field === 'token_position') {
        const pos = ch.after as { x: number; y: number };
        sqlite
          .prepare('UPDATE board_tokens SET x = ?, y = ? WHERE id = ?')
          .run(pos.x, pos.y, ch.target_id);
      } else if (ch.field === 'cover_hp') {
        const cov = ch.after as { cover_hp: number | null; blocks_los: string };
        sqlite
          .prepare('UPDATE board_objects SET cover_hp = ?, blocks_los = ? WHERE id = ?')
          .run(cov.cover_hp, cov.blocks_los, ch.target_id);
      } else if (ch.field === 'board_drop') {
        const d = ch.after as any;
        sqlite
          .prepare(
            'INSERT INTO board_drops (id, board_id, x, y, inventory_entry, from_character_id) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(d.id, d.board_id, d.x, d.y, JSON.stringify(d.inventory_entry), d.from_character_id ?? null);
      } else if (ch.field === 'board_drop_remove') {
        sqlite.prepare('DELETE FROM board_drops WHERE id = ?').run(ch.target_id);
      } else if (ch.field === 'net_architecture') {
        sqlite
          .prepare('INSERT INTO rule_constants (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
          .run(`net_architecture.${ch.target_id}`, JSON.stringify(ch.after));
      }
    }
  });

  applyTx();
  // 行動順の先頭へ（ヴィークル始動）は反映するときに前の並びを残すので、ログを書き直す（Phase 5y）
  if (result.changes.some((ch) => ch.field === 'initiative_top')) {
    sqlite.prepare('UPDATE combat_log SET changes = ? WHERE id = ?').run(JSON.stringify(result.changes), logId);
  }

  // 移動アクションとアクションを使い切った、または行動した人が倒れたら、自動で次の手番へ（Phase 5j）
  // 同じログに 'turn' の変化として残すので、「取り消し」で手番も戻る
  let autoAdvanced = false;
  const cbNow = db.select().from(combats).where(eq(combats.id, combatId)).get();
  const actorNow = db.select().from(combat_participants).where(eq(combat_participants.id, actor.id)).get();
  const ordered = getHydratedCombat(combatId)?.participants ?? [];
  const actorNowNet = actorNow ? JSON.parse(actorNow.state || '{}')?.net : null;
  const netMax = actor.character ? (roleRank(actor.character.role, actor.character.extra, 'Netrunner') >= 10 ? 5 : roleRank(actor.character.role, actor.character.extra, 'Netrunner') >= 7 ? 4 : roleRank(actor.character.role, actor.character.extra, 'Netrunner') >= 4 ? 3 : 2) : 2;
  const netEffectiveMax = actorNowNet?.slowed ? Math.max(2, netMax - 1) : netMax;
  const netHasRemaining = Boolean(actorNowNet && (actorNowNet.net_used ?? 0) > 0 && (actorNowNet.net_used ?? 0) < netEffectiveMax);
  if (
    cbNow?.status === 'active' &&
    actorNow &&
    ordered[cbNow.turn_index]?.id === actor.id &&
    ((actorNow.move_used && actorNow.action_used && !netHasRemaining) || actorNow.out)
  ) {
    const turnChange = advanceTurn(combatId);
    if (turnChange) {
      autoAdvanced = true;
      const changes = [...result.changes, turnChange];
      sqlite.prepare('UPDATE combat_log SET changes = ? WHERE id = ?').run(JSON.stringify(changes), logId);
    }
  }

  if (combat.board_id) {
    sessionManager.broadcastBoardUpdate({ id: combat.board_id });
    sessionManager.broadcastScreenUpdate();
  }

  announceResult(result.changes, actor, actorNow?.action_used ?? true, combat.settings);

  // 11.9: Notify players and GMs (filter enemy numeric hp/sp from player notification)
  if (target?.character_id) {
    sessionManager.updateCharacterSheet(target.character_id);
    sessionManager.notifyCombatResult({
      characterId: target.character_id,
      title: '被弾通知',
      summary: result.formula,
      // 撃たれた人に関係する変化だけ（相手の弾数・所持品は出さない。Phase 5l）
      changes: result.changes.filter((ch) => ch.target_id === target.character_id || ch.target_id === target.id),
      is_victim: true,
    });
  }
  if (actor.character_id && actor.character_id !== target?.character_id) {
    sessionManager.updateCharacterSheet(actor.character_id);

    // Filter enemy HP/SP for attacker player
    const isEnemyTarget = target && target.side === 'enemy';
    const ammoHidden = combat.settings.playerAmmoVisible === false;
    const playerChanges = result.changes
      .filter((ch) => {
        // 残弾を見せない設定なら、弾数と所持品の変化は出さない（Phase 5r）
        if (ammoHidden && (ch.field === 'ammo' || ch.field === 'inventory')) return false;
        // Do not leak enemy SP
        if (isEnemyTarget && ch.target_id === target.character_id) {
          if (ch.field === 'sp_head' || ch.field === 'sp_body') return false;
        }
        return true;
      })
      .map((ch) => {
        // Do not leak enemy numeric HP
        if (isEnemyTarget && ch.target_id === target.character_id && ch.field === 'hp') {
          const dmg =
            typeof ch.before === 'number' && typeof ch.after === 'number'
              ? ch.before - ch.after
              : 0;
          const maxHp = target.character?.hp_max ?? 1;
          const afterHp = typeof ch.after === 'number' ? ch.after : 0;
          const wound = woundState(afterHp, maxHp);
          const woundDesc =
            wound === 'seriously'
              ? '重傷'
              : wound === 'mortally'
                ? '瀕死'
                : wound === 'dead'
                  ? '死亡'
                  : '通常';
          return {
            target_id: ch.target_id,
            target_name: ch.target_name,
            field: 'custom' as const,
            desc: `命中 · ${ch.target_name} に ${dmg} ダメージ → ${woundDesc}`,
          };
        }
        return ch;
      });

    sessionManager.notifyCombatResult({
      characterId: actor.character_id,
      title: '行動結果',
      summary: result.formula,
      changes: playerChanges,
      is_victim: false,
    });
  }

  const updatedCombat = getHydratedCombat(combatId);
  sessionManager.broadcastCombatUpdate(updatedCombat);
  if (autoAdvanced) broadcastTurn(combatId);

  return c.json({ result, combat: updatedCombat, auto_advanced: autoAdvanced });
});

/**
 * POST /api/combats/:id/undo: Undo latest combat log entry.
 */
combatRoutes.post('/combats/:id/undo', requireGm, async (c) => {
  const combatId = c.req.param('id');
  if (!combatId) return c.json({ error: 'Missing combat ID' }, 400);
  const latestLog = db
    .select()
    .from(combat_log)
    .where(and(eq(combat_log.combat_id, combatId), eq(combat_log.undone, false)))
    .orderBy(desc(combat_log.at))
    .get();

  if (!latestLog) {
    return c.json({ error: 'No action to undo' }, 400);
  }

  const changes = JSON.parse(latestLog.changes || '[]') as CombatChange[];
  const now = Date.now();

  const undoTx = sqlite.transaction(() => {
    // Reverse apply changes
    for (let i = changes.length - 1; i >= 0; i--) {
      const ch = changes[i];
      if (ch.field === 'hp') {
        sqlite.prepare('UPDATE characters SET hp = ?, updated_at = ? WHERE id = ?').run(
          ch.before as number,
          now,
          ch.target_id,
        );
      } else if (ch.field === 'sp_head') {
        sqlite.prepare('UPDATE characters SET sp_head = ?, updated_at = ? WHERE id = ?').run(
          ch.before as number,
          now,
          ch.target_id,
        );
      } else if (ch.field === 'sp_body') {
        sqlite.prepare('UPDATE characters SET sp_body = ?, updated_at = ? WHERE id = ?').run(
          ch.before as number,
          now,
          ch.target_id,
        );
      } else if (ch.field === 'status') {
        sqlite.prepare('UPDATE characters SET status = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(ch.before),
          now,
          ch.target_id,
        );
      } else if (ch.field === 'crit_injuries') {
        sqlite.prepare('UPDATE characters SET crit_injuries = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(ch.before),
          now,
          ch.target_id,
        );
      } else if (ch.field === 'extra' || ch.field === 'stats') {
        // 【運命】点・環境の状態など（extra）と、真空で減った能力値（stats）（Phase 5v）
        sqlite.prepare(`UPDATE characters SET ${ch.field} = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(ch.before), now, ch.target_id);
      } else if (ch.field === 'humanity') {
        sqlite.prepare('UPDATE characters SET humanity = humanity - ?, updated_at = ? WHERE id = ?').run(Number(ch.after) || 0, now, ch.target_id);
      } else if (ch.field === 'initiative_top') {
        const b = ch.before as { order: Array<{ id: string; initiative: number; order_index: number }>; turn_index: number } | null;
        if (b) {
          for (const o of b.order) sqlite.prepare('UPDATE combat_participants SET initiative = ?, order_index = ? WHERE id = ?').run(o.initiative, o.order_index, o.id);
          sqlite.prepare('UPDATE combats SET turn_index = ? WHERE id = ?').run(b.turn_index, combatId);
        }
      } else if (ch.field === 'state') {
        const part = sqlite
          .prepare('SELECT state, move_used, action_used FROM combat_participants WHERE id = ?')
          .get(ch.target_id) as any;
        if (part) {
          const curState = JSON.parse(part.state || '{}');
          const beforeObj = ch.before as Record<string, unknown>;
          const newState = { ...curState };
          let moveUsed = part.move_used;
          let actionUsed = part.action_used;

          if (beforeObj.move_used !== undefined) moveUsed = beforeObj.move_used ? 1 : 0;
          if (beforeObj.action_used !== undefined) actionUsed = beforeObj.action_used ? 1 : 0;
          for (const [k, v] of Object.entries(beforeObj)) {
            if (k === 'move_used' || k === 'action_used') continue;
            if (v === null) delete newState[k];
            else newState[k] = v;
          }

          sqlite
            .prepare('UPDATE combat_participants SET state = ?, move_used = ?, action_used = ? WHERE id = ?')
            .run(JSON.stringify(newState), moveUsed, actionUsed, ch.target_id);
        }
      } else if (ch.field === 'out') {
        sqlite.prepare('UPDATE combat_participants SET out = ? WHERE id = ?').run(
          ch.before ? 1 : 0,
          ch.target_id,
        );
      } else if (ch.field === 'inventory') {
        sqlite
          .prepare('UPDATE characters SET inventory = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(ch.before), now, ch.target_id);
      } else if (ch.field === 'token_position') {
        const pos = ch.before as { x: number; y: number };
        sqlite
          .prepare('UPDATE board_tokens SET x = ?, y = ? WHERE id = ?')
          .run(pos.x, pos.y, ch.target_id);
      } else if (ch.field === 'cover_hp') {
        const cov = ch.before as { cover_hp: number | null; blocks_los: string };
        sqlite
          .prepare('UPDATE board_objects SET cover_hp = ?, blocks_los = ? WHERE id = ?')
          .run(cov.cover_hp, cov.blocks_los, ch.target_id);
      } else if (ch.field === 'participant_join') {
        const b = ch.before as { order: Array<{ id: string; order_index: number }>; turn_index: number };
        const a = ch.after as { participant_ids: string[]; created_character_ids: string[]; token_ids: string[] };
        for (const t of a.token_ids) sqlite.prepare('DELETE FROM board_tokens WHERE id = ?').run(t);
        for (const p of a.participant_ids) sqlite.prepare('DELETE FROM combat_participants WHERE id = ?').run(p);
        for (const cid of a.created_character_ids) sqlite.prepare('DELETE FROM characters WHERE id = ?').run(cid);
        for (const o of b.order) sqlite.prepare('UPDATE combat_participants SET order_index = ? WHERE id = ?').run(o.order_index, o.id);
        sqlite.prepare('UPDATE combats SET turn_index = ? WHERE id = ?').run(b.turn_index, ch.target_id);
      } else if (ch.field === 'turn') {
        // 自動で進んだ手番を戻す（Phase 5j）
        const b = ch.before as TurnSnapshot;
        sqlite.prepare('UPDATE combats SET turn_index = ?, round = ? WHERE id = ?').run(b.turn_index, b.round, ch.target_id);
        for (const p of b.participants) {
          sqlite
            .prepare('UPDATE combat_participants SET move_used = ?, action_used = ?, state = ? WHERE id = ?')
            .run(p.move_used ? 1 : 0, p.action_used ? 1 : 0, p.state, p.id);
        }
        // 後から変えた順の逆に戻す（同じキャラが 2 回入っていれば最初の値が残る）
        for (const ch of [...(b.characters ?? [])].reverse()) {
          sqlite.prepare('UPDATE characters SET status = ? WHERE id = ?').run(ch.status, ch.id);
          if (ch.hp !== undefined) sqlite.prepare('UPDATE characters SET hp = ?, stats = ?, extra = ? WHERE id = ?').run(ch.hp, ch.stats, ch.extra, ch.id);
        }
      } else if (ch.field === 'board_drop') {
        sqlite.prepare('DELETE FROM board_drops WHERE id = ?').run(ch.target_id);
      } else if (ch.field === 'board_drop_remove') {
        const d = ch.before as any;
        sqlite
          .prepare(
            'INSERT INTO board_drops (id, board_id, x, y, inventory_entry, from_character_id) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(d.id, d.board_id, d.x, d.y, JSON.stringify(d.inventory_entry), d.from_character_id ?? null);
      } else if (ch.field === 'net_architecture') {
        if (ch.before) {
          sqlite
            .prepare('INSERT INTO rule_constants (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
            .run(`net_architecture.${ch.target_id}`, JSON.stringify(ch.before));
        }
      }
    }

    // Mark log as undone
    sqlite.prepare('UPDATE combat_log SET undone = 1 WHERE id = ?').run(latestLog.id);
  });

  undoTx();

  sessionManager.updateAllCharacterSheets();
  const updatedCombat = getHydratedCombat(combatId);
  sessionManager.broadcastCombatUpdate(updatedCombat);
  if (updatedCombat?.board_id) {
    sessionManager.broadcastBoardUpdate({ id: updatedCombat.board_id });
    sessionManager.broadcastScreenUpdate();
  }

  return c.json({ success: true, undoneLogId: latestLog.id, combat: updatedCombat });
});

/**
 * 支援要員・トラウマ・チームを戦闘に入れる（Phase 5x。日本語版 p.158〜159・224）。
 * 戦闘値（能力値＋技能）で攻撃も防御もし、弾丸は回避できない。トラウマ・チームは行動順の先頭に入る
 */
export const NO_BULLET_DODGE = '弾丸を回避できない';
combatRoutes.post('/combats/:id/squad', requireGm, async (c) => {
  const combatId = c.req.param('id')!;
  const body = await c.req.json();
  const cb = db.select().from(combats).where(eq(combats.id, combatId)).get();
  if (!cb) return c.json({ error: 'Combat not found' }, 404);
  const data = loadRoleData().squads ?? {};
  const type = body.type === 'trauma' ? 'trauma' : 'lawman';
  const list = type === 'trauma' ? (data.trauma ?? []) : (data.lawman ?? []).filter((s: any) => s.ranks === body.tier);
  if (list.length === 0) return c.json({ error: '支援要員のデータがありません（手元のルール資料 roles.json）' }, 400);
  const side = body.side === 'enemy' ? 'enemy' : 'ally';
  const before = db.select().from(combat_participants).where(eq(combat_participants.combat_id, combatId)).all();
  const currentActorId = before.slice().sort((a, b) => a.order_index - b.order_index)[cb.turn_index]?.id ?? null;
  const now = Date.now();
  const result = sqlite.transaction(() => {
    const createdIds: string[] = [];
    for (const m of list) {
      // 戦闘値 = 能力値 + 技能。技能を 6 にそろえ、能力値を戦闘値 − 6 にする
      const stat = Math.max(0, m.combat - 6);
      const skills = Object.fromEntries(['handgun', 'shoulder_arms', 'heavy_weapons', 'autofire', 'melee_weapon', 'brawling', 'evasion', 'first_aid', 'paramedic', 'perception'].map((k) => [k, 6]));
      const inventory = (m.weapons as string[]).map((en) => {
        const it = db.select().from(items).where(eq(items.name_en, en)).get();
        const w = it ? db.select().from(weapons).where(eq(weapons.item_id, it.id)).get() : null;
        return { entry_id: generateUlid(), item_id: it?.id, name: it?.name_ja || en, kind: 'weapon', qty: 1, equipped: true, ...(w?.magazine_max ? { ammo: w.magazine_max } : {}) };
      });
      const tmplId = generateUlid();
      db.insert(characters)
        .values({
          id: tmplId,
          kind: 'mook',
          name: m.name,
          role: type === 'trauma' ? 'Medtech' : 'Lawman',
          stats: JSON.stringify({ int: stat, ref: stat, dex: stat, tech: stat, cool: stat, will: stat, luck: 0, move: m.move_body, body: m.move_body, emp: 4 }),
          skills: JSON.stringify(skills),
          hp: m.hp,
          hp_max: m.hp,
          sp_head: m.sp,
          sp_body: m.sp,
          humanity: 40,
          emp_max: 4,
          inventory: JSON.stringify(inventory),
          status: JSON.stringify([NO_BULLET_DODGE]),
          notes_gm: `戦闘値 ${m.combat}（${type === 'trauma' ? 'トラウマ・チーム p.224' : 'ローマンの支援要員 p.158'}）`,
          created_at: now,
          updated_at: now,
        })
        .run();
      const ids = addCombatParticipants(combatId, { character_id: tmplId, name: m.name, side, count: m.count });
      createdIds.push(...ids.filter((x): x is string => !!x && x !== tmplId));
      db.delete(characters).where(eq(characters.id, tmplId)).run();
    }
    const after = db.select().from(combat_participants).where(eq(combat_participants.combat_id, combatId)).all();
    const added = after.filter((p) => !before.some((b) => b.id === p.id));
    // トラウマ・チームは行動順の先頭（p.224）。支援要員は 1d10 + 能力値
    const top = Math.max(0, ...before.map((p) => p.initiative)) + 1;
    for (const p of added) {
      const ch = p.character_id ? db.select().from(characters).where(eq(characters.id, p.character_id)).get() : null;
      const ref = ch ? JSON.parse(ch.stats).ref : 0;
      const first = randomInt(1, 11);
      const total = type === 'trauma' ? top : initiativeTotal(ref, first, first === 10 || first === 1 ? randomInt(1, 11) : undefined).total;
      sqlite.prepare('UPDATE combat_participants SET initiative = ?, initiative_roll = ? WHERE id = ?').run(total, JSON.stringify({ first, total, auto: true }), p.id);
    }
    const all = db.select().from(combat_participants).where(eq(combat_participants.combat_id, combatId)).all();
    const sorted = all.slice().sort((a, b) => b.initiative - a.initiative || a.order_index - b.order_index);
    sorted.forEach((p, idx) => sqlite.prepare('UPDATE combat_participants SET order_index = ? WHERE id = ?').run(idx, p.id));
    const newTurnIndex = currentActorId ? sorted.findIndex((p) => p.id === currentActorId) : cb.turn_index;
    sqlite.prepare('UPDATE combats SET turn_index = ? WHERE id = ?').run(Math.max(0, newTurnIndex), combatId);
    const change: CombatChange = {
      target_id: combatId,
      target_name: type === 'trauma' ? 'トラウマ・チーム' : '支援要員',
      field: 'participant_join',
      before: { order: before.map((p) => ({ id: p.id, order_index: p.order_index })), turn_index: cb.turn_index },
      after: { participant_ids: added.map((p) => p.id), created_character_ids: createdIds, token_ids: [] },
      desc: `到着: ${added.map((p) => p.name).join('、')}`,
    };
    sqlite
      .prepare(`INSERT INTO combat_log (id, combat_id, round, actor_id, action_key, input, breakdown, changes, undone, at) VALUES (?, ?, ?, ?, 'join', ?, '{}', ?, 0, ?)`)
      .run(generateUlid(), combatId, cb.round, added[0]?.id ?? combatId, JSON.stringify(body), JSON.stringify([change]), Date.now());
    return added.map((p) => p.name);
  });
  const names = result();
  sessionManager.announceCombat(type === 'trauma' ? 'トラウマ・チーム到着' : '支援要員到着', `${names.join('、')}（戦闘値で判定、弾丸は回避できない）`);
  const updated = getHydratedCombat(combatId);
  sessionManager.broadcastCombatUpdate(updated);
  return c.json({ combat: updated, added: names }, 201);
});

/**
 * POST /api/combats/:id/move-token: 戦闘中に GM がコマの位置を直す（Phase 6a）。
 * 移動力を消費せずにコマを動かし、戦闘ログに「GM がコマを動かした: 名前 (x1,y1)→(x2,y2)」を残す。
 * 「一手戻る」（POST /api/combats/:id/undo）で元の位置に戻せる。
 */
combatRoutes.post('/combats/:id/move-token', requireGm, async (c) => {
  const combatId = c.req.param('id');
  if (!combatId) return c.json({ error: 'Missing combat ID' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const tokenId = typeof body.token_id === 'string' ? body.token_id : '';
  const x = Number(body.x);
  const y = Number(body.y);
  if (!tokenId || !Number.isInteger(x) || !Number.isInteger(y)) {
    return c.json({ error: 'token_id, x, y が必要です' }, 400);
  }

  const cb = db.select().from(combats).where(eq(combats.id, combatId)).get();
  if (!cb) return c.json({ error: 'Combat not found' }, 404);
  if (!cb.board_id) return c.json({ error: '盤面が設定されていません' }, 400);

  const boardRow = db.select().from(boards).where(eq(boards.id, cb.board_id)).get();
  if (!boardRow) return c.json({ error: 'Board not found' }, 404);

  let cols = 20;
  let rows = 15;
  try {
    const grid = JSON.parse(boardRow.grid || '{}');
    if (typeof grid.cols === 'number') cols = grid.cols;
    if (typeof grid.rows === 'number') rows = grid.rows;
  } catch {
    // ignore
  }
  if (x < 0 || x >= cols || y < 0 || y >= rows) {
    return c.json({ error: 'そのマスへは移動できません（盤面の外です）' }, 400);
  }

  const tok = db
    .select()
    .from(board_tokens)
    .where(and(eq(board_tokens.id, tokenId), eq(board_tokens.board_id, cb.board_id)))
    .get();
  if (!tok) return c.json({ error: 'コマが見つかりません' }, 404);

  // 通れない置物（!obj.passable）があるマスには置けない
  const objs = db.select().from(board_objects).where(eq(board_objects.board_id, cb.board_id)).all();
  const blockingObj = objs.find(
    (obj) => !obj.passable && x >= obj.x && x < obj.x + obj.w && y >= obj.y && y < obj.y + obj.h,
  );
  if (blockingObj) {
    return c.json(
      { error: `そのマスへは移動できません（通れない置物「${blockingObj.label || '障害物'}」があります）` },
      400,
    );
  }

  // ほかのコマがいるマスには置けない
  const otherTok = db
    .select()
    .from(board_tokens)
    .where(and(eq(board_tokens.board_id, cb.board_id), eq(board_tokens.x, x), eq(board_tokens.y, y)))
    .all()
    .find((t) => t.id !== tok.id);
  if (otherTok) {
    return c.json({ error: 'そのマスへは移動できません（ほかのコマがいます）' }, 400);
  }

  if (tok.x === x && tok.y === y) {
    const updated = getHydratedCombat(combatId);
    return c.json({ combat: updated });
  }

  const parts = db.select().from(combat_participants).where(eq(combat_participants.combat_id, combatId)).all();
  const part = parts.find(
    (p) => (p.character_id && p.character_id === tok.character_id) || p.id === tok.character_id,
  );
  const charRow =
    !part && tok.character_id
      ? db.select().from(characters).where(eq(characters.id, tok.character_id)).get()
      : null;
  const tokenName = part?.name || charRow?.name || (tok.gm_only ? 'GM' : 'コマ');
  const desc = `GM がコマを動かした: ${tokenName} (${tok.x},${tok.y})→(${x},${y})`;

  const change: CombatChange = {
    target_id: tok.id,
    target_name: tokenName,
    field: 'token_position',
    before: { x: tok.x, y: tok.y },
    after: { x, y },
    desc,
  };

  sqlite.transaction(() => {
    db.update(board_tokens).set({ x, y }).where(eq(board_tokens.id, tok.id)).run();
    sqlite
      .prepare(
        `INSERT INTO combat_log (id, combat_id, round, actor_id, action_key, input, breakdown, changes, undone, at)
         VALUES (?, ?, ?, ?, 'gm_move', ?, ?, ?, 0, ?)`,
      )
      .run(
        generateUlid(),
        combatId,
        cb.round,
        part?.id ?? null,
        JSON.stringify({ token_id: tok.id, x, y }),
        JSON.stringify({ formula: desc }),
        JSON.stringify([change]),
        Date.now(),
      );
  })();

  const updatedCombat = getHydratedCombat(combatId);
  sessionManager.broadcastCombatUpdate(updatedCombat);
  sessionManager.broadcastBoardUpdate({ id: cb.board_id });
  sessionManager.broadcastScreenUpdate();

  return c.json({ combat: updatedCombat });
});
