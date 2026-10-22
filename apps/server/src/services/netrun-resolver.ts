import {
  ActiveFloorIce,
  BlackIceDef,
  CombatChange,
  CombatParticipant,
  findBlackIce,
  findDemon,
  findNetProgram,
  formatSkillName,
  generateUlid,
  hasDeckHardware,
  hasVirtualityGoggles,
  hazardStatus,
  NET_DIFFICULTIES,
  netAccessRangeM,
  netActionsForRank,
  NetArchitecture,
  NetDeckConfig,
  NetFloor,
  NetRunState,
  RezzedProgram,
  roleRank,
  skillNameToKey,
} from '@cyberpgm/shared';
import {
  BoardObstacle,
  checkLineOfSight,
  DEFAULT_RULES,
  gridDistance,
  resolveD10,
  woundPenalty,
  woundState,
} from '@cyberpgm/rules';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { board_objects, board_tokens, boards, characters, rule_constants } from '../db/schema.js';
import { effectiveForChecks } from '../character-helper.js';
import { getNetArchitecture } from '../routes/netrun.js';
import type { ResolveResult } from './combat-resolver.js';

export const UNPROTECTED_NET_STATUS = 'ネット中（肉体は無防備）';

export function interfaceRankOf(ch: { role: string; extra?: Record<string, any>; skills?: Record<string, number> }): number {
  const r = roleRank(ch.role, ch.extra, 'Netrunner');
  if (r > 0) return r;
  return Number(ch.extra?.role_ranks?.Netrunner ?? ch.skills?.interface ?? ch.skills?.Interface ?? 0);
}

export function defaultNetState(cur?: Partial<NetRunState> | null): NetRunState {
  return {
    arch_id: cur?.arch_id ?? null,
    depth: cur?.depth ?? 0,
    branch: cur?.branch ?? 'main',
    jacked_in: Boolean(cur?.jacked_in),
    rezzed: Array.isArray(cur?.rezzed) ? cur!.rezzed.map((r) => ({ ...r })) : [],
    broken: Array.isArray(cur?.broken) ? [...cur!.broken] : [],
    armor_used_copies: Array.isArray(cur?.armor_used_copies) ? [...cur!.armor_used_copies] : [],
    shield_used_copies: Array.isArray(cur?.shield_used_copies) ? [...cur!.shield_used_copies] : [],
    superglue_used_copies: Array.isArray(cur?.superglue_used_copies) ? [...cur!.superglue_used_copies] : [],
    controlled: Array.isArray(cur?.controlled) ? [...cur!.controlled] : [],
    controlled_used_this_turn: Array.isArray(cur?.controlled_used_this_turn) ? [...cur!.controlled_used_this_turn] : [],
    unlocked_passwords: Array.isArray(cur?.unlocked_passwords) ? [...cur!.unlocked_passwords] : [],
    identified_files: Array.isArray(cur?.identified_files) ? [...cur!.identified_files] : [],
    slid_ice: Array.isArray(cur?.slid_ice) ? [...cur!.slid_ice] : [],
    slid_this_turn: Boolean(cur?.slid_this_turn),
    active_ice: Array.isArray(cur?.active_ice) ? cur!.active_ice.map((x) => ({ ...x })) : [],
    net_used: Number(cur?.net_used ?? 0),
    skunk: Number(cur?.skunk ?? 0),
    pinned_until: cur?.pinned_until,
    pinned_by_ice: cur?.pinned_by_ice,
    slowed: Boolean(cur?.slowed),
    slowed_just_set: Boolean(cur?.slowed_just_set),
    revealed: Array.isArray(cur?.revealed) ? [...cur!.revealed] : [],
    cloak: cur?.cloak,
    virus_progress: cur?.virus_progress ? { ...cur.virus_progress } : null,
  };
}

function getAccessPointLinksMap(db: AppDatabase): Record<string, string> {
  const row = db.select().from(rule_constants).where(eq(rule_constants.key, 'net_access_points')).get();
  if (!row) return {};
  try {
    return JSON.parse(row.value) || {};
  } catch {
    return {};
  }
}

export function checkAccessPointConnection(
  db: AppDatabase,
  boardId: string | null | undefined,
  actorChar: NonNullable<CombatParticipant['character']>,
  tokenPos: { x: number; y: number } | null,
  archId: string | null | undefined,
  diagonalRule: 'chebyshev' | 'alternate' = 'chebyshev',
): { ok: boolean; distM?: number; error?: string; apLabel?: string } {
  if (!boardId || !tokenPos) return { ok: true };
  const allObs = db.select().from(board_objects).where(eq(board_objects.board_id, boardId)).all();
  const apObjs = allObs.filter((o) => o.kind === 'access_point');
  if (apObjs.length === 0) return { ok: true };

  const links = getAccessPointLinksMap(db);
  const matching = archId
    ? apObjs.filter((o) => links[o.id] === archId || o.label.includes(archId))
    : [];
  const candidates = matching.length > 0 ? matching : apObjs;

  const boardRow = db.select().from(boards).where(eq(boards.id, boardId)).get();
  let cellM = 2;
  try {
    const g = JSON.parse(boardRow?.grid || '{}');
    if (typeof g.cell_m === 'number' && g.cell_m > 0) cellM = g.cell_m;
  } catch {
    // ignore
  }

  const maxRangeM = netAccessRangeM(actorChar);
  const rules = { ...DEFAULT_RULES, diagonalRule, metersPerSquare: cellM };
  let minDistM = Infinity;
  let blockedWithinRange = false;

  for (const ap of candidates) {
    const distSq = gridDistance(tokenPos, { x: ap.x, y: ap.y }, rules);
    const distM = distSq * cellM;
    if (distM < minDistM) minDistM = distM;
    const obstacles = allObs.filter((o) => o.id !== ap.id) as unknown as BoardObstacle[];
    const los = checkLineOfSight(tokenPos, { x: ap.x, y: ap.y }, obstacles, rules);
    if (distM <= maxRangeM) {
      if (los.status !== 'blocked') {
        return { ok: true, distM, apLabel: ap.label || 'アクセスポイント' };
      }
      blockedWithinRange = true;
    }
  }

  if (blockedWithinRange) {
    return {
      ok: false,
      distM: minDistM,
      error: '壁・遮蔽物に遮られてアクセスポイントへの射線が通りません（アクセスポイントは射線が通る必要があります）',
    };
  }
  return {
    ok: false,
    distM: minDistM,
    error: `アクセスポイントから ${maxRangeM}m 以内にいないためネットランできません（現在 ${minDistM}m、上限 ${maxRangeM}m）`,
  };
}

interface TargetContext {
  part: CombatParticipant;
  char: NonNullable<CombatParticipant['character']>;
  net: NetRunState;
  hp: number;
  status: string[];
  stats: Record<string, number>;
  extra: Record<string, any>;
}

function makeTargetContext(part: CombatParticipant): TargetContext {
  const char = part.character!;
  const net = defaultNetState((part.state as any)?.net);
  return {
    part,
    char,
    net,
    hp: char.hp,
    status: [...(char.status ?? [])],
    stats: { ...(char.stats as unknown as Record<string, number>) },
    extra: JSON.parse(JSON.stringify(char.extra ?? {})),
  };
}

function flushTargetContextChanges(ctx: TargetContext, changes: CombatChange[], descPrefix: string) {
  const charBefore = ctx.char;
  const partBeforeState = (ctx.part.state ?? {}) as Record<string, any>;

  if (ctx.hp !== charBefore.hp) {
    changes.push({
      target_id: charBefore.id,
      target_name: charBefore.name,
      field: 'hp',
      before: charBefore.hp,
      after: ctx.hp,
      desc: `${charBefore.name} HP ${charBefore.hp} → ${ctx.hp}（${descPrefix}、脳ダメージ・防具無視）`,
    });
    const oldW = woundState(charBefore.hp, charBefore.hp_max);
    const newW = woundState(ctx.hp, charBefore.hp_max);
    if (oldW !== newW) {
      ctx.status = [
        ...ctx.status.filter((s) => s !== 'seriously' && s !== 'mortally'),
        ...(newW === 'seriously' ? ['seriously'] : newW === 'mortally' ? ['mortally'] : []),
      ];
    }
  }
  if (JSON.stringify(ctx.status) !== JSON.stringify(charBefore.status ?? [])) {
    changes.push({
      target_id: charBefore.id,
      target_name: charBefore.name,
      field: 'status',
      before: charBefore.status ?? [],
      after: ctx.status,
      desc: `${charBefore.name} 状態更新`,
    });
  }
  if (JSON.stringify(ctx.stats) !== JSON.stringify(charBefore.stats)) {
    changes.push({
      target_id: charBefore.id,
      target_name: charBefore.name,
      field: 'stats',
      before: charBefore.stats,
      after: ctx.stats,
      desc: `${charBefore.name} 能力値変化（1 時間）`,
    });
  }
  if (JSON.stringify(ctx.extra) !== JSON.stringify(charBefore.extra ?? {})) {
    changes.push({
      target_id: charBefore.id,
      target_name: charBefore.name,
      field: 'extra',
      before: charBefore.extra ?? {},
      after: ctx.extra,
      desc: `${charBefore.name} デッキ・能力値記録更新`,
    });
  }
  if (JSON.stringify(ctx.net) !== JSON.stringify(partBeforeState.net ?? null)) {
    changes.push({
      target_id: ctx.part.id,
      target_name: ctx.part.name,
      field: 'state',
      before: { net: partBeforeState.net ?? null },
      after: { net: ctx.net },
      desc: `${ctx.part.name} NET 状態更新`,
    });
  }
}

/**
 * 脳への直接ダメージ（防具 SP を無視）。
 * - 非ブラック ICE からの最初の脳ダメージは「シールド」が防いで停止する
 * - 「アーマー」が起動中なら 4 点軽減する（各コピー 1 ネットラン 1 回）
 */
