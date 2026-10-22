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
} from '@cyberpgm/shared';
import { z } from 'zod';
import type { AppDatabase } from '../db/client.js';
import { rule_constants, weapons, items, boards, board_tokens, board_objects, board_drops } from '../db/schema.js';
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

export function resolveCombatAction(
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
  const usesAction = !usesMove && input.action_key !== 'death_save';
  const spent =
    usesMove && actorPart.move_used
      ? '移動アクションは使用済みです（もう一度動くなら「走る」でアクションを使います）'
      : usesAction && actorPart.action_used
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

  const actorWound = woundState(actorChar.hp, actorChar.hp_max);
  const actorWoundPen = woundPenalty(actorWound);
  // 重い防具は REF・DEX・MOVE を下げる。瀕死のあいだは MOVE −6（どちらも最低 1）（Phase 5m）
  const actorArmorPen = actorChar.armor_penalty ?? 0;
  const actorRef = actorChar.stats.ref - actorArmorPen;
  const actorDex = actorChar.stats.dex - actorArmorPen;
  const effectiveMove = Math.max(1, actorChar.stats.move - actorArmorPen - (actorWound === 'mortally' ? 6 : 0));
  const moveNote =
    effectiveMove !== actorChar.stats.move
      ? `（MOVE ${actorChar.stats.move}${actorArmorPen ? ` − 防具 ${actorArmorPen}` : ''}${actorWound === 'mortally' ? ' − 瀕死 6' : ''}）`
      : '';

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
    return { ...critEntry, name: stripHtml(critEntry.name), summary: stripHtml(critEntry.summary || ''), table };
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

    return {
      action_key: 'move',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: true,
      formula: `MOVE ${effectiveMove}マス (1マス2m) まで移動${moveNote}`,
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

    return {
      action_key: 'run',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: true,
      formula: `追加で MOVE ${effectiveMove}マス (1マス2m) 移動${moveNote}`,
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
    const base = actorChar.stats.tech + Math.max(fa, pm) + actorWoundPen;
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
    let formula = `応急手当: TECH ${actorChar.stats.tech} + ${skillLabel} ${Math.max(fa, pm)}${actorWoundPen ? ` ${actorWoundPen}` : ''} + 出目 = ${res.total} vs 難易度 ${dv}（${wound === 'mortally' ? '瀕死' : wound === 'seriously' ? '重傷' : '軽傷'}）-> ${res.success ? '成功' : '失敗'}`;
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
          missing_inputs.push('オートファイアの DV 表がありません');
        } else {
          const autofireKey = `${wData.dv_table_key} (Autofire)`;
          dvTable =
            getRuleConstant<DvTable>(`dv_table.${autofireKey}`) ||
            getRuleConstant<DvTable>(autofireKey);
          if (!dvTable) {
            missing_inputs.push('オートファイアの DV 表がありません');
          }
        }
        if (typeof wData.autofire !== 'number' || wData.autofire <= 0) {
          missing_inputs.push('倍率の上限が不明です');
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
        missing_inputs.push(`${prefix}出目を入力してください`);
      } else if (
        (att.attack_roll.first === 10 || att.attack_roll.first === 1) &&
        att.attack_roll.extra === undefined
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
        woundPenalty: actorWoundPen,
        aimed: isAimed,
      });

      const attD10 = resolveD10(att.attack_roll!.first, att.attack_roll!.extra).value;
      const attackTotal = base + attD10;

      // Defense calculation
      let isHit = false;
      let defFormula = '';
      const canDodge = curTargetChar ? canDodgeRanged(curTargetChar.stats.ref - (curTargetChar.armor_penalty ?? 0)) : false;
      const isDodging = canDodge && att.dodge_mode === 'dodge';

      if (isDodging && curTargetChar) {
        if (!att.defense_roll) {
          missing_inputs.push(`${prefix}回避の出目を入力してください`);
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
        const defWoundPen = woundPenalty(defWound);
        const defD10 = resolveD10(att.defense_roll.first, att.defense_roll.extra).value;
        const defTotal = defStat + defSkill + defWoundPen + defD10;
        isHit = attackTotal > defTotal;
        defFormula = `DEX ${defStat} + 回避 ${defSkill} + 出目 ${defD10}${defWoundPen ? ` ${defWoundPen}` : ''} = ${defTotal}`;
      } else {
        isHit = attackTotal > dv;
        defFormula = `難易度 ${dv}`;
      }

      let subFormula = `${prefix}REF ${stat} + 技能 ${skillLevel} + 出目 ${attD10}${actorWoundPen ? ` ${actorWoundPen}` : ''}${isAimed ? ' −8' : ''} = ${attackTotal} vs ${defFormula} -> ${isHit ? '命中' : '外れ'}`;

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
            sp: targetSp,
            ignoreArmorPercent: wData.ignore_armor_percent ?? 0,
            currentHp: runningHp,
          });
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
  if (input.action_key === 'melee' || input.action_key === 'brawl') {
    const isBrawl = input.action_key === 'brawl';
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
    const wData = isBrawl
      ? { skill: 'Brawling', damage: `${brawlDice}d6`, ignore_armor_percent: 0, rof: 2 }
      : getWeaponData(weaponItemId || invWeapon?.name);
    if (!wData) {
      missing_inputs.push('武器を選択してください');
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
      for (const [roll, label] of [
        [att.attack_roll, '攻撃'],
        [att.defense_roll, '回避'],
      ] as const) {
        if (!roll) {
          missing_inputs.push(`${prefix}${label === '攻撃' ? '出目' : '回避の出目'}を入力してください`);
        } else if ((roll.first === 10 || roll.first === 1) && roll.extra === undefined) {
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
    const label = isBrawl ? `格闘 (${wData.damage})` : '近接攻撃';

    const changes: CombatChange[] = [
      {
        target_id: actorPart.id,
        target_name: actorPart.name,
        field: 'state',
        ...useAction(actorPart),
        desc: `${actorPart.name} アクション使用 (${isBrawl ? '格闘' : '近接攻撃'})${actionCountLabel(actorPart)}`,
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

      const attD10 = resolveD10(att.attack_roll!.first, att.attack_roll!.extra).value;
      const attackTotal = base + attD10;
      const defStat = tChar.stats.dex - (tChar.armor_penalty ?? 0);
      const defSkill = tChar.skills[skillNameToKey('evasion')] ?? 0;
      const defWoundPen = woundPenalty(woundState(cur.hp, tChar.hp_max));
      const defD10 = resolveD10(att.defense_roll!.first, att.defense_roll!.extra).value;
      const defTotal = defStat + defSkill + defWoundPen + defD10;
      const isHit = attackTotal > defTotal;
      let sub = `${prefix}${label}: DEX ${stat} + 技能 ${skillLevel} + 出目 ${attD10}${actorWoundPen ? ` ${actorWoundPen}` : ''} = ${attackTotal} vs ${tPart.name} 回避 DEX ${defStat} + 回避 ${defSkill} + 出目 ${defD10}${defWoundPen ? ` ${defWoundPen}` : ''} = ${defTotal} -> ${isHit ? '命中' : '外れ'}`;
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
        sp: cur.sp,
        ignoreArmorPercent: ignoreArmorPercent!,
        currentHp: cur.hp,
      });
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
