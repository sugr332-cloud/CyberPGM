import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { eq, like } from 'drizzle-orm';
import { db, sqlite } from '../db/client.js';
import { characters, combat_participants, combats, items, rule_constants, weapons } from '../db/schema.js';
import { requireGm } from '../auth.js';
import { sessionManager } from '../session.js';
import { getHydratedCombat, NO_BULLET_DODGE } from './combat.js';
import {
  BLACK_ICE_CATALOG,
  calculateArchitecturePriceEb,
  CombatChange,
  DECK_SLOTS,
  DEFAULT_FLOORS_TABLE,
  DEFAULT_LOBBY_TABLE,
  DEMON_CATALOG,
  findBlackIce,
  findDemon,
  findNetHardware,
  findNetProgram,
  generateNetArchitecture,
  generateUlid,
  getProjectRoot,
  NET_DIFFICULTIES,
  NET_HARDWARE,
  NET_PROGRAMS,
  NET_SECURITIES,
  NetArchitecture,
  NetDeckConfig,
  NetDifficultyKey,
  NetFloor,
  NetrunData,
  parseFloorRaw,
  validateCyberdeck,
  validateNetArchitectureDemons,
} from '@cyberpgm/shared';
import type { AppDatabase } from '../db/client.js';

export const netrunRoutes = new Hono();

/**
 * 手元のルール資料 data/sources/core-ja/netrun.json を読む（Phase 5z）。
 * ファイルが無ければ内蔵の定義・空構造で動作する
 */
export function loadNetrunData(): NetrunData {
  const fallback: NetrunData = {
    blackIce: BLACK_ICE_CATALOG,
    demons: DEMON_CATALOG,
    difficulties: {
      basic: { name: '初歩的', dv: 6 },
      standard: { name: '標準的', dv: 8 },
      uncommon: { name: '例外的', dv: 10 },
      advanced: { name: '先進的', dv: 12 },
    },
    lobby: DEFAULT_LOBBY_TABLE,
    floors: DEFAULT_FLOORS_TABLE,
    decks: DECK_SLOTS,
  };
  try {
    const p = path.join(getProjectRoot(), 'data', 'sources', 'core-ja', 'netrun.json');
    if (!fs.existsSync(p)) return fallback;
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return {
      blackIce: Array.isArray(raw.blackIce) && raw.blackIce.length > 0 ? raw.blackIce : fallback.blackIce,
      demons: Array.isArray(raw.demons) && raw.demons.length > 0 ? raw.demons : fallback.demons,
      difficulties: raw.difficulties ?? fallback.difficulties,
      lobby: Array.isArray(raw.lobby) && raw.lobby.length > 0 ? raw.lobby : fallback.lobby,
      floors: raw.floors ?? fallback.floors,
      decks: raw.decks ?? fallback.decks,
    };
  } catch {
    return fallback;
  }
}

export function getNetArchitecture(id: string, dbInst: AppDatabase = db): NetArchitecture | null {
  const key = id.startsWith('net_architecture.') ? id : `net_architecture.${id}`;
  const row = dbInst.select().from(rule_constants).where(eq(rule_constants.key, key)).get();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as NetArchitecture;
  } catch {
    return null;
  }
}

export function listNetArchitectures(dbInst: AppDatabase = db): NetArchitecture[] {
  const rows = dbInst.select().from(rule_constants).where(like(rule_constants.key, 'net_architecture.%')).all();
  const list: NetArchitecture[] = [];
  for (const r of rows) {
    try {
      const arch = JSON.parse(r.value) as NetArchitecture;
      if (arch && arch.id) list.push(arch);
    } catch {
      // ignore malformed
    }
  }
  return list.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
}

export function saveNetArchitecture(arch: NetArchitecture, dbInst: AppDatabase = db): NetArchitecture {
  const key = `net_architecture.${arch.id}`;
  const existing = dbInst.select().from(rule_constants).where(eq(rule_constants.key, key)).get();
  const value = JSON.stringify(arch);
  if (existing) {
    dbInst.update(rule_constants).set({ value, note: `NET Architecture: ${arch.name}` }).where(eq(rule_constants.key, key)).run();
  } else {
    dbInst.insert(rule_constants).values({ key, value, note: `NET Architecture: ${arch.name}` }).run();
  }
  return arch;
}