function applyBrainDamage(
  ctx: TargetContext,
  rawDamage: number,
  fromBlackIce: boolean,
  sourceName: string,
): string {
  if (rawDamage <= 0) return `${sourceName}: 0 ダメージ`;
  if (!fromBlackIce) {
    const shieldIdx = ctx.net.rezzed.findIndex((r) => findNetProgram(r.key)?.en === 'Shield' && r.rez > 0);
    if (shieldIdx >= 0) {
      const sh = ctx.net.rezzed[shieldIdx];
      ctx.net.rezzed.splice(shieldIdx, 1);
      if (sh.copy_index !== undefined) {
        ctx.net.shield_used_copies = [...(ctx.net.shield_used_copies ?? []), sh.copy_index];
      }
      return `${sourceName}: シールドが脳ダメージ（${rawDamage}）を完全に防いで停止した`;
    }
  }

  let dmg = rawDamage;
  let armorNote = '';
  const armorIdx = ctx.net.rezzed.findIndex(
    (r) =>
      findNetProgram(r.key)?.en === 'Armor' &&
      r.rez > 0 &&
      !(ctx.net.armor_used_copies ?? []).includes(r.copy_index ?? 0),
  );
  if (armorIdx >= 0) {
    const arm = ctx.net.rezzed[armorIdx];
    dmg = Math.max(0, rawDamage - 4);
    ctx.net.armor_used_copies = [...(ctx.net.armor_used_copies ?? []), arm.copy_index ?? 0];
    ctx.net.rezzed.splice(armorIdx, 1);
    armorNote = `（アーマー −4 → ${dmg}）`;
  }

  const beforeHp = ctx.hp;
  ctx.hp = Math.max(0, ctx.hp - dmg);
  return `${sourceName}: 脳ダメージ ${rawDamage}${armorNote} → HP ${beforeHp} → ${ctx.hp}`;
}

/**
 * サイバーデッキ上の非ブラック ICE プログラムを 1 つ破壊する（バックアップ・ドライブがあれば保存）
 */
function destroyProgramOnDeck(ctx: TargetContext, filterClass?: string, preferredKey?: string): string {
  const deck: NetDeckConfig = ctx.extra.deck ?? { quality: 'Standard', slots: 7, programs: [], black_ice: [], hardware: [] };
  const hasBackup = hasDeckHardware({ extra: ctx.extra, inventory: ctx.char.inventory as any }, 'Backup Drive');

  let targetKey: string | undefined;
  const rezzedIdx = ctx.net.rezzed.findIndex((r) => {
    const def = findNetProgram(r.key);
    if (!def) return false;
    if (preferredKey && def.en.toLowerCase() !== preferredKey.toLowerCase() && def.name !== preferredKey) return false;
    if (filterClass && def.class !== filterClass) return false;
    return true;
  });

  if (rezzedIdx >= 0) {
    const removed = ctx.net.rezzed.splice(rezzedIdx, 1)[0];
    targetKey = findNetProgram(removed.key)?.en ?? removed.key;
  } else {
    const progList = deck.programs ?? [];
    const deckIdx = progList.findIndex((k) => {
      const def = findNetProgram(k);
      if (preferredKey && (def?.en ?? k).toLowerCase() !== preferredKey.toLowerCase() && def?.name !== preferredKey) return false;
      if (filterClass && def?.class !== filterClass) return false;
      return true;
    });
    if (deckIdx >= 0) {
      targetKey = findNetProgram(progList[deckIdx])?.en ?? progList[deckIdx];
    }
  }

  if (!targetKey) {
    return '対象となるプログラムがありません';
  }

  const progDef = findNetProgram(targetKey);
  const jaName = progDef?.name ?? targetKey;
  ctx.net.broken = [...(ctx.net.broken ?? []), targetKey];

  const progs = [...(deck.programs ?? [])];
  const rmIdx = progs.findIndex((p) => (findNetProgram(p)?.en ?? p) === targetKey);
  if (rmIdx >= 0) progs.splice(rmIdx, 1);

  const backupSaved = [...(deck.backup_saved ?? [])];
  if (hasBackup) backupSaved.push(targetKey);

  ctx.extra.deck = {
    ...deck,
    programs: progs,
    backup_saved: backupSaved,
  };

  return hasBackup
    ? `プログラム「${jaName}」が破壊された（バックアップ・ドライブに保存）`
    : `プログラム「${jaName}」が破壊され消滅した`;
}

function applyStatDrain(ctx: TargetContext, statsToDrain: Array<'int' | 'ref' | 'dex' | 'move'>, dice: number[], sourceName: string): string {
  const curDrain = ctx.extra.net_drain ?? { hours: 1, stats: {} };
  const drainStats: Record<string, number> = { ...(curDrain.stats ?? {}) };
  const parts: string[] = [];

  statsToDrain.forEach((stKey, i) => {
    const roll = dice[i] ?? dice[0] ?? 3;
    const beforeVal = ctx.stats[stKey] ?? 1;
    const afterVal = Math.max(1, beforeVal - roll);
    const diff = beforeVal - afterVal;
    ctx.stats[stKey] = afterVal;
    drainStats[stKey] = (drainStats[stKey] ?? 0) + diff;
    parts.push(`${stKey.toUpperCase()} ${beforeVal} → ${afterVal} (−${roll})`);
  });

  ctx.extra.net_drain = {
    hours: 1,
    stats: drainStats,
  };

  return `${sourceName}: 1 時間能力値低下 [${parts.join('、')}]（最低 1）`;
}

/**
 * ブラック ICE 1 体の命中効果を適用する
 */
export function applyBlackIceEffect(
  ice: BlackIceDef,
  ctx: TargetContext,
  dicePool: number[],
  opts: { iceId?: string; isOwnTurn?: boolean; targetProgramKey?: string } = {},
): { note: string; triggersForceOut: boolean; diceConsumed: number } {
  const takeDice = (count: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      out.push(dicePool.length > 0 ? dicePool.shift()! : 3);
    }
    return out;
  };

  if (ice.class === 'antiprogram') {
    const count = ice.dice ?? 4;
    const rolled = takeDice(count);
    const dmg = rolled.reduce((a, b) => a + b, 0);
    const rezzedIdx = opts.targetProgramKey
      ? ctx.net.rezzed.findIndex((r) => r.key === opts.targetProgramKey || findNetProgram(r.key)?.en === opts.targetProgramKey)
      : 0;
    const targetProg = ctx.net.rezzed[rezzedIdx >= 0 ? rezzedIdx : 0];
    if (!targetProg) {
      return { note: `${ice.name}: 攻撃対象の起動中プログラムがありません`, triggersForceOut: false, diceConsumed: count };
    }
    const beforeRez = targetProg.rez;
    const afterRez = Math.max(0, beforeRez - dmg);
    targetProg.rez = afterRez;
    if (afterRez === 0) {
      const destroyNote = destroyProgramOnDeck(ctx, undefined, targetProg.key);
      return {
        note: `${ice.name}: ${targetProg.name} に ${count}d6 = ${dmg} REZ ダメージ（REZ ${beforeRez} → 0）。${destroyNote}`,
        triggersForceOut: false,
        diceConsumed: count,
      };
    }
    return {
      note: `${ice.name}: ${targetProg.name} に ${count}d6 = ${dmg} REZ ダメージ（REZ ${beforeRez} → ${afterRez}）`,
      triggersForceOut: false,
      diceConsumed: count,
    };
  }

  // 対人ブラック ICE
  if (ice.effect === 'destroy_program') {
    // アスプ
    const destroyNote = destroyProgramOnDeck(ctx);
    return { note: `${ice.name}: ${destroyNote}`, triggersForceOut: false, diceConsumed: 0 };
  }

  if (ice.effect === 'skunk') {
    // スカンク
    ctx.net.skunk = (ctx.net.skunk ?? 0) + 1;
    return {
      note: `${ice.name}: 停止させるまでスライド判定に −2（現在 −${ctx.net.skunk * 2}）`,
      triggersForceOut: false,
      diceConsumed: 0,
    };
  }

  if (ice.effect === 'stats' && ice.statsDown) {
    // リッチ / スコーピオン
    const need = ice.statsDown.length === 1 ? 1 : dicePool.length >= 3 ? 3 : 1;
    const rolled = takeDice(need);
    const note = applyStatDrain(ctx, ice.statsDown, rolled, ice.name);
    return { note, triggersForceOut: false, diceConsumed: need };
  }

  // 脳ダメージ系（ジャイアント・ヘルハウンド・クラーケン・レイヴン・ウィスプ）
  const notes: string[] = [];
  if (ice.destroyDefender) {
    // レイヴン: 先にディフェンダーを 1 つ破壊してから 1d6 脳ダメージ
    const hasDef = ctx.net.rezzed.some((r) => findNetProgram(r.key)?.class === 'defender');
    if (hasDef) {
      notes.push(destroyProgramOnDeck(ctx, 'defender'));
    }
  }

  const diceCount = ice.dice ?? 1;
  const rolled = takeDice(diceCount);
  const rawDmg = rolled.reduce((a, b) => a + b, 0);
  notes.push(applyBrainDamage(ctx, rawDmg, true, ice.name));

  let triggersForceOut = false;
  if (ice.fire) {
    // ヘルハウンド: インスレーテッド・ワイヤリングが無ければ着火（小）
    if (hasDeckHardware({ extra: ctx.extra, inventory: ctx.char.inventory as any }, 'Insulated Wiring')) {
      notes.push('インスレーテッド・ワイヤリングにより着火無効');
    } else {
      const fireSt = hazardStatus('fire', 'small')!;
      if (!ctx.status.includes(fireSt)) ctx.status.push(fireSt);
      notes.push(`「${fireSt}」（毎ターン終了時 HP に直接 2 ダメージ）`);
    }
  }

  if (ice.pin) {
    // クラーケン: 倒すまで移動封じ・安全なジャックアウト不可
    ctx.net.pinned_until = 999;
    ctx.net.pinned_by_ice = opts.iceId || 'Kraken';
    notes.push('移動封じ（クラーケンを停止させるまで先へ進めず、安全にジャックアウトできない）');
  }

  if (ice.slow) {
    // ウィスプ: 次のターンの NET アクション −1（最低 2）
    ctx.net.slowed = true;
    if (opts.isOwnTurn) ctx.net.slowed_just_set = true;
    notes.push('次のターンの NET アクション −1（最低 2）');
  }

  if (ice.forceOut) {
    // ジャイアント: KRASHバリアが無ければ強制的に安全でないジャックアウト
    if (hasDeckHardware({ extra: ctx.extra, inventory: ctx.char.inventory as any }, 'KRASH Barrier')) {
      notes.push('KRASHバリアにより強制ジャックアウト無効');
    } else {
      triggersForceOut = true;
      notes.push('強制的に安全でないジャックアウト発生');
    }
  }

  return { note: notes.join(' / '), triggersForceOut, diceConsumed: diceCount };
}

