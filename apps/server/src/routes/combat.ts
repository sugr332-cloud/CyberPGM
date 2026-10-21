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
} from '../db/schema.js';
import { requireGm } from '../auth.js';
import { sessionManager } from '../session.js';
import { formatCharacterRow } from '../character-helper.js';
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
} from '@cyberpgm/shared';
import { resolveCombatAction, actionsAllowed, WEAPON_NAME_ALIASES } from '../services/combat-resolver.js';
import { woundState, initiativeTotal } from '@cyberpgm/rules';
import { randomInt } from 'node:crypto';
import { linkTextWeapons } from '../weapon-link.js';

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
          stats: formatted.stats,
          skills: formatted.skills,
          hp: formatted.hp,
          hp_max: formatted.hp_max,
          sp_head: formatted.sp_head,
          sp_body: formatted.sp_body,
          weapons: formatted.weapons,
          inventory: hydratedInventory,
          cyberware: formatted.cyberware,
          status: formatted.status,
          crit_injuries: formatted.crit_injuries,
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
    const sanitizedParticipants = current.participants.map((p) => {
      const isMine = p.character_id === userCharId;
      if (isMine) return p;

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
      return p;
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
    tieBreak: 'ref',
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
      const ref = ch ? (JSON.parse(ch.stats).ref as number) : 0;
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
  if (curPart) {
    const st = JSON.parse(curPart.state || '{}');
    delete st.actions_taken;
    delete st.bonus_actions;
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
  if (roundIncrement > 0) {
    updates.round = cb.round + roundIncrement;
    // Decrement status rounds on participants
    for (const p of db.select().from(combat_participants).where(eq(combat_participants.combat_id, combatId)).all()) {
      try {
        const st = JSON.parse(p.state || '{}');
        if (st.statusRounds) {
          const updatedRounds: Record<string, number> = {};
          for (const [sKey, rNum] of Object.entries(st.statusRounds as Record<string, number>)) {
            if (rNum > 1) updatedRounds[sKey] = rNum - 1;
          }
          st.statusRounds = updatedRounds;
          db.update(combat_participants)
            .set({ state: JSON.stringify(st) })
            .where(eq(combat_participants.id, p.id))
            .run();
        }
      } catch {
        // ignore
      }
    }
  }
  db.update(combats).set(updates).where(eq(combats.id, combatId)).run();

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

  const result = resolveCombatAction(db, parsed.data, actor, target, combat.participants, combat.board_id, combat.settings);
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
  const result = resolveCombatAction(db, parsed.data, actor, target, combat.participants, combat.board_id, combat.settings);
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
          if (afterObj.deathSavePenalty !== undefined) newState.deathSavePenalty = afterObj.deathSavePenalty;
          if (afterObj.actions_taken !== undefined) newState.actions_taken = afterObj.actions_taken;

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
      }
    }
  });

  applyTx();

  // 移動アクションとアクションを使い切った、または行動した人が倒れたら、自動で次の手番へ（Phase 5j）
  // 同じログに 'turn' の変化として残すので、「取り消し」で手番も戻る
  let autoAdvanced = false;
  const cbNow = db.select().from(combats).where(eq(combats.id, combatId)).get();
  const actorNow = db.select().from(combat_participants).where(eq(combat_participants.id, actor.id)).get();
  const ordered = getHydratedCombat(combatId)?.participants ?? [];
  if (
    cbNow?.status === 'active' &&
    actorNow &&
    ordered[cbNow.turn_index]?.id === actor.id &&
    ((actorNow.move_used && actorNow.action_used) || actorNow.out)
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
    const playerChanges = result.changes
      .filter((ch) => {
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
          if (beforeObj.deathSavePenalty !== undefined) newState.deathSavePenalty = beforeObj.deathSavePenalty;
          if (beforeObj.actions_taken !== undefined) newState.actions_taken = beforeObj.actions_taken;

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
      } else if (ch.field === 'board_drop') {
        sqlite.prepare('DELETE FROM board_drops WHERE id = ?').run(ch.target_id);
      } else if (ch.field === 'board_drop_remove') {
        const d = ch.before as any;
        sqlite
          .prepare(
            'INSERT INTO board_drops (id, board_id, x, y, inventory_entry, from_character_id) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(d.id, d.board_id, d.x, d.y, JSON.stringify(d.inventory_entry), d.from_character_id ?? null);
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