function normalizeFloors(floors: Array<Partial<NetFloor> & { n?: number; node?: string; note?: string }>, defaultDv: number): NetFloor[] {
  return floors.map((f, idx) => {
    const floorNum = f.floor ?? f.n ?? idx + 1;
    const depth = f.depth ?? floorNum;
    const branch = f.branch || 'main';
    const raw = f.raw || (f.kind === 'password' ? `password:${f.dv ?? defaultDv}` : f.kind === 'file' ? `file:${f.dv ?? defaultDv}` : f.kind === 'control' ? `control:${f.dv ?? defaultDv}` : f.kind === 'demon' && f.demon ? `demon:${f.demon}` : f.kind === 'ice' && f.ice?.length ? `ice:${f.ice.join(',')}` : 'file:6');
    const parsed = parseFloorRaw(raw, defaultDv);
    return {
      floor: floorNum,
      depth,
      branch,
      parent_floor: f.parent_floor ?? (floorNum > 1 ? floorNum - 1 : null),
      ...parsed,
      ...(f.node ? { node: f.node } : {}),
      ...(f.note ? { note: f.note } : {}),
    } as NetFloor;
  });
}

// GET /api/netrun/data: ルール一覧（ブラックICE・デーモン・プログラム・ハードウェア・防衛設備・難易度）
netrunRoutes.get('/netrun/data', (c) => {
  const data = loadNetrunData();
  return c.json({
    ...data,
    programs: NET_PROGRAMS,
    hardware: NET_HARDWARE,
    securities: NET_SECURITIES,
    homePrices: NET_DIFFICULTIES,
  });
});

// GET /api/netrun/architectures: NET アーキテクチャ一覧
netrunRoutes.get('/netrun/architectures', (c) => {
  const list = listNetArchitectures().map((a) => ({
    ...a,
    price_info: calculateArchitecturePriceEb(a),
  }));
  return c.json({ architectures: list });
});

// GET /api/netrun/architectures/:id: 個別取得（?player=1 なら DV を伏せる）
netrunRoutes.get('/netrun/architectures/:id', (c) => {
  const arch = getNetArchitecture(c.req.param('id')!);
  if (!arch) return c.json({ error: 'NET アーキテクチャが見つかりません' }, 404);
  const isPlayer = c.req.query('player') === '1';
  if (isPlayer) {
    const revealedParam = (c.req.query('revealed') || '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n) && n > 0);
    const revealedSet = new Set(revealedParam);
    const safeFloors = arch.floors.map((f) => {
      if (revealedSet.size > 0 && !revealedSet.has(f.floor)) {
        return { floor: f.floor, depth: f.depth, branch: f.branch, parent_floor: f.parent_floor, kind: 'unknown', label: '？' };
      }
      // プレイヤーには DV を出さない
      const cleanLabel = (f.label || '').replace(/\s*\(DV\s*\d+\)/gi, '');
      return {
        floor: f.floor,
        depth: f.depth,
        branch: f.branch,
        parent_floor: f.parent_floor,
        kind: f.kind,
        label: cleanLabel || f.kind,
        ice: f.ice,
        demon: f.demon,
      };
    });
    return c.json({
      architecture: {
        id: arch.id,
        name: arch.name,
        difficulty: arch.difficulty,
        floors: safeFloors,
      },
    });
  }
  return c.json({ architecture: { ...arch, price_info: calculateArchitecturePriceEb(arch) } });
});

// POST /api/netrun/architectures: 新規作成・自動生成（GM）
netrunRoutes.post('/netrun/architectures', requireGm, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const difficulty: NetDifficultyKey = ['basic', 'standard', 'uncommon', 'advanced'].includes(body.difficulty)
    ? body.difficulty
    : 'standard';
  const diffDef = NET_DIFFICULTIES[difficulty];
  const data = loadNetrunData();

  let arch: NetArchitecture;
  if (body.auto !== false && (!Array.isArray(body.floors) || body.floors.length === 0)) {
    arch = generateNetArchitecture({
      name: body.name,
      difficulty,
      data,
      floorCount: typeof body.floor_count === 'number' ? body.floor_count : undefined,
    });
    if (body.notes) arch.notes = String(body.notes);
  } else {
    const now = Date.now();
    const floors = normalizeFloors(
      Array.isArray(body.floors) && body.floors.length > 0
        ? body.floors
        : [
            { floor: 1, depth: 1, branch: 'main', raw: 'password:6' },
            { floor: 2, depth: 2, branch: 'main', raw: 'file:6' },
            { floor: 3, depth: 3, branch: 'main', raw: 'control:6' },
          ],
      diffDef.dv,
    );
    const demonErr = validateNetArchitectureDemons(floors);
    if (demonErr) return c.json({ error: demonErr }, 400);
    arch = {
      id: body.id || generateUlid(),
      name: (body.name || '').trim() || `${diffDef.name} NET アーキテクチャ`,
      difficulty,
      dv: diffDef.dv,
      floors,
      viruses: Array.isArray(body.viruses) ? body.viruses : [],
      notes: body.notes ? String(body.notes) : undefined,
      created_at: now,
      updated_at: now,
    };
  }

  saveNetArchitecture(arch);
  return c.json({ architecture: { ...arch, price_info: calculateArchitecturePriceEb(arch) } }, 201);
});