/**
 * 安全でないジャックアウトを実行する。
 * 残っている（倒しても振り切ってもいない）すべての対人ブラック ICE の効果を 1 回ずつ受けてから接続が切れる。
 */
export function executeUnsafeJackOut(
  ctx: TargetContext,
  allParticipants: CombatParticipant[] | undefined,
  dicePool: number[],
  excludeIceId?: string,
): string[] {
  const notes: string[] = [];
  const slidSet = new Set(ctx.net.slid_ice ?? []);

  // 1. active_ice（アーキテクチャ内で遭遇中）
  const activeIces: Array<{ id: string; def: BlackIceDef }> = [];
  for (const ai of ctx.net.active_ice ?? []) {
    if (ai.rez <= 0 || slidSet.has(ai.id) || ai.id === excludeIceId) continue;
    const def = findBlackIce(ai.en || ai.name);
    if (def && def.class === 'antipersonnel') {
      activeIces.push({ id: ai.id, def });
    }
  }

  // 2. 戦闘参加者として入っているブラック ICE
  for (const p of allParticipants ?? []) {
    if (p.out || !p.active || slidSet.has(p.id) || p.id === excludeIceId) continue;
    const ni = (p.state as any)?.net_ice;
    if (!ni?.is_ice || ni.rez <= 0) continue;
    if (ni.owner_participant_id === ctx.part.id) continue;
    if (activeIces.some((x) => x.id === p.id)) continue;
    const def = findBlackIce(ni.ice_key || ni.name);
    if (def && def.class === 'antipersonnel') {
      activeIces.push({ id: p.id, def });
    }
  }

  for (const item of activeIces) {
    const res = applyBlackIceEffect(item.def, ctx, dicePool, { iceId: item.id });
    notes.push(`[残留ICE] ${res.note}`);
  }

  // 接続切断と状態の初期化
  ctx.net.jacked_in = false;
  ctx.net.depth = 0;
  ctx.net.rezzed = [];
  ctx.net.controlled = [];
  ctx.net.controlled_used_this_turn = [];
  ctx.net.active_ice = [];
  ctx.net.skunk = 0;
  ctx.net.pinned_until = undefined;
  ctx.net.pinned_by_ice = undefined;
  ctx.net.virus_progress = null;
  ctx.status = ctx.status.filter((s) => s !== UNPROTECTED_NET_STATUS);
  notes.push('安全でないジャックアウトにより NET から切断された');

  return notes;
}

/**
 * 移動（move / run）でアクセスポイントから 6m（8m）を超えて離れたか検査し、
 * 超えていたらただちに安全でないジャックアウトを発動する
 */
export function checkMoveBreaksNetrun(
  db: AppDatabase,
  boardId: string | null | undefined,
  actorPart: CombatParticipant,
  destination: { x: number; y: number } | undefined,
  allParticipants: CombatParticipant[] | undefined,
  diagonalRule: 'chebyshev' | 'alternate' = 'chebyshev',
  dicePool: number[] = [],
): { formulaNote?: string; changes: CombatChange[] } {
  const actorChar = actorPart.character;
  const curNet = (actorPart.state as any)?.net as NetRunState | undefined;
  if (!actorChar || !curNet?.jacked_in || !boardId || !destination) {
    return { changes: [] };
  }
  const check = checkAccessPointConnection(db, boardId, actorChar, destination, curNet.arch_id, diagonalRule);
  if (check.ok) return { changes: [] };

  const ctx = makeTargetContext(actorPart);
  const notes = executeUnsafeJackOut(ctx, allParticipants, [...dicePool]);
  const changes: CombatChange[] = [];
  flushTargetContextChanges(ctx, changes, 'アクセスポイント範囲外による強制切断');
  return {
    formulaNote: ` 【範囲外切断】アクセスポイントから離れたため安全でないジャックアウト発生: ${notes.join(' / ')}`,
    changes,
  };
}

/**
 * 肉体への攻撃や窒息などでジャックイン中のネットランナーが瀕死（HP <= 0）または気絶になったとき、
 * まだ切断されていなければ安全でないジャックアウトを発生させる
 */
export function checkIncapacitatedBreaksNetrun(
  changes: CombatChange[],
  participants: CombatParticipant[],
  dicePool: number[] = [],
): string | null {
  const extraNotes: string[] = [];
  for (const p of participants) {
    if (!p?.character) continue;
    const curNet = (p.state as any)?.net as NetRunState | undefined;
    if (!curNet?.jacked_in) continue;
    // すでにこの行動で net 状態が切断されていればスキップ
    const alreadyJackedOut = changes.some(
      (c) => c.target_id === p.id && c.field === 'state' && (c.after as any)?.net && !(c.after as any).net.jacked_in,
    );
    if (alreadyJackedOut) continue;

    const hpChange = [...changes].reverse().find((c) => c.target_id === p.character!.id && c.field === 'hp');
    const statusChange = [...changes].reverse().find((c) => c.target_id === p.character!.id && c.field === 'status');
    const hpAfter = hpChange ? Number(hpChange.after) : p.character.hp;
    const statusAfter = statusChange ? (statusChange.after as string[]) : (p.character.status ?? []);

    const isIncapacitated =
      (hpChange && hpAfter <= 0) ||
      (statusChange && (statusAfter.includes('気絶') || statusAfter.includes('mortally')));
    if (!isIncapacitated) continue;

    const ctx = makeTargetContext(p);
    ctx.hp = hpAfter;
    ctx.status = [...statusAfter];
    const notes = executeUnsafeJackOut(ctx, participants, [...dicePool]);
    const subChanges: CombatChange[] = [];
    flushTargetContextChanges(ctx, subChanges, '気絶・瀕死による強制切断');
    for (const sc of subChanges) {
      // 既存の hp / status 変化を上書き更新または追加
      if (sc.field === 'hp' && hpChange) {
        hpChange.after = sc.after;
        hpChange.desc += ` → ${sc.after}（安全でないジャックアウト）`;
      } else if (sc.field === 'status' && statusChange) {
        statusChange.after = sc.after;
      } else {
        changes.push(sc);
      }
    }
    extraNotes.push(`【強制切断】${p.name} が行動不能になったため安全でないジャックアウト発生: ${notes.join(' / ')}`);
  }
  return extraNotes.length > 0 ? ` ｜ ${extraNotes.join(' ｜ ')}` : null;
}

/**
 * net_action, net_ice_attack, scanner の解決
 */
