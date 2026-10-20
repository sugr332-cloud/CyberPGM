import {
  rangedDv,
  attackBase,
  canDodgeRanged,
  autofireMultiplier,
  resolveDamage,
  lookupCriticalInjury,
  deathSave,
  woundState,
  woundPenalty,
  resolveD10,
  CriticalInjuryEntry,
} from '@cyberpgm/rules';
import {
  CombatChange,
  ResolveActionInputSchema,
  SingleAttackInput,
  CombatParticipant,
  DvTable,
  InventoryEntry,
  skillNameToKey,
} from '@cyberpgm/shared';
import { z } from 'zod';
import type { AppDatabase } from '../db/client.js';
import { rule_constants, weapons, items } from '../db/schema.js';
import { eq } from 'drizzle-orm';

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

export function resolveCombatAction(
  db: AppDatabase,
  input: ResolveInput,
  actorPart: CombatParticipant,
  targetPart?: CombatParticipant,
  allParticipants?: CombatParticipant[],
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

  const actorWound = woundState(actorChar.hp, actorChar.hp_max);
  const actorWoundPen = woundPenalty(actorWound);

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

  // 1. Move action
  if (input.action_key === 'move') {
    return {
      action_key: 'move',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: true,
      formula: `MOVE ${actorChar.stats.move}マス (1マス2m) まで移動`,
      breakdown: { move: actorChar.stats.move },
      changes: [
        {
          target_id: actorPart.id,
          target_name: actorPart.name,
          field: 'state',
          before: { move_used: actorPart.move_used },
          after: { move_used: true },
          desc: `${actorPart.name} 移動アクション使用`,
        },
      ],
    };
  }

  // 2. Run action
  if (input.action_key === 'run') {
    return {
      action_key: 'run',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: true,
      formula: `追加で MOVE ${actorChar.stats.move}マス (1マス2m) 移動`,
      breakdown: { move: actorChar.stats.move },
      changes: [
        {
          target_id: actorPart.id,
          target_name: actorPart.name,
          field: 'state',
          before: { action_used: actorPart.action_used },
          after: { action_used: true },
          desc: `${actorPart.name} 走る (アクション使用)`,
        },
      ],
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
    const penalty = (actorPart.state?.deathSavePenalty as number) ?? 0;
    const body = actorChar.stats.body;
    const res = deathSave({ roll, penalty, body });
    const changes: CombatChange[] = [];

    let formula = `死亡セーブ: 出目 ${roll} + ペナルティ ${penalty} = ${roll + penalty} (BODY ${body} 未満で成功)`;
    if (res.success) {
      formula += ` -> 生存 (次回ペナルティ +1)`;
      changes.push({
        target_id: actorPart.id,
        target_name: actorPart.name,
        field: 'state',
        before: { deathSavePenalty: penalty },
        after: { deathSavePenalty: res.nextPenalty },
        desc: `${actorPart.name} 死亡セーブ成功 (ペナルティ ${res.nextPenalty} に増加)`,
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
      breakdown: { roll, penalty, body, success: res.success },
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
          before: { action_used: actorPart.action_used },
          after: { action_used: true },
          desc: `${actorPart.name} アクション使用 (リロード)`,
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

  // 5. Unconfirmed actions (take_cover, suppressive, brawl, hide, pickup, use_skill, item_cyberware, first_aid, dodge, other)
  const unconfirmedKeys = [
    'take_cover',
    'suppressive',
    'brawl',
    'hide',
    'pickup',
    'use_skill',
    'item_cyberware',
    'first_aid',
    'dodge',
    'other',
  ];
  if (unconfirmedKeys.includes(input.action_key)) {
    const manualChanges = input.manual_changes ?? [];
    const isMove = input.action_key === 'take_cover';
    const baseChanges: CombatChange[] = [
      {
        target_id: actorPart.id,
        target_name: actorPart.name,
        field: 'state',
        before: isMove ? { move_used: actorPart.move_used } : { action_used: actorPart.action_used },
        after: isMove ? { move_used: true } : { action_used: true },
        desc: `${actorPart.name} ${isMove ? '移動' : 'アクション'}使用 (${input.action_key})`,
      },
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
        if (input.ammo_spent === undefined || input.ammo_spent === null || input.ammo_spent <= 0) {
          missing_inputs.push('オートファイアの消費弾数を入力してください');
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
              aimed_location: input.aimed_location,
              held_item_id: input.held_item_id,
              manual_changes: input.manual_changes,
            },
          ];

    // Ammo inventory verification
    const currentAmmo: number | null =
      wData && wData.magazine_max !== null && wData.magazine_max !== undefined
        ? invWeapon && typeof invWeapon.ammo === 'number'
          ? invWeapon.ammo
          : wData.magazine_max
        : null;

    const totalAmmoNeeded = isAutofire ? (input.ammo_spent ?? 1) : rawAttacks.length;
    if (currentAmmo !== null && currentAmmo < totalAmmoNeeded) {
      missing_inputs.push(`残弾が不足しています (残弾 ${currentAmmo} / 必要 ${totalAmmoNeeded})`);
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
        before: { action_used: actorPart.action_used },
        after: { action_used: true },
        desc: `${actorPart.name} アクション使用 (${input.action_key})`,
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

      // Attack roll calculation
      const stat = actorChar.stats.ref;
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
      const canDodge = curTargetChar ? canDodgeRanged(curTargetChar.stats.ref) : false;
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

        const defStat = curTargetChar.stats.dex;
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
        } else {
          // Requires damage dice
          if (!att.damage_dice || att.damage_dice.length === 0) {
            missing_inputs.push(`${prefix}ダメージダイスの出目を入力してください`);
            continue;
          }

          const location = isAimed && att.aimed_location === 'head' ? 'head' : 'body';
          const targetSp = location === 'head' ? runningSpHead : runningSpBody;

          let multiplier = 1;
          if (isAutofire) {
            const cap = wData.autofire!;
            multiplier = autofireMultiplier({ attackTotal, dv, weaponCap: cap });
          }

          const dmgRes = resolveDamage({
            dice: att.damage_dice,
            multiplier,
            location,
            sp: targetSp,
            ignoreArmorPercent: wData.ignore_armor_percent ?? 0,
            currentHp: runningHp,
          });

          // Check for critical injury roll requirement
          if (dmgRes.criticalInjuryTable) {
            if (att.crit_injury_roll === undefined || att.crit_injury_roll === null) {
              missing_inputs.push(`${prefix}致命傷表 (2d6) の出目を入力してください`);
              continue;
            }
          }

          // Apply damage
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

          // Wound state check
          const oldWound = woundState(curTargetChar.hp, curTargetChar.hp_max);
          const newWound = woundState(runningHp, curTargetChar.hp_max);
          if (oldWound !== newWound) {
            const filtered = (curTargetChar.status || []).filter(
              (s) => s !== 'seriously' && s !== 'mortally',
            );
            const added =
              newWound === 'seriously'
                ? [...filtered, 'seriously']
                : newWound === 'mortally'
                  ? [...filtered, 'mortally']
                  : filtered;
            changes.push({
              target_id: curTargetChar.id,
              target_name: curTargetChar.name,
              field: 'status',
              before: curTargetChar.status,
              after: added,
              desc: `${curTargetChar.name} 状態: ${newWound === 'seriously' ? '重傷 (−2)' : newWound === 'mortally' ? '瀕死 (−4)' : '通常'}`,
            });
          }

          // Critical injury application
          if (dmgRes.criticalInjuryTable && att.crit_injury_roll) {
            const critTable =
              getRuleConstant<CriticalInjuryEntry[]>(
                `critical_injury.${dmgRes.criticalInjuryTable}`,
              ) || [];
            const critEntry = lookupCriticalInjury(critTable, att.crit_injury_roll);
            if (critEntry) {
              const injuryName = stripHtml(critEntry.name);
              const summary = stripHtml(critEntry.summary || '');
              const cleanEntry: CriticalInjuryEntry = { ...critEntry, name: injuryName, summary };
              changes.push({
                target_id: curTargetChar.id,
                target_name: curTargetChar.name,
                field: 'crit_injuries',
                before: curTargetChar.crit_injuries,
                after: [...(curTargetChar.crit_injuries || []), cleanEntry],
                desc: `${curTargetChar.name} 致命傷: ${injuryName}${summary ? ` (${summary})` : ''}`,
              });
              subFormula += ` [致命傷: ${injuryName}]`;
            }
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
      formula: formulaParts.join(' ｜ '),
      breakdown: {
        allHit,
        attacksResolved: rawAttacks.length,
      },
      changes,
    };
  }

  // 7. Melee attack
  if (input.action_key === 'melee') {
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

    if (!input.attack_roll) {
      missing_inputs.push('出目を入力してください');
    } else if (
      (input.attack_roll.first === 10 || input.attack_roll.first === 1) &&
      input.attack_roll.extra === undefined
    ) {
      missing_inputs.push(
        input.attack_roll.first === 10
          ? '攻撃クリティカル: 追加出目 (1d10) を入力してください'
          : '攻撃ファンブル: 追加出目 (1d10) を入力してください',
      );
    }

    if (!targetChar || !targetPart) {
      missing_inputs.push('対象を選択してください');
    } else {
      if (!input.defense_roll) {
        missing_inputs.push('回避の出目を入力してください');
      } else if (
        (input.defense_roll.first === 10 || input.defense_roll.first === 1) &&
        input.defense_roll.extra === undefined
      ) {
        missing_inputs.push(
          input.defense_roll.first === 10
            ? '回避クリティカル: 追加出目 (1d10) を入力してください'
            : '回避ファンブル: 追加出目 (1d10) を入力してください',
        );
      }
    }

    if (missing_inputs.length > 0 || !wData || !targetChar || !targetPart) {
      return {
        action_key: 'melee',
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

    const stat = actorChar.stats.dex;
    const skillKey = skillNameToKey(wData.skill);
    const skillLevel = actorChar.skills[skillKey] ?? 0;
    const base = attackBase({ stat, skillLevel, woundPenalty: actorWoundPen });
    const attD10 = resolveD10(input.attack_roll!.first, input.attack_roll!.extra).value;
    const attackTotal = base + attD10;

    const defStat = targetChar.stats.dex;
    const defSkillKey = skillNameToKey('evasion');
    const defSkill = targetChar.skills[defSkillKey] ?? 0;
    const defWound = woundState(targetChar.hp, targetChar.hp_max);
    const defWoundPen = woundPenalty(defWound);
    const defD10 = resolveD10(input.defense_roll!.first, input.defense_roll!.extra).value;
    const defTotal = defStat + defSkill + defWoundPen + defD10;
    const isHit = attackTotal > defTotal;

    let formula = `近接攻撃: DEX ${stat} + 技能 ${skillLevel} + 出目 ${attD10}${actorWoundPen ? ` ${actorWoundPen}` : ''} = ${attackTotal} vs 回避 DEX ${defStat} + 回避 ${defSkill} + 出目 ${defD10}${defWoundPen ? ` ${defWoundPen}` : ''} = ${defTotal} -> ${isHit ? '命中' : '外れ'}`;

    const changes: CombatChange[] = [
      {
        target_id: actorPart.id,
        target_name: actorPart.name,
        field: 'state',
        before: { action_used: actorPart.action_used },
        after: { action_used: true },
        desc: `${actorPart.name} アクション使用 (近接攻撃)`,
      },
    ];

    if (isHit) {
      if (!input.damage_dice || input.damage_dice.length === 0) {
        missing_inputs.push('ダメージダイスの出目を入力してください');
        return {
          action_key: 'melee',
          actor_id: actorPart.id,
          actor_name: actorPart.name,
          target_id: targetPart.id,
          target_name: targetPart.name,
          success: false,
          formula: missing_inputs.join(' / '),
          breakdown: { missing_inputs },
          changes: [],
          missing_inputs,
        };
      }

      const targetSp = targetChar.sp_body;
      if (ignoreArmorPercent! > 0) {
        formula += ` (防具無視 ${ignoreArmorPercent}%)`;
      }
      const dmgRes = resolveDamage({
        dice: input.damage_dice,
        location: 'body',
        sp: targetSp,
        ignoreArmorPercent: ignoreArmorPercent!,
        currentHp: targetChar.hp,
      });

      if (dmgRes.criticalInjuryTable) {
        if (input.crit_injury_roll === undefined || input.crit_injury_roll === null) {
          missing_inputs.push('致命傷表 (2d6) の出目を入力してください');
          return {
            action_key: 'melee',
            actor_id: actorPart.id,
            actor_name: actorPart.name,
            target_id: targetPart.id,
            target_name: targetPart.name,
            success: false,
            formula: missing_inputs.join(' / '),
            breakdown: { missing_inputs },
            changes: [],
            missing_inputs,
          };
        }
      }

      const newHp = Math.max(0, targetChar.hp - dmgRes.hpLoss);
      changes.push({
        target_id: targetChar.id,
        target_name: targetChar.name,
        field: 'hp',
        before: targetChar.hp,
        after: newHp,
        desc: `${targetChar.name} HP ${targetChar.hp} → ${newHp} (${dmgRes.hpLoss} ダメージ${ignoreArmorPercent! > 0 ? `, 防具無視 ${ignoreArmorPercent}%` : ''})`,
      });

      if (dmgRes.spAfter !== targetSp) {
        changes.push({
          target_id: targetChar.id,
          target_name: targetChar.name,
          field: 'sp_body',
          before: targetSp,
          after: dmgRes.spAfter,
          desc: `${targetChar.name} SP 胴 ${targetSp} → ${dmgRes.spAfter}`,
        });
      }

      const oldWound = woundState(targetChar.hp, targetChar.hp_max);
      const newWound = woundState(newHp, targetChar.hp_max);
      if (oldWound !== newWound) {
        const filtered = (targetChar.status || []).filter(
          (s) => s !== 'seriously' && s !== 'mortally',
        );
        const added =
          newWound === 'seriously'
            ? [...filtered, 'seriously']
            : newWound === 'mortally'
              ? [...filtered, 'mortally']
              : filtered;
        changes.push({
          target_id: targetChar.id,
          target_name: targetChar.name,
          field: 'status',
          before: targetChar.status,
          after: added,
          desc: `${targetChar.name} 状態: ${newWound === 'seriously' ? '重傷 (−2)' : newWound === 'mortally' ? '瀕死 (−4)' : '通常'}`,
        });
      }

      if (dmgRes.criticalInjuryTable && input.crit_injury_roll) {
        const critTable =
          getRuleConstant<CriticalInjuryEntry[]>(
            `critical_injury.${dmgRes.criticalInjuryTable}`,
          ) || [];
        const critEntry = lookupCriticalInjury(critTable, input.crit_injury_roll);
        if (critEntry) {
          const injuryName = stripHtml(critEntry.name);
          const summary = stripHtml(critEntry.summary || '');
          const cleanEntry: CriticalInjuryEntry = { ...critEntry, name: injuryName, summary };
          changes.push({
            target_id: targetChar.id,
            target_name: targetChar.name,
            field: 'crit_injuries',
            before: targetChar.crit_injuries,
            after: [...(targetChar.crit_injuries || []), cleanEntry],
            desc: `${targetChar.name} 致命傷: ${injuryName}${summary ? ` (${summary})` : ''}`,
          });
          formula += ` [致命傷: ${injuryName}]`;
        }
      }
    }

    return {
      action_key: 'melee',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      target_id: targetPart.id,
      target_name: targetPart.name,
      success: isHit,
      formula,
      breakdown: { attackTotal, defTotal, isHit },
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