// PUT /api/netrun/architectures/:id: 更新（GM）
netrunRoutes.put('/netrun/architectures/:id', requireGm, async (c) => {
  const id = c.req.param('id')!;
  const existing = getNetArchitecture(id);
  if (!existing) return c.json({ error: 'NET アーキテクチャが見つかりません' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const difficulty: NetDifficultyKey = ['basic', 'standard', 'uncommon', 'advanced'].includes(body.difficulty)
    ? body.difficulty
    : existing.difficulty;
  const diffDef = NET_DIFFICULTIES[difficulty];
  const floors = Array.isArray(body.floors) ? normalizeFloors(body.floors, diffDef.dv) : existing.floors;
  const demonErr = validateNetArchitectureDemons(floors);
  if (demonErr) return c.json({ error: demonErr }, 400);

  const updated: NetArchitecture = {
    ...existing,
    name: body.name !== undefined ? String(body.name).trim() || existing.name : existing.name,
    difficulty,
    dv: diffDef.dv,
    floors,
    viruses: Array.isArray(body.viruses) ? body.viruses : existing.viruses,
    notes: body.notes !== undefined ? String(body.notes) : existing.notes,
    updated_at: Date.now(),
  };
  saveNetArchitecture(updated);
  return c.json({ architecture: { ...updated, price_info: calculateArchitecturePriceEb(updated) } });
});

// DELETE /api/netrun/architectures/:id: 削除（GM）
netrunRoutes.delete('/netrun/architectures/:id', requireGm, (c) => {
  const id = c.req.param('id')!;
  const key = id.startsWith('net_architecture.') ? id : `net_architecture.${id}`;
  db.delete(rule_constants).where(eq(rule_constants.key, key)).run();
  return c.json({ success: true });
});

// POST /api/netrun/deck/:charId: サイバーデッキの構成を更新（スロット上限・ブラックICE 2スロット検査）
netrunRoutes.post('/netrun/deck/:charId', async (c) => {
  const charId = c.req.param('charId')!;
  const row = db.select().from(characters).where(eq(characters.id, charId)).get();
  if (!row) return c.json({ error: 'キャラクターが見つかりません' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const extra = JSON.parse(row.extra || '{}');
  const curDeck: NetDeckConfig = extra.deck ?? { quality: 'Standard', slots: 7, programs: [], black_ice: [], hardware: [] };

  // バックアップ・ドライブからの復元（肉体アクション）
  if (body.restore_backup) {
    const saved = curDeck.backup_saved ?? [];
    if (saved.length === 0) return c.json({ error: 'バックアップ・ドライブに保存されたプログラムはありません' }, 400);
    const nextDeck: NetDeckConfig = {
      ...curDeck,
      programs: [...(curDeck.programs ?? []), ...saved],
      backup_saved: [],
    };
    const check = validateCyberdeck(nextDeck);
    if (!check.ok) return c.json({ error: check.error }, 400);
    extra.deck = nextDeck;
    db.update(characters).set({ extra: JSON.stringify(extra), updated_at: Date.now() }).where(eq(characters.id, charId)).run();
    sessionManager.updateCharacterSheet(charId);
    return c.json({ deck: nextDeck, used_slots: check.used, max_slots: check.max });
  }

  const quality: 'Poor' | 'Standard' | 'Excellent' =
    body.quality === 'Poor' || body.quality === 'Standard' || body.quality === 'Excellent'
      ? body.quality
      : curDeck.quality ?? 'Standard';
  const slots = typeof body.slots === 'number' && [5, 7, 9].includes(body.slots) ? body.slots : DECK_SLOTS[quality];
  const programs = Array.isArray(body.programs)
    ? body.programs.map((p: string) => findNetProgram(p)?.en ?? p)
    : curDeck.programs ?? [];
  const black_ice = Array.isArray(body.black_ice)
    ? body.black_ice.map((b: string) => findBlackIce(b)?.en ?? b)
    : curDeck.black_ice ?? [];
  const hardware = Array.isArray(body.hardware)
    ? body.hardware.map((h: string) => findNetHardware(h)?.en ?? h)
    : curDeck.hardware ?? [];

  const nextDeck: NetDeckConfig = {
    quality,
    slots,
    programs,
    black_ice,
    hardware,
    backup_saved: Array.isArray(body.backup_saved) ? body.backup_saved : curDeck.backup_saved ?? [],
  };

  const check = validateCyberdeck(nextDeck);
  if (!check.ok) {
    return c.json({ error: check.error, used_slots: check.used, max_slots: check.max }, 400);
  }

  extra.deck = nextDeck;
  db.update(characters).set({ extra: JSON.stringify(extra), updated_at: Date.now() }).where(eq(characters.id, charId)).run();
  sessionManager.updateCharacterSheet(charId);
  return c.json({ deck: nextDeck, used_slots: check.used, max_slots: check.max });
});

// POST /api/netrun/restore-drain/:charId: プログラム・ブラックICEによる能力値低下を回復（GM）
netrunRoutes.post('/netrun/restore-drain/:charId', requireGm, (c) => {
  const charId = c.req.param('charId')!;
  const row = db.select().from(characters).where(eq(characters.id, charId)).get();
  if (!row) return c.json({ error: 'キャラクターが見つかりません' }, 404);
  const extra = JSON.parse(row.extra || '{}');
  const stats = JSON.parse(row.stats || '{}');
  if (extra.net_drain?.stats) {
    for (const [k, v] of Object.entries(extra.net_drain.stats)) {
      if (typeof v === 'number') stats[k] = (stats[k] ?? 0) + v;
    }
    delete extra.net_drain;
    db.update(characters)
      .set({ stats: JSON.stringify(stats), extra: JSON.stringify(extra), updated_at: Date.now() })
      .where(eq(characters.id, charId))
      .run();
    sessionManager.updateCharacterSheet(charId);
  }
  return c.json({ ok: true, stats });
});

/**
 * POST /api/combats/:id/net-join:
 * ブラック ICE、デーモン、または防衛設備（砲塔・ドローン・レーザーグリッド等）を戦闘に参加させる（Phase 5z）。
 * - ブラック ICE・デーモンは行動順のいちばん上（max(initiative) + 1）に入る
 * - 動けない防衛設備は「弾丸を回避できない」と「回避できない」を付与する
 * - Undo で参加ごと取り消せるように participant_join を combat_log に残す
 */
netrunRoutes.post('/combats/:id/net-join', requireGm, async (c) => {
  const combatId = c.req.param('id')!;
  const cb = db.select().from(combats).where(eq(combats.id, combatId)).get();
  if (!cb) return c.json({ error: 'Combat not found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const kind: 'ice' | 'demon' | 'security' = body.kind === 'demon' ? 'demon' : body.kind === 'security' ? 'security' : 'ice';
  const side: 'ally' | 'enemy' = body.side === 'ally' ? 'ally' : 'enemy';

  const before = db.select().from(combat_participants).where(eq(combat_participants.combat_id, combatId)).all();
  const currentActorId = before.slice().sort((a, b) => a.order_index - b.order_index)[cb.turn_index]?.id ?? null;
  const topInit = Math.max(20, ...before.map((p) => p.initiative)) + 1;
  const now = Date.now();

  let displayName = '';
  let hp = 15;
  let sp = 0;
  let move = 0;
  let combatNum = 14;
  let actionsPerTurn = 1;
  let statusList: string[] = [];
  let weaponEn: string | undefined;
  let netIceState: Record<string, any> | undefined;

  if (kind === 'ice') {
    const ice = findBlackIce(body.key || body.name);
    if (!ice) return c.json({ error: 'ブラック ICE を選んでください' }, 400);
    displayName = body.custom_name || ice.name;
    hp = ice.rez;
    move = ice.spd;
    combatNum = 10 + ice.atk;
    statusList = [NO_BULLET_DODGE];
    netIceState = {
      is_ice: true,
      ice_key: ice.en,
      name: ice.name,
      class: ice.class,
      per: ice.per,
      spd: ice.spd,
      atk: ice.atk,
      def: ice.def,
      rez: ice.rez,
      rez_max: ice.rez,
      effect: ice.effect,
      dice: ice.dice,
      forceOut: ice.forceOut,
      fire: ice.fire,
      pin: ice.pin,
      statsDown: ice.statsDown,
      destroyDefender: ice.destroyDefender,
      slow: ice.slow,
      arch_id: body.arch_id ?? null,
      floor: Number(body.floor ?? 1),
      target_participant_id: body.target_participant_id ?? null,
      owner_participant_id: body.owner_participant_id ?? null,
    };
  } else if (kind === 'demon') {
    const demon = findDemon(body.key || body.name);
    if (!demon) return c.json({ error: 'デーモンを選んでください' }, 400);
    displayName = body.custom_name || demon.name;
    hp = demon.rez;
    combatNum = demon.combat;
    actionsPerTurn = demon.actions;
    statusList = [NO_BULLET_DODGE];
    netIceState = {
      is_demon: true,
      ice_key: demon.en,
      name: demon.name,
      class: 'demon',
      per: demon.interface,
      spd: demon.interface,
      atk: demon.interface,
      def: demon.interface,
      rez: demon.rez,
      rez_max: demon.rez,
      interface: demon.interface,
      combat_number: demon.combat,
      arch_id: body.arch_id ?? null,
      floor: Number(body.floor ?? 1),
    };
  } else {
    const sec = NET_SECURITIES.find((s) => s.key === body.key || s.name === body.key || s.name === body.name);
    if (!sec) return c.json({ error: '防衛設備を選んでください' }, 400);
    displayName = body.custom_name || sec.name;
    hp = sec.hp ?? 10;
    sp = sec.sp;
    move = sec.move;
    combatNum = sec.combat || 14;
    weaponEn = body.weapon_en || sec.defaultWeaponEn;
    statusList = sec.stationary ? [NO_BULLET_DODGE, '回避できない'] : [NO_BULLET_DODGE];
  }

  const statVal = Math.max(4, combatNum - 6);
  const skills = Object.fromEntries(
    ['handgun', 'shoulder_arms', 'heavy_weapons', 'autofire', 'melee_weapon', 'brawling', 'evasion', 'perception'].map((k) => [k, 6]),
  );
  const inventory: any[] = [];
  if (weaponEn) {
    const it = db.select().from(items).where(eq(items.name_en, weaponEn)).get();
    const w = it ? db.select().from(weapons).where(eq(weapons.item_id, it.id)).get() : null;
    inventory.push({
      entry_id: generateUlid(),
      item_id: it?.id,
      name: it?.name_ja || weaponEn,
      kind: 'weapon',
      qty: 1,
      equipped: true,
      ...(w?.magazine_max ? { ammo: w.magazine_max } : {}),
    });
  }

  const joinTx = sqlite.transaction(() => {
    const charId = generateUlid();
    db.insert(characters)
      .values({
        id: charId,
        kind: 'mook',
        name: displayName,
        role: kind === 'demon' || kind === 'ice' ? 'Netrunner' : 'Solo',
        stats: JSON.stringify({
          int: statVal,
          ref: statVal,
          dex: statVal,
          tech: statVal,
          cool: statVal,
          will: statVal,
          luck: 0,
          move: Math.max(0, move),
          body: statVal,
          emp: 0,
        }),
        skills: JSON.stringify(skills),
        hp,
        hp_max: hp,
        sp_head: sp,
        sp_body: sp,
        humanity: 0,
        emp_max: 0,
        inventory: JSON.stringify(inventory),
        status: JSON.stringify(statusList),
        extra: JSON.stringify(netIceState ? { role_ranks: { Netrunner: netIceState.interface ?? 4 } } : {}),
        notes_gm: kind === 'security' ? `防衛設備（戦闘値 ${combatNum}）` : `${displayName}（REZ ${hp}）`,
        created_at: now,
        updated_at: now,
      })
      .run();

    const partId = generateUlid();
    const partState: Record<string, any> = {
      actions_per_turn: actionsPerTurn,
      ...(netIceState ? { net_ice: netIceState } : {}),
    };
    db.insert(combat_participants)
      .values({
        id: partId,
        combat_id: combatId,
        character_id: charId,
        side,
        name: displayName,
        initiative: topInit,
        initiative_roll: JSON.stringify({ first: 10, total: topInit, auto: true }),
        order_index: 0,
        active: true,
        out: false,
        move_used: false,
        action_used: false,
        state: JSON.stringify(partState),
      })
      .run();

    const all = db.select().from(combat_participants).where(eq(combat_participants.combat_id, combatId)).all();
    const sorted = all.slice().sort((a, b) => b.initiative - a.initiative || a.order_index - b.order_index);
    sorted.forEach((p, idx) => sqlite.prepare('UPDATE combat_participants SET order_index = ? WHERE id = ?').run(idx, p.id));
    const newTurnIndex = currentActorId ? sorted.findIndex((p) => p.id === currentActorId) : cb.turn_index;
    sqlite.prepare('UPDATE combats SET turn_index = ? WHERE id = ?').run(Math.max(0, newTurnIndex), combatId);

    const change: CombatChange = {
      target_id: combatId,
      target_name: displayName,
      field: 'participant_join',
      before: { order: before.map((p) => ({ id: p.id, order_index: p.order_index })), turn_index: cb.turn_index },
      after: { participant_ids: [partId], created_character_ids: [charId], token_ids: [] },
      desc: `参戦: ${displayName}（行動順の先頭）`,
    };
    sqlite
      .prepare(
        `INSERT INTO combat_log (id, combat_id, round, actor_id, action_key, input, breakdown, changes, undone, at)
         VALUES (?, ?, ?, ?, 'join', ?, '{}', ?, 0, ?)`,
      )
      .run(generateUlid(), combatId, cb.round, partId, JSON.stringify(body), JSON.stringify([change]), now);

    return { partId, charId };
  });

  const added = joinTx();
  sessionManager.announceCombat('NET・防衛', `${displayName} が戦闘に加わった（行動順の先頭）`);
  const updated = getHydratedCombat(combatId);
  sessionManager.broadcastCombatUpdate(updated);
  const participant = updated?.participants.find((p: any) => p.id === added.partId);
  return c.json({ combat: updated, participant, participant_id: added.partId, character_id: added.charId }, 201);
});