export function resolveNetCombatAction(
  db: AppDatabase,
  input: any,
  actorPart: CombatParticipant,
  targetPart: CombatParticipant | undefined,
  allParticipants: CombatParticipant[] | undefined,
  boardId: string | null | undefined,
  combatSettings: Record<string, any> | undefined,
): ResolveResult {
  const actorChar = actorPart.character!;
  const round = Number(combatSettings?.__round ?? 1);
  const luck = Math.max(0, input.luck_spent ?? 0);
  const luckText = luck ? ` +${luck}（運命）` : '';
  const diagonalRule = (combatSettings?.diagonalRule as 'chebyshev' | 'alternate') || 'chebyshev';

  const fail = (msg: string | string[]): ResolveResult => {
    const list = Array.isArray(msg) ? msg : [msg];
    return {
      action_key: input.action_key,
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      target_id: targetPart?.id,
      target_name: targetPart?.name,
      success: false,
      formula: list.join(' / '),
      breakdown: { missing_inputs: list },
      changes: [],
      missing_inputs: list,
    };
  };

  const d10 = (roll: { first: number; extra?: number } | undefined, label: string): number | string => {
    if (!roll) return `${label}の出目 (1d10) を入力してください`;
    if ((roll.first === 10 || roll.first === 1) && roll.extra === undefined) {
      return `${label}${roll.first === 10 ? 'クリティカル' : 'ファンブル'}: 追加出目 (1d10) を入力してください`;
    }
    return resolveD10(roll.first, roll.extra).value;
  };

  // ── 1. アクセスポイントを探す（スキャナ）: TECH + 電子／セキュリティ技術（+ テク現場エンジニア）+ 1d10 ──
  if (input.action_key === 'scanner') {
    const r = d10(input.attack_roll, '〈電子／セキュリティ技術〉');
    if (typeof r === 'string') return fail(r);

    // DBにキャラがあれば生の技能から effectiveForChecks を計算して二重加算を防ぐ
    const rawRow = db.select().from(characters).where(eq(characters.id, actorChar.id)).get();
    const eff = rawRow
      ? effectiveForChecks(JSON.parse(rawRow.stats), JSON.parse(rawRow.skills), JSON.parse(rawRow.extra || '{}'), rawRow.role)
      : effectiveForChecks(actorChar.stats, actorChar.skills, actorChar.extra, actorChar.role);

    const tech = eff.stats.tech;
    const skillKey = skillNameToKey('electronics_security_tech');
    const skillLvl = eff.skills[skillKey] ?? 0;
    const fieldBonus = roleRank(actorChar.role, actorChar.extra, 'Tech') > 0 ? Number((actorChar.extra as any)?.maker?.field ?? 0) : 0;
    const rawSkillLvl = Math.max(0, skillLvl - fieldBonus);
    const woundPen = eff.ignoreSeriousWound && woundState(actorChar.hp, actorChar.hp_max) === 'seriously' ? 0 : woundPenalty(woundState(actorChar.hp, actorChar.hp_max));
    const dv = Number(input.net?.scanner_dv ?? 13);
    const total = tech + skillLvl + woundPen + luck + r;
    const success = total > dv;

    let apSummary = '';
    if (boardId && actorPart.character_id) {
      const tok = db
        .select()
        .from(board_tokens)
        .where(and(eq(board_tokens.board_id, boardId), eq(board_tokens.character_id, actorPart.character_id)))
        .get();
      const allObs = db.select().from(board_objects).where(eq(board_objects.board_id, boardId)).all();
      const apObjs = allObs.filter((o) => o.kind === 'access_point');
      if (tok && apObjs.length > 0) {
        const rules = { ...DEFAULT_RULES, diagonalRule };
        const found = apObjs.filter((ap) => {
          const distM = gridDistance({ x: tok.x, y: tok.y }, { x: ap.x, y: ap.y }, rules) * 2;
          const los = checkLineOfSight({ x: tok.x, y: tok.y }, { x: ap.x, y: ap.y }, allObs.filter((o) => o.id !== ap.id) as unknown as BoardObstacle[], rules);
          return distM <= 50 && los.status !== 'blocked';
        });
        const names = found.map((ap) => ap.label || 'アクセスポイント').join('、');
        apSummary = found.length > 0 ? `（50m 以内・射線内のアクセスポイント ${found.length} 箇所 [${names}] を検知）` : '（50m 以内・射線内にアクセスポイントなし）';
      }
    }

    const actorSt = (actorPart.state ?? {}) as Record<string, unknown>;
    const taken = Number(actorSt.actions_taken ?? 0);
    const allowed = Math.max(1, Number(actorSt.actions_per_turn ?? 1)) + Math.max(0, Number(actorSt.bonus_actions ?? 0));
    const formula = `スキャナ（50m 以内のアクセスポイント探知）: TECH ${tech} + ${formatSkillName(skillKey)} ${rawSkillLvl}${fieldBonus ? ` + 現場エンジニア ${fieldBonus}` : ''}${woundPen ? ` ${woundPen}` : ''}${luckText} + 出目 ${r} = ${total} vs 難易度 ${dv} -> ${success ? `成功${apSummary}` : '失敗'}`;

    return {
      action_key: 'scanner',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success,
      formula,
      breakdown: { total, dv, fieldBonus },
      changes: [
        {
          target_id: actorPart.id,
          target_name: actorPart.name,
          field: 'state',
          before: { action_used: actorPart.action_used, actions_taken: taken },
          after: { action_used: taken + 1 >= allowed, actions_taken: taken + 1 },
          desc: `${actorPart.name} アクション使用 (スキャナ)`,
        },
      ],
    };
  }

  // ── 2. ブラック ICE の攻撃（net_ice_attack） ──
  if (input.action_key === 'net_ice_attack') {
    const actorIce = (actorPart.state as any)?.net_ice;
    const tPart = actorIce ? targetPart : (targetPart ?? actorPart);
    if (!tPart?.character) return fail('攻撃対象のネットランナーを選んでください');

    const tCtx = makeTargetContext(tPart);
    let iceDef: BlackIceDef | undefined;
    let iceId = actorPart.id;

    if (actorIce) {
      iceDef = findBlackIce(actorIce.ice_key || actorIce.name);
    } else {
      const reqId = input.net?.target_ice_id || input.net?.program_key;
      const foundActive = (tCtx.net.active_ice ?? []).find((x) => x.id === reqId || x.en === reqId || x.name === reqId) ?? tCtx.net.active_ice?.[0];
      if (foundActive) {
        iceId = foundActive.id;
        iceDef = findBlackIce(foundActive.en || foundActive.name);
      } else if (reqId) {
        iceDef = findBlackIce(reqId);
      }
    }

    if (!iceDef) return fail('攻撃するブラック ICE を選んでください');

    const atkR = d10(input.attack_roll, 'ブラック ICE 攻撃');
    const defR = d10(input.defense_roll, '防御');
    const missing: string[] = [];
    if (typeof atkR === 'string') missing.push(atkR);
    if (typeof defR === 'string') missing.push(defR);

    const atkTotal = typeof atkR === 'number' ? iceDef.atk + atkR : 0;
    const tRank = interfaceRankOf(tCtx.char);
    const defBase = iceDef.class === 'antiprogram' ? 0 : tRank;
    const defTotal = typeof defR === 'number' ? defBase + defR : 0;
    const hit = atkTotal > defTotal;

    const neededDice =
      iceDef.effect === 'brain' || iceDef.effect === 'program'
        ? (iceDef.dice ?? 1)
        : iceDef.effect === 'stats'
          ? 1
          : 0;
    if (missing.length === 0 && hit && neededDice > 0 && (!input.damage_dice || input.damage_dice.length < neededDice)) {
      missing.push(`${iceDef.name} の効果ダイス (${neededDice}d6) の出目を入力してください`);
    }
    if (missing.length > 0) return fail(missing);

    const dicePool = [...(input.damage_dice ?? [])];
    let formula = `${iceDef.name} の攻撃: ATK ${iceDef.atk} + 出目 ${atkR} = ${atkTotal} vs ${tPart.name} ${iceDef.class === 'antiprogram' ? 'DEF 0' : `インタフェース ${tRank}`} + 出目 ${defR} = ${defTotal} -> ${hit ? '命中' : '回避'}`;
    const changes: CombatChange[] = [];

    if (actorIce) {
      const actorSt = (actorPart.state ?? {}) as Record<string, unknown>;
      const taken = Number(actorSt.actions_taken ?? 0);
      const allowed = Math.max(1, Number(actorSt.actions_per_turn ?? 1));
      changes.push({
        target_id: actorPart.id,
        target_name: actorPart.name,
        field: 'state',
        before: { action_used: actorPart.action_used, actions_taken: taken },
        after: { action_used: taken + 1 >= allowed, actions_taken: taken + 1 },
        desc: `${actorPart.name} 攻撃行動`,
      });
    }

    if (hit) {
      const eff = applyBlackIceEffect(iceDef, tCtx, dicePool, {
        iceId,
        isOwnTurn: actorPart.id === tPart.id,
        targetProgramKey: input.net?.target_program_key,
      });
      formula += `。${eff.note}`;
      if (eff.triggersForceOut) {
        const uNotes = executeUnsafeJackOut(tCtx, allParticipants, dicePool, iceId);
        formula += ` -> ${uNotes.join(' / ')}`;
      }
      flushTargetContextChanges(tCtx, changes, iceDef.name);
    }

    return {
      action_key: 'net_ice_attack',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      target_id: tPart.id,
      target_name: tPart.name,
      success: hit,
      formula,
      breakdown: { atkTotal, defTotal, hit },
      changes,
    };
  }

  // ── 3. NET アクション（net_action） ──
  const sub: string = input.net?.sub_action || 'pathfinder';
  const rank = interfaceRankOf(actorChar);
  if (rank < 1) {
    return fail('《インタフェース》（ネットランナーのロール特技）がランク 1 以上必要です');
  }

  const actorCtx = makeTargetContext(actorPart);
  const curNet = actorCtx.net;
  const maxNet = netActionsForRank(rank, Boolean(curNet.slowed));

  // 肉体アクションを既に使っていたら NET アクションは使えない（安全でないジャックアウトを除く）
  const actorSt = (actorPart.state ?? {}) as Record<string, unknown>;
  const meatActionsTaken = Number(actorSt.actions_taken ?? 0);
  if (sub !== 'unsafe_jack_out' && meatActionsTaken > 0 && curNet.net_used === 0) {
    return fail('このターンは既に肉体のアクションを使用しているため、NET アクションは使えません');
  }

  const usesNetAction = !['descend', 'unsafe_jack_out'].includes(sub);
  if (usesNetAction && curNet.net_used >= maxNet) {
    return fail(`このターンの NET アクション（最大 ${maxNet} 回）はすべて使い切っています`);
  }

  const getArch = (archId?: string | null): NetArchitecture | null => {
    const id = archId || input.net?.arch_id || curNet.arch_id;
    if (!id) return null;
    return getNetArchitecture(id, db);
  };

  const hasBooster = (enName: string) =>
    curNet.rezzed.some((r) => findNetProgram(r.key)?.en === enName && r.rez > 0);

  const runnerSpdBonus = () => (hasBooster('Speedy Gonzalvez') ? 2 : 0);

  const changes: CombatChange[] = [];
  const consumeNetAction = (label: string) => {
    if (!usesNetAction) return;
    actorCtx.net.net_used = curNet.net_used + 1;
    changes.push({
      target_id: actorPart.id,
      target_name: actorPart.name,
      field: 'state',
      before: { action_used: actorPart.action_used },
      after: { action_used: true },
      desc: `${actorPart.name} NET アクション (${label}) ${actorCtx.net.net_used}/${maxNet}`,
    });
  };

  // フロアに入ったときにそこにある未遭遇のブラック ICE を active_ice に登録する
  const spawnFloorIce = (arch: NetArchitecture | null, floorNum: number, dicePool: number[]): string[] => {
    if (!arch) return [];
    const fl = arch.floors.find((f) => f.floor === floorNum);
    if (!fl || !fl.ice || fl.ice.length === 0) return [];
    const notes: string[] = [];
    const slidSet = new Set(actorCtx.net.slid_ice ?? []);
    fl.ice.forEach((iceKey, idx) => {
      const iceId = `arch-${arch.id}-f${floorNum}-${idx}`;
      if (slidSet.has(iceId)) return;
      if ((actorCtx.net.active_ice ?? []).some((x) => x.id === iceId)) return;
      const def = findBlackIce(iceKey);
      if (!def) return;
      (actorCtx.net.active_ice ??= []).push({
        id: iceId,
        floor: floorNum,
        en: def.en,
        name: def.name,
        class: def.class,
        per: def.per,
        spd: def.spd,
        atk: def.atk,
        def: def.def,
        rez: def.rez,
        rez_max: def.rez,
      });
      if (def.effect === 'skunk') {
        actorCtx.net.skunk = (actorCtx.net.skunk ?? 0) + 1;
      }
      // 先制攻撃の出目（ice_rolls）が渡されていればここで先制判定を解決する
      const ambushRollSpec = input.net?.ice_rolls?.[idx];
      if (ambushRollSpec?.ice_roll && ambushRollSpec?.runner_roll) {
        const iceR = resolveD10(ambushRollSpec.ice_roll.first, ambushRollSpec.ice_roll.extra).value;
        const runR = resolveD10(ambushRollSpec.runner_roll.first, ambushRollSpec.runner_roll.extra).value;
        const iceSpdTotal = def.spd + iceR;
        const runSpdTotal = rank + runnerSpdBonus() + runR;
        if (iceSpdTotal >= runSpdTotal) {
          const eff = applyBlackIceEffect(def, actorCtx, ambushRollSpec.damage_dice ? [...ambushRollSpec.damage_dice] : dicePool, {
            iceId,
            isOwnTurn: true,
          });
          notes.push(`${def.name} 先制攻撃成功 (SPD ${def.spd}+${iceR}=${iceSpdTotal} ≥ ${runSpdTotal}): ${eff.note}`);
          if (eff.triggersForceOut) {
            const uNotes = executeUnsafeJackOut(actorCtx, allParticipants, dicePool, iceId);
            notes.push(...uNotes);
          }
        } else {
          notes.push(`${def.name} 先制攻撃回避 (SPD ${def.spd}+${iceR}=${iceSpdTotal} < ${runSpdTotal})`);
        }
      } else {
        notes.push(`ブラック ICE「${def.name}」(REZ ${def.rez}) に遭遇`);
      }
    });
    return notes;
  };

  // ── 3a. ジャックイン（jack_in） ──
  if (sub === 'jack_in') {
    if (curNet.jacked_in) return fail('すでにジャックインしています');
    const arch = getArch(input.net?.arch_id);
    const archId = arch?.id ?? input.net?.arch_id ?? 'default';

    // 盤面にアクセスポイントがあれば 6m（レンジ・アップグレードで 8m）以内・射線を検査
    if (boardId && actorPart.character_id) {
      const tok = db
        .select()
        .from(board_tokens)
        .where(and(eq(board_tokens.board_id, boardId), eq(board_tokens.character_id, actorPart.character_id)))
        .get();
      if (tok) {
        const apCheck = checkAccessPointConnection(db, boardId, actorChar, { x: tok.x, y: tok.y }, arch?.id, diagonalRule);
        if (!apCheck.ok) return fail(apCheck.error!);
      }
    }

    consumeNetAction('ジャックイン');
    actorCtx.net.jacked_in = true;
    actorCtx.net.arch_id = archId;
    actorCtx.net.depth = 1;
    actorCtx.net.branch = 'main';
    actorCtx.net.revealed = Array.from(new Set([...(actorCtx.net.revealed ?? []), 1]));
    actorCtx.net.armor_used_copies = [];
    actorCtx.net.shield_used_copies = [];
    actorCtx.net.superglue_used_copies = [];

    const hasGoggles = hasVirtualityGoggles(actorChar);
    if (!hasGoggles && !actorCtx.status.includes(UNPROTECTED_NET_STATUS)) {
      actorCtx.status.push(UNPROTECTED_NET_STATUS);
    }

    const iceNotes = spawnFloorIce(arch, 1, [...(input.damage_dice ?? [])]);
    flushTargetContextChanges(actorCtx, changes, 'ジャックイン');

    const goggleNote = hasGoggles
      ? 'バーチャリティ・ゴーグル着用'
      : `バーチャリティ・ゴーグル無し（状態「${UNPROTECTED_NET_STATUS}」付与）`;
    const formula = `ジャックイン: ${arch?.name ?? archId} の第 1 階層に接続（${goggleNote}）${iceNotes.length ? `。${iceNotes.join(' / ')}` : ''}`;

    return {
      action_key: 'net_action',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: true,
      formula,
      breakdown: { sub_action: 'jack_in', arch_id: archId, depth: 1 },
      changes,
    };
  }

  // これ以降のサブアクションはジャックイン中のみ
  if (!curNet.jacked_in) {
    return fail('ジャックインしていません。先に「ジャックイン」を行なってください');
  }

  const arch = getArch();

  // ── 3b. 安全なジャックアウト（jack_out） ──
  if (sub === 'jack_out') {
    if ((curNet.pinned_until !== undefined && curNet.pinned_until >= round) || curNet.pinned_by_ice) {
      return fail('クラーケンまたはスーパーグルーで移動を封じられているため、安全にジャックアウトできません');
    }
    consumeNetAction('ジャックアウト');
    actorCtx.net.jacked_in = false;
    actorCtx.net.depth = 0;
    actorCtx.net.rezzed = [];
    actorCtx.net.controlled = [];
    actorCtx.net.controlled_used_this_turn = [];
    actorCtx.net.active_ice = [];
    actorCtx.net.skunk = 0;
    actorCtx.net.pinned_until = undefined;
    actorCtx.net.pinned_by_ice = undefined;
    actorCtx.net.virus_progress = null;
    actorCtx.status = actorCtx.status.filter((s) => s !== UNPROTECTED_NET_STATUS);
    flushTargetContextChanges(actorCtx, changes, 'ジャックアウト');

    return {
      action_key: 'net_action',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: true,
      formula: `${actorPart.name} が安全にジャックアウトした（起動中プログラムと制御ノードを解除）`,
      breakdown: { sub_action: 'jack_out' },
      changes,
    };
  }

  // ── 3c. 安全でないジャックアウト（unsafe_jack_out） ──
  if (sub === 'unsafe_jack_out') {
    const notes = executeUnsafeJackOut(actorCtx, allParticipants, [...(input.damage_dice ?? [])]);
    flushTargetContextChanges(actorCtx, changes, '安全でないジャックアウト');
    return {
      action_key: 'net_action',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: true,
      formula: `安全でないジャックアウト: ${notes.join(' / ')}`,
      breakdown: { sub_action: 'unsafe_jack_out' },
      changes,
    };
  }

  // ── 3d. パスファインダー（pathfinder） ──
  if (sub === 'pathfinder') {
    const r = d10(input.attack_roll, 'パスファインダー');
    if (typeof r === 'string') return fail(r);
    const seeYaBonus = hasBooster('See Ya') ? 2 : 0;
    const total = rank + seeYaBonus + luck + r;
    consumeNetAction('パスファインダー');

    const revealed = new Set<number>(curNet.revealed ?? [curNet.depth]);
    const unlocked = new Set<number>(curNet.unlocked_passwords ?? []);
    let stoppedByPassword: NetFloor | null = null;

    if (arch) {
      // 現在の階層から出目（total）の階層数ぶん先まで見通す。ただし total を超える DV の未解除パスワードで止まる（そのパスワード階層自体は見える）
      const sortedFloors = [...arch.floors].sort((a, b) => a.floor - b.floor);
      let steps = 0;
      for (const fl of sortedFloors) {
        if (fl.floor < curNet.depth) continue;
        revealed.add(fl.floor);
        steps++;
        if (fl.kind === 'password' && !unlocked.has(fl.floor) && (fl.dv ?? arch.dv) > total) {
          stoppedByPassword = fl;
          break;
        }
        if (steps >= total) break;
      }
    } else {
      for (let f = 1; f <= total; f++) revealed.add(f);
    }

    actorCtx.net.revealed = Array.from(revealed).sort((a, b) => a - b);
    flushTargetContextChanges(actorCtx, changes, 'パスファインダー');

    const formula = `パスファインダー: インタフェース ${rank}${seeYaBonus ? ' + シーヤ 2' : ''}${luckText} + 出目 ${r} = ${total} -> 第 ${actorCtx.net.revealed.join(', ')} 階層まで視認${stoppedByPassword ? `（第 ${stoppedByPassword.floor} 階層のパスワード DV${stoppedByPassword.dv} で遮断）` : ''}`;
    return {
      action_key: 'net_action',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: true,
      formula,
      breakdown: { sub_action: 'pathfinder', total, revealed: actorCtx.net.revealed },
      changes,
    };
  }

  // ── 3e. 階層移動（descend: NET アクション消費なし） ──
  if (sub === 'descend') {
    const targetFloor = Number(input.net?.target_floor ?? curNet.depth + 1);
    if (targetFloor > curNet.depth) {
      if ((curNet.pinned_until !== undefined && curNet.pinned_until >= round) || curNet.pinned_by_ice) {
        return fail('クラーケンまたはスーパーグルーで移動を封じられているため、下の階層へ進めません');
      }
      // 現在の階層または途中に未解除のパスワードがあれば進めない
      if (arch) {
        const unlocked = new Set(curNet.unlocked_passwords ?? []);
        const curFl = arch.floors.find((f) => f.floor === curNet.depth);
        if (curFl?.kind === 'password' && !unlocked.has(curFl.floor)) {
          return fail(`第 ${curFl.floor} 階層のパスワード（DV ${curFl.dv ?? arch.dv}）をバックドアで突破しないと先へ進めません`);
        }
      }
    }
    if (arch && !arch.floors.some((f) => f.floor === targetFloor)) {
      return fail(`第 ${targetFloor} 階層は存在しません`);
    }

    actorCtx.net.depth = targetFloor;
    if (!actorCtx.net.revealed.includes(targetFloor)) {
      actorCtx.net.revealed = [...actorCtx.net.revealed, targetFloor].sort((a, b) => a - b);
    }
    const fl = arch?.floors.find((f) => f.floor === targetFloor);
    if (fl?.branch) actorCtx.net.branch = fl.branch;

    const iceNotes = spawnFloorIce(arch, targetFloor, [...(input.damage_dice ?? [])]);
    flushTargetContextChanges(actorCtx, changes, '階層移動');

    return {
      action_key: 'net_action',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: true,
      formula: `第 ${targetFloor} 階層へ移動（NET アクション消費なし）${fl?.label ? ` [${fl.label}]` : ''}${iceNotes.length ? ` — ${iceNotes.join(' / ')}` : ''}`,
      breakdown: { sub_action: 'descend', depth: targetFloor },
      changes,
    };
  }

  // ── 3f. バックドア（backdoor） ──
  if (sub === 'backdoor') {
    const r = d10(input.attack_roll, 'バックドア');
    if (typeof r === 'string') return fail(r);
    const flNum = Number(input.net?.target_floor ?? curNet.depth);
    const fl = arch?.floors.find((f) => f.floor === flNum);
    const dv = fl?.dv ?? arch?.dv ?? Number(input.net?.virus_dv ?? 8);
    const wormBonus = hasBooster('Worm') ? 2 : 0;
    const total = rank + wormBonus + luck + r;
    const success = total > dv;

    consumeNetAction('バックドア');
    if (success && !(actorCtx.net.unlocked_passwords ?? []).includes(flNum)) {
      actorCtx.net.unlocked_passwords = [...(actorCtx.net.unlocked_passwords ?? []), flNum];
    }
    flushTargetContextChanges(actorCtx, changes, 'バックドア');

    return {
      action_key: 'net_action',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success,
      formula: `バックドア（第 ${flNum} 階層パスワード）: インタフェース ${rank}${wormBonus ? ' + ワーム 2' : ''}${luckText} + 出目 ${r} = ${total} vs 難易度 ${dv} -> ${success ? '突破成功（以降の階層へ移動可）' : '失敗'}`,
      breakdown: { sub_action: 'backdoor', total, dv, success },
      changes,
    };
  }

  // ── 3g. アイディール（eyedee / eye_dee） ──
  if (sub === 'eyedee' || sub === 'eye_dee') {
    const r = d10(input.attack_roll, 'アイディール');
    if (typeof r === 'string') return fail(r);
    const flNum = Number(input.net?.target_floor ?? curNet.depth);
    const fl = arch?.floors.find((f) => f.floor === flNum);
    const dv = fl?.dv ?? arch?.dv ?? 8;
    const total = rank + luck + r;
    const success = total > dv;

    consumeNetAction('アイディール');
    if (success && !(actorCtx.net.identified_files ?? []).includes(flNum)) {
      actorCtx.net.identified_files = [...(actorCtx.net.identified_files ?? []), flNum];
    }
    flushTargetContextChanges(actorCtx, changes, 'アイディール');

    const noteText = success && fl?.note ? `（内容: ${fl.note}）` : '';
    return {
      action_key: 'net_action',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success,
      formula: `アイディール（第 ${flNum} 階層ファイル）: インタフェース ${rank}${luckText} + 出目 ${r} = ${total} vs 難易度 ${dv} -> ${success ? `成功（ファイルの内容を確認・コピー）${noteText}` : '失敗'}`,
      breakdown: { sub_action: 'eyedee', total, dv, success, note: success ? fl?.note : undefined },
      changes,
    };
  }

  // ── 3h. コントロール（control / operate_node） ──
  if (sub === 'control' || sub === 'operate_node') {
    const flNum = Number(input.net?.target_floor ?? curNet.depth);
    const fl = arch?.floors.find((f) => f.floor === flNum);
    const nodeKey = `floor-${flNum}`;
    const alreadyControlled = (curNet.controlled ?? []).includes(nodeKey);
    const nodeLabel = fl?.node || fl?.note ? `（${fl.node || fl.note}）` : '';

    if (sub === 'operate_node' || alreadyControlled) {
      if (!alreadyControlled) {
        return fail(`第 ${flNum} 階層の制御ノードはまだ支配下に置いていません（先にコントロールを行なってください）`);
      }
      // 既に支配下にある制御ノードを動かす（各ノード1ターンに1回、NETアクション1回）
      if ((curNet.controlled_used_this_turn ?? []).includes(nodeKey)) {
        return fail(`第 ${flNum} 階層の制御ノードはこのターンすでに操作済みです（同じノードは 1 ターンに 1 回まで）`);
      }
      consumeNetAction('制御ノード操作');
      actorCtx.net.controlled_used_this_turn = [...(actorCtx.net.controlled_used_this_turn ?? []), nodeKey];
      flushTargetContextChanges(actorCtx, changes, '制御ノード操作');
      return {
        action_key: 'net_action',
        actor_id: actorPart.id,
        actor_name: actorPart.name,
        success: true,
        formula: `コントロール（第 ${flNum} 階層）${nodeLabel}: 支配下の制御ノードを作動させた（判定不要）`,
        breakdown: { sub_action: 'control', node: nodeKey, operated: true },
        changes,
      };
    }

    const r = d10(input.attack_roll, 'コントロール');
    if (typeof r === 'string') return fail(r);
    // 他人やデーモンが制御していれば、その判定結果が難易度になる
    let rivalScore = 0;
    for (const p of allParticipants ?? []) {
      if (p.id === actorPart.id) continue;
      const pNet = (p.state as any)?.net as NetRunState | undefined;
      if (pNet?.controlled?.includes(nodeKey)) {
        rivalScore = Math.max(rivalScore, pNet.controlled_scores?.[nodeKey] ?? 0);
      }
    }
    const dv = rivalScore > 0 ? rivalScore : (fl?.dv ?? arch?.dv ?? 8);
    const total = rank + luck + r;
    const success = total > dv;

    consumeNetAction('コントロール');
    if (success) {
      actorCtx.net.controlled = [...(actorCtx.net.controlled ?? []), nodeKey];
      actorCtx.net.controlled_scores = { ...(actorCtx.net.controlled_scores ?? {}), [nodeKey]: total };
    }
    flushTargetContextChanges(actorCtx, changes, 'コントロール');

    return {
      action_key: 'net_action',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success,
      formula: `コントロール（第 ${flNum} 階層制御ノード）${nodeLabel}: インタフェース ${rank}${luckText} + 出目 ${r} = ${total} vs 難易度 ${dv} -> ${success ? '支配下に置いた（掌握成功）' : '失敗'}`,
      breakdown: { sub_action: 'control', total, dv, success },
      changes,
    };
  }

  // ── 3i. プログラム起動・停止（activate / rez / derez / deactivate） ──
  if (sub === 'activate' || sub === 'rez' || sub === 'derez' || sub === 'deactivate') {
    const progKey = input.net?.program_key;
    if (!progKey) return fail('起動または停止するプログラムを選んでください');
    const copyIndex = Number(input.net?.copy_index ?? 0);

    // 停止（Derez）の場合
    if (input.net?.deactivate || sub === 'derez' || sub === 'deactivate') {
      const idx = actorCtx.net.rezzed.findIndex(
        (r) => (r.key === progKey || findNetProgram(r.key)?.en === progKey || r.name === progKey) && (input.net?.copy_index === undefined || r.copy_index === copyIndex),
      );
      if (idx < 0) return fail(`「${progKey}」は起動していません`);
      const removed = actorCtx.net.rezzed.splice(idx, 1)[0];
      consumeNetAction('プログラム停止');
      flushTargetContextChanges(actorCtx, changes, 'プログラム停止');
      return {
        action_key: 'net_action',
        actor_id: actorPart.id,
        actor_name: actorPart.name,
        success: true,
        formula: `プログラム「${removed.name}」を停止（Derez）した`,
        breakdown: { sub_action: 'activate', deactivated: removed.key },
        changes,
      };
    }

    // ネットランナー自身のブラック ICE を起動する場合
    const ownIce = findBlackIce(progKey);
    if (ownIce) {
      consumeNetAction('ブラックICE起動');
      actorCtx.net.rezzed.push({
        key: ownIce.en,
        name: ownIce.name,
        class: 'black_ice',
        rez: ownIce.rez,
        rez_max: ownIce.rez,
        atk: ownIce.atk,
        def: ownIce.def,
        spd: ownIce.spd,
        per: ownIce.per,
        floor: curNet.depth,
        copy_index: copyIndex,
      });
      flushTargetContextChanges(actorCtx, changes, 'ブラックICE起動');
      return {
        action_key: 'net_action',
        actor_id: actorPart.id,
        actor_name: actorPart.name,
        success: true,
        formula: `ブラック ICE「${ownIce.name}」(REZ ${ownIce.rez}) を第 ${curNet.depth} 階層に起動（Rez）した`,
        breakdown: { sub_action: 'activate', rezzed: ownIce.en },
        changes,
      };
    }

    const progDef = findNetProgram(progKey);
    if (!progDef) return fail(`プログラム「${progKey}」が見つかりません`);

    // アーマー・シールド・フラックは同時に 1 枚しか起動できない
    if (['Armor', 'Shield', 'Flak'].includes(progDef.en)) {
      if (actorCtx.net.rezzed.some((r) => findNetProgram(r.key)?.en === progDef.en)) {
        return fail(`${progDef.name} は同時に 1 枚しか起動できません`);
      }
    }
    if (progDef.en === 'Armor' && (actorCtx.net.armor_used_copies ?? []).includes(copyIndex)) {
      return fail(`この「アーマー」（コピー #${copyIndex + 1}）はこのネットランですでに使用済みです`);
    }
    if (progDef.en === 'Shield' && (actorCtx.net.shield_used_copies ?? []).includes(copyIndex)) {
      return fail(`この「シールド」（コピー #${copyIndex + 1}）はこのネットランですでに使用済みです`);
    }

    consumeNetAction('プログラム起動');
    actorCtx.net.rezzed.push({
      key: progDef.en,
      name: progDef.name,
      class: progDef.class,
      rez: progDef.rez || 7,
      rez_max: progDef.rez || 7,
      atk: progDef.atk,
      def: progDef.def,
      copy_index: copyIndex,
    });
    flushTargetContextChanges(actorCtx, changes, 'プログラム起動');

    return {
      action_key: 'net_action',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: true,
      formula: `プログラム「${progDef.name}」(REZ ${progDef.rez || 7}、${progDef.effect}) を起動（Rez）した`,
      breakdown: { sub_action: 'activate', rezzed: progDef.en },
      changes,
    };
  }

  // ── 3j. ザップ（zap）または 攻撃プログラム（program / attack） ──
  if (sub === 'zap' || sub === 'program' || sub === 'attack') {
    const isZap = sub === 'zap';
    const progDef = isZap ? null : findNetProgram(input.net?.program_key);
    if (!isZap && !progDef) return fail('使用する攻撃プログラムを選んでください');
    if (progDef && !['antipersonnelattacker', 'antiprogramattacker'].includes(progDef.class)) {
      return fail(`${progDef.name} は攻撃プログラムではありません（「プログラム起動・停止」を使ってください）`);
    }

    const copyIndex = Number(input.net?.copy_index ?? 0);
    if (progDef?.en === 'Superglue' && (curNet.superglue_used_copies ?? []).includes(copyIndex)) {
      return fail('スーパーグルーの各コピーはネットラン 1 回につき 1 度しか使えません');
    }

    const atkR = d10(input.attack_roll, '攻撃');
    const defR = d10(input.defense_roll, '防御');
    const missing: string[] = [];
    if (typeof atkR === 'string') missing.push(atkR);
    if (typeof defR === 'string') missing.push(defR);

    // 対人攻撃プログラムか、対プログラム／ブラックICEか
    const isAntiPersonnel = progDef?.class === 'antipersonnelattacker';
    const hasExplicitParticipantTarget = Boolean(targetPart && targetPart.id !== actorPart.id && !input.net?.target_ice_id);
    const reqIceId = input.net?.target_ice_id || (!hasExplicitParticipantTarget ? input.target_id : undefined);
    const activeIceTarget =
      !isAntiPersonnel && !hasExplicitParticipantTarget
        ? (actorCtx.net.active_ice ?? []).find(
            (x) => x.rez > 0 && (x.id === reqIceId || x.en === reqIceId || x.name === reqIceId || (!reqIceId && x.floor === curNet.depth)),
          ) ?? (actorCtx.net.active_ice ?? []).find((x) => x.rez > 0)
        : undefined;

    const partIce = (targetPart?.state as any)?.net_ice;
    const isTargetBlackIce = Boolean(activeIceTarget || partIce?.is_ice);
    const isTargetDemon = Boolean(partIce?.is_demon);

    // フラック判定（目標がネットランナーで非ブラックICEの攻撃プログラムを受けるとき ATK を 0 にし停止）
    const tRunnerCtx = targetPart?.character && !partIce ? makeTargetContext(targetPart) : null;
    let flakNote = '';
    let effectiveAtk = progDef?.atk ?? 0;
    if (progDef && tRunnerCtx) {
      const flakIdx = tRunnerCtx.net.rezzed.findIndex((r) => findNetProgram(r.key)?.en === 'Flak' && r.rez > 0);
      if (flakIdx >= 0) {
        effectiveAtk = 0;
        tRunnerCtx.net.rezzed.splice(flakIdx, 1);
        flakNote = '（相手のフラックにより ATK 0、フラック停止）';
      }
    }

    const atkTotal = typeof atkR === 'number' ? rank + effectiveAtk + luck + atkR : 0;
    const defBase = activeIceTarget
      ? activeIceTarget.def
      : partIce
        ? Number(partIce.def ?? partIce.interface ?? 0)
        : tRunnerCtx
          ? interfaceRankOf(tRunnerCtx.char)
          : 0;
    const defTotal = typeof defR === 'number' ? defBase + defR : 0;
    const hit = atkTotal > defTotal;

    // 必要なダメージダイス数
    let neededDice = 0;
    if (isZap) neededDice = 1;
    else if (progDef?.en === 'Sword') neededDice = isTargetBlackIce ? 3 : 2;
    else if (progDef?.en === 'Banhammer') neededDice = isTargetBlackIce ? 2 : 3;
    else if (progDef?.en === 'Hellbolt') neededDice = 2;
    else if (['Nervescrub', 'Superglue', 'Vrizzbolt'].includes(progDef?.en ?? '')) neededDice = 1;

    if (missing.length === 0 && hit && neededDice > 0 && (!input.damage_dice || input.damage_dice.length < neededDice)) {
      missing.push(`ダメージ／効果ダイス (${neededDice}d6) の出目を入力してください`);
    }
    if (isAntiPersonnel && !tRunnerCtx) {
      missing.push('対人攻撃プログラムの目標（ネットランナー）を選択してください');
    }
    if (missing.length > 0) return fail(missing);

    consumeNetAction(isZap ? 'ザップ' : progDef!.name);
    if (progDef?.en === 'Superglue') {
      actorCtx.net.superglue_used_copies = [...(actorCtx.net.superglue_used_copies ?? []), copyIndex];
    }

    const label = isZap ? 'ザップ' : progDef!.name;
    const targetLabel = activeIceTarget?.name ?? targetPart?.name ?? 'ターゲット';
    let formula = `${label} → ${targetLabel}: インタフェース ${rank}${progDef ? ` + ATK ${effectiveAtk}` : ''}${flakNote}${luckText} + 出目 ${atkR} = ${atkTotal} vs 防御 ${defBase} + 出目 ${defR} = ${defTotal} -> ${hit ? '命中' : '外れ'}`;

    const dicePool = [...(input.damage_dice ?? [])];
    if (hit) {
      if (isAntiPersonnel && tRunnerCtx && progDef) {
        // 対人攻撃プログラム 6 種
        switch (progDef.en) {
          case 'DeckKRASH': {
            if (hasDeckHardware({ extra: tRunnerCtx.extra, inventory: tRunnerCtx.char.inventory as any }, 'KRASH Barrier')) {
              formula += '。KRASHバリアにより強制ジャックアウトは無効化された';
            } else {
              const uNotes = executeUnsafeJackOut(tRunnerCtx, allParticipants, dicePool);
              formula += `。強制ジャックアウト！ ${uNotes.join(' / ')}`;
            }
            break;
          }
          case 'Hellbolt': {
            const rawDmg = (dicePool[0] ?? 3) + (dicePool[1] ?? 3);
            formula += `。${applyBrainDamage(tRunnerCtx, rawDmg, false, 'ヘルボルト')}`;
            if (hasDeckHardware({ extra: tRunnerCtx.extra, inventory: tRunnerCtx.char.inventory as any }, 'Insulated Wiring')) {
              formula += '（インスレーテッド・ワイヤリングにより着火無効）';
            } else {
              const fireSt = hazardStatus('fire', 'small')!;
              if (!tRunnerCtx.status.includes(fireSt)) tRunnerCtx.status.push(fireSt);
              formula += `。「${fireSt}」付与`;
            }
            break;
          }
          case 'Nervescrub': {
            const drainNote = applyStatDrain(tRunnerCtx, ['int', 'ref', 'dex'], dicePool, 'ナーヴスクラブ');
            formula += `。${drainNote}`;
            break;
          }
          case 'Poison Flatline': {
            const destroyNote = destroyProgramOnDeck(tRunnerCtx);
            formula += `。${destroyNote}`;
            break;
          }
          case 'Superglue': {
            const rounds = dicePool[0] ?? 3;
            tRunnerCtx.net.pinned_until = round + rounds;
            formula += `。${rounds} ラウンド（ラウンド ${round + rounds} まで）下の階層へ進めず安全にジャックアウトもできない`;
            break;
          }
          case 'Vrizzbolt': {
            const rawDmg = dicePool[0] ?? 3;
            formula += `。${applyBrainDamage(tRunnerCtx, rawDmg, false, 'ヴリズボルト')}`;
            tRunnerCtx.net.slowed = true;
            if (targetPart?.id === actorPart.id) tRunnerCtx.net.slowed_just_set = true;
            formula += '。次のターンの NET アクション −1（最低 2）';
            break;
          }
        }
      } else {
        // ザップ、剣、バンハンマー（REZ ダメージまたはネットランナー脳ダメージ）
        const dmg = dicePool.slice(0, neededDice).reduce((a, b) => a + b, 0);
        if (activeIceTarget) {
          const beforeRez = activeIceTarget.rez;
          const afterRez = Math.max(0, beforeRez - dmg);
          activeIceTarget.rez = afterRez;
          formula += `。${neededDice}d6 = ${dmg} REZ ダメージ（${activeIceTarget.name} REZ ${beforeRez} → ${afterRez}${afterRez === 0 ? '、消滅' : ''}）`;
          if (afterRez === 0) {
            if (activeIceTarget.en === 'Skunk') actorCtx.net.skunk = Math.max(0, (actorCtx.net.skunk ?? 0) - 1);
            if (actorCtx.net.pinned_by_ice === activeIceTarget.id) {
              actorCtx.net.pinned_by_ice = undefined;
              actorCtx.net.pinned_until = undefined;
            }
          }
        } else if (targetPart && partIce) {
          const beforeRez = Number(partIce.rez ?? targetPart.character?.hp ?? 0);
          const afterRez = Math.max(0, beforeRez - dmg);
          formula += `。${neededDice}d6 = ${dmg} REZ ダメージ（${targetPart.name} REZ ${beforeRez} → ${afterRez}${afterRez === 0 ? '、消滅' : ''}）`;
          if (targetPart.character) {
            changes.push({
              target_id: targetPart.character.id,
              target_name: targetPart.name,
              field: 'hp',
              before: targetPart.character.hp,
              after: afterRez,
              desc: `${targetPart.name} REZ ${beforeRez} → ${afterRez}`,
            });
          }
          changes.push({
            target_id: targetPart.id,
            target_name: targetPart.name,
            field: 'state',
            before: { net_ice: partIce },
            after: { net_ice: { ...partIce, rez: afterRez } },
            desc: `${targetPart.name} REZ ${beforeRez} → ${afterRez}`,
          });
          if (afterRez === 0) {
            changes.push({
              target_id: targetPart.id,
              target_name: targetPart.name,
              field: 'out',
              before: targetPart.out,
              after: true,
              desc: `${targetPart.name} 消滅（Derez）`,
            });
            if (partIce.ice_key === 'Skunk') actorCtx.net.skunk = Math.max(0, (actorCtx.net.skunk ?? 0) - 1);
            if (actorCtx.net.pinned_by_ice === targetPart.id || partIce.ice_key === 'Kraken') {
              actorCtx.net.pinned_by_ice = undefined;
              actorCtx.net.pinned_until = undefined;
            }
          }
        } else if (tRunnerCtx) {
          // 敵ネットランナーの起動中プログラムを狙ったか、ネットランナー本人へのザップか
          const targetProgKey = input.net?.target_program_key;
          const targetProgIdx = targetProgKey
            ? tRunnerCtx.net.rezzed.findIndex((r) => r.key === targetProgKey || findNetProgram(r.key)?.en === targetProgKey)
            : progDef
              ? 0
              : -1;
          const targetProg = targetProgIdx >= 0 ? tRunnerCtx.net.rezzed[targetProgIdx] : undefined;
          if (targetProg) {
            const beforeRez = targetProg.rez;
            const afterRez = Math.max(0, beforeRez - dmg);
            targetProg.rez = afterRez;
            if (afterRez === 0) {
              const dNote = destroyProgramOnDeck(tRunnerCtx, undefined, targetProg.key);
              formula += `。${targetProg.name} に ${dmg} REZ ダメージ（REZ ${beforeRez} → 0）。${dNote}`;
            } else {
              formula += `。${targetProg.name} に ${dmg} REZ ダメージ（REZ ${beforeRez} → ${afterRez}）`;
            }
          } else {
            formula += `。${applyBrainDamage(tRunnerCtx, dmg, false, label)}`;
          }
        }
      }
    }

    if (tRunnerCtx && tRunnerCtx.part.id !== actorCtx.part.id) {
      flushTargetContextChanges(tRunnerCtx, changes, label);
    } else if (tRunnerCtx && tRunnerCtx.part.id === actorCtx.part.id) {
      // 自分自身がターゲットだった場合は actorCtx に反映
      actorCtx.hp = tRunnerCtx.hp;
      actorCtx.status = tRunnerCtx.status;
      actorCtx.stats = tRunnerCtx.stats;
      actorCtx.extra = tRunnerCtx.extra;
      actorCtx.net = { ...tRunnerCtx.net, net_used: actorCtx.net.net_used };
    }
    flushTargetContextChanges(actorCtx, changes, label);

    return {
      action_key: 'net_action',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      target_id: targetPart?.id,
      target_name: targetPart?.name,
      success: hit,
      formula,
      breakdown: { sub_action: sub, atkTotal, defTotal, hit, isTargetDemon },
      changes,
    };
  }

  // ── 3k. スライド（slide: 1 ターン 1 回、1 体のブラック ICE から逃げる） ──
  if (sub === 'slide') {
    if (curNet.slid_this_turn) {
      return fail('スライドは 1 ターンに 1 回しか使えません');
    }
    if ((curNet.pinned_until !== undefined && curNet.pinned_until >= round) || curNet.pinned_by_ice) {
      return fail('クラーケンまたはスーパーグルーで移動を封じられているため、スライドできません');
    }
    const targetFloor = Number(input.net?.target_floor ?? curNet.depth + 1);
    if (arch && targetFloor > curNet.depth) {
      const unlocked = new Set(curNet.unlocked_passwords ?? []);
      const curFl = arch.floors.find((f) => f.floor === curNet.depth);
      if (curFl?.kind === 'password' && !unlocked.has(curFl.floor)) {
        return fail('スライドでパスワード階層を抜けることはできません');
      }
    }

    const reqIceId = input.net?.target_ice_id || input.target_id;
    const activeIce =
      (actorCtx.net.active_ice ?? []).find((x) => x.rez > 0 && (x.id === reqIceId || x.en === reqIceId || x.name === reqIceId)) ??
      (actorCtx.net.active_ice ?? []).find((x) => x.rez > 0);
    const partIce = (targetPart?.state as any)?.net_ice;
    if (partIce?.is_demon) {
      return fail('デーモンに対してスライドは効きません');
    }
    const icePer = activeIce ? activeIce.per : partIce ? Number(partIce.per ?? 4) : 4;
    const iceName = activeIce ? activeIce.name : targetPart?.name ?? 'ブラック ICE';
    const iceId = activeIce ? activeIce.id : targetPart?.id ?? 'ice-0';

    const r = d10(input.attack_roll, 'スライド');
    const iceR = d10(input.defense_roll, 'ブラック ICE の PER');
    const missing: string[] = [];
    if (typeof r === 'string') missing.push(r);
    if (typeof iceR === 'string') missing.push(iceR);
    if (missing.length > 0) return fail(missing);

    const spdBonus = runnerSpdBonus();
    const skunkPen = (curNet.skunk ?? 0) * 2;
    const runnerTotal = rank + spdBonus - skunkPen + luck + (r as number);
    const iceTotal = icePer + (iceR as number);
    const success = runnerTotal > iceTotal;

    consumeNetAction('スライド');
    actorCtx.net.slid_this_turn = true;
    if (success) {
      actorCtx.net.slid_ice = [...(actorCtx.net.slid_ice ?? []), iceId];
      if (activeIce?.en === 'Skunk' || partIce?.ice_key === 'Skunk') {
        actorCtx.net.skunk = Math.max(0, (actorCtx.net.skunk ?? 0) - 1);
      }
      actorCtx.net.depth = Math.max(1, targetFloor);
      if (!actorCtx.net.revealed.includes(actorCtx.net.depth)) {
        actorCtx.net.revealed = [...actorCtx.net.revealed, actorCtx.net.depth].sort((a, b) => a - b);
      }
    }
    flushTargetContextChanges(actorCtx, changes, 'スライド');

    return {
      action_key: 'net_action',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success,
      formula: `スライド（vs ${iceName}）: インタフェース ${rank}${spdBonus ? ' + スピーディ 2' : ''}${skunkPen ? ` − スカンク ${skunkPen}` : ''}${luckText} + 出目 ${r} = ${runnerTotal} vs PER ${icePer} + 出目 ${iceR} = ${iceTotal} -> ${success ? `成功（${iceName} を振り切って第 ${actorCtx.net.depth} 階層へ移動）` : '失敗'}`,
      breakdown: { sub_action: 'slide', runnerTotal, iceTotal, success },
      changes,
    };
  }

  // ── 3l. クローク（cloak） ──
  if (sub === 'cloak') {
    const r = d10(input.attack_roll, 'クローク');
    if (typeof r === 'string') return fail(r);
    const eraserBonus = hasBooster('Eraser') ? 2 : 0;
    const total = rank + eraserBonus + luck + r;

    consumeNetAction('クローク');
    actorCtx.net.cloak = total;
    flushTargetContextChanges(actorCtx, changes, 'クローク');

    return {
      action_key: 'net_action',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: true,
      formula: `クローク: インタフェース ${rank}${eraserBonus ? ' + イレイサ 2' : ''}${luckText} + 出目 ${r} = ${total}（痕跡・ウイルスの発見難易度を ${total} に設定）`,
      breakdown: { sub_action: 'cloak', total },
      changes,
    };
  }

  // ── 3m. ウイルス（virus: 最下層でのみ実行可） ──
  if (sub === 'virus') {
    if (arch) {
      const maxDepth = Math.max(...arch.floors.map((f) => f.depth));
      const curFl = arch.floors.find((f) => f.floor === curNet.depth);
      const curDepth = curFl?.depth ?? curNet.depth;
      if (curDepth < maxDepth) {
        return fail(`ウイルスはアーキテクチャの最下層（深さ ${maxDepth}）でのみ作成できます（現在: 深さ ${curDepth}）`);
      }
    }

    const prevProg = curNet.virus_progress;
    const actionsNeeded = Math.max(1, Number(input.net?.virus_actions ?? prevProg?.actions_needed ?? 1));
    const dv = Number(input.net?.virus_dv ?? prevProg?.dv ?? arch?.dv ?? 10);
    const desc = (input.net?.virus_desc || prevProg?.description || 'システム改変ウイルス').trim();
    const spentAfter = (prevProg?.actions_spent ?? 0) + 1;

    if (spentAfter < actionsNeeded) {
      consumeNetAction('ウイルス作成中');
      actorCtx.net.virus_progress = {
        description: desc,
        actions_needed: actionsNeeded,
        actions_spent: spentAfter,
        dv,
      };
      flushTargetContextChanges(actorCtx, changes, 'ウイルス作成中');
      return {
        action_key: 'net_action',
        actor_id: actorPart.id,
        actor_name: actorPart.name,
        success: true,
        formula: `ウイルス「${desc}」作成中（${spentAfter}/${actionsNeeded} NET アクション完了、難易度 ${dv}）`,
        breakdown: { sub_action: 'virus', progress: spentAfter, needed: actionsNeeded },
        changes,
      };
    }

    const r = d10(input.attack_roll, 'ウイルス');
    if (typeof r === 'string') return fail(r);
    const total = rank + luck + r;
    const success = total > dv;

    consumeNetAction('ウイルス');
    actorCtx.net.virus_progress = null;
    flushTargetContextChanges(actorCtx, changes, 'ウイルス');

    if (success && arch) {
      const beforeArch = JSON.parse(JSON.stringify(arch)) as NetArchitecture;
      const afterArch: NetArchitecture = {
        ...beforeArch,
        viruses: [
          ...(beforeArch.viruses ?? []),
          {
            id: generateUlid(),
            author_name: actorPart.name,
            description: desc,
            dv,
            created_at: Date.now(),
          },
        ],
        updated_at: Date.now(),
      };
      changes.push({
        target_id: arch.id,
        target_name: arch.name,
        field: 'net_architecture',
        before: beforeArch,
        after: afterArch,
        desc: `${arch.name} の最下層にウイルス「${desc}」を設置`,
      });
    }

    return {
      action_key: 'net_action',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success,
      formula: `ウイルス「${desc}」: インタフェース ${rank}${luckText} + 出目 ${r} = ${total} vs 難易度 ${dv} -> ${success ? '設置成功（アーキテクチャ最下層で常時稼働）' : '失敗'}`,
      breakdown: { sub_action: 'virus', total, dv, success },
      changes,
    };
  }

  return fail(`未対応の NET サブアクションです: ${sub}`);
}
