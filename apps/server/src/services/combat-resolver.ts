import {
  rangedDv,
  attackBase,
  resolveCheck,
  canDodgeRanged,
  autofireMultiplier,
  resolveDamage,
  lookupCriticalInjury,
  deathSave,
  deathSaveBase,
  hasCrackedSkull,
  woundState,
  woundPenalty,
  resolveD10,
  CriticalInjuryEntry,
  findReachableSquares,
  checkLineOfSight,
  gridDistance,
  BoardObstacle,
  DEFAULT_RULES,
} from '@cyberpgm/rules';
import {
  CombatChange,
  ResolveActionInputSchema,
  SingleAttackInput,
  CombatParticipant,
  DvTable,
  InventoryEntry,
  skillNameToKey,
  generateUlid,
  MARTIAL_TECHNIQUES,
  martialArtsDice,
  splitSkillKey,
  formatSkillName,
  HAZARDS,
  HazardLevel,
  hazardStatus,
  burnDamage,
  RESIST_DV,
  POISON_DICE,
  DRUG_EFFECT,
  HAZARD_LEVEL_LABEL,
  CRIT_INJURIES_JA,
  drugModifiers,
  DRUGS,
  soloEffects,
  roleRank,
  backupTier,
  BACKUP_TIERS,
  SoloAbility,
  soloAllocError,
  SOLO_ABILITIES,
  VehicleRec,
  DRIVE_SKILL,
  MANEUVERS,
  RAM_DICE,
  WHIPLASH,
  hasVirtualityGoggles,
} from '@cyberpgm/shared';
import { useDrug } from './medical.js';
import { resolveNetCombatAction, checkMoveBreaksNetrun, checkIncapacitatedBreaksNetrun } from './netrun-resolver.js';
import { z } from 'zod';
import type { AppDatabase } from '../db/client.js';
import { rule_constants, weapons, items, boards, board_tokens, board_objects, board_drops, characters } from '../db/schema.js';
import { eq, and, ne } from 'drizzle-orm';

type ResolveInput = z.infer<typeof ResolveActionInputSchema>;

export interface ResolveResult {
  action_key: string;
  actor_id: string;
  actor_name: string;
  target_id?: string;
  target_name?: string;
  success: boolean;
  formula: string;
  breakdown: Record<string, unknown>;
  changes: CombatChange[];
  missing_inputs?: string[];
}

function stripHtml(text?: string | null): string {
  if (!text) return '';
  return text.replace(/<[^>]*>/g, '').trim();
}

export const WEAPON_NAME_ALIASES: Record<string, string> = {
  'ヘビー・ピストル': '大型拳銃',
  '大型拳銃': 'ヘビー・ピストル',
  'ミディアム・ピストル': '中型拳銃',
  '中型拳銃': 'ミディアム・ピストル',
  'ライト・ピストル': '小型拳銃',
  '小型拳銃': 'ライト・ピストル',
  'ベリー・ヘビー・ピストル': '超大型拳銃',
  '超大型拳銃': 'ベリー・ヘビー・ピストル',
};

const MOVE_ACTION_KEYS = ['move', 'take_cover'];

// フルオート射撃・制圧射撃で使う弾数（日本語版 p.173・174）
const AUTOFIRE_ROUNDS = 10;

// 気絶の長さ。1 ラウンドは約 3 秒なので 1 分 = 20 ラウンド（日本語版 p.126・168・186）
export const UNCONSCIOUS_ROUNDS = 20;

// ログ・通知に出す行動の名前（Phase 5l。英語のキーを出さない）
const ACTION_LABEL: Record<string, string> = {
  take_cover: '遮蔽に入る',
  ranged: '射撃',
  aimed: '照準射撃',
  autofire: 'フルオート射撃',
  suppressive: '制圧射撃',
  hide: '身を隠す',
  pickup: '拾う',
  use_skill: '技能を使う',
  item_cyberware: 'アイテム・サイバーウェア',
  first_aid: '応急手当',
  dodge: '回避',
  other: 'その他',
  martial_arts: '武術攻撃',
  martial_technique: '武術奥義',
  grab: 'つかむ',
  choke: '締め',
  throw: '投げ',
  release: '放す',
  stand: '立ち上がる',
  throw_object: '投げる',
  hazard: '環境ダメージ',
  hazard_end: '環境の状態を終える',
  use_drug: 'ドラッグ・薬品を使う',
  call_backup: '支援を呼ぶ',
  vehicle_board: 'ヴィークル搭乗',
  vehicle_start: 'ヴィークル始動',
  vehicle_stop: 'ヴィークル停止',
  vehicle_exit: 'ヴィークルから降りる',
  vehicle_control: '操縦',
  vehicle_maneuver: '特殊機動',
  vehicle_ram: '体当たり',
  attack_vehicle: 'ヴィークルを攻撃',
  solo_realloc: 'コンバット・アウェアネスを割り振り直す',
  net_action: 'NET アクション',
  net_ice_attack: 'ブラック ICE の攻撃',
  scanner: 'アクセスポイントを探す（スキャナ）',
};

/**
 * 1 ターンに使えるアクションの数（Phase 5j）。ふつうは 1。
 * state.actions_per_turn: GM が決めた毎ターンの回数（ボスの 2 回行動など）
 * state.bonus_actions: このターンだけ増やした回数（GM の「+1 アクション」）
 */
export function actionsAllowed(p: Pick<CombatParticipant, 'state'>): number {
  const st = (p.state ?? {}) as Record<string, unknown>;
  return Math.max(1, Number(st.actions_per_turn ?? 1)) + Math.max(0, Number(st.bonus_actions ?? 0));
}

function actionsTaken(p: Pick<CombatParticipant, 'state'>): number {
  return Number(((p.state ?? {}) as Record<string, unknown>).actions_taken ?? 0);
}

// アクションを 1 回使う変化。回数が残っていれば action_used は false のまま
function useAction(p: CombatParticipant) {
  const taken = actionsTaken(p);
  return {
    before: { action_used: p.action_used, actions_taken: taken },
    after: { action_used: taken + 1 >= actionsAllowed(p), actions_taken: taken + 1 },
  };
}

function actionCountLabel(p: CombatParticipant): string {
  const allowed = actionsAllowed(p);
  return allowed > 1 ? ` ${actionsTaken(p) + 1}/${allowed} 回目` : '';
}

/** つかみ状態の −2（日本語版 p.177） */
export function grapplePenalty(status: string[] | null | undefined): number {
  return (status ?? []).includes(GRAPPLED) ? -2 : 0;
}

// 状態の名前（Phase 5u・5x）
export const GRAPPLED = 'つかみ';
export const NO_BULLET_DODGE = '弾丸を回避できない';
export const PRONE = '伏せ';

/** サイバーアーム本体か（カヴァーリングなどの付属品は含めない） */
function isCyberarm(c: { name?: string }): boolean {
  return /^(medical grade )?cyberarm$/i.test((c.name ?? '').trim()) || /^(医療用)?サイバーアーム$/.test((c.name ?? '').trim());
}

/**
 * ダメージの出目の数が武器のダメージ（3d6 なら 3 個）と合っているか（Phase 5m）。合わなければ理由を返す
 */
