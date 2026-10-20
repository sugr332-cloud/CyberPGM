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
  CombatParticipant,
  DvTable,
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
}

export function resolveCombatAction(
  db: AppDatabase,
  input: ResolveInput,
  actorPart: CombatParticipant,
  targetPart?: CombatParticipant,
): ResolveResult {
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
    const w = db.select().from(weapons).where(eq(weapons.item_id, itemId)).get();
    const it = db.select().from(items).where(eq(items.id, itemId)).get();
    return w ? { ...w, name_ja: it?.name_ja || it?.name_ja_override || it?.name_en || '武器' } : null;
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
    const roll = input.death_save_roll ?? 1;
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
    const wData = getWeaponData(input.weapon_id);
    const weaponName = wData?.name_ja || '武器';
    const maxAmmo = wData?.magazine_max ?? 8;
    return {
      action_key: 'reload',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      success: true,
      formula: `${weaponName} をリロード (弾数 ${maxAmmo}/${maxAmmo})`,
      breakdown: { maxAmmo },
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
          before: `${weaponName} 残弾`,
          after: `${weaponName} 弾 ${maxAmmo}/${maxAmmo}`,
          desc: `${actorChar.name} ${weaponName} 弾 ${maxAmmo}/${maxAmmo}`,
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
    // Mark action or move used
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
    const wData = getWeaponData(input.weapon_id);
    const weaponName = wData?.name_ja || '射撃武器';
    const isAimed = input.action_key === 'aimed';
    const isAutofire = input.action_key === 'autofire';
    const distanceM = input.distance_m ?? 5;

    // DV lookup
    const dvTableKey = isAutofire
      ? 'dv_table.Autofire'
      : (wData?.dv_table_key ? `dv_table.${wData.dv_table_key}` : 'dv_table.Pistol');
    
    let dvTable = getRuleConstant<DvTable>(dvTableKey);
    // fallback if prefix key without dv_table. was stored
    if (!dvTable && wData?.dv_table_key) {
      dvTable = getRuleConstant<DvTable>(wData.dv_table_key);
    }
    // standard RED fallback dv table if missing
    if (!dvTable) {
      dvTable = [
        { range: [0, 6], dv: 13 },
        { range: [7, 12], dv: 15 },
        { range: [13, 25], dv: 20 },
        { range: [26, 50], dv: 25 },
        { range: [51, 100], dv: 30 },
      ];
    }

    const dv = rangedDv(dvTable, distanceM);
    if (dv === null) {
      return {
        action_key: input.action_key,
        actor_id: actorPart.id,
        actor_name: actorPart.name,
        target_id: targetPart?.id,
        target_name: targetPart?.name,
        success: false,
        formula: `距離 ${distanceM}m: 射程外 (DV なし)`,
        breakdown: { distanceM, inRange: false },
        changes: [],
      };
    }

    // Attack calculation
    const stat = actorChar.stats.ref;
    const skillName = wData?.skill || 'Handgun';
    const skillLevel = actorChar.skills[skillName] ?? actorChar.skills['ハンドガン'] ?? 0;
    const base = attackBase({
      stat,
      skillLevel,
      woundPenalty: actorWoundPen,
      aimed: isAimed,
    });

    const attD10 = input.attack_roll
      ? resolveD10(input.attack_roll.first, input.attack_roll.extra).value
      : 1;
    const attackTotal = base + attD10;

    // Defense calculation
    let isHit = false;
    let defFormula = '';
    const defBreakdown: Record<string, unknown> = {};

    const canDodge = targetChar ? canDodgeRanged(targetChar.stats.ref) : false;
    const isDodging = canDodge && input.dodge_mode === 'dodge';

    if (isDodging && targetChar) {
      const defStat = targetChar.stats.dex;
      const defSkill = targetChar.skills['Evasion'] ?? targetChar.skills['回避'] ?? 0;
      const defWound = woundState(targetChar.hp, targetChar.hp_max);
      const defWoundPen = woundPenalty(defWound);
      const defD10 = input.defense_roll
        ? resolveD10(input.defense_roll.first, input.defense_roll.extra).value
        : 1;
      const defTotal = defStat + defSkill + defWoundPen + defD10;
      // Attacker must exceed defender's total (tie goes to defender)
      isHit = attackTotal > defTotal;
      defFormula = `DEX ${defStat} + 回避 ${defSkill} + 出目 ${defD10}${defWoundPen ? ` ${defWoundPen}` : ''} = ${defTotal}`;
      defBreakdown.dodge = { defStat, defSkill, defD10, defTotal };
    } else {
      isHit = attackTotal > dv;
      defFormula = `難易度 ${dv}`;
      defBreakdown.dv = dv;
    }

    let formula = `攻撃: REF ${stat} + 技能 ${skillLevel} + 出目 ${attD10}${actorWoundPen ? ` ${actorWoundPen}` : ''}${isAimed ? ' −8 (照準)' : ''} = ${attackTotal} vs ${defFormula} -> ${isHit ? '命中' : '外れ'}`;

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

    // Ammo consumption
    const ammoSpent = isAutofire ? 10 : 1;
    changes.push({
      target_id: actorChar.id,
      target_name: actorChar.name,
      field: 'ammo',
      before: `${weaponName} 残弾`,
      after: `${weaponName} -${ammoSpent}発`,
      desc: `${actorChar.name} ${weaponName} 弾 -${ammoSpent}発`,
    });

    if (isHit && targetChar && targetPart) {
      // Aimed item drop
      if (isAimed && input.aimed_location === 'held_item' && input.held_item_id) {
        changes.push({
          target_id: targetPart.id,
          target_name: targetPart.name,
          field: 'dropped',
          before: null,
          after: input.held_item_id,
          desc: `${targetPart.name} の持っている物を落とさせた`,
        });
        formula += ` (持っている物を落とした)`;
      } else {
        // Damage resolution
        const location = isAimed && input.aimed_location === 'head' ? 'head' : 'body';
        const targetSp = location === 'head' ? targetChar.sp_head : targetChar.sp_body;
        const damageDice = input.damage_dice ?? (isAutofire ? [1, 1] : [1, 1, 1]);

        let multiplier = 1;
        if (isAutofire) {
          const cap = wData?.autofire ?? 3;
          multiplier = autofireMultiplier({ attackTotal, dv, weaponCap: cap });
        }

        const dmgRes = resolveDamage({
          dice: damageDice,
          multiplier,
          location,
          sp: targetSp,
          currentHp: targetChar.hp,
        });

        // Target HP update
        const newHp = Math.max(0, targetChar.hp - dmgRes.hpLoss);
        changes.push({
          target_id: targetChar.id,
          target_name: targetChar.name,
          field: 'hp',
          before: targetChar.hp,
          after: newHp,
          desc: `${targetChar.name} HP ${targetChar.hp} → ${newHp} (${dmgRes.hpLoss} ダメージ)`,
        });

        // Target SP update
        if (dmgRes.spAfter !== targetSp) {
          const spField = location === 'head' ? 'sp_head' : 'sp_body';
          changes.push({
            target_id: targetChar.id,
            target_name: targetChar.name,
            field: spField,
            before: targetSp,
            after: dmgRes.spAfter,
            desc: `${targetChar.name} SP ${location === 'head' ? '頭' : '胴'} ${targetSp} → ${dmgRes.spAfter}`,
          });
        }

        // Wound state check
        const oldWound = woundState(targetChar.hp, targetChar.hp_max);
        const newWound = woundState(newHp, targetChar.hp_max);
        if (oldWound !== newWound) {
          const filteredStatus = (targetChar.status || []).filter((s) => s !== 'seriously' && s !== 'mortally');
          const addedStatus = newWound === 'seriously' ? [...filteredStatus, 'seriously'] : (newWound === 'mortally' ? [...filteredStatus, 'mortally'] : filteredStatus);
          changes.push({
            target_id: targetChar.id,
            target_name: targetChar.name,
            field: 'status',
            before: targetChar.status,
            after: addedStatus,
            desc: `${targetChar.name} 状態: ${newWound === 'seriously' ? '重傷 (−2)' : (newWound === 'mortally' ? '瀕死 (−4)' : '通常')}`,
          });
        }

        // Critical injury check
        if (dmgRes.criticalInjuryTable && input.crit_injury_roll) {
          const critTable = getRuleConstant<CriticalInjuryEntry[]>(`critical_injury.${dmgRes.criticalInjuryTable}`) || [];
          const critEntry = lookupCriticalInjury(critTable, input.crit_injury_roll);
          if (critEntry) {
            const injuryName = critEntry.name || '致命傷';
            changes.push({
              target_id: targetChar.id,
              target_name: targetChar.name,
              field: 'crit_injuries',
              before: targetChar.crit_injuries,
              after: [...(targetChar.crit_injuries || []), critEntry],
              desc: `${targetChar.name} 致命傷: ${injuryName} (${critEntry.summary || ''})`,
            });
            formula += ` [致命傷: ${injuryName}]`;
          }
        }
      }
    }

    return {
      action_key: input.action_key,
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      target_id: targetPart?.id,
      target_name: targetPart?.name,
      success: isHit,
      formula,
      breakdown: {
        attackTotal,
        dv,
        isHit,
        ...defBreakdown,
      },
      changes,
    };
  }

  // 7. Melee attack
  if (input.action_key === 'melee') {
    const stat = actorChar.stats.dex;
    const skillLevel = actorChar.skills['Melee Weapon'] ?? actorChar.skills['近接武器'] ?? 0;
    const base = attackBase({ stat, skillLevel, woundPenalty: actorWoundPen });
    const attD10 = input.attack_roll
      ? resolveD10(input.attack_roll.first, input.attack_roll.extra).value
      : 1;
    const attackTotal = base + attD10;

    let isHit = false;
    let defTotal = 0;
    if (targetChar) {
      const defStat = targetChar.stats.dex;
      const defSkill = targetChar.skills['Evasion'] ?? targetChar.skills['回避'] ?? 0;
      const defWound = woundState(targetChar.hp, targetChar.hp_max);
      const defWoundPen = woundPenalty(defWound);
      const defD10 = input.defense_roll
        ? resolveD10(input.defense_roll.first, input.defense_roll.extra).value
        : 1;
      defTotal = defStat + defSkill + defWoundPen + defD10;
      isHit = attackTotal > defTotal;
    }

    const formula = `近接攻撃: DEX ${stat} + 技能 ${skillLevel} + 出目 ${attD10}${actorWoundPen ? ` ${actorWoundPen}` : ''} = ${attackTotal} vs 回避 ${defTotal} -> ${isHit ? '命中' : '外れ'}`;

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

    if (isHit && targetChar && targetPart) {
      const targetSp = targetChar.sp_body;
      const damageDice = input.damage_dice ?? [1, 1, 1];
      const dmgRes = resolveDamage({
        dice: damageDice,
        location: 'body',
        sp: targetSp,
        ignoreArmorPercent: 50,
        currentHp: targetChar.hp,
      });

      const newHp = Math.max(0, targetChar.hp - dmgRes.hpLoss);
      changes.push({
        target_id: targetChar.id,
        target_name: targetChar.name,
        field: 'hp',
        before: targetChar.hp,
        after: newHp,
        desc: `${targetChar.name} HP ${targetChar.hp} → ${newHp} (${dmgRes.hpLoss} ダメージ, SP半減)`,
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
        const filteredStatus = (targetChar.status || []).filter((s) => s !== 'seriously' && s !== 'mortally');
        const addedStatus = newWound === 'seriously' ? [...filteredStatus, 'seriously'] : (newWound === 'mortally' ? [...filteredStatus, 'mortally'] : filteredStatus);
        changes.push({
          target_id: targetChar.id,
          target_name: targetChar.name,
          field: 'status',
          before: targetChar.status,
          after: addedStatus,
          desc: `${targetChar.name} 状態: ${newWound === 'seriously' ? '重傷 (−2)' : (newWound === 'mortally' ? '瀕死 (−4)' : '通常')}`,
        });
      }
    }

    return {
      action_key: 'melee',
      actor_id: actorPart.id,
      actor_name: actorPart.name,
      target_id: targetPart?.id,
      target_name: targetPart?.name,
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