function damageDiceCountError(damage: string | null | undefined, dice: number[]): string | null {
  const m = /^(\d+)d6$/i.exec((damage ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  return dice.length === n ? null : `ダメージは ${damage} なので、d6 の出目を ${n} 個入れてください（今は ${dice.length} 個）`;
}

/**
 * HP が変わって負傷段階（通常・重傷・瀕死）が変わったら、状態の変化を返す。
 * 同じ行動で 2 回当たったときも、直前の状態から計算する（Phase 5m）
 */
function woundStatusChange(
  ch: { id: string; name: string; hp_max: number },
  statusBefore: string[],
  hpBefore: number,
  hpAfter: number,
): CombatChange | null {
  const oldWound = woundState(hpBefore, ch.hp_max);
  const newWound = woundState(hpAfter, ch.hp_max);
  if (oldWound === newWound) return null;
  const filtered = statusBefore.filter((s) => s !== 'seriously' && s !== 'mortally');
  const after =
    newWound === 'seriously' ? [...filtered, 'seriously'] : newWound === 'mortally' ? [...filtered, 'mortally'] : filtered;
  return {
    target_id: ch.id,
    target_name: ch.name,
    field: 'status',
    before: statusBefore,
    after,
    desc: `${ch.name} 状態: ${newWound === 'seriously' ? '重傷 (−2)' : newWound === 'mortally' ? '瀕死 (−4)' : '通常'}`,
  };
}

/** 死亡セーヴの修正値: 致命的損傷による基本値 ＋ 瀕死になってから増えた分（日本語版 p.188） */
function deathSavePenaltyOf(part: CombatParticipant): { base: number; added: number } {
  return {
    base: deathSaveBase(part.character?.crit_injuries as never),
    added: (part.state?.deathSavePenalty as number) ?? 0,
  };
}

function resolveCombatActionInner(
  db: AppDatabase,
  input: ResolveInput,
  actorPart: CombatParticipant,
  targetPart?: CombatParticipant,
  allParticipants?: CombatParticipant[],
  boardId?: string | null,
  combatSettings?: Record<string, any>,
): ResolveResult {
  if (!targetPart && input.target_id && allParticipants) {
    targetPart = allParticipants.find((p) => p.id === input.target_id);
  }
  if (!targetPart && input.attacks?.[0]?.target_id && allParticipants) {
    targetPart = allParticipants.find((p) => p.id === input.attacks?.[0]?.target_id);
  }
  const actorChar = actorPart.character;
  const targetChar = targetPart?.character;

  if (!actorChar) {
    throw new Error(`Actor character data missing for participant ${actorPart.id}`);
  }

  // 使い切った移動アクション・アクションは使えない（Phase 5j）
  const usesMove = MOVE_ACTION_KEYS.includes(input.action_key);
  // つかみを放すのはアクションなしでできる（p.177）
  // 環境ダメージ（GM が与える）と、その終わり（火を消すときは中でアクションを使う）もアクションの残りに関係なく使える
  // NET アクションのうち移動（descend）と安全でないジャックアウト（unsafe_jack_out）、およびブラック ICE の攻撃はアクション残りに関係なく使える（Phase 5z）
  const isNetFreeSub = input.action_key === 'net_action' && ['descend', 'unsafe_jack_out'].includes(input.net?.sub_action ?? '');
  const usesAction =
    !usesMove &&
    !['death_save', 'release', 'hazard', 'hazard_end', 'vehicle_exit', 'net_ice_attack'].includes(input.action_key) &&
    !isNetFreeSub;
  const actorNet = (actorPart.state as any)?.net;
  const isOngoingNetTurn = input.action_key === 'net_action' && (actorNet?.net_used ?? 0) > 0;
  const spent =
    actorNet?.jacked_in && !hasVirtualityGoggles(actorChar as any) && (usesMove || input.action_key === 'run')
      ? 'ヴァーチャリティ・ゴーグルを着用していないため、ネットラン中は肉体を移動できません'
      : (actorNet?.net_used ?? 0) > 0 && usesAction && input.action_key !== 'net_action'
        ? 'このターンはすでに NET アクションを使っているため、肉体のアクションは使えません'
        : usesMove && actorPart.move_used
          ? '移動アクションは使用済みです（もう一度動くなら「走る」でアクションを使います）'
          : usesAction && actorPart.action_used && !isOngoingNetTurn
            ? 'このターンのアクションは使い切っています（GM は「+1 アクション」で追加できます）'
            : null;
  if (spent) {
    return {
      action_key: input.action_key,
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: false,
      formula: spent,
      breakdown: {},
      changes: [],
      missing_inputs: [spent],
    };
  }

  // Phase 5z: ネットランニング（NET アクション / ブラック ICE の攻撃 / スキャナ）
  if (['net_action', 'net_ice_attack', 'scanner'].includes(input.action_key)) {
    return resolveNetCombatAction(db, input, actorPart, targetPart, allParticipants, boardId, combatSettings);
  }

  const actorWound = woundState(actorChar.hp, actorChar.hp_max);
  // つかみ状態のあいだは、つかんでいる側もつかまれている側もすべての判定に −2（日本語版 p.177。Phase 5u）
  // ブラック・レースと興奮剤は重傷の効果を無視する（Phase 5w。p.150・229）
  const actorWoundPen = (drugModifiers(actorChar.extra).ignoreSeriousWound && actorWound === 'seriously' ? 0 : woundPenalty(actorWound)) + grapplePenalty(actorChar.status);
  // 【運命】点: 振る前に使うと 1 点につき +1（日本語版 p.130。Phase 5v）。ROF 2 などで 2 回振るときは 1 回目だけ
  const luck = Math.max(0, input.luck_spent ?? 0);
  const luckText = luck ? ` +${luck}（運命）` : '';
  // ソロ《コンバット・アウェアネス》（日本語版 p.146。Phase 5x）
  const solo = soloEffects(actorChar.role, actorChar.extra);
  const round = Number(combatSettings?.__round ?? 0);
  const precisionText = solo.precision ? ` +${solo.precision}（精密攻撃）` : '';
  // 決定的失敗無効なら、攻撃の出目 1 はそのまま 1（追加の出目は要らない）
  const atkNeedsExtra = (roll: { first: number; extra?: number }) => roll.extra === undefined && (roll.first === 10 || (roll.first === 1 && !solo.fumbleImmune));
  const atkD10 = (roll: { first: number; extra?: number }) => (solo.fumbleImmune && roll.first === 1 ? 1 : resolveD10(roll.first, roll.extra).value);
  const actorState = (actorPart.state ?? {}) as Record<string, unknown>;
  let spotWeaknessLeft = solo.spotWeakness > 0 && actorState.sw_round !== round ? solo.spotWeakness : 0;
  const drUsed = new Set<string>();
  // 相手がソロでダメージ軽減を割り振っていれば、各ラウンドで最初に受けるダメージを減らす
  /** 弱点看破とダメージ軽減を 1 回の命中に入れる。使ったらこのラウンドはもう使えない記録を足す */
  const applySoloDamage = (dmg: { hpLoss: number }, target: CombatParticipant | undefined, changes: CombatChange[]): string => {
    let note = '';
    if (spotWeaknessLeft > 0) {
      note += ` (弱点看破 +${spotWeaknessLeft})`;
      changes.push({ target_id: actorPart.id, target_name: actorPart.name, field: 'state', before: { sw_round: actorState.sw_round ?? null }, after: { sw_round: round }, desc: `${actorPart.name} 弱点看破を使った（このラウンド）` });
      spotWeaknessLeft = 0;
    }
    const dr = target ? damageReductionFor(target) : 0;
    if (dr > 0 && target && dmg.hpLoss > 0) {
      dmg.hpLoss = Math.max(0, dmg.hpLoss - dr);
      note += ` (${target.name} のダメージ軽減 −${dr})`;
      changes.push({ target_id: target.id, target_name: target.name, field: 'state', before: { dr_round: (target.state as Record<string, unknown> | undefined)?.dr_round ?? null }, after: { dr_round: round }, desc: `${target.name} ダメージ軽減を使った（このラウンド）` });
    }
    return note;
  };
  const damageReductionFor = (p: CombatParticipant): number => {
    const ch = p.character;
    if (!ch || drUsed.has(p.id)) return 0;
    const dr = soloEffects(ch.role, ch.extra).damageReduction;
    if (dr <= 0 || (p.state as Record<string, unknown> | undefined)?.dr_round === round) return 0;
    drUsed.add(p.id);
    return dr;
  };
  // 重い防具は REF・DEX・MOVE を下げる。瀕死のあいだは MOVE −6（どちらも最低 1）（Phase 5m）
  const actorArmorPen = actorChar.armor_penalty ?? 0;
  const actorRef = actorChar.stats.ref - actorArmorPen;
  const actorDex = actorChar.stats.dex - actorArmorPen;
  // 始動したヴィークルの操縦者は、【移動】がヴィークルの値になる（ペナルティは関係ない。p.192。Phase 5y）
  const drivingIv = (actorPart.state as Record<string, any> | undefined)?.in_vehicle;
  const drivenVehicle: VehicleRec | null =
    drivingIv?.driver && drivingIv?.started
      ? ((JSON.parse(db.select({ extra: characters.extra }).from(characters).where(eq(characters.id, drivingIv.owner_id)).get()?.extra || '{}').vehicles ?? []) as VehicleRec[]).find((v) => v.id === drivingIv.vehicle_id) ?? null
      : null;
  const effectiveMove = drivenVehicle ? drivenVehicle.move : Math.max(1, actorChar.stats.move - actorArmorPen - (actorWound === 'mortally' ? 6 : 0));
  const moveNote =
    effectiveMove !== actorChar.stats.move
      ? `（MOVE ${actorChar.stats.move}${actorArmorPen ? ` − 防具 ${actorArmorPen}` : ''}${actorWound === 'mortally' ? ' − 瀕死 6' : ''}）`
      : '';

  // 伏せ状態では移動できない（先に立ち上がる）。つかまれているあいだも自分では移動できない（日本語版 p.169・177。Phase 5u）
  if (['move', 'run', 'take_cover'].includes(input.action_key)) {
    const st = actorChar.status ?? [];
    const msg = input.action_key === 'run' && drivenVehicle
      ? 'ヴィークルを操縦しているあいだは「走る」ができません（p.192）'
      : st.includes(PRONE) && !drivenVehicle
      ? '伏せ状態です。先に「立ち上がる」をしてください'
      : (actorPart.state as Record<string, unknown> | undefined)?.grappled_by
        ? 'つかまれているので移動できません（「つかむ」で逃れるか、相手が放すまで）'
        : null;
    if (msg) {
      return { action_key: input.action_key, actor_id: actorPart.id, actor_name: actorPart.name, success: false, formula: msg, breakdown: {}, changes: [], missing_inputs: [msg] };
    }
  }

  // 走る（速足）は、この手番の移動アクションを使ったあとだけ（Phase 5m）
  if (input.action_key === 'run' && !actorPart.move_used) {
    const msg = '走るのは移動アクションを使ったあとだけです。先に「移動」をしてください';
    return {
      action_key: 'run',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: false,
      formula: msg,
      breakdown: {},
      changes: [],
      missing_inputs: [msg],
    };
  }

  const rules = {
    ...DEFAULT_RULES,
    diagonalRule: (combatSettings?.diagonalRule as 'chebyshev' | 'alternate') || 'chebyshev',
  };

  // Helper to load rule_constant JSON
  const getRuleConstant = <T>(key: string): T | null => {
    const row = db.select().from(rule_constants).where(eq(rule_constants.key, key)).get();
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  };

  /**
   * 致命的損傷の表を引いて、受けた損傷の記録を作る。どちらの表かも残す（死亡セーヴの基本値・頭蓋損傷の判定に使う）
   */
  const rollInjury = (table: 'body' | 'head', roll: number): CriticalInjuryEntry | null => {
    const critTable = getRuleConstant<CriticalInjuryEntry[]>(`critical_injury.${table}`) || [];
    const critEntry = lookupCriticalInjury(critTable, roll);
    if (!critEntry) return null;
    // 名前と効果は日本語版の表記にする（Phase 5w。p.221〜222）
    const ja = CRIT_INJURIES_JA[table]?.[critEntry.range[0]];
    return { ...critEntry, name: ja?.name ?? stripHtml(critEntry.name), summary: ja?.effect ?? stripHtml(critEntry.summary || ''), name_en: stripHtml(critEntry.name), table };
  };

  // いちばんレベルの高い〈武術〉（流派を指定すればその流派）。種類なしの martial_arts もあれば使う（Phase 5u）
  const bestMartialStyle = (styleName?: string | null): { key: string; level: number } | null => {
    let best: { key: string; level: number } | null = null;
    for (const [key, level] of Object.entries(actorChar.skills)) {
      const { base, spec } = splitSkillKey(key);
      if (base !== 'martial_arts' || level < 1) continue;
      if (styleName && spec && spec !== styleName) continue;
      if (!best || level > best.level) best = { key, level };
    }
    return best;
  };

  // Helper to load weapon data
  const getWeaponData = (itemId?: string) => {
    if (!itemId) return null;
    let w = db.select().from(weapons).where(eq(weapons.item_id, itemId)).get();
    let it = db.select().from(items).where(eq(items.id, itemId)).get();
    if (!w) {
      const alias = WEAPON_NAME_ALIASES[itemId];
      it =
        db.select().from(items).where(eq(items.name_ja, itemId)).get() ||
        db.select().from(items).where(eq(items.name_ja_override, itemId)).get() ||
        db.select().from(items).where(eq(items.name_en, itemId)).get() ||
        (alias ? db.select().from(items).where(eq(items.name_ja, alias)).get() : undefined) ||
        (alias ? db.select().from(items).where(eq(items.name_en, alias)).get() : undefined);
      if (it) {
        w = db.select().from(weapons).where(eq(weapons.item_id, it.id)).get();
      }
    }
    return w
      ? {
          ...w,
          name_ja: it?.name_ja || it?.name_ja_override || it?.name_en || '武器',
        }
      : null;
  };

  // Helper for board movement verification
  const resolveBoardMovement = (actionKey: 'move' | 'run'): { error?: string; change?: CombatChange } => {
    if (!boardId || !actorPart.character_id || !input.destination) {
      return {};
    }

    const token = db
      .select()
      .from(board_tokens)
      .where(and(eq(board_tokens.board_id, boardId), eq(board_tokens.character_id, actorPart.character_id)))
      .get();

    if (!token) {
      return {};
    }

    if (input.force_move) {
      return {
        change: {
          target_id: token.id,
          target_name: actorPart.name,
          field: 'token_position',
          before: { x: token.x, y: token.y },
          after: { x: input.destination.x, y: input.destination.y },
          desc: `${actorPart.name} 強制移動: (${token.x},${token.y}) → (${input.destination.x},${input.destination.y})`,
        },
      };
    }

    const boardObs = db.select().from(board_objects).where(eq(board_objects.board_id, boardId)).all();
    const otherTokens = db
      .select()
      .from(board_tokens)
      .where(and(eq(board_tokens.board_id, boardId), ne(board_tokens.id, token.id)))
      .all();
    const otherCells = new Set(otherTokens.map((t) => `${t.x},${t.y}`));

    const isPassable = (pt: { x: number; y: number }) => {
      for (const obj of boardObs) {
        if (obj.passable) continue;
        const rot = obj.rotation ?? 0;
        const w = rot === 90 || rot === 270 ? obj.h : obj.w;
        const h = rot === 90 || rot === 270 ? obj.w : obj.h;
        if (pt.x >= obj.x && pt.x < obj.x + w && pt.y >= obj.y && pt.y < obj.y + h) {
          return false;
        }
      }
      return true;
    };
    const canStop = (pt: { x: number; y: number }) => !otherCells.has(`${pt.x},${pt.y}`);

    const boardRow = db.select().from(boards).where(eq(boards.id, boardId)).get();
    let bounds: { cols: number; rows: number } | undefined = undefined;
    if (boardRow) {
      try {
        const grid = JSON.parse(boardRow.grid || '{}');
        if (grid.cols && grid.rows) {
          bounds = { cols: grid.cols, rows: grid.rows };
        }
      } catch {
        // ignore
      }
    }

    const reachable = findReachableSquares({
      start: { x: token.x, y: token.y },
      maxSquares: effectiveMove,
      isPassable,
      canStop,
      bounds,
      diagonalRule: rules.diagonalRule,
    });

    const isOk = reachable.some(
      (pt) => pt.x === input.destination!.x && pt.y === input.destination!.y,
    );

    if (!isOk) {
      return {
        error: `移動先 (${input.destination.x},${input.destination.y}) は移動範囲外です`,
      };
    }

    return {
      change: {
        target_id: token.id,
        target_name: actorPart.name,
        field: 'token_position',
        before: { x: token.x, y: token.y },
        after: { x: input.destination.x, y: input.destination.y },
        desc: `${actorPart.name} ${actionKey === 'run' ? '走る' : '移動'}: (${token.x},${token.y}) → (${input.destination.x},${input.destination.y})`,
      },
    };
  };

  // 1. Move action
  if (input.action_key === 'move') {
    const boardMove = resolveBoardMovement('move');
    if (boardMove.error) {
      return {
        action_key: 'move',
        actor_id: actorPart.id,
        actor_name: actorPart.name,
        success: false,
        formula: boardMove.error,
        breakdown: { destination: input.destination },
        changes: [],
        missing_inputs: [boardMove.error],
      };
    }

    const changes: CombatChange[] = [
      {
        target_id: actorPart.id,
        target_name: actorPart.name,
        field: 'state',
        before: { move_used: actorPart.move_used },
        after: { move_used: true },
        desc: `${actorPart.name} 移動アクション使用`,
      },
    ];
    if (boardMove.change) {
      changes.push(boardMove.change);
    }
    const netBreakMove = checkMoveBreaksNetrun(
      db,
      boardId,
      actorPart,
      input.destination,
      allParticipants,
      rules.diagonalRule,
      input.damage_dice ?? [],
    );
    if (netBreakMove.changes.length > 0) {
      changes.push(...netBreakMove.changes);
    }

    return {
      action_key: 'move',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: true,
      formula: `MOVE ${effectiveMove}マス (1マス2m) まで移動${moveNote}${netBreakMove.formulaNote ?? ''}`,
      breakdown: { move: effectiveMove, ...(input.destination ? { destination: input.destination } : {}) },
      changes,
    };
  }

  // 2. Run action
  if (input.action_key === 'run') {
    const boardMove = resolveBoardMovement('run');
    if (boardMove.error) {
      return {
        action_key: 'run',
        actor_id: actorPart.id,
        actor_name: actorPart.name,
        success: false,
        formula: boardMove.error,
        breakdown: { destination: input.destination },
        changes: [],
        missing_inputs: [boardMove.error],
      };
    }

    const changes: CombatChange[] = [
      {
        target_id: actorPart.id,
        target_name: actorPart.name,
        field: 'state',
        ...useAction(actorPart),
        desc: `${actorPart.name} 走る (アクション使用)${actionCountLabel(actorPart)}`,
      },
    ];
    if (boardMove.change) {
      changes.push(boardMove.change);
    }
    const netBreakRun = checkMoveBreaksNetrun(
      db,
      boardId,
      actorPart,
      input.destination,
      allParticipants,
      rules.diagonalRule,
      input.damage_dice ?? [],
    );
    if (netBreakRun.changes.length > 0) {
      changes.push(...netBreakRun.changes);
    }

    return {
      action_key: 'run',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: true,
      formula: `追加で MOVE ${effectiveMove}マス (1マス2m) 移動${moveNote}${netBreakRun.formulaNote ?? ''}`,
      breakdown: { move: effectiveMove, ...(input.destination ? { destination: input.destination } : {}) },
      changes,
    };
  }

  // 3. Death save
  if (input.action_key === 'death_save') {
    if (input.death_save_roll === undefined || input.death_save_roll === null) {
      return {
        action_key: 'death_save',
        actor_id: actorPart.id,
        actor_name: actorPart.name,
        success: false,
        formula: '死亡セーブの出目 (1d10) を入力してください',
        breakdown: {},
        changes: [],
        missing_inputs: ['死亡セーブの出目を入力してください'],
      };
    }
    const roll = input.death_save_roll;
    // 修正値 = 致命的損傷による基本値 + 瀕死になってから増えた分（日本語版 p.188）
    const { base: basePenalty, added } = deathSavePenaltyOf(actorPart);
    const penalty = basePenalty + added;
    const body = actorChar.stats.body;
    const res = deathSave({ roll, penalty, body });
    const changes: CombatChange[] = [];

    let formula = `死亡セーブ: 出目 ${roll} + ペナルティ ${penalty}${basePenalty ? `（致命的損傷 ${basePenalty}）` : ''} = ${roll + penalty} (BODY ${body} 未満で成功)`;
    if (res.success) {
      formula += ` -> 生存 (次回ペナルティ +1)`;
      changes.push({
        target_id: actorPart.id,
        target_name: actorPart.name,
        field: 'state',
        before: { deathSavePenalty: added },
        after: { deathSavePenalty: added + 1 },
        desc: `${actorPart.name} 死亡セーブ成功 (ペナルティ ${penalty + 1} に増加)`,
      });
    } else {
      formula += ` -> 死亡 (失敗)`;
      changes.push({
        target_id: actorPart.id,
        target_name: actorPart.name,
        field: 'out',
        before: false,
        after: true,
        desc: `${actorPart.name} 死亡セーブ失敗 (死亡・離脱)`,
      });
      const newStatus = [...(actorChar.status || []).filter((s) => s !== 'dead'), 'dead'];
      changes.push({
        target_id: actorChar.id,
        target_name: actorChar.name,
        field: 'status',
        before: actorChar.status,
        after: newStatus,
        desc: `${actorChar.name} 状態: 死亡`,
      });
    }

    return {
      action_key: 'death_save',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: res.success,
      formula,
      breakdown: { roll, penalty, basePenalty, body, success: res.success },
      changes,
    };
  }

  // 4. Reload
  if (input.action_key === 'reload') {
    const actorInventory: InventoryEntry[] = (actorChar.inventory as InventoryEntry[]) || [];
    const invWeapon = input.weapon_entry_id
      ? actorInventory.find((i) => i.entry_id === input.weapon_entry_id)
      : input.weapon_id
        ? actorInventory.find(
            (i) =>
              i.entry_id === input.weapon_id ||
              i.item_id === input.weapon_id ||
              i.name === input.weapon_id,
          )
        : undefined;
    const weaponItemId = invWeapon?.item_id || input.weapon_id;
    const wData = getWeaponData(weaponItemId || invWeapon?.name);

    if (!wData) {
      return {
        action_key: 'reload',
        actor_id: actorPart.id,
        actor_name: actorPart.name,
        success: false,
        formula: '武器を選択してください',
        breakdown: {},
        changes: [],
        missing_inputs: ['武器を選択してください'],
      };
    }

    if (wData.magazine_max === null || wData.magazine_max === undefined) {
      return {
        action_key: 'reload',
        actor_id: actorPart.id,
        actor_name: actorPart.name,
        success: false,
        formula: '装弾数が不明なためリロードできません',
        breakdown: {},
        changes: [],
        missing_inputs: ['装弾数が不明なためリロードできません'],
      };
    }

    const maxAmmo = wData.magazine_max;
    const newInventory = [...actorInventory];

    // Find spare ammo in inventory with kind === 'ammo'
    const ammoItemIdx = newInventory.findIndex((i) => {
      if (i.qty <= 0) return false;
      if (i.kind === 'ammo') return true;
      if (i.item_id) {
        const it = db.select({ kind: items.kind }).from(items).where(eq(items.id, i.item_id)).get();
        if (it?.kind === 'ammo') return true;
      }
      const itByName =
        db.select({ kind: items.kind }).from(items).where(eq(items.name_ja, i.name)).get() ||
        db.select({ kind: items.kind }).from(items).where(eq(items.name_en, i.name)).get();
      return itByName?.kind === 'ammo';
    });

    if (ammoItemIdx < 0) {
      return {
        action_key: 'reload',
        actor_id: actorPart.id,
        actor_name: actorPart.name,
        success: false,
        formula: '予備の弾薬がありません',
        breakdown: {},
        changes: [],
        missing_inputs: ['予備の弾薬がありません'],
      };
    }

    const spareAmmoItem = newInventory[ammoItemIdx];
    if (spareAmmoItem.qty > 1) {
      newInventory[ammoItemIdx] = {
        ...spareAmmoItem,
        qty: spareAmmoItem.qty - 1,
      };
    } else {
      newInventory.splice(ammoItemIdx, 1);
    }

    const weaponIdx = invWeapon
      ? newInventory.findIndex((i) => i.entry_id === invWeapon.entry_id)
      : newInventory.findIndex((i) => i.item_id === wData.item_id || i.name === wData.name_ja);

    const beforeAmmo =
      weaponIdx >= 0 && typeof newInventory[weaponIdx].ammo === 'number'
        ? newInventory[weaponIdx].ammo
        : 0;

    if (weaponIdx >= 0) {
      newInventory[weaponIdx] = { ...newInventory[weaponIdx], ammo: maxAmmo };
    } else {
      newInventory.push({
        entry_id: 'w-' + Math.random().toString(36).slice(2),
        item_id: wData.item_id,
        name: wData.name_ja,
        kind: 'weapon',
        qty: 1,
        equipped: true,
        ammo: maxAmmo,
      });
    }

    return {
      action_key: 'reload',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: true,
      formula: `${wData.name_ja} をリロード (弾数 ${maxAmmo}/${maxAmmo})`,
      breakdown: { maxAmmo, beforeAmmo },
      changes: [
        {
          target_id: actorPart.id,
          target_name: actorPart.name,
          field: 'state',
          ...useAction(actorPart),
          desc: `${actorPart.name} アクション使用 (リロード)${actionCountLabel(actorPart)}`,
        },
        {
          target_id: actorChar.id,
          target_name: actorChar.name,
          field: 'ammo',
          before: beforeAmmo,
          after: maxAmmo,
          desc: `${actorChar.name} ${wData.name_ja} 弾数 ${beforeAmmo} → ${maxAmmo}/${maxAmmo}`,
        },
        {
          target_id: actorChar.id,
          target_name: actorChar.name,
          field: 'inventory',
          before: actorInventory,
          after: newInventory,
          desc: `${actorChar.name} ${wData.name_ja} をリロード (残弾 ${maxAmmo}, 予備弾薬消費)`,
        },
      ],
    };
  }

  // 5. Pickup & Unconfirmed actions
  if (input.action_key === 'pickup' && boardId && input.pickup_drop_id) {
    const drop = db
      .select()
      .from(board_drops)
      .where(eq(board_drops.id, input.pickup_drop_id))
      .get();

    if (!drop) {
      return {
        action_key: 'pickup',
        actor_id: actorPart.id,
        actor_name: actorPart.name,
        success: false,
        formula: '落とし物が見つかりません',
        breakdown: {},
        changes: [],
        missing_inputs: ['指定された落とし物が存在しません'],
      };
    }

    const actorToken = actorPart.character_id
      ? db
          .select()
          .from(board_tokens)
          .where(and(eq(board_tokens.board_id, boardId), eq(board_tokens.character_id, actorPart.character_id)))
          .get()
      : null;

    if (actorToken) {
      const dist = gridDistance({ x: actorToken.x, y: actorToken.y }, { x: drop.x, y: drop.y }, rules);
      if (dist > 1) {
        return {
          action_key: 'pickup',
          actor_id: actorPart.id,
          actor_name: actorPart.name,
          success: false,
          formula: `落とし物まで離れすぎています (距離 ${dist}マス。隣接か同じマスのみ)`,
          breakdown: { dist },
          changes: [],
          missing_inputs: ['落とし物は同じマスか隣接マスからのみ拾えます'],
        };
      }
    }

    let parsedEntry: any = {};
    try {
      parsedEntry = JSON.parse(drop.inventory_entry);
    } catch {
      parsedEntry = { name: '拾ったアイテム' };
    }

    const changes: CombatChange[] = [
      {
        target_id: actorPart.id,
        target_name: actorPart.name,
        field: 'state',
        ...useAction(actorPart),
        desc: `${actorPart.name} アクション使用 (拾う)${actionCountLabel(actorPart)}`,
      },
      {
        target_id: drop.id,
        target_name: parsedEntry.name || 'アイテム',
        field: 'board_drop_remove',
        before: { ...drop, inventory_entry: parsedEntry },
        after: null,
        desc: `${actorPart.name} が足元の ${parsedEntry.name || 'アイテム'} を拾った`,
      },
      {
        target_id: actorChar.id,
        target_name: actorChar.name,
        field: 'inventory',
        before: actorChar.inventory,
        after: [...actorChar.inventory, parsedEntry],
        desc: `${actorChar.name} 所持品に追加: ${parsedEntry.name || 'アイテム'}`,
      },
    ];

    return {
      action_key: 'pickup',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: true,
      formula: `${actorPart.name} が足元の ${parsedEntry.name || 'アイテム'} を拾う`,
      breakdown: { drop_id: drop.id },
      changes,
    };
  }

  // ── つかむ・締め・投げ・放す・立ち上がる・武術奥義（Phase 5u。日本語版 p.177〜180） ──
  const GRAPPLE_KEYS = ['grab', 'choke', 'throw', 'release', 'stand', 'martial_technique'];
  if (GRAPPLE_KEYS.includes(input.action_key)) {
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
        breakdown: {},
        changes: [],
        missing_inputs: list,
      };
    };
    const ok = (success: boolean, formula: string, changes: CombatChange[], breakdown: Record<string, unknown> = {}): ResolveResult => ({
      action_key: input.action_key,
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      target_id: targetPart?.id,
      target_name: targetPart?.name,
      success,
      formula,
      breakdown,
      changes,
    });
    const actorState = (actorPart.state ?? {}) as Record<string, unknown>;
    const statusOf = (ch: { status?: string[] | null }) => ch.status ?? [];
    const setStatus = (ch: { id: string; name: string; status?: string[] | null }, add: string[], remove: string[], desc: string): CombatChange => ({
      target_id: ch.id,
      target_name: ch.name,
      field: 'status',
      before: statusOf(ch),
      after: [...statusOf(ch).filter((s) => !remove.includes(s) && !add.includes(s)), ...add],
      desc,
    });
    const stateChange = (p: CombatParticipant, after: Record<string, unknown>, desc: string): CombatChange => {
      const st = (p.state ?? {}) as Record<string, unknown>;
      return {
        target_id: p.id,
        target_name: p.name,
        field: 'state',
        before: Object.fromEntries(Object.keys(after).map((k) => [k, st[k] ?? null])),
        after,
        desc,
      };
    };
    const actionChange = (label: string): CombatChange => ({
      target_id: actorPart.id,
      target_name: actorPart.name,
      field: 'state',
      ...useAction(actorPart),
      desc: `${actorPart.name} アクション使用 (${label})${actionCountLabel(actorPart)}`,
    });
    // 出目（10 と 1 は追加の出目が要る）
    const rollOf = (roll: { first: number; extra?: number } | undefined, label: string): number | string => {
      if (!roll) return `${label}の出目 (1d10) を入力してください`;
      if ((roll.first === 10 || roll.first === 1) && roll.extra === undefined) {
        return `${label}${roll.first === 10 ? 'クリティカル' : 'ファンブル'}: 追加出目 (1d10) を入力してください`;
      }
      return resolveD10(roll.first, roll.extra).value;
    };
    // HP に直接与えるダメージ（防具を無視し、損耗させない。締め・投げ）
    const directDamage = (tChar: NonNullable<CombatParticipant['character']>, amount: number, label: string): CombatChange[] => {
      const after = Math.max(0, tChar.hp - amount);
      const changes: CombatChange[] = [
        { target_id: tChar.id, target_name: tChar.name, field: 'hp', before: tChar.hp, after, desc: `${tChar.name} HP ${tChar.hp} → ${after} (${label} ${amount}、防具を無視)` },
      ];
      const sc = woundStatusChange(tChar, statusOf(tChar), tChar.hp, after);
      if (sc) changes.push(sc);
      return changes;
    };
    const inReach = (): string | null => {
      if (!boardId || !actorPart.character_id || !targetPart?.character_id) return null;
      const a = db.select().from(board_tokens).where(and(eq(board_tokens.board_id, boardId), eq(board_tokens.character_id, actorPart.character_id))).get();
      const t = db.select().from(board_tokens).where(and(eq(board_tokens.board_id, boardId), eq(board_tokens.character_id, targetPart.character_id))).get();
      if (!a || !t) return null;
      const dist = gridDistance({ x: a.x, y: a.y }, { x: t.x, y: t.y }, rules);
      return dist > 1 ? `相手が間合い（2m・隣のマス）の外です (現在: ${dist}マス)` : null;
    };

    // 放す: つかんでいる側はいつでもアクションなしで放せる
    if (input.action_key === 'release') {
      const heldId = actorState.grappling as string | undefined;
      const held = allParticipants?.find((p) => p.id === heldId);
      if (!heldId || !held?.character) return fail('いまは誰もつかんでいません');
      return ok(true, `${actorPart.name} が ${held.name} を放した`, [
        setStatus(actorChar, [], [GRAPPLED], `${actorChar.name} つかみ状態が終わる`),
        setStatus(held.character, [], [GRAPPLED, '鋼のつかみ'], `${held.character.name} つかみ状態が終わる`),
        stateChange(actorPart, { grappling: null, choke_count: null }, `${actorPart.name} つかみを終える`),
        stateChange(held, { grappled_by: null }, `${held.name} つかまれていない`),
      ]);
    }

    // 立ち上がる（伏せ状態から。武術家は「跳ね起き」に成功すればアクションを使わない）
    if (input.action_key === 'stand') {
      if (!statusOf(actorChar).includes(PRONE)) return fail('伏せ状態ではありません');
      const changes: CombatChange[] = [setStatus(actorChar, [], [PRONE], `${actorChar.name} 立ち上がった`)];
      let formula = `${actorPart.name} が立ち上がる`;
      if (input.technique === 'kip_up') {
        const style = bestMartialStyle();
        if (!style) return fail('跳ね起きには〈武術〉が 1 レベル以上必要です');
        const r = rollOf(input.attack_roll, '跳ね起き');
        if (typeof r === 'string') return fail(r);
        const total = actorDex + style.level + actorWoundPen + luck + r;
        const success = total > 13;
        formula = `跳ね起き: DEX ${actorDex} + ${formatSkillName(style.key)} ${style.level}${actorWoundPen ? ` ${actorWoundPen}` : ''}${luckText} + 出目 ${r} = ${total} vs 難易度 13 -> ${success ? '成功（アクションを使わずに立ち上がる）' : '失敗（立ち上がるのにアクションを使う）'}`;
        if (!success) changes.unshift(actionChange('立ち上がる'));
      } else {
        changes.unshift(actionChange('立ち上がる'));
      }
      return ok(true, formula, changes);
    }

    const tChar = targetPart?.character;
    if (!targetPart || !tChar) return fail('対象を選択してください');

    // つかむ: 【敏捷】＋〈格闘〉＋1d10 の対抗判定。勝てば相手を拘束するか、持ち物を 1 つ奪う
    if (input.action_key === 'grab') {
      const reach = inReach();
      if (reach) return fail(reach);
      const iAmHeld = actorState.grappled_by === targetPart.id;
      const missing: string[] = [];
      const a = rollOf(input.attack_roll, '攻撃');
      const d = rollOf(input.defense_roll, '回避');
      if (typeof a === 'string') missing.push(a);
      if (typeof d === 'string') missing.push(d.replace('回避', '相手の〈格闘〉'));
      if (input.grab_mode === 'item' && !input.held_item_id && !iAmHeld) missing.push('奪う持ち物を選んでください');
      if (missing.length) return fail(missing);
      const brawl = actorChar.skills[skillNameToKey('brawling')] ?? 0;
      const tBrawl = tChar.skills[skillNameToKey('brawling')] ?? 0;
      const tDex = tChar.stats.dex - (tChar.armor_penalty ?? 0);
      const tPen = woundPenalty(woundState(tChar.hp, tChar.hp_max)) + grapplePenalty(tChar.status);
      // 鋼のつかみを受けていると、逃れる判定にさらに −2
      const ironGrip = iAmHeld && statusOf(actorChar).includes('鋼のつかみ') ? -2 : 0;
      const atk = actorDex + brawl + actorWoundPen + luck + ironGrip + (a as number);
      const def = tDex + tBrawl + tPen + (d as number);
      const success = atk > def;
      let formula = `つかむ: DEX ${actorDex} + 格闘 ${brawl}${actorWoundPen ? ` ${actorWoundPen}` : ''}${luckText}${ironGrip ? ' −2（鋼のつかみ）' : ''} + 出目 ${a} = ${atk} vs ${targetPart.name} DEX ${tDex} + 格闘 ${tBrawl}${tPen ? ` ${tPen}` : ''} + 出目 ${d} = ${def} -> ${success ? '成功' : '失敗（同じなら相手の勝ち）'}`;
      const changes: CombatChange[] = [actionChange('つかむ')];
      if (success && iAmHeld) {
        // つかまれている側が逃れる
        formula += `。${actorPart.name} はつかみから逃れた`;
        changes.push(
          setStatus(actorChar, [], [GRAPPLED, '鋼のつかみ'], `${actorChar.name} つかみ状態が終わる`),
          setStatus(tChar, [], [GRAPPLED], `${tChar.name} つかみ状態が終わる`),
          stateChange(actorPart, { grappled_by: null }, `${actorPart.name} 逃れた`),
          stateChange(targetPart, { grappling: null, choke_count: null }, `${targetPart.name} つかみが外れた`),
        );
      } else if (success && input.grab_mode === 'item') {
        const inv = (tChar.inventory as InventoryEntry[]) ?? [];
        const item = inv.find((i) => i.entry_id === input.held_item_id || i.item_id === input.held_item_id);
        formula += `。${targetPart.name} の ${item?.name ?? '持ち物'} を奪った`;
        if (item) {
          changes.push(
            { target_id: tChar.id, target_name: tChar.name, field: 'inventory', before: inv, after: inv.filter((i) => i !== item), desc: `${tChar.name} ${item.name} を奪われた` },
            {
              target_id: actorChar.id,
              target_name: actorChar.name,
              field: 'inventory',
              before: actorChar.inventory,
              after: [...((actorChar.inventory as InventoryEntry[]) ?? []), { ...item, equipped: true }],
              desc: `${actorChar.name} ${item.name} を手に入れた`,
            },
          );
        }
      } else if (success) {
        formula += `。${targetPart.name} をつかんだ（両者つかみ状態: すべての判定に −2、つかまれた側は移動できない）`;
        changes.push(
          setStatus(actorChar, [GRAPPLED], [], `${actorChar.name} 状態: つかみ（つかんでいる）`),
          setStatus(tChar, [GRAPPLED], [], `${tChar.name} 状態: つかみ（つかまれている）`),
          stateChange(actorPart, { grappling: targetPart.id, choke_count: 0 }, `${actorPart.name} が ${targetPart.name} をつかむ`),
          stateChange(targetPart, { grappled_by: actorPart.id }, `${targetPart.name} がつかまれる`),
        );
      }
      return ok(success, formula, changes);
    }

    const holding = actorState.grappling === targetPart.id;

    // 締め: 【体格】ぶんのダメージを HP に直接。HP 2 以上なら 1 で止まって気絶。3 回続けて締めると気絶
    if (input.action_key === 'choke') {
      if (!holding) return fail(`${targetPart.name} をつかんでいません（締めるには先につかむ）`);
      const body = actorChar.stats.body;
      const count = Number(actorState.choke_count ?? 0) + 1;
      let dmg = body;
      let knockout = false;
      if (tChar.hp >= 2 && tChar.hp - body < 1) {
        dmg = tChar.hp - 1;
        knockout = true;
      }
      if (count >= 3) knockout = true;
      const changes: CombatChange[] = [actionChange('締め'), ...directDamage(tChar, dmg, '締め')];
      const formula = `締め: ${targetPart.name} に BODY ${body} のダメージ（防具を無視）${dmg !== body ? `。HP は 1 で止まる` : ''}${knockout ? '。気絶した' : ''}（${count} 回目）`;
      if (knockout) {
        const hpAfter = tChar.hp - dmg;
        const base = (changes.find((c) => c.field === 'status')?.after as string[] | undefined) ?? statusOf(tChar);
        changes.push({
          target_id: tChar.id,
          target_name: tChar.name,
          field: 'status',
          before: base,
          after: [...base.filter((s) => s !== '気絶'), '気絶'],
          desc: `${tChar.name} 状態: 気絶（HP ${hpAfter}）`,
        });
        changes.push(stateChange(targetPart, { statusRounds: { ...((targetPart.state?.statusRounds as Record<string, number>) ?? {}), 気絶: UNCONSCIOUS_ROUNDS } }, `${targetPart.name} 気絶は ${UNCONSCIOUS_ROUNDS} ラウンド`));
      }
      changes.push(stateChange(actorPart, { choke_count: count }, `${actorPart.name} 締め ${count} 回目`));
      return ok(true, formula, changes);
    }

    // 投げ: つかんでいる相手を投げる。【体格】ぶんのダメージを HP に直接、つかみは終わり、相手は伏せ状態
    if (input.action_key === 'throw') {
      if (!holding) return fail(`${targetPart.name} をつかんでいません（投げるには先につかむ）`);
      const body = actorChar.stats.body;
      const dmgChanges = directDamage(tChar, body, '投げ');
      const afterStatus = (dmgChanges.find((c) => c.field === 'status')?.after as string[] | undefined) ?? statusOf(tChar);
      return ok(true, `投げ: ${targetPart.name} に BODY ${body} のダメージ（防具を無視）。つかみが終わり、${targetPart.name} は伏せ状態`, [
        actionChange('投げ'),
        ...dmgChanges,
        { target_id: tChar.id, target_name: tChar.name, field: 'status', before: afterStatus, after: [...afterStatus.filter((s) => s !== GRAPPLED && s !== '鋼のつかみ' && s !== PRONE), PRONE], desc: `${tChar.name} 状態: 伏せ（立ち上がるまで移動できない）` },
        setStatus(actorChar, [], [GRAPPLED], `${actorChar.name} つかみ状態が終わる`),
        stateChange(actorPart, { grappling: null, choke_count: null }, `${actorPart.name} 投げた`),
        stateChange(targetPart, { grappled_by: null }, `${targetPart.name} 投げられた`),
      ]);
    }

    // 武術奥義
    const tech = MARTIAL_TECHNIQUES.find((t) => t.key === input.technique);
    if (!tech) return fail('奥義を選んでください');
    const style = input.martial_style ? { key: input.martial_style, level: actorChar.skills[input.martial_style] ?? 0 } : bestMartialStyle(tech.style);
    if (!style || style.level < 1) return fail(`${tech.name} には〈武術${tech.style ? `：${tech.style}` : ''}〉が 1 レベル以上必要です`);
    const styleName = splitSkillKey(style.key).spec;
    if (tech.style && styleName && styleName !== tech.style) return fail(`${tech.name} は ${tech.style} の奥義です（選んだ流派: ${styleName}）`);
    if (tech.statReq && actorChar.stats[tech.statReq.stat] < tech.statReq.min) {
      return fail(`${tech.name} には【${tech.statReq.stat === 'will' ? '意志' : '移動'}】${tech.statReq.min} 以上が必要です`);
    }
    if (tech.key !== 'flying_kick') {
      const reach = inReach();
      if (reach) return fail(reach);
    }
    const missing: string[] = [];
    const a = rollOf(input.attack_roll, '奥義');
    if (typeof a === 'string') missing.push(a);
    let d: number | string = 0;
    if (tech.dv === null) {
      d = rollOf(input.defense_roll, '回避');
      if (typeof d === 'string') missing.push(d);
    }
    const body = actorChar.stats.body;
    const dice = martialArtsDice(body);
    if (tech.damage && (!input.damage_dice || input.damage_dice.length === 0)) missing.push(`ダメージの出目 (${dice}d6) を入力してください`);
    else if (tech.damage) {
      const err = damageDiceCountError(`${dice}d6`, input.damage_dice!);
      if (err) missing.push(err);
    }
    if (tech.key === 'disarm' && !input.held_item_id) missing.push('落とさせる持ち物を選んでください');
    if (missing.length) return fail(missing);

    const aimHead = Boolean(input.aim_head && tech.canAimHead);
    const atk = actorDex + style.level + actorWoundPen + luck + (aimHead ? -8 : 0) + (a as number);
    let success: boolean;
    let vs: string;
    if (tech.dv !== null) {
      success = atk > tech.dv;
      vs = `難易度 ${tech.dv}`;
    } else {
      const tDex = tChar.stats.dex - (tChar.armor_penalty ?? 0);
      const ev = tChar.skills[skillNameToKey('evasion')] ?? 0;
      const tPen = woundPenalty(woundState(tChar.hp, tChar.hp_max)) + grapplePenalty(tChar.status);
      const def = tDex + ev + tPen + (d as number);
      success = atk > def;
      vs = `${targetPart.name} 回避 DEX ${tDex} + 回避 ${ev}${tPen ? ` ${tPen}` : ''} + 出目 ${d} = ${def}`;
    }
    let formula = `${tech.name}（${tech.style ?? '共通'}）: DEX ${actorDex} + ${formatSkillName(style.key)} ${style.level}${actorWoundPen ? ` ${actorWoundPen}` : ''}${luckText}${aimHead ? ' −8（頭部）' : ''} + 出目 ${a} = ${atk} vs ${vs} -> ${success ? '成功' : '失敗'}`;
    const changes: CombatChange[] = tech.usesAction ? [actionChange(tech.name)] : [];
    if (!success) return ok(false, formula, changes);

    const crits = (tChar.crit_injuries as Array<{ range?: [number, number]; table?: string; sources?: unknown }>) ?? [];
    const hasInjury = (table: 'body' | 'head', n: number) => crits.some((c) => c.range?.[0] === n && (c.table ?? (JSON.stringify(c.sources ?? '').includes('188') ? 'head' : 'body')) === table);
    const giveInjury = (table: 'body' | 'head', n: number, critsBefore: unknown[]): CombatChange | null => {
      if (hasInjury(table, n)) {
        formula += `（すでに受けている損傷なので追加しない）`;
        return null;
      }
      const entry = rollInjury(table, n);
      if (!entry) return null;
      formula += ` [致命傷: ${entry.name}]`;
      return { target_id: tChar.id, target_name: tChar.name, field: 'crit_injuries', before: critsBefore, after: [...critsBefore, entry], desc: `${tChar.name} 致命傷: ${entry.name}${entry.summary ? ` (${entry.summary})` : ''}` };
    };
    let status = statusOf(tChar);
    let hp = tChar.hp;
    let critList: unknown[] = crits;
    // 武術攻撃のダメージ（防具は半分、端数切り上げ）
    if (tech.damage) {
      const location = aimHead ? 'head' : 'body';
      const sp = location === 'head' ? tChar.sp_head : tChar.sp_body;
      const dmg = resolveDamage({ dice: input.damage_dice!, location, sp, ignoreArmorPercent: 50, currentHp: hp, headMultiplier: hasCrackedSkull(crits as never) ? 3 : 2 });
      const after = Math.max(0, hp - dmg.hpLoss);
      changes.push({ target_id: tChar.id, target_name: tChar.name, field: 'hp', before: hp, after, desc: `${tChar.name} HP ${hp} → ${after} (${dmg.hpLoss} ダメージ${dmg.critical ? `、クリティカル +${dmg.critBonus}` : ''})` });
      if (dmg.spAfter !== sp) {
        changes.push({ target_id: tChar.id, target_name: tChar.name, field: location === 'head' ? 'sp_head' : 'sp_body', before: sp, after: dmg.spAfter, desc: `${tChar.name} SP ${location === 'head' ? '頭' : '胴'} ${sp} → ${dmg.spAfter}` });
      }
      const sc = woundStatusChange(tChar, status, hp, after);
      if (sc) {
        changes.push(sc);
        status = sc.after as string[];
      }
      formula += `。${dmg.hpLoss} ダメージ`;
      if (dmg.critical) formula += '（6 が 2 個: 致命傷表は GM が振って足す）';
      hp = after;
    }
    const pushInjury = (table: 'body' | 'head', n: number) => {
      const ch = giveInjury(table, n, critList);
      if (ch) {
        changes.push(ch);
        critList = ch.after as unknown[];
      }
    };
    switch (tech.key) {
      case 'disarm': {
        const inv = (tChar.inventory as InventoryEntry[]) ?? [];
        const item = inv.find((i) => i.entry_id === input.held_item_id || i.item_id === input.held_item_id);
        changes.push({ target_id: targetPart.id, target_name: targetPart.name, field: 'dropped', before: null, after: input.held_item_id, desc: `${targetPart.name} の ${item?.name ?? '持ち物'} を落とさせた` });
        formula += `。${item?.name ?? '持ち物'} を落とさせた（奪う場合は GM が所持品を移す）`;
        break;
      }
      case 'iron_grip':
        if (!holding) return fail(`${targetPart.name} をつかんでいません（鋼のつかみはつかんでいる相手に使う）`);
        changes.push(setStatus(tChar, ['鋼のつかみ'], [], `${tChar.name} 状態: 鋼のつかみ（逃れる判定にさらに −2、遠隔攻撃できない）`));
        formula += '。相手は逃れにくくなり、つかみが終わるまで遠隔攻撃できない';
        break;
      case 'armor_break': {
        const head = Math.max(0, tChar.sp_head - 2);
        const bodySp = Math.max(0, tChar.sp_body - 2);
        changes.push(
          { target_id: tChar.id, target_name: tChar.name, field: 'sp_head', before: tChar.sp_head, after: head, desc: `${tChar.name} SP 頭 ${tChar.sp_head} → ${head}（鎧砕き）` },
          { target_id: tChar.id, target_name: tChar.name, field: 'sp_body', before: tChar.sp_body, after: bodySp, desc: `${tChar.name} SP 胴 ${tChar.sp_body} → ${bodySp}（鎧砕き）` },
        );
        formula += '。防具が 2 SP 減った';
        break;
      }
      case 'bone_break':
        pushInjury(aimHead ? 'head' : 'body', aimHead ? 9 : 5);
        break;
      case 'pressure_point':
        pushInjury(aimHead ? 'head' : 'body', aimHead ? 3 : 10);
        break;
      case 'arm_counter':
        if (actorState.grappled_by !== targetPart.id) return fail(`${targetPart.name} につかまれていません（腕捕り返しは自分をつかんでいる相手に使う）`);
        changes.push(
          setStatus(actorChar, [], [GRAPPLED, '鋼のつかみ'], `${actorChar.name} つかみ状態が終わる`),
          setStatus(tChar, [], [GRAPPLED], `${tChar.name} つかみ状態が終わる`),
          stateChange(actorPart, { grappled_by: null }, `${actorPart.name} つかみを外した`),
          stateChange(targetPart, { grappling: null, choke_count: null }, `${targetPart.name} つかみが外れた`),
        );
        pushInjury('body', 6);
        break;
      case 'dodge_throw': {
        const dmgChanges = directDamage({ ...tChar, hp, status }, body, '投げ');
        changes.push(...dmgChanges);
        status = (dmgChanges.find((c) => c.field === 'status')?.after as string[] | undefined) ?? status;
        changes.push({ target_id: tChar.id, target_name: tChar.name, field: 'status', before: status, after: [...status.filter((s) => s !== PRONE), PRONE], desc: `${tChar.name} 状態: 伏せ` });
        formula += `。投げて BODY ${body} のダメージ（防具を無視）、相手は伏せ状態`;
        break;
      }
      case 'flying_kick':
        changes.push({ target_id: tChar.id, target_name: tChar.name, field: 'status', before: status, after: [...status.filter((s) => s !== PRONE), PRONE], desc: `${tChar.name} 状態: 伏せ` });
        changes.push(stateChange(actorPart, { move_used: true }, `${actorPart.name} 跳び蹴りのあとは移動できない`));
        formula += '。相手は伏せ状態（このあと攻撃・移動はできない）';
        break;
      default:
        break;
    }
    return ok(true, formula, changes);
  }

  // ── 物を投げる・環境ダメージ（Phase 5v。日本語版 p.177〜181） ──
  if (['throw_object', 'hazard', 'hazard_end'].includes(input.action_key)) {
    const fail = (msg: string | string[]): ResolveResult => {
      const list = Array.isArray(msg) ? msg : [msg];
      return { action_key: input.action_key, actor_id: actorPart.id, actor_name: actorPart.name, target_id: targetPart?.id, target_name: targetPart?.name, success: false, formula: list.join(' / '), breakdown: {}, changes: [], missing_inputs: list };
    };
    const done = (success: boolean, formula: string, changes: CombatChange[]): ResolveResult => ({
      action_key: input.action_key, actor_id: actorPart.id, actor_name: actorPart.name, target_id: targetPart?.id, target_name: targetPart?.name, success, formula, breakdown: {}, changes,
    });
    const d10 = (roll: { first: number; extra?: number } | undefined, label: string): number | string => {
      if (!roll) return `${label}の出目 (1d10) を入力してください`;
      if ((roll.first === 10 || roll.first === 1) && roll.extra === undefined) return `${label}${roll.first === 10 ? 'クリティカル' : 'ファンブル'}: 追加出目 (1d10) を入力してください`;
      return resolveD10(roll.first, roll.extra).value;
    };
    const statusChange = (ch: { id: string; name: string; status?: string[] | null }, before: string[], after: string[], desc: string): CombatChange => ({ target_id: ch.id, target_name: ch.name, field: 'status', before, after, desc });

    // 物を投げる: DEX + 〈運動〉 + 1d10 を、グレネード・ランチャーの距離の難易度と比べる（25m まで）。REF 8 以上の相手は回避できる。防具は半分にしない
    if (input.action_key === 'throw_object') {
      const tChar = targetPart?.character;
      const missing: string[] = [];
      if (!targetPart || !tChar) missing.push('対象を選択してください');
      const inv = (actorChar.inventory as InventoryEntry[]) ?? [];
      const entry = inv.find((i) => i.entry_id === input.throw_entry_id);
      if (!entry) missing.push('投げる物を選んでください（武器・グレネードなど）');
      const dist = input.distance_m;
      if (dist === undefined || dist === null) missing.push('距離を入力してください');
      else if (dist > 25) missing.push('投げられるのは 25m までです');
      const a = d10(input.attack_roll, '攻撃');
      if (typeof a === 'string') missing.push(a);
      const w = entry ? getWeaponData(entry.item_id || entry.name) : null;
      // 近接武器は近接のダメージ、グレネードはグレネード・ランチャーと同じ、それ以外は GM が決めたダイス（p.178）
      const diceCount = w && w.damage && /^\d+d6$/.test(w.damage) ? Number(w.damage.split('d')[0]) : null;
      if (!input.damage_dice || input.damage_dice.length === 0) missing.push(`ダメージの出目を入力してください${diceCount ? `（${diceCount}d6）` : '（GM が決めた個数）'}`);
      else if (diceCount && input.damage_dice.length !== diceCount) missing.push(`ダメージは ${diceCount}d6 なので、d6 の出目を ${diceCount} 個入れてください`);
      const canDodge = tChar ? canDodgeRanged(tChar.stats.ref - (tChar.armor_penalty ?? 0)) && !(tChar.status ?? []).includes(NO_BULLET_DODGE) : false;
      let def: number | string = 0;
      if (canDodge && input.dodge_mode === 'dodge') {
        def = d10(input.defense_roll, '回避');
        if (typeof def === 'string') missing.push(def);
      }
      if (missing.length || !tChar || !targetPart || !entry) return fail(missing);
      const table = getRuleConstant<DvTable>('dv_table.DV Grenade Launcher');
      const dv = table ? rangedDv(table, dist!) : null;
      const ath = actorChar.skills[skillNameToKey('athletics')] ?? 0;
      const atk = actorDex + ath + actorWoundPen + luck + (a as number);
      let hit: boolean;
      let vs: string;
      if (canDodge && input.dodge_mode === 'dodge') {
        const tDex = tChar.stats.dex - (tChar.armor_penalty ?? 0);
        const ev = tChar.skills[skillNameToKey('evasion')] ?? 0;
        const dTotal = tDex + ev + woundPenalty(woundState(tChar.hp, tChar.hp_max)) + (def as number);
        hit = atk > dTotal;
        vs = `${targetPart.name} 回避 ${dTotal}`;
      } else {
        if (dv === null) return fail('グレネード・ランチャーの難易度表がありません');
        hit = atk > dv;
        vs = `難易度 ${dv}（${dist}m、グレネード・ランチャーの表）`;
      }
      let formula = `投げる（${entry.name}）: DEX ${actorDex} + 運動 ${ath}${actorWoundPen ? ` ${actorWoundPen}` : ''}${luckText} + 出目 ${a} = ${atk} vs ${vs} -> ${hit ? '命中' : '外れ'}`;
      const changes: CombatChange[] = [
        { target_id: actorPart.id, target_name: actorPart.name, field: 'state', ...useAction(actorPart), desc: `${actorPart.name} アクション使用 (投げる)${actionCountLabel(actorPart)}` },
        {
          target_id: actorChar.id,
          target_name: actorChar.name,
          field: 'inventory',
          before: inv,
          after: entry.qty > 1 ? inv.map((i) => (i === entry ? { ...i, qty: i.qty - 1 } : i)) : inv.filter((i) => i !== entry),
          desc: `${actorChar.name} ${entry.name} を投げた（手元から 1 つ減る）`,
        },
      ];
      if (!hit) return done(false, formula + '。投げた物は狙った場所の近くに落ちる', changes);
      const dmg = resolveDamage({ dice: input.damage_dice!, location: 'body', sp: tChar.sp_body, currentHp: tChar.hp });
      const after = Math.max(0, tChar.hp - dmg.hpLoss);
      changes.push({ target_id: tChar.id, target_name: tChar.name, field: 'hp', before: tChar.hp, after, desc: `${tChar.name} HP ${tChar.hp} → ${after} (${dmg.hpLoss} ダメージ)` });
      if (dmg.spAfter !== tChar.sp_body) changes.push({ target_id: tChar.id, target_name: tChar.name, field: 'sp_body', before: tChar.sp_body, after: dmg.spAfter, desc: `${tChar.name} SP 胴 ${tChar.sp_body} → ${dmg.spAfter}` });
      const sc = woundStatusChange(tChar, tChar.status ?? [], tChar.hp, after);
      if (sc) changes.push(sc);
      formula += `。${dmg.hpLoss} ダメージ`;
      if (dmg.critical) formula += '（6 が 2 個: 致命傷表は GM が振って足す）';
      return done(true, formula, changes);
    }

    const tPart = targetPart ?? actorPart;
    const tChar = tPart.character;
    if (!tChar) return fail('対象を選択してください');
    const tStatus = tChar.status ?? [];

    // 環境の状態を終わらせる（火を消す・感電から離れる・空気を吸う など）
    if (input.action_key === 'hazard_end') {
      const target = input.hazard_status;
      if (!target || !tStatus.includes(target)) return fail('終わらせる環境の状態を選んでください');
      // 放射線は区域にいるあいだ消せない。区域を出たら GM がここで外す（p.181）
      const changes: CombatChange[] = [statusChange(tChar, tStatus, tStatus.filter((s) => s !== target), `${tChar.name} 「${target}」が終わる`)];
      // 火を消すのは本人のアクション 1 回（p.180）
      if (target.startsWith('着火') && tPart.id === actorPart.id) {
        changes.unshift({ target_id: actorPart.id, target_name: actorPart.name, field: 'state', ...useAction(actorPart), desc: `${actorPart.name} アクション使用 (火を消す)${actionCountLabel(actorPart)}` });
      }
      // 真空で減った能力値は空気を吸えばすぐ戻る
      const loss = (tChar.extra?.vacuum_loss ?? {}) as Partial<Record<'int' | 'ref' | 'dex', number>>;
      if (target === '真空' && Object.keys(loss).length > 0) {
        const stats = { ...tChar.stats };
        for (const [k, v] of Object.entries(loss)) (stats as any)[k] += v ?? 0;
        changes.push({ target_id: tChar.id, target_name: tChar.name, field: 'stats', before: tChar.stats, after: stats, desc: `${tChar.name} 空気を吸って能力値が戻る` });
        const { vacuum_loss: _v, ...rest } = tChar.extra ?? {};
        changes.push({ target_id: tChar.id, target_name: tChar.name, field: 'extra', before: tChar.extra ?? {}, after: rest, desc: `${tChar.name} 真空の影響が消える` });
      }
      return done(true, `${tChar.name} の「${target}」が終わった`, changes);
    }

    // 環境ダメージを与える（GM。アクションは使わない）
    const hz = HAZARDS.find((h) => h.key === input.hazard);
    if (!hz) return fail('環境ダメージの種類を選んでください');
    const level = (input.hazard_level ?? 'small') as HazardLevel;
    const direct = (amount: number, label: string): CombatChange[] => {
      const after = Math.max(0, tChar.hp - amount);
      const out: CombatChange[] = [{ target_id: tChar.id, target_name: tChar.name, field: 'hp', before: tChar.hp, after, desc: `${tChar.name} HP ${tChar.hp} → ${after} (${label} ${amount}、HP に直接)` }];
      const sc = woundStatusChange(tChar, tStatus, tChar.hp, after);
      if (sc) out.push(sc);
      return out;
    };
    const sum = (dice?: number[]) => (dice ?? []).reduce((a, b) => a + b, 0);
    const ongoing = hazardStatus(hz.key, level);

    if (ongoing && hz.key !== 'electric') {
      if (tStatus.includes(ongoing)) return fail(`${tChar.name} はすでに「${ongoing}」です`);
      const next = [...tStatus, ongoing];
      const when = hz.key === 'drown' ? '自分のターンの始めごとに【体格】ぶんを HP に直接' : hz.key === 'vacuum' ? '自分のターンの終わりごとに【知力】【反応】【敏捷】が 1d6 ずつ減る（窒息もするので「溺れ・窒息」も付けてください）' : `自分のターンの終わりごとに HP に直接 ${burnDamage([ongoing])}`;
      return done(true, `${tChar.name} が「${ongoing}」になった。${when}`, [statusChange(tChar, tStatus, next, `${tChar.name} 状態: ${ongoing}`)]);
    }

    if (hz.key === 'electric') {
      if (!input.damage_dice || input.damage_dice.length !== 6) return fail('感電のダメージ 6d6 の出目を 6 個入れてください');
      const dmg = resolveDamage({ dice: input.damage_dice, location: 'body', sp: tChar.sp_body, currentHp: tChar.hp, ablation: 0 });
      const after = Math.max(0, tChar.hp - dmg.hpLoss);
      const changes: CombatChange[] = [{ target_id: tChar.id, target_name: tChar.name, field: 'hp', before: tChar.hp, after, desc: `${tChar.name} HP ${tChar.hp} → ${after} (感電 ${dmg.hpLoss}、防具は損耗しない)` }];
      const sc = woundStatusChange(tChar, tStatus, tChar.hp, after);
      const base = (sc?.after as string[] | undefined) ?? tStatus;
      if (sc) changes.push(sc);
      if (!base.includes('感電')) changes.push(statusChange(tChar, base, [...base, '感電'], `${tChar.name} 状態: 感電（離れるまでターンの終わりごとに 6d6）`));
      return done(true, `感電: 6d6 = ${sum(input.damage_dice)} − SP ${tChar.sp_body} → ${dmg.hpLoss} ダメージ（防具は損耗しない）。離れるまで続く`, changes);
    }

    if (hz.key === 'fall') {
      const m = input.fall_m;
      if (m === undefined || m === null) return fail('落ちた高さ (m) を入力してください');
      const legs = (tChar.cyberware ?? []).filter((c) => /サイバーレッグ$|^cyberleg$/i.test((c.name ?? '').trim())).length;
      if (m < 10) return done(true, `${m}m の落下。10m 未満なのでダメージなし`, []);
      if (legs >= 2 && m <= 30) return done(true, `${m}m の落下。サイバーレッグ 2 本なのでダメージも片脚損傷もなし`, []);
      const count = Math.floor(m / 10) * 2;
      const missing: string[] = [];
      if (!input.damage_dice || input.damage_dice.length !== count) missing.push(`落下ダメージ ${count}d6 の出目を ${count} 個入れてください`);
      const a = d10(input.attack_roll, '〈運動〉');
      if (typeof a === 'string') missing.push(a);
      if (missing.length) return fail(missing);
      const dmg = resolveDamage({ dice: input.damage_dice!, location: 'body', sp: tChar.sp_body, currentHp: tChar.hp });
      const after = Math.max(0, tChar.hp - dmg.hpLoss);
      const changes: CombatChange[] = [{ target_id: tChar.id, target_name: tChar.name, field: 'hp', before: tChar.hp, after, desc: `${tChar.name} HP ${tChar.hp} → ${after} (落下 ${dmg.hpLoss})` }];
      if (dmg.spAfter !== tChar.sp_body) changes.push({ target_id: tChar.id, target_name: tChar.name, field: 'sp_body', before: tChar.sp_body, after: dmg.spAfter, desc: `${tChar.name} SP 胴 ${tChar.sp_body} → ${dmg.spAfter}` });
      const sc = woundStatusChange(tChar, tStatus, tChar.hp, after);
      if (sc) changes.push(sc);
      const ath = tChar.skills[skillNameToKey('athletics')] ?? 0;
      const tDex = tChar.stats.dex - (tChar.armor_penalty ?? 0);
      const total = tDex + ath + woundPenalty(woundState(tChar.hp, tChar.hp_max)) + (a as number);
      let formula = `落下 ${m}m: ${count}d6 = ${sum(input.damage_dice)} − SP ${tChar.sp_body} → ${dmg.hpLoss} ダメージ。〈運動〉DEX ${tDex} + 運動 ${ath} + 出目 ${a} = ${total} vs 難易度 15 -> ${total > 15 ? '成功' : '失敗: 片脚損傷'}`;
      if (total <= 15) {
        const inj = rollInjury('body', 8);
        if (inj) {
          changes.push({ target_id: tChar.id, target_name: tChar.name, field: 'crit_injuries', before: tChar.crit_injuries, after: [...(tChar.crit_injuries ?? []), inj], desc: `${tChar.name} 致命傷: ${inj.name}` });
          formula += ` [致命傷: ${inj.name}]`;
        }
      }
      if (m > 30 && legs >= 2) formula += '（30m を超えたのでサイバーレッグでも防げない）';
      return done(true, formula, changes);
    }

    if (hz.key === 'poison' || hz.key === 'drug') {
      const dv = RESIST_DV[level];
      const missing: string[] = [];
      const a = d10(input.attack_roll, '〈拷問／薬物抵抗〉');
      if (typeof a === 'string') missing.push(a);
      if (hz.key === 'poison' && (!input.damage_dice || input.damage_dice.length !== POISON_DICE[level])) missing.push(`毒のダメージ ${POISON_DICE[level]}d6 の出目を入れてください（抵抗に成功すれば使いません）`);
      if (missing.length) return fail(missing);
      const res = tChar.skills[skillNameToKey('resist_torture_drugs')] ?? 0;
      const total = tChar.stats.will + res + woundPenalty(woundState(tChar.hp, tChar.hp_max)) + (a as number);
      const ok = total > dv;
      let formula = `${hz.name}（${HAZARD_LEVEL_LABEL[level]}）: WILL ${tChar.stats.will} + 拷問／薬物抵抗 ${res} + 出目 ${a} = ${total} vs 難易度 ${dv} -> ${ok ? '抵抗した' : '効いた'}`;
      if (ok) return done(true, formula, []);
      if (hz.key === 'poison') {
        formula += `。HP に直接 ${sum(input.damage_dice)}（防具を損耗させない）`;
        return done(true, formula, direct(sum(input.damage_dice), '毒'));
      }
      const eff = DRUG_EFFECT[level];
      formula += `。「${eff}」`;
      return done(true, formula, [statusChange(tChar, tStatus, [...tStatus.filter((s) => s !== eff), eff], `${tChar.name} 状態: ${eff}`)]);
    }

    // 過酷な気候: 1 日の終わりに HP に直接 1d6
    if (!input.damage_dice || input.damage_dice.length !== 1) return fail('過酷な気候の 1d6 の出目を入れてください');
    return done(true, `過酷な気候: HP に直接 ${input.damage_dice[0]}（そのあいだは自然治癒しない）`, direct(input.damage_dice[0], '過酷な気候'));
  }

  // ── ソロ《コンバット・アウェアネス》を割り振り直す（戦闘中はアクション 1 回。p.146） ──
  if (input.action_key === 'solo_realloc') {
    const rank = roleRank(actorChar.role, actorChar.extra, 'Solo');
    const alloc = (input.solo_alloc ?? {}) as Partial<Record<SoloAbility, number>>;
    const err = rank < 1 ? '《コンバット・アウェアネス》（ソロのロール特技）がありません' : soloAllocError(rank, alloc);
    if (err) return { action_key: 'solo_realloc', actor_id: actorPart.id, actor_name: actorPart.name, success: false, formula: err, breakdown: {}, changes: [], missing_inputs: [err] };
    const text = SOLO_ABILITIES.filter((a) => (alloc[a.key] ?? 0) > 0).map((a) => `${a.name} ${alloc[a.key]}`).join('、') || 'なし';
    return {
      action_key: 'solo_realloc',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: true,
      formula: `《コンバット・アウェアネス》（ランク ${rank}）を割り振り直した: ${text}`,
      breakdown: {},
      changes: [
        { target_id: actorPart.id, target_name: actorPart.name, field: 'state', ...useAction(actorPart), desc: `${actorPart.name} アクション使用 (割り振り直し)${actionCountLabel(actorPart)}` },
        { target_id: actorChar.id, target_name: actorChar.name, field: 'extra', before: actorChar.extra ?? {}, after: { ...(actorChar.extra ?? {}), solo_alloc: alloc }, desc: `${actorChar.name} コンバット・アウェアネス: ${text}` },
      ],
    };
  }

  // ── ローマン《バックアップ》: 支援を呼ぶ（Phase 5x。日本語版 p.158） ──
  // アクション 1 回で 1d10。ランク以下なら応じてもらえ、1d6 ラウンド後に支援要員が来る（6 なら 1 段階上、ランク 10 なら 2 グループ）
  if (input.action_key === 'call_backup') {
    const rank = roleRank(actorChar.role, actorChar.extra, 'Lawman');
    const msg = (m: string): ResolveResult => ({ action_key: 'call_backup', actor_id: actorPart.id, actor_name: actorPart.name, success: false, formula: m, breakdown: {}, changes: [], missing_inputs: [m] });
    if (rank < 1) return msg('《バックアップ》（ローマンのロール特技）がありません');
    const r = input.attack_roll?.first;
    if (!r) return msg('支援要請の出目 (1d10) を「攻撃」の欄に入れてください');
    const changes: CombatChange[] = [{ target_id: actorPart.id, target_name: actorPart.name, field: 'state', ...useAction(actorPart), desc: `${actorPart.name} アクション使用 (支援要請)${actionCountLabel(actorPart)}` }];
    if (r > rank) {
      return { action_key: 'call_backup', actor_id: actorPart.id, actor_name: actorPart.name, success: false, formula: `支援要請: 出目 ${r} > ランク ${rank} -> 誰も応じない（次のターンにまた呼べる）`, breakdown: {}, changes };
    }
    const arrive = input.damage_dice?.[0];
    if (!arrive) return msg('到着までの 1d6 の出目を「ダメージ出目」に入れてください');
    let tier = backupTier(rank);
    let extraNote = '';
    if (arrive === 6) {
      const i = BACKUP_TIERS.indexOf(tier);
      if (i < BACKUP_TIERS.length - 1) {
        tier = BACKUP_TIERS[i + 1];
        extraNote = '（6 なので 1 段階上の支援要員）';
      } else extraNote = '（6 でランク 10 なので 2 グループ）';
    }
    return {
      action_key: 'call_backup',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: true,
      formula: `支援要請: 出目 ${r} ≤ ランク ${rank} -> 応じた。${arrive} ラウンド後にランク ${tier} の支援要員が到着${extraNote}。到着したら「支援要員を入れる」を押す`,
      breakdown: { tier, rounds: arrive, groups: arrive === 6 && tier === '10' ? 2 : 1 },
      changes,
    };
  }

  // ── ドラッグ・薬品を使う（Phase 5w。日本語版 p.150・227） ──
  // 同意する相手にはアクション 1 回で注射。同意しない相手にはエアハイポで近接攻撃し、当たれば注射
  if (input.action_key === 'use_drug') {
    const fail = (msg: string | string[]): ResolveResult => {
      const list = Array.isArray(msg) ? msg : [msg];
      return { action_key: 'use_drug', actor_id: actorPart.id, actor_name: actorPart.name, success: false, formula: list.join(' / '), breakdown: {}, changes: [], missing_inputs: list };
    };
    const tPart = targetPart ?? actorPart;
    const tChar = tPart.character;
    if (!tChar) return fail('対象を選択してください');
    const inv = (actorChar.inventory as InventoryEntry[]) ?? [];
    const entry = inv.find((i) => i.entry_id === input.drug_entry_id);
    if (!entry) return fail('使うドラッグ・薬品を選んでください');
    const it = entry.item_id ? db.select().from(items).where(eq(items.id, entry.item_id)).get() : null;
    const def = DRUGS.find((d) => d.item_en === it?.name_en || d.name === entry.name);
    if (!def) return fail(`${entry.name} はドラッグ・薬品として扱えません`);
    const changes: CombatChange[] = [
      { target_id: actorPart.id, target_name: actorPart.name, field: 'state', ...useAction(actorPart), desc: `${actorPart.name} アクション使用 (${def.name})${actionCountLabel(actorPart)}` },
    ];
    let formula = '';
    if (input.unwilling && tPart.id !== actorPart.id) {
      const missing: string[] = [];
      const a = input.attack_roll;
      const d = input.defense_roll;
      if (!a) missing.push('攻撃の出目 (1d10) を入力してください');
      if (!d) missing.push('回避の出目 (1d10) を入力してください');
      if (missing.length) return fail(missing);
      const atkSkill = actorChar.skills[skillNameToKey('melee_weapon')] ?? 0;
      const atk = actorDex + atkSkill + actorWoundPen + luck + resolveD10(a!.first, a!.extra).value;
      const tDex = tChar.stats.dex - (tChar.armor_penalty ?? 0);
      const ev = tChar.skills[skillNameToKey('evasion')] ?? 0;
      const def2 = tDex + ev + woundPenalty(woundState(tChar.hp, tChar.hp_max)) + resolveD10(d!.first, d!.extra).value;
      formula = `エアハイポ: DEX ${actorDex} + 近接武器 ${atkSkill}${luckText} + 出目 = ${atk} vs ${tPart.name} 回避 ${def2} -> ${atk > def2 ? '命中' : '外れ'}`;
      if (atk <= def2) return { action_key: 'use_drug', actor_id: actorPart.id, actor_name: actorPart.name, target_id: tPart.id, target_name: tPart.name, success: false, formula, breakdown: {}, changes };
      formula += '。';
    }
    const byMedtech = (actorChar.skills.medical_tech ?? 0) > 0;
    const res = useDrug(
      { id: tChar.id, name: tChar.name, stats: tChar.stats as unknown as Record<string, number>, skills: tChar.skills, hp: tChar.hp, hp_max: tChar.hp_max, humanity: 0, cyberware: tChar.cyberware ?? [], crit_injuries: (tChar.crit_injuries ?? []) as Array<Record<string, any>>, status: tChar.status ?? [], extra: tChar.extra ?? {} },
      def.key,
      { dice: input.damage_dice, byMedtech },
    );
    if (!res.ok) return fail(res.missing!);
    formula += res.formula;
    const a = res.after!;
    if (a.extra) changes.push({ target_id: tChar.id, target_name: tChar.name, field: 'extra', before: tChar.extra ?? {}, after: a.extra, desc: `${tChar.name} ${def.name} が効く` });
    if (a.hp !== undefined && a.hp !== tChar.hp) {
      changes.push({ target_id: tChar.id, target_name: tChar.name, field: 'hp', before: tChar.hp, after: a.hp, desc: `${tChar.name} HP ${tChar.hp} → ${a.hp}` });
      const sc = woundStatusChange(tChar, tChar.status ?? [], tChar.hp, a.hp);
      if (sc) changes.push(sc);
    }
    if (a.status) changes.push({ target_id: tChar.id, target_name: tChar.name, field: 'status', before: tChar.status, after: a.status, desc: `${tChar.name} 状態が変わる` });
    if (def.key === 'black_lace') {
      const loss = (input.damage_dice ?? []).reduce((x, y) => x + y, 0);
      changes.push({ target_id: tChar.id, target_name: tChar.name, field: 'humanity', before: null, after: -loss, desc: `${tChar.name} 人間性 −${loss}（ブラック・レース）` });
    }
    changes.push({
      target_id: actorChar.id,
      target_name: actorChar.name,
      field: 'inventory',
      before: inv,
      after: entry.qty > 1 ? inv.map((i) => (i === entry ? { ...i, qty: i.qty - 1 } : i)) : inv.filter((i) => i !== entry),
      desc: `${actorChar.name} ${def.name} を 1 回分使った`,
    });
    return { action_key: 'use_drug', actor_id: actorPart.id, actor_name: actorPart.name, target_id: tPart.id, target_name: tPart.name, success: true, formula, breakdown: {}, changes };
  }

  // ── ヴィークル（Phase 5y。日本語版 p.189〜193） ──
  if (input.action_key.startsWith('vehicle_') || input.action_key === 'attack_vehicle') {
    const fail = (msg: string | string[]): ResolveResult => {
      const list = Array.isArray(msg) ? msg : [msg];
      return { action_key: input.action_key, actor_id: actorPart.id, actor_name: actorPart.name, success: false, formula: list.join(' / '), breakdown: {}, changes: [], missing_inputs: list };
    };
    const done = (success: boolean, formula: string, changes: CombatChange[]): ResolveResult => ({ action_key: input.action_key, actor_id: actorPart.id, actor_name: actorPart.name, target_id: targetPart?.id, target_name: targetPart?.name, success, formula, breakdown: {}, changes });
    const st = (actorPart.state ?? {}) as Record<string, any>;
    const inVeh = st.in_vehicle as { owner_id: string; vehicle_id: string; driver?: boolean; started?: boolean } | undefined;
    // ヴィークルは持ち主のキャラの extra.vehicles にある。同じ行動で 2 回変えるときは、変えたあとの値から
    const extras = new Map<string, Record<string, any>>();
    const ownerExtra = (ownerId: string): Record<string, any> | null => {
      if (extras.has(ownerId)) return extras.get(ownerId)!;
      const row = db.select().from(characters).where(eq(characters.id, ownerId)).get();
      if (!row) return null;
      const ex = JSON.parse(row.extra || '{}');
      extras.set(ownerId, ex);
      return ex;
    };
    const vehicleOf = (ref?: { owner_id: string; vehicle_id: string } | null): VehicleRec | null => {
      if (!ref) return null;
      return ((ownerExtra(ref.owner_id)?.vehicles ?? []) as VehicleRec[]).find((v) => v.id === ref.vehicle_id) ?? null;
    };
    const ownerName = (id: string) => db.select({ name: characters.name }).from(characters).where(eq(characters.id, id)).get()?.name ?? '';
    const updateVehicle = (ref: { owner_id: string; vehicle_id: string }, patch: Partial<VehicleRec>, desc: string): CombatChange => {
      const ex = ownerExtra(ref.owner_id)!;
      const before = JSON.parse(JSON.stringify(ex));
      ex.vehicles = ((ex.vehicles ?? []) as VehicleRec[]).map((v) => (v.id === ref.vehicle_id ? { ...v, ...patch } : v));
      return { target_id: ref.owner_id, target_name: ownerName(ref.owner_id), field: 'extra', before, after: JSON.parse(JSON.stringify(ex)), desc };
    };
    const stateChange = (p: CombatParticipant, after: Record<string, unknown>, desc: string): CombatChange => {
      const s0 = (p.state ?? {}) as Record<string, unknown>;
      return { target_id: p.id, target_name: p.name, field: 'state', before: Object.fromEntries(Object.keys(after).map((k) => [k, s0[k] ?? null])), after, desc };
    };
    const actionChange = (label: string): CombatChange => ({ target_id: actorPart.id, target_name: actorPart.name, field: 'state', ...useAction(actorPart), desc: `${actorPart.name} アクション使用 (${label})${actionCountLabel(actorPart)}` });
    const d10v = (roll?: { first: number; extra?: number }) => (roll ? ((roll.first === 10 || roll.first === 1) && roll.extra === undefined ? null : resolveD10(roll.first, roll.extra).value) : null);
    const occupants = (ref: { owner_id: string; vehicle_id: string }) =>
      (allParticipants ?? []).filter((p) => {
        const iv = (p.state as Record<string, any> | undefined)?.in_vehicle;
        return iv && iv.owner_id === ref.owner_id && iv.vehicle_id === ref.vehicle_id;
      });

    if (input.action_key === 'vehicle_board') {
      const ref = input.vehicle_ref;
      const v = vehicleOf(ref);
      if (!ref || !v) return fail('乗るヴィークルを選んでください');
      if (v.sdp <= 0) return fail(`${v.name} は壊れていて動きません（SDP 0。修理が要る）`);
      if (occupants(ref).length >= v.seats) return fail(`${v.name} の座席（${v.seats}）は埋まっています`);
      const driver = Boolean(input.as_driver) && !occupants(ref).some((p) => (p.state as any)?.in_vehicle?.driver);
      return done(true, `${actorPart.name} が ${v.name} に乗った${driver ? '（運転席）' : ''}`, [actionChange('ヴィークル搭乗'), stateChange(actorPart, { in_vehicle: { ...ref, driver, started: false } }, `${actorPart.name} ${v.name} に乗る`)]);
    }
    const myVeh = inVeh ? vehicleOf(inVeh) : null;
    if (input.action_key !== 'attack_vehicle') {
      if (!inVeh) return fail('ヴィークルに乗っていません');
      if (!myVeh) return fail('乗っているヴィークルが見つかりません');
    }
    // ここから下（ヴィークルを攻撃より前）は、乗っている人の行動
    const veh = inVeh as NonNullable<typeof inVeh>;

    if (input.action_key === 'vehicle_exit') {
      // 降りるのは移動アクション（p.191）
      if (actorPart.move_used) return fail('移動アクションは使用済みです');
      return done(true, `${actorPart.name} が ${myVeh!.name} から降りた（続けて動くなら「走る」）`, [
        { target_id: actorPart.id, target_name: actorPart.name, field: 'state', before: { move_used: actorPart.move_used }, after: { move_used: true }, desc: `${actorPart.name} 移動アクション使用 (降りる)` },
        stateChange(actorPart, { in_vehicle: null }, `${actorPart.name} 降りた`),
      ]);
    }
    if (input.action_key === 'vehicle_start' || input.action_key === 'vehicle_stop') {
      if (!veh.driver) return fail('運転席にいません');
      const start = input.action_key === 'vehicle_start';
      const changes: CombatChange[] = [actionChange(start ? 'ヴィークル始動' : 'ヴィークル停止'), stateChange(actorPart, { in_vehicle: { ...veh, started: start } }, `${myVeh!.name} を${start ? '始動' : '停止'}`)];
      // 始動すると操縦者は行動順の先頭に（p.192）
      if (start) changes.push({ target_id: actorPart.id, target_name: actorPart.name, field: 'initiative_top', before: null, after: true, desc: `${actorPart.name} 行動順の先頭へ` });
      return done(true, start ? `${myVeh!.name} を始動した。行動順の先頭になり、【移動】は ${myVeh!.move}（ヴィークルの値）。「走る」はできない` : `${myVeh!.name} を止めた`, changes);
    }

    const skillKey = myVeh ? DRIVE_SKILL[myVeh.kind] : 'drive_land_vehicle';
    const skill = actorChar.skills[skillKey] ?? 0;
    const driveBase = actorRef + skill;
    if (input.action_key === 'vehicle_control' || input.action_key === 'vehicle_maneuver') {
      if (!veh.driver || !veh.started) return fail('始動したヴィークルの運転席にいません');
      const man = input.action_key === 'vehicle_maneuver' ? MANEUVERS.find((m) => m.key === input.maneuver) : null;
      if (input.action_key === 'vehicle_maneuver' && !man) return fail('特殊機動を選んでください');
      if (!man && driveBase >= 10) return done(true, `REF ${actorRef} + ${formatSkillName(skillKey)} ${skill} = ${driveBase}（10 以上）: 基本的な操縦は判定もアクションも要らない`, []);
      const r = d10v(input.attack_roll);
      if (r === null) return fail('操縦の出目 (1d10) を「攻撃」の欄に入れてください');
      const dv = man ? man.dv : 10;
      const total = driveBase + actorWoundPen + luck + r;
      const ok = total > dv;
      const changes: CombatChange[] = [actionChange(man ? `特殊機動: ${man.name}` : '操縦')];
      if (man) changes.push({ target_id: actorPart.id, target_name: actorPart.name, field: 'state', before: { move_used: actorPart.move_used }, after: { move_used: true }, desc: `${actorPart.name} 移動アクション使用 (特殊機動)` });
      if (!ok) changes.push(updateVehicle(veh, { out_of_control: true }, `${myVeh!.name} 制御不能（移動は GM が決める）`));
      else if (myVeh!.out_of_control) changes.push(updateVehicle(veh, { out_of_control: false }, `${myVeh!.name} 制御を取り戻した`));
      return done(ok, `${man ? `特殊機動「${man.name}」` : '基本的な操縦'}: REF ${actorRef} + ${formatSkillName(skillKey)} ${skill}${actorWoundPen ? ` ${actorWoundPen}` : ''}${luckText} + 出目 ${r} = ${total} vs 難易度 ${dv} -> ${ok ? '成功' : '失敗: 制御不能（移動は GM が決め、何かにぶつかれば体当たりと同じ）'}`, changes);
    }

    if (input.action_key === 'vehicle_ram') {
      if (!veh.driver || !veh.started) return fail('始動したヴィークルの運転席にいません');
      const dice = input.damage_dice ?? [];
      if (dice.length !== RAM_DICE) return fail('体当たりのダメージ 6d6 の出目を 6 個入れてください（双方に同じ値）');
      const plow = myVeh!.upgrades.includes('Combat Plow');
      const total = dice.reduce((a, b) => a + b, 0);
      const changes: CombatChange[] = [actionChange('体当たり')];
      let formula = `体当たり（${myVeh!.name}）: 6d6 = ${total}`;
      const whiplash = (p: CombatParticipant) => {
        const ch = p.character;
        if (!ch) return;
        const inj = rollInjury(WHIPLASH.table, WHIPLASH.roll);
        if (!inj || (ch.crit_injuries ?? []).some((c: any) => c.table === 'head' && c.range?.[0] === 8)) return;
        changes.push({ target_id: ch.id, target_name: ch.name, field: 'crit_injuries', before: ch.crit_injuries, after: [...(ch.crit_injuries ?? []), inj], desc: `${ch.name} 致命傷: ${inj.name}（衝突）` });
        // 致命的損傷を受けると 5 点のボーナス・ダメージ（p.187）
        changes.push({ target_id: ch.id, target_name: ch.name, field: 'hp', before: ch.hp, after: Math.max(0, ch.hp - 5), desc: `${ch.name} HP ${ch.hp} → ${Math.max(0, ch.hp - 5)}（致命的損傷のボーナス 5）` });
      };
      // 自分のヴィークル（戦闘用プラウなら無傷で、乗員も頸椎損傷を受けない）
      if (!plow) {
        const after = Math.max(0, myVeh!.sdp - Math.max(0, total - myVeh!.sp));
        changes.push(updateVehicle(veh, { sdp: after }, `${myVeh!.name} SDP ${myVeh!.sdp} → ${after}`));
        for (const p of occupants(veh)) whiplash(p);
        formula += `。${myVeh!.name} SDP ${myVeh!.sdp} → ${after}`;
      } else formula += '。戦闘用プラウで自分のヴィークルと乗員は無傷';
      const tv = input.target_vehicle;
      if (tv) {
        const v = vehicleOf(tv);
        if (!v) return fail('体当たりする相手のヴィークルが見つかりません');
        const after = Math.max(0, v.sdp - Math.max(0, total - v.sp));
        changes.push(updateVehicle(tv, { sdp: after }, `${v.name} SDP ${v.sdp} → ${after}`));
        for (const p of occupants(tv)) whiplash(p);
        formula += `。${v.name} SDP ${v.sdp} → ${after}${after === 0 ? '（破壊。こちらは移動を続けられる）' : ''}`;
      } else if (targetPart?.character) {
        // 歩行者は【敏捷】＋〈回避〉＋1d10 が 13 を上回れば避けられる（p.193）
        const tc = targetPart.character;
        const dr = d10v(input.defense_roll);
        const dodge = dr !== null ? tc.stats.dex - (tc.armor_penalty ?? 0) + (tc.skills[skillNameToKey('evasion')] ?? 0) + dr : null;
        if (dodge !== null && dodge > 13) {
          formula += `。${targetPart.name} は回避した（${dodge} vs 13。望むならヴィークルの上に乗れる）`;
        } else {
          const res = resolveDamage({ dice, location: 'body', sp: tc.sp_body, currentHp: tc.hp });
          const after = Math.max(0, tc.hp - res.hpLoss);
          changes.push({ target_id: tc.id, target_name: tc.name, field: 'hp', before: tc.hp, after, desc: `${tc.name} HP ${tc.hp} → ${after} (はねられた ${res.hpLoss})` });
          if (res.spAfter !== tc.sp_body) changes.push({ target_id: tc.id, target_name: tc.name, field: 'sp_body', before: tc.sp_body, after: res.spAfter, desc: `${tc.name} SP 胴 ${tc.sp_body} → ${res.spAfter}` });
          whiplash(targetPart);
          formula += `。${targetPart.name} をはねた（${dodge !== null ? `回避 ${dodge} vs 13 失敗、` : ''}${res.hpLoss} ダメージ。HP が残れば上に乗れる。ヴィークルは移動を続けられる）`;
        }
      } else return fail('体当たりする相手（参加者かヴィークル）を選んでください');
      return done(true, formula, changes);
    }

    // attack_vehicle: ヴィークルを撃つ・殴る。弱点を狙うと −8 で SP を引いた後 2 倍（p.191）
    const tv = input.target_vehicle;
    const v = vehicleOf(tv);
    if (!tv || !v) return fail('攻撃するヴィークルを選んでください');
    const inv = (actorChar.inventory as InventoryEntry[]) ?? [];
    const entry = inv.find((i) => i.entry_id === input.weapon_entry_id);
    const w = entry ? getWeaponData(entry.item_id || entry.name) : null;
    if (!w) return fail('使う武器を選んでください');
    const weak = input.aimed_location === 'weakpoint';
    const missing: string[] = [];
    const a = d10v(input.attack_roll);
    if (a === null) missing.push('攻撃の出目 (1d10) を入力してください');
    const n = /^(\d+)d6$/.exec(w.damage ?? '')?.[1];
    if (!input.damage_dice || (n && input.damage_dice.length !== Number(n))) missing.push(`ダメージ ${w.damage} の出目を入れてください`);
    const moving = occupants(tv).some((p) => (p.state as any)?.in_vehicle?.driver && (p.state as any)?.in_vehicle?.started);
    let dv: number | null = null;
    if (w.is_ranged) {
      const table = w.dv_table_key ? getRuleConstant<DvTable>(`dv_table.${w.dv_table_key}`) ?? getRuleConstant<DvTable>(w.dv_table_key) : null;
      if (input.distance_m === undefined || input.distance_m === null) missing.push('距離を入力してください');
      else dv = table ? rangedDv(table, input.distance_m) : null;
      if (input.distance_m !== undefined && dv === null) missing.push('射程外か、武器の難易度表がありません');
    } else dv = moving ? 13 : null; // 停止中のヴィークルは近接なら自動で当たる
    if (missing.length) return fail(missing);
    const stat = w.is_ranged ? actorRef : actorDex;
    const lvl = actorChar.skills[skillNameToKey(w.skill)] ?? 0;
    const total = stat + lvl + actorWoundPen + luck + solo.precision + (weak ? -8 : 0) + (a as number);
    const hit = dv === null ? true : total > dv;
    let formula = `${v.name} を攻撃（${entry!.name}${weak ? '、弱点 −8' : ''}）: ${w.is_ranged ? 'REF' : 'DEX'} ${stat} + ${formatSkillName(skillNameToKey(w.skill))} ${lvl}${luckText}${precisionText} + 出目 ${a} = ${total} vs ${dv === null ? '停止中なので自動で命中' : `難易度 ${dv}`} -> ${hit ? '命中' : '外れ'}`;
    const changes: CombatChange[] = [actionChange('ヴィークルを攻撃')];
    if (w.is_ranged && typeof entry!.ammo === 'number') {
      const after = Math.max(0, entry!.ammo - 1);
      changes.push(
        { target_id: actorChar.id, target_name: actorChar.name, field: 'ammo', before: entry!.ammo, after, desc: `${actorChar.name} ${entry!.name} 弾数 ${entry!.ammo} → ${after}` },
        { target_id: actorChar.id, target_name: actorChar.name, field: 'inventory', before: inv, after: inv.map((i) => (i === entry ? { ...i, ammo: after } : i)), desc: `${actorChar.name} 所持品更新` },
      );
    }
    if (!hit) return done(false, formula, changes);
    const raw = input.damage_dice!.reduce((x, y) => x + y, 0);
    const through = Math.max(0, raw - v.sp) * (weak ? 2 : 1);
    const after = Math.max(0, v.sdp - through);
    changes.push(updateVehicle(tv, { sdp: after }, `${v.name} SDP ${v.sdp} → ${after}${after === 0 ? '（破壊）' : ''}`));
    formula += `。${raw}${v.sp ? ` − SP ${v.sp}` : ''}${weak ? ' × 2' : ''} = ${through} → SDP ${v.sdp} → ${after}${after === 0 ? '（破壊。修理するまで動かない）' : ''}`;
    return done(true, formula, changes);
  }

  // Check brawl distance if on board
  if (input.action_key === 'brawl' && boardId && actorPart.character_id && targetPart?.character_id) {
    const actorToken = db
      .select()
      .from(board_tokens)
      .where(and(eq(board_tokens.board_id, boardId), eq(board_tokens.character_id, actorPart.character_id)))
      .get();
    const targetToken = db
      .select()
      .from(board_tokens)
      .where(and(eq(board_tokens.board_id, boardId), eq(board_tokens.character_id, targetPart.character_id)))
      .get();
    if (actorToken && targetToken) {
      const dist = gridDistance({ x: actorToken.x, y: actorToken.y }, { x: targetToken.x, y: targetToken.y }, rules);
      if (dist > 1) {
        return {
          action_key: 'brawl',
          actor_id: actorPart.id,
          actor_name: actorPart.name,
          target_id: targetPart.id,
          target_name: targetPart.name,
          success: false,
          formula: `格闘の対象が離れすぎています (現在: ${dist}マス。隣接1マスのみ)`,
          breakdown: { distance: dist },
          changes: [],
          missing_inputs: ['格闘は隣接（1マス）の対象のみ可能です'],
        };
      }
    }
  }

  // 応急手当（安定化）: TECH + 応急手当か救急医療 + 1d10 が、相手の負傷段階で決まる難易度
  // （軽傷 10・重傷 13・瀕死 15）を上回れば成功。瀕死の相手は HP 1 になり、死亡セーブの修正がもとに戻る（Phase 5m）
  if (input.action_key === 'first_aid') {
    const tPart = targetPart ?? actorPart;
    const tChar = tPart.character;
    const missing: string[] = [];
    if (!tChar) missing.push('対象を選択してください');
    else if (tChar.hp >= tChar.hp_max) missing.push(`${tChar.name} は傷を負っていません`);
    const roll = input.attack_roll;
    if (!roll) missing.push('判定の出目を入力してください');
    else if ((roll.first === 10 || roll.first === 1) && roll.extra === undefined) missing.push('追加の出目 (1d10) を入力してください');
    if (missing.length > 0 || !tChar || !roll) {
      return {
        action_key: 'first_aid',
        actor_id: actorPart.id,
        actor_name: actorPart.name,
        target_id: tPart.id,
        target_name: tPart.name,
        success: false,
        formula: missing.join(' / '),
        breakdown: {},
        changes: [],
        missing_inputs: missing,
      };
    }
    const wound = woundState(tChar.hp, tChar.hp_max);
    const dv = wound === 'mortally' ? 15 : wound === 'seriously' ? 13 : 10;
    const fa = actorChar.skills[skillNameToKey('first_aid')] ?? 0;
    const pm = actorChar.skills[skillNameToKey('paramedic')] ?? 0;
    const skillLabel = pm > fa ? '救急医療' : '応急手当';
    const base = actorChar.stats.tech + Math.max(fa, pm) + actorWoundPen + luck;
    const res = resolveCheck({ base, first: roll.first, extra: roll.extra, target: dv, mode: 'dv' }, rules);
    const changes: CombatChange[] = [
      {
        target_id: actorPart.id,
        target_name: actorPart.name,
        field: 'state',
        ...useAction(actorPart),
        desc: `${actorPart.name} アクション使用 (応急手当)${actionCountLabel(actorPart)}`,
      },
    ];
    let formula = `応急手当: TECH ${actorChar.stats.tech} + ${skillLabel} ${Math.max(fa, pm)}${actorWoundPen ? ` ${actorWoundPen}` : ''}${luckText} + 出目 = ${res.total} vs 難易度 ${dv}（${wound === 'mortally' ? '瀕死' : wound === 'seriously' ? '重傷' : '軽傷'}）-> ${res.success ? '成功' : '失敗'}`;
    if (res.success) {
      if (wound === 'mortally') {
        changes.push({
          target_id: tChar.id,
          target_name: tChar.name,
          field: 'hp',
          before: tChar.hp,
          after: 1,
          desc: `${tChar.name} 安定化: HP ${tChar.hp} → 1`,
        });
        // 瀕死から安定化すると HP 1 になり、気絶状態（1 分間意識を失い行動不能）になる（日本語版 p.186）
        const statusChange = woundStatusChange(tChar, tChar.status || [], tChar.hp, 1);
        if (statusChange) changes.push(statusChange);
        const statusBefore = (statusChange?.after as string[] | undefined) ?? tChar.status ?? [];
        changes.push({
          target_id: tChar.id,
          target_name: tChar.name,
          field: 'status',
          before: statusBefore,
          after: [...statusBefore.filter((st) => st !== '気絶'), '気絶'],
          desc: `${tChar.name} 状態: 気絶（1 分間行動できない）`,
        });
        // 1 ターン（1 ラウンド）は約 3 秒なので、1 分は 20 ラウンド（日本語版 p.126・168）。過ぎたら自動で外れる
        const rounds = (tPart.state?.statusRounds as Record<string, number> | undefined) ?? null;
        changes.push({
          target_id: tPart.id,
          target_name: tPart.name,
          field: 'state',
          before: { statusRounds: rounds },
          after: { statusRounds: { ...(rounds ?? {}), 気絶: UNCONSCIOUS_ROUNDS } },
          desc: `${tPart.name} 気絶は ${UNCONSCIOUS_ROUNDS} ラウンド（1 分）`,
        });
        // 死亡セーヴの修正は基本値に戻る。致命的損傷で上がった基本値は治療するまで残る（p.188）
        const { base: basePenalty, added } = deathSavePenaltyOf(tPart);
        if (added !== 0) {
          changes.push({
            target_id: tPart.id,
            target_name: tPart.name,
            field: 'state',
            before: { deathSavePenalty: added },
            after: { deathSavePenalty: 0 },
            desc: `${tPart.name} 死亡セーブの修正が基本値 ${basePenalty} に戻る`,
          });
        }
        formula += `。HP 1 で安定し、気絶する（1 分 = ${UNCONSCIOUS_ROUNDS} ラウンド行動できない）。死亡セーブは要らなくなる`;
      } else {
        formula += '。安定し、自然に治り始める';
      }
      // 安定化すると自然治癒が始まる（1 日休むごとに【体格】ぶん。p.222。Phase 5w）
      changes.push({ target_id: tChar.id, target_name: tChar.name, field: 'extra', before: tChar.extra ?? {}, after: { ...(tChar.extra ?? {}), healing: true }, desc: `${tChar.name} 自然治癒が始まる` });
    }
    return {
      action_key: 'first_aid',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      target_id: tPart.id,
      target_name: tPart.name,
      success: res.success,
      formula,
      breakdown: { total: res.total, dv },
      changes,
    };
  }

  const unconfirmedKeys = [
    'take_cover',
    'suppressive',
    'hide',
    'pickup',
    'use_skill',
    'item_cyberware',
    'dodge',
    'other',
  ];
  if (unconfirmedKeys.includes(input.action_key)) {
    const manualChanges = input.manual_changes ?? [];
    // 制圧射撃は弾を 10 発使う。残りが 10 発未満なら撃てない（日本語版 p.174。Phase 5r）
    const ammoChanges: CombatChange[] = [];
    if (input.action_key === 'suppressive') {
      const inv: InventoryEntry[] = (actorChar.inventory as InventoryEntry[]) || [];
      const invWeapon = input.weapon_entry_id
        ? inv.find((i) => i.entry_id === input.weapon_entry_id)
        : input.weapon_id
          ? inv.find((i) => i.entry_id === input.weapon_id || i.item_id === input.weapon_id || i.name === input.weapon_id)
          : undefined;
      const wData = getWeaponData(invWeapon?.item_id || input.weapon_id || invWeapon?.name);
      const problem = !wData
        ? '制圧射撃に使う武器を選択してください'
        : !wData.suppressive
          ? `${wData.name_ja} では制圧射撃ができません`
          : null;
      const current = wData && typeof wData.magazine_max === 'number' ? (typeof invWeapon?.ammo === 'number' ? invWeapon.ammo : wData.magazine_max) : null;
      const short = !problem && current !== null && current < AUTOFIRE_ROUNDS
        ? `制圧射撃は 10 発使います。弾倉の残りが 10 発未満なので撃てません (残弾 ${current})`
        : null;
      if (problem || short) {
        const msg = (problem || short)!;
        return {
          action_key: input.action_key,
          actor_id: actorPart.id,
          actor_name: actorPart.name,
          success: false,
          formula: msg,
          breakdown: {},
          changes: [],
          missing_inputs: [msg],
        };
      }
      if (wData && current !== null && invWeapon) {
        const after = current - AUTOFIRE_ROUNDS;
        ammoChanges.push(
          {
            target_id: actorChar.id,
            target_name: actorChar.name,
            field: 'ammo',
            before: current,
            after,
            desc: `${actorChar.name} ${wData.name_ja} 弾数 ${current}/${wData.magazine_max} → ${after}/${wData.magazine_max} (-${AUTOFIRE_ROUNDS}発)`,
          },
          {
            target_id: actorChar.id,
            target_name: actorChar.name,
            field: 'inventory',
            before: inv,
            after: inv.map((i) => (i.entry_id === invWeapon.entry_id ? { ...i, ammo: after } : i)),
            desc: `${actorChar.name} 所持品更新 (${wData.name_ja} 弾数 ${after})`,
          },
        );
      }
    }
    const isMove = input.action_key === 'take_cover';
    const baseChanges: CombatChange[] = [
      {
        target_id: actorPart.id,
        target_name: actorPart.name,
        field: 'state',
        ...(isMove ? { before: { move_used: actorPart.move_used }, after: { move_used: true } } : useAction(actorPart)),
        desc: `${actorPart.name} ${isMove ? '移動' : 'アクション'}使用 (${ACTION_LABEL[input.action_key] ?? input.action_key})${isMove ? '' : actionCountLabel(actorPart)}`,
      },
      ...ammoChanges,
      ...manualChanges,
    ];

    return {
      action_key: input.action_key,
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      target_id: targetPart?.id,
      target_name: targetPart?.name,
      success: true,
      formula: input.manual_notes || 'GM 手動判定',
      breakdown: { manual: true, notes: input.manual_notes },
      changes: baseChanges,
    };
  }

  // 6. Ranged / Aimed / Autofire
  if (['ranged', 'aimed', 'autofire'].includes(input.action_key)) {
    const missing_inputs: string[] = [];
    const actorInventory: InventoryEntry[] = (actorChar.inventory as InventoryEntry[]) || [];
    const invWeapon = input.weapon_entry_id
      ? actorInventory.find((i) => i.entry_id === input.weapon_entry_id)
      : input.weapon_id
        ? actorInventory.find(
            (i) =>
              i.entry_id === input.weapon_id ||
              i.item_id === input.weapon_id ||
              i.name === input.weapon_id,
          )
        : undefined;
    const weaponItemId = invWeapon?.item_id || input.weapon_id;
    const wData = getWeaponData(weaponItemId || invWeapon?.name);
    if (!wData) {
      missing_inputs.push('武器を選択してください');
    }

    const isAimed = input.action_key === 'aimed';
    const isAutofire = input.action_key === 'autofire';

    // DV lookup
    let dvTable: DvTable | null = null;
    if (wData) {
      if (isAutofire) {
        if (!wData.dv_table_key) {
          missing_inputs.push(`${wData.name_ja} には難易度表がありません`);
        } else {
          // 武器データの表の名前に (Autofire) が付いているものはそのまま使う（Phase 5s）
          const autofireKey = /\(Autofire\)$/.test(wData.dv_table_key) ? wData.dv_table_key : `${wData.dv_table_key} (Autofire)`;
          dvTable =
            getRuleConstant<DvTable>(`dv_table.${autofireKey}`) ||
            getRuleConstant<DvTable>(autofireKey);
          if (!dvTable) {
            missing_inputs.push(`フルオート射撃の難易度表（${autofireKey}）がありません`);
          }
        }
        if (typeof wData.autofire !== 'number' || wData.autofire <= 0) {
          missing_inputs.push(`${wData.name_ja} はフルオート射撃ができません。フルオート射撃のある武器（SMG、アサルト・ライフルなど）を選んでください`);
        }
      } else {
        if (!wData.dv_table_key) {
          missing_inputs.push('武器の DV 表がありません');
        } else {
          dvTable =
            getRuleConstant<DvTable>(`dv_table.${wData.dv_table_key}`) ||
            getRuleConstant<DvTable>(wData.dv_table_key);
          if (!dvTable) {
            missing_inputs.push('武器の DV 表がありません');
          }
        }
      }
    }

    // Check board LoS and distance if combat has a board
    let effectiveLos: 'clear' | 'cover' | 'blocked' = 'clear';
    const coverChanges: CombatChange[] = [];

    if (boardId && actorPart.character_id && targetPart?.character_id) {
      const actorToken = db
        .select()
        .from(board_tokens)
        .where(and(eq(board_tokens.board_id, boardId), eq(board_tokens.character_id, actorPart.character_id)))
        .get();
      const targetToken = db
        .select()
        .from(board_tokens)
        .where(and(eq(board_tokens.board_id, boardId), eq(board_tokens.character_id, targetPart.character_id)))
        .get();

      if (actorToken && targetToken) {
        const boardObs = db.select().from(board_objects).where(eq(board_objects.board_id, boardId)).all();
        const losRes = checkLineOfSight(
          { x: actorToken.x, y: actorToken.y },
          { x: targetToken.x, y: targetToken.y },
          boardObs as unknown as BoardObstacle[],
          rules,
        );

        if (input.distance_m === undefined || input.distance_m === null) {
          input.distance_m = losRes.distanceMeters;
        }

        effectiveLos = input.los_override || losRes.status;
        if (effectiveLos === 'blocked') {
          missing_inputs.push('壁に遮られて射線が通りません');
        } else if (effectiveLos === 'cover') {
          if (input.hit_cover && input.cover_object_id) {
            const coverObj = boardObs.find((o) => o.id === input.cover_object_id);
            if (coverObj) {
              const curHp =
                coverObj.cover_hp !== null && coverObj.cover_hp !== undefined
                  ? coverObj.cover_hp
                  : (input.cover_current_hp !== undefined && input.cover_current_hp !== null
                      ? input.cover_current_hp
                      : null);

              if (curHp === null) {
                missing_inputs.push('遮蔽物の HP を入力してください');
              } else if (input.cover_damage === undefined || input.cover_damage === null) {
                missing_inputs.push('遮蔽物に与えるダメージを入力してください');
              } else {
                const newHp = Math.max(0, curHp - input.cover_damage);
                const newBlocksLos = newHp === 0 ? 'none' : coverObj.blocks_los;
                coverChanges.push({
                  target_id: coverObj.id,
                  target_name: coverObj.label || '遮蔽物',
                  field: 'cover_hp',
                  before: { cover_hp: coverObj.cover_hp, blocks_los: coverObj.blocks_los },
                  after: { cover_hp: newHp, blocks_los: newBlocksLos },
                  desc: `${coverObj.label || '遮蔽物'} に ${input.cover_damage} ダメージ (HP ${curHp} → ${newHp}${newHp === 0 ? '、破壊' : ''})`,
                });
              }
            }
          }
        }
      }
    }

    // Attacks list to resolve (supports ROF 2)
    const rawAttacks: SingleAttackInput[] =
      input.attacks && input.attacks.length > 0
        ? input.attacks
        : [
            {
              target_id: input.target_id,
              distance_m: input.distance_m,
              dodge_mode: input.dodge_mode,
              attack_roll: input.attack_roll,
              defense_roll: input.defense_roll,
              damage_dice: input.damage_dice,
              crit_injury_roll: input.crit_injury_roll,
              extra_crit_injury_roll: input.extra_crit_injury_roll,
              aimed_location: input.aimed_location,
              held_item_id: input.held_item_id,
              manual_changes: input.manual_changes,
            },
          ];

    // Ammo inventory verification
    const currentAmmoRaw: number | null =
      wData && wData.magazine_max !== null && wData.magazine_max !== undefined
        ? invWeapon && typeof invWeapon.ammo === 'number'
          ? invWeapon.ammo
          : wData.magazine_max
        : null;
    const currentAmmo = currentAmmoRaw;
    // 弾が足りないときは、残っている分だけ撃つ（ROF 2 で残り 1 発なら 1 回だけ）。0 発なら撃てない（Phase 5r）
    let ammoNote = '';
    if (!isAutofire && currentAmmo !== null && currentAmmo > 0 && currentAmmo < rawAttacks.length) {
      ammoNote = `残弾 ${currentAmmo} 発なので ${currentAmmo} 回だけ撃つ`;
      rawAttacks.splice(currentAmmo);
    }

    // フルオート射撃は毎回 10 発。弾倉の残りが 10 発未満なら撃てない（日本語版 p.173）
    const totalAmmoNeeded = isAutofire ? AUTOFIRE_ROUNDS : rawAttacks.length;
    // ROF を超える回数は撃てない（照準射撃・オートファイアは ROF に関係なく 1 回。Phase 5m）
    const maxShots = isAimed || isAutofire ? 1 : Number(wData?.rof ?? 1) || 1;
    if (wData && rawAttacks.length > maxShots) {
      missing_inputs.push(`この攻撃は 1 回のアクションで ${maxShots} 回までです`);
    }
    if (currentAmmo !== null && currentAmmo < totalAmmoNeeded) {
      missing_inputs.push(
        isAutofire
          ? `フルオート射撃は 10 発使います。弾倉の残りが 10 発未満なので撃てません (残弾 ${currentAmmo})`
          : currentAmmo === 0
            ? '弾切れです。リロード（アクション 1 回）するか、別の武器・行動を選んでください'
            : `残弾が不足しています (残弾 ${currentAmmo} / 必要 ${totalAmmoNeeded})`,
      );
    }

    // Validate each attack
    rawAttacks.forEach((att, idx) => {
      const prefix = rawAttacks.length > 1 ? `第${idx + 1}攻撃: ` : '';
      if (att.distance_m === undefined || att.distance_m === null) {
        missing_inputs.push(`${prefix}距離を入力してください`);
      }
      if (!att.attack_roll) {
        missing_inputs.push(`${prefix}攻撃の出目 (1d10) を入力してください`);
      } else if (
        atkNeedsExtra(att.attack_roll)
      ) {
        missing_inputs.push(
          att.attack_roll.first === 10
            ? `${prefix}攻撃クリティカル: 追加出目 (1d10) を入力してください`
            : `${prefix}攻撃ファンブル: 追加出目 (1d10) を入力してください`,
        );
      }
    });

    if (missing_inputs.length > 0 || !wData || !dvTable) {
      return {
        action_key: input.action_key,
        actor_id: actorPart.id,
        actor_name: actorPart.name,
        target_id: targetPart?.id,
        target_name: targetPart?.name,
        success: false,
        formula: missing_inputs.join(' / '),
        breakdown: { missing_inputs },
        changes: [],
        missing_inputs,
      };
    }

    // Resolve attacks sequentially tracking defender HP/SP
    const changes: CombatChange[] = [
      {
        target_id: actorPart.id,
        target_name: actorPart.name,
        field: 'state',
        ...useAction(actorPart),
        desc: `${actorPart.name} アクション使用 (${ACTION_LABEL[input.action_key] ?? input.action_key})${actionCountLabel(actorPart)}`,
      },
    ];

    // Deduct ammo from weapon inventory
    if (currentAmmo !== null) {
      const newAmmo = Math.max(0, currentAmmo - totalAmmoNeeded);
      const newInventory = [...actorInventory];
      const wIdx = invWeapon
        ? newInventory.findIndex((i) => i.entry_id === invWeapon.entry_id)
        : newInventory.findIndex(
            (i) => i.item_id === wData.item_id || i.name === wData.name_ja,
          );
      if (wIdx >= 0) {
        newInventory[wIdx] = { ...newInventory[wIdx], ammo: newAmmo };
      } else {
        newInventory.push({
          entry_id: 'w-' + Math.random().toString(36).slice(2),
          item_id: wData.item_id,
          name: wData.name_ja,
          qty: 1,
          equipped: true,
          ammo: newAmmo,
        });
      }
      changes.push({
        target_id: actorChar.id,
        target_name: actorChar.name,
        field: 'ammo',
        before: currentAmmo,
        after: newAmmo,
        desc: `${actorChar.name} ${wData.name_ja} 弾数 ${currentAmmo}/${wData.magazine_max} → ${newAmmo}/${wData.magazine_max} (-${totalAmmoNeeded}発)`,
      });
      changes.push({
        target_id: actorChar.id,
        target_name: actorChar.name,
        field: 'inventory',
        before: actorInventory,
        after: newInventory,
        desc: `${actorChar.name} 所持品更新 (${wData.name_ja} 弾数 ${newAmmo})`,
      });
    }

    const runningHpMap = new Map<string, number>();
    const runningSpHeadMap = new Map<string, number>();
    const runningSpBodyMap = new Map<string, number>();
    const runningStatusMap = new Map<string, string[]>();
    const runningCritMap = new Map<string, unknown[]>();
    const runningPenaltyMap = new Map<string, number>();
    let allHit = true;
    const formulaParts: string[] = [];

    for (let i = 0; i < rawAttacks.length; i++) {
      const att = rawAttacks[i];
      const prefix = rawAttacks.length > 1 ? `[#${i + 1}] ` : '';
      const distanceM = att.distance_m!;
      const dv = rangedDv(dvTable, distanceM);

      const curTargetPart =
        (att.target_id && allParticipants
          ? allParticipants.find((p) => p.id === att.target_id)
          : undefined) || targetPart;
      const curTargetChar = curTargetPart?.character;

      const curTargetId = curTargetChar?.id || 'default';
      if (curTargetChar && !runningHpMap.has(curTargetId)) {
        runningHpMap.set(curTargetId, curTargetChar.hp);
        runningSpHeadMap.set(curTargetId, curTargetChar.sp_head);
        runningSpBodyMap.set(curTargetId, curTargetChar.sp_body);
      }
      let runningHp = runningHpMap.get(curTargetId) ?? 0;
      let runningSpHead = runningSpHeadMap.get(curTargetId) ?? 0;
      let runningSpBody = runningSpBodyMap.get(curTargetId) ?? 0;

      if (dv === null) {
        formulaParts.push(`${prefix}距離 ${distanceM}m: 射程外 (DV なし)`);
        allHit = false;
        continue;
      }

      // Attack roll calculation（重い防具のペナルティを引いた REF）
      const stat = actorRef;
      const skillKey = skillNameToKey(wData.skill);
      const skillLevel = actorChar.skills[skillKey] ?? 0;
      const base = attackBase({
        stat,
        skillLevel,
        woundPenalty: actorWoundPen + (i === 0 ? luck : 0) + solo.precision,
        aimed: isAimed,
      });

      const attD10 = atkD10(att.attack_roll!);
      const attackTotal = base + attD10;

      // Defense calculation
      let isHit = false;
      let defFormula = '';
      // 支援要員・トラウマ・チームは弾丸を回避できない（p.158・224）
      const canDodge = curTargetChar ? canDodgeRanged(curTargetChar.stats.ref - (curTargetChar.armor_penalty ?? 0)) && !(curTargetChar.status ?? []).includes(NO_BULLET_DODGE) : false;
      const isDodging = canDodge && att.dodge_mode === 'dodge';

      if (isDodging && curTargetChar) {
        if (!att.defense_roll) {
          missing_inputs.push(`${prefix}回避の出目 (1d10) を入力してください`);
          continue;
        }
        if (
          (att.defense_roll.first === 10 || att.defense_roll.first === 1) &&
          att.defense_roll.extra === undefined
        ) {
          missing_inputs.push(
            att.defense_roll.first === 10
              ? `${prefix}回避クリティカル: 追加出目 (1d10) を入力してください`
              : `${prefix}回避ファンブル: 追加出目 (1d10) を入力してください`,
          );
          continue;
        }

        const defStat = curTargetChar.stats.dex - (curTargetChar.armor_penalty ?? 0);
        const defSkillKey = skillNameToKey('evasion');
        const defSkill = curTargetChar.skills[defSkillKey] ?? 0;
        const defWound = woundState(runningHp, curTargetChar.hp_max);
        const defWoundPen = woundPenalty(defWound) + grapplePenalty(runningStatusMap.get(curTargetId) ?? curTargetChar.status);
        const defD10 = resolveD10(att.defense_roll.first, att.defense_roll.extra).value;
        const defTotal = defStat + defSkill + defWoundPen + defD10;
        isHit = attackTotal > defTotal;
        defFormula = `DEX ${defStat} + 回避 ${defSkill} + 出目 ${defD10}${defWoundPen ? ` ${defWoundPen}` : ''} = ${defTotal}`;
      } else {
        isHit = attackTotal > dv;
        defFormula = `難易度 ${dv}`;
      }

      let subFormula = `${prefix}REF ${stat} + 技能 ${skillLevel} + 出目 ${attD10}${actorWoundPen ? ` ${actorWoundPen}` : ''}${i === 0 ? luckText : ''}${precisionText}${isAimed ? ' −8' : ''} = ${attackTotal} vs ${defFormula} -> ${isHit ? '命中' : '外れ'}`;

      if (!isHit) {
        allHit = false;
        formulaParts.push(subFormula);
        continue;
      }

      // Hit branch
      if (curTargetChar && curTargetPart) {
        if (input.hit_cover && coverChanges.length > 0) {
          subFormula += ` (遮蔽物に命中)`;
          formulaParts.push(subFormula);
          changes.push(...coverChanges);
          continue;
        }

        if (isAimed && att.aimed_location === 'held_item' && att.held_item_id) {
          changes.push({
            target_id: curTargetPart.id,
            target_name: curTargetPart.name,
            field: 'dropped',
            before: null,
            after: att.held_item_id,
            desc: `${curTargetPart.name} の持っている物を落とさせた`,
          });
          subFormula += ` (持っている物を落とした)`;

          if (boardId && curTargetPart.character_id) {
            const targetToken = db
              .select()
              .from(board_tokens)
              .where(
                and(
                  eq(board_tokens.board_id, boardId),
                  eq(board_tokens.character_id, curTargetPart.character_id),
                ),
              )
              .get();
            const droppedItem = (curTargetChar.inventory as any[]).find(
              (i: any) => i.entry_id === att.held_item_id || i.item_id === att.held_item_id,
            );
            if (targetToken && droppedItem) {
              const dropId = generateUlid();
              const itemName = (droppedItem as any).name || 'アイテム';
              changes.push({
                target_id: dropId,
                target_name: itemName,
                field: 'board_drop',
                before: null,
                after: {
                  id: dropId,
                  board_id: boardId,
                  x: targetToken.x,
                  y: targetToken.y,
                  inventory_entry: droppedItem,
                  from_character_id: curTargetChar.id,
                },
                desc: `${curTargetPart.name} が ${itemName} を足元 (${targetToken.x}, ${targetToken.y}) に落とした`,
              });
            }
          }
        } else {
          // Requires damage dice
          if (!att.damage_dice || att.damage_dice.length === 0) {
            missing_inputs.push(`${prefix}ダメージダイスの出目を入力してください`);
            continue;
          }

          // オートファイアのダメージは 2d6（倍率は難易度を超えた分）
          const diceErr = damageDiceCountError(isAutofire ? '2d6' : wData.damage, att.damage_dice);
          if (diceErr) {
            missing_inputs.push(`${prefix}${diceErr}`);
            continue;
          }

          const location = isAimed && att.aimed_location === 'head' ? 'head' : 'body';
          const targetSp = location === 'head' ? runningSpHead : runningSpBody;

          let multiplier = 1;
          if (isAutofire) {
            const cap = wData.autofire!;
            multiplier = autofireMultiplier({ attackTotal, dv, weaponCap: cap });
          }

          const critsBefore = runningCritMap.get(curTargetId) ?? curTargetChar.crit_injuries ?? [];
          const dmgRes = resolveDamage({
            dice: att.damage_dice,
            multiplier,
            location,
            // 「頭蓋損傷」があると頭部は 3 倍（日本語版 p.188）
            headMultiplier: hasCrackedSkull(critsBefore as never) ? 3 : 2,
            flatBonus: spotWeaknessLeft,
            sp: targetSp,
            ignoreArmorPercent: wData.ignore_armor_percent ?? 0,
            currentHp: runningHp,
          });
          // ソロの弱点看破（ラウンドの最初の命中に +）と、相手のダメージ軽減（ラウンドの最初のダメージに −）（p.146）
          const soloNotes = applySoloDamage(dmgRes, curTargetPart, changes);
          if (soloNotes) subFormula += soloNotes;
          // 瀕死のあいだに攻撃でダメージを受けると、致命的損傷を 1 つ受け、死亡セーヴの修正値が 1 増える（日本語版 p.186・188）
          const mortalHit = woundState(runningHp, curTargetChar.hp_max) === 'mortally' && dmgRes.hpLoss > 0;
          const injuryTable = dmgRes.criticalInjuryTable ?? (mortalHit ? location : null);

          // Check for critical injury roll requirement
          if (injuryTable) {
            if (att.crit_injury_roll === undefined || att.crit_injury_roll === null) {
              missing_inputs.push(`${prefix}致命傷表 (2d6) の出目を入力してください`);
              continue;
            }
            // 6 が 2 個のクリティカルと瀕死中の被弾が重なると、致命的損傷は 2 つ（p.186・187）
            if (mortalHit && dmgRes.criticalInjuryTable && (att.extra_crit_injury_roll === undefined || att.extra_crit_injury_roll === null)) {
              missing_inputs.push(`${prefix}瀕死中の被弾で致命的損傷がもう 1 つ: 致命傷表 (2d6) の 2 つ目の出目を入力してください`);
              continue;
            }
          }

          // Apply damage
          const hpBeforeHit = runningHp;
          const newHp = Math.max(0, runningHp - dmgRes.hpLoss);
          changes.push({
            target_id: curTargetChar.id,
            target_name: curTargetChar.name,
            field: 'hp',
            before: runningHp,
            after: newHp,
            desc: `${curTargetChar.name} HP ${runningHp} → ${newHp} (${dmgRes.hpLoss} ダメージ)`,
          });
          runningHp = newHp;
          runningHpMap.set(curTargetId, newHp);

          // Apply SP ablation
          if (dmgRes.spAfter !== targetSp) {
            const spField = location === 'head' ? 'sp_head' : 'sp_body';
            changes.push({
              target_id: curTargetChar.id,
              target_name: curTargetChar.name,
              field: spField,
              before: targetSp,
              after: dmgRes.spAfter,
              desc: `${curTargetChar.name} SP ${location === 'head' ? '頭' : '胴'} ${targetSp} → ${dmgRes.spAfter}`,
            });
            if (location === 'head') {
              runningSpHead = dmgRes.spAfter;
              runningSpHeadMap.set(curTargetId, dmgRes.spAfter);
            } else {
              runningSpBody = dmgRes.spAfter;
              runningSpBodyMap.set(curTargetId, dmgRes.spAfter);
            }
          }

          // Wound state check（同じ相手に 2 回当たったら 1 回目のあとから。Phase 5m）
          const statusChange = woundStatusChange(curTargetChar, runningStatusMap.get(curTargetId) ?? curTargetChar.status ?? [], hpBeforeHit, runningHp);
          if (statusChange) {
            changes.push(statusChange);
            runningStatusMap.set(curTargetId, statusChange.after as string[]);
          }

          // Critical injury application
          if (injuryTable && att.crit_injury_roll) {
            const rolls = [att.crit_injury_roll, ...(mortalHit && dmgRes.criticalInjuryTable && att.extra_crit_injury_roll ? [att.extra_crit_injury_roll] : [])];
            let critsAfter = critsBefore;
            for (const roll of rolls) {
              const cleanEntry = rollInjury(injuryTable, roll);
              if (!cleanEntry) continue;
              const next = [...critsAfter, cleanEntry];
              changes.push({
                target_id: curTargetChar.id,
                target_name: curTargetChar.name,
                field: 'crit_injuries',
                before: critsAfter,
                after: next,
                desc: `${curTargetChar.name} 致命傷: ${cleanEntry.name}${cleanEntry.summary ? ` (${cleanEntry.summary})` : ''}`,
              });
              critsAfter = next;
              subFormula += ` [致命傷: ${cleanEntry.name}]`;
            }
            runningCritMap.set(curTargetId, critsAfter);
          }
          if (mortalHit) {
            const added = runningPenaltyMap.get(curTargetPart.id) ?? deathSavePenaltyOf(curTargetPart).added;
            changes.push({
              target_id: curTargetPart.id,
              target_name: curTargetPart.name,
              field: 'state',
              before: { deathSavePenalty: added },
              after: { deathSavePenalty: added + 1 },
              desc: `${curTargetPart.name} 瀕死で被弾: 死亡セーブの修正 +1`,
            });
            runningPenaltyMap.set(curTargetPart.id, added + 1);
            subFormula += ' (瀕死で被弾: 致命的損傷 1 つ、死亡セーブの修正 +1)';
          }

          // Aimed leg: GM manual effect (Issue #4, do not auto-apply)
          if (isAimed && att.aimed_location === 'leg') {
            subFormula += ` (脚に命中: 追加効果は GM 手入力)`;
            if (att.manual_changes && att.manual_changes.length > 0) {
              changes.push(...att.manual_changes);
            }
          }
        }
      }

      formulaParts.push(subFormula);
    }

    if (missing_inputs.length > 0) {
      return {
        action_key: input.action_key,
        actor_id: actorPart.id,
        actor_name: actorPart.name,
        target_id: targetPart?.id,
        target_name: targetPart?.name,
        success: false,
        formula: missing_inputs.join(' / '),
        breakdown: { missing_inputs },
        changes: [],
        missing_inputs,
      };
    }

    return {
      action_key: input.action_key,
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      target_id: targetPart?.id,
      target_name: targetPart?.name,
      success: allHit,
      formula: [ammoNote, ...formulaParts].filter(Boolean).join(' ｜ '),
      breakdown: {
        allHit,
        attacksResolved: rawAttacks.length,
      },
      changes,
    };
  }

  // 7. Melee attack（格闘＝素手も同じ計算。ROF 2 なら 1 回のアクションで 2 回攻撃できる。Phase 5l/5m）
  if (input.action_key === 'melee' || input.action_key === 'brawl' || input.action_key === 'martial_arts') {
    const isBrawl = input.action_key === 'brawl';
    // 武術攻撃: 【敏捷】＋〈武術〉、ROF 2、ダメージは【体格】で決まり、防具は半分（端数切り上げ）（日本語版 p.178。Phase 5u）
    const isMartial = input.action_key === 'martial_arts';
    const martialStyle = isMartial
      ? input.martial_style && (actorChar.skills[input.martial_style] ?? 0) >= 1
        ? { key: input.martial_style, level: actorChar.skills[input.martial_style] }
        : bestMartialStyle()
      : null;
    const missing_inputs: string[] = [];
    const actorInventory: InventoryEntry[] = (actorChar.inventory as InventoryEntry[]) || [];
    const invWeapon = input.weapon_entry_id
      ? actorInventory.find((i) => i.entry_id === input.weapon_entry_id)
      : input.weapon_id
        ? actorInventory.find(
            (i) =>
              i.entry_id === input.weapon_id ||
              i.item_id === input.weapon_id ||
              i.name === input.weapon_id,
          )
        : undefined;
    const weaponItemId = invWeapon?.item_id || input.weapon_id;
    // 格闘は武器なし: 技能は格闘、ROF 2、ダメージは BODY で決まる（4 以下 1d6、5〜6 2d6、7〜10 3d6、11 以上 4d6）、防具は普通に効く
    // サイバーアームで殴るときは最低 2d6（日本語版 p.176）
    const body = actorChar.stats.body;
    const hasCyberarm = (actorChar.cyberware ?? []).some((c) => isCyberarm(c));
    const brawlDice = Math.max(body <= 4 ? 1 : body <= 6 ? 2 : body <= 10 ? 3 : 4, hasCyberarm ? 2 : 0);
    const wData = isMartial
      ? martialStyle
        ? { skill: martialStyle.key, damage: `${martialArtsDice(body)}d6`, ignore_armor_percent: 50, rof: 2 }
        : null
      : isBrawl
        ? { skill: 'Brawling', damage: `${brawlDice}d6`, ignore_armor_percent: 0, rof: 2 }
        : getWeaponData(weaponItemId || invWeapon?.name);
    if (!wData) {
      missing_inputs.push(isMartial ? '武術攻撃には〈武術〉が 1 レベル以上必要です' : '武器を選択してください');
    }

    const weaponIgnore = wData?.ignore_armor_percent;
    const ignoreArmorPercent =
      typeof weaponIgnore === 'number'
        ? weaponIgnore
        : typeof input.ignore_armor_percent === 'number'
          ? input.ignore_armor_percent
          : null;
    if (wData && ignoreArmorPercent === null) {
      missing_inputs.push('防具無視率が不明です (GM が入力してください)');
    }

    const rawAttacks: SingleAttackInput[] =
      input.attacks && input.attacks.length > 0
        ? input.attacks
        : [
            {
              target_id: input.target_id,
              dodge_mode: 'dodge',
              attack_roll: input.attack_roll,
              defense_roll: input.defense_roll,
              damage_dice: input.damage_dice,
              crit_injury_roll: input.crit_injury_roll,
              extra_crit_injury_roll: input.extra_crit_injury_roll,
            },
          ];
    const rof = Number(wData?.rof ?? 1) || 1;
    if (rawAttacks.length > rof) {
      missing_inputs.push(`この武器の ROF は ${rof} なので、1 回のアクションで ${rof} 回までです`);
    }

    const targetOf = (att: SingleAttackInput) =>
      (att.target_id && allParticipants ? allParticipants.find((p) => p.id === att.target_id) : undefined) || targetPart;

    // 入力の確認（攻撃ごと）
    rawAttacks.forEach((att, idx) => {
      const prefix = rawAttacks.length > 1 ? `第${idx + 1}攻撃: ` : '';
      const tPart = targetOf(att);
      if (!tPart?.character) {
        missing_inputs.push(`${prefix}対象を選択してください`);
        return;
      }
      if (boardId && actorPart.character_id && tPart.character_id) {
        const actorToken = db
          .select()
          .from(board_tokens)
          .where(and(eq(board_tokens.board_id, boardId), eq(board_tokens.character_id, actorPart.character_id)))
          .get();
        const targetToken = db
          .select()
          .from(board_tokens)
          .where(and(eq(board_tokens.board_id, boardId), eq(board_tokens.character_id, tPart.character_id)))
          .get();
        if (actorToken && targetToken) {
          const dist = gridDistance({ x: actorToken.x, y: actorToken.y }, { x: targetToken.x, y: targetToken.y }, rules);
          if (dist > 1) {
            missing_inputs.push(`${prefix}近接攻撃は隣接（1マス）の対象のみ可能です (現在: ${dist}マス)`);
          }
        }
      }
      const cannotDodgeMelee = (tPart.character.status ?? []).includes('回避できない');
      for (const [roll, label] of [
        [att.attack_roll, '攻撃'],
        ...(cannotDodgeMelee ? [] : ([[att.defense_roll, '回避']] as const)),
      ] as const) {
        if (!roll) {
          missing_inputs.push(`${prefix}${label === '攻撃' ? '攻撃の出目 (1d10)' : '回避の出目 (1d10)'}を入力してください`);
        } else if (label === '攻撃' ? atkNeedsExtra(roll) : (roll.first === 10 || roll.first === 1) && roll.extra === undefined) {
          missing_inputs.push(
            `${prefix}${label}${roll.first === 10 ? 'クリティカル' : 'ファンブル'}: 追加出目 (1d10) を入力してください`,
          );
        }
      }
    });

    const failed = (): ResolveResult => ({
      action_key: input.action_key,
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      target_id: targetPart?.id,
      target_name: targetPart?.name,
      success: false,
      formula: missing_inputs.join(' / '),
      breakdown: { missing_inputs },
      changes: [],
      missing_inputs,
    });
    if (missing_inputs.length > 0 || !wData) return failed();

    const stat = actorDex;
    const skillKey = skillNameToKey(wData.skill);
    const skillLevel = actorChar.skills[skillKey] ?? 0;
    const base = attackBase({ stat, skillLevel, woundPenalty: actorWoundPen });
    const label = isMartial ? `武術 (${formatSkillName(wData.skill ?? "")}、${wData.damage})` : isBrawl ? `格闘 (${wData.damage})` : '近接攻撃';

    const changes: CombatChange[] = [
      {
        target_id: actorPart.id,
        target_name: actorPart.name,
        field: 'state',
        ...useAction(actorPart),
        desc: `${actorPart.name} アクション使用 (${isMartial ? '武術攻撃' : isBrawl ? '格闘' : '近接攻撃'})${actionCountLabel(actorPart)}`,
      },
    ];
    // 同じ相手に 2 回当たったとき、2 回目は 1 回目のあとの HP・SP から計算する
    const running = new Map<string, { hp: number; sp: number; status: string[]; crits: unknown[]; penaltyAdded: number }>();
    const formulaParts: string[] = [];
    let anyHit = false;

    for (let i = 0; i < rawAttacks.length; i++) {
      const att = rawAttacks[i];
      const prefix = rawAttacks.length > 1 ? `[#${i + 1}] ` : '';
      const tPart = targetOf(att)!;
      const tChar = tPart.character!;
      const cur = running.get(tChar.id) ?? {
        hp: tChar.hp,
        sp: tChar.sp_body,
        status: tChar.status || [],
        crits: tChar.crit_injuries || [],
        penaltyAdded: deathSavePenaltyOf(tPart).added,
      };

      const attD10 = atkD10(att.attack_roll!);
      const attackTotal = base + attD10 + (i === 0 ? luck : 0) + solo.precision;
      const cannotDodgeMelee = (cur.status ?? []).includes('回避できない');
      let isHit = true;
      let sub = '';
      if (cannotDodgeMelee) {
        sub = `${prefix}${label}: DEX ${stat} + 技能 ${skillLevel} + 出目 ${attD10}${actorWoundPen ? ` ${actorWoundPen}` : ''}${i === 0 ? luckText : ''}${precisionText} = ${attackTotal} vs ${tPart.name} 固定設備（回避不可） -> 命中`;
      } else {
        const defStat = tChar.stats.dex - (tChar.armor_penalty ?? 0);
        const defSkill = tChar.skills[skillNameToKey('evasion')] ?? 0;
        const defWoundPen = woundPenalty(woundState(cur.hp, tChar.hp_max)) + grapplePenalty(cur.status);
        const defD10 = resolveD10(att.defense_roll!.first, att.defense_roll!.extra).value;
        const defTotal = defStat + defSkill + defWoundPen + defD10;
        isHit = attackTotal > defTotal;
        sub = `${prefix}${label}: DEX ${stat} + 技能 ${skillLevel} + 出目 ${attD10}${actorWoundPen ? ` ${actorWoundPen}` : ''}${i === 0 ? luckText : ''}${precisionText} = ${attackTotal} vs ${tPart.name} 回避 DEX ${defStat} + 回避 ${defSkill} + 出目 ${defD10}${defWoundPen ? ` ${defWoundPen}` : ''} = ${defTotal} -> ${isHit ? '命中' : '外れ'}`;
      }
      if (!isHit) {
        formulaParts.push(sub);
        continue;
      }
      anyHit = true;

      if (!att.damage_dice || att.damage_dice.length === 0) {
        missing_inputs.push(`${prefix}ダメージダイスの出目を入力してください`);
        continue;
      }
      const diceErr = damageDiceCountError(wData.damage, att.damage_dice);
      if (diceErr) {
        missing_inputs.push(`${prefix}${diceErr}`);
        continue;
      }
      if (ignoreArmorPercent! > 0) sub += ` (防具無視 ${ignoreArmorPercent}%)`;
      const dmgRes = resolveDamage({
        dice: att.damage_dice,
        location: 'body',
        flatBonus: spotWeaknessLeft,
        sp: cur.sp,
        ignoreArmorPercent: ignoreArmorPercent!,
        currentHp: cur.hp,
      });
      const soloNotes = applySoloDamage(dmgRes, tPart, changes);
      if (soloNotes) sub += soloNotes;
      // 瀕死のあいだに攻撃でダメージを受けると、致命的損傷を 1 つ受け、死亡セーヴの修正値が 1 増える（日本語版 p.186・188）
      const mortalHit = woundState(cur.hp, tChar.hp_max) === 'mortally' && dmgRes.hpLoss > 0;
      const injuryTable = dmgRes.criticalInjuryTable ?? (mortalHit ? 'body' : null);
      if (injuryTable && (att.crit_injury_roll === undefined || att.crit_injury_roll === null)) {
        missing_inputs.push(`${prefix}致命傷表 (2d6) の出目を入力してください`);
        continue;
      }
      if (mortalHit && dmgRes.criticalInjuryTable && (att.extra_crit_injury_roll === undefined || att.extra_crit_injury_roll === null)) {
        missing_inputs.push(`${prefix}瀕死中の被弾で致命的損傷がもう 1 つ: 致命傷表 (2d6) の 2 つ目の出目を入力してください`);
        continue;
      }

      const newHp = Math.max(0, cur.hp - dmgRes.hpLoss);
      changes.push({
        target_id: tChar.id,
        target_name: tChar.name,
        field: 'hp',
        before: cur.hp,
        after: newHp,
        desc: `${tChar.name} HP ${cur.hp} → ${newHp} (${dmgRes.hpLoss} ダメージ${dmgRes.critical ? `、クリティカル +${dmgRes.critBonus}` : ''})`,
      });
      if (dmgRes.spAfter !== cur.sp) {
        changes.push({
          target_id: tChar.id,
          target_name: tChar.name,
          field: 'sp_body',
          before: cur.sp,
          after: dmgRes.spAfter,
          desc: `${tChar.name} SP 胴 ${cur.sp} → ${dmgRes.spAfter}`,
        });
      }
      const statusChange = woundStatusChange(tChar, cur.status, cur.hp, newHp);
      if (statusChange) changes.push(statusChange);

      let critAfter = cur.crits;
      if (injuryTable && att.crit_injury_roll) {
        const rolls = [att.crit_injury_roll, ...(mortalHit && dmgRes.criticalInjuryTable && att.extra_crit_injury_roll ? [att.extra_crit_injury_roll] : [])];
        for (const roll of rolls) {
          const cleanEntry = rollInjury(injuryTable, roll);
          if (!cleanEntry) continue;
          const next = [...critAfter, cleanEntry];
          changes.push({
            target_id: tChar.id,
            target_name: tChar.name,
            field: 'crit_injuries',
            before: critAfter,
            after: next,
            desc: `${tChar.name} 致命傷: ${cleanEntry.name}${cleanEntry.summary ? ` (${cleanEntry.summary})` : ''}`,
          });
          critAfter = next;
          sub += ` [致命傷: ${cleanEntry.name}]`;
        }
      }
      let penaltyAdded = cur.penaltyAdded;
      if (mortalHit) {
        changes.push({
          target_id: tPart.id,
          target_name: tPart.name,
          field: 'state',
          before: { deathSavePenalty: penaltyAdded },
          after: { deathSavePenalty: penaltyAdded + 1 },
          desc: `${tPart.name} 瀕死で被弾: 死亡セーブの修正 +1`,
        });
        penaltyAdded += 1;
        sub += ' (瀕死で被弾: 致命的損傷 1 つ、死亡セーブの修正 +1)';
      }
      running.set(tChar.id, {
        hp: newHp,
        sp: dmgRes.spAfter,
        status: (statusChange?.after as string[] | undefined) ?? cur.status,
        crits: critAfter,
        penaltyAdded,
      });
      formulaParts.push(sub);
    }

    if (missing_inputs.length > 0) return failed();

    return {
      action_key: input.action_key,
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      target_id: targetPart?.id,
      target_name: targetPart?.name,
      success: anyHit,
      formula: formulaParts.join(' ｜ '),
      breakdown: { attacksResolved: rawAttacks.length },
      changes,
    };
  }

  // Fallback for generic actions
  return {
    action_key: input.action_key,
    actor_id: actorPart.id,
    actor_name: actorPart.name,
    success: true,
    formula: '行動実行',
    breakdown: {},
    changes: [],
  };
}

/** 【運命】点を使える行動（自分が振る判定のあるもの） */
const LUCK_ACTIONS = ['ranged', 'aimed', 'autofire', 'melee', 'brawl', 'martial_arts', 'grab', 'martial_technique', 'stand', 'first_aid', 'throw_object', 'use_drug', 'vehicle_control', 'vehicle_maneuver', 'attack_vehicle', 'net_action', 'scanner'];

/**
 * 行動の結果を出す。【運命】点を使ったら、残りを確かめて、使った分を記録する変化を足す（Phase 5v。日本語版 p.130）
 */
export function resolveCombatAction(
  db: AppDatabase,
  input: ResolveInput,
  actorPart: CombatParticipant,
  targetPart?: CombatParticipant,
  allParticipants?: CombatParticipant[],
  boardId?: string | null,
  combatSettings?: Record<string, any>,
): ResolveResult {
  const spend = Math.max(0, input.luck_spent ?? 0);
  const ch = actorPart.character;
  if (spend > 0 && ch) {
    const used = Number(ch.extra?.luck_used ?? 0);
    const left = Math.max(0, ch.stats.luck - used);
    const msg = !LUCK_ACTIONS.includes(input.action_key)
      ? 'この行動では【運命】点を使えません'
      : spend > left
        ? `【運命】点が足りません（残り ${left} 点）`
        : null;
    if (msg) {
      return { action_key: input.action_key, actor_id: actorPart.id, actor_name: actorPart.name, success: false, formula: msg, breakdown: {}, changes: [], missing_inputs: [msg] };
    }
  }
  const result = resolveCombatActionInner(db, input, actorPart, targetPart, allParticipants, boardId, combatSettings);
  if (result.changes.length > 0 && !['move', 'run'].includes(input.action_key)) {
    const seen = new Set<string>();
    const partList = [actorPart, ...(targetPart ? [targetPart] : []), ...(allParticipants ?? [])].filter((p) => {
      if (!p || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
    const incNote = checkIncapacitatedBreaksNetrun(result.changes, partList, input.damage_dice ?? []);
    if (incNote) result.formula += incNote;
  }
  if (spend > 0 && ch && !(result.missing_inputs?.length) && result.changes.length > 0) {
    const used = Number(ch.extra?.luck_used ?? 0);
    result.changes.push({
      target_id: ch.id,
      target_name: ch.name,
      field: 'extra',
      before: ch.extra ?? {},
      after: { ...(ch.extra ?? {}), luck_used: used + spend },
      desc: `${ch.name} 【運命】点を ${spend} 点使った（残り ${ch.stats.luck - used - spend}）`,
    });
  }
  return result;
}
