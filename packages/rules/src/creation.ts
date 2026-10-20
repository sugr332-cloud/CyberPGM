import {
  CharacterDraft,
  CreationMethodConfig,
  CharacterValidationResult,
  getSkillDef,
  SKILL_CATALOG,
} from '@cyberpgm/shared';
import { maxHumanity, currentEmp } from './humanity.js';

export const STAT_KEYS = [
  'int',
  'ref',
  'dex',
  'tech',
  'cool',
  'will',
  'luck',
  'move',
  'body',
  'emp',
] as const;

export function validateCharacterDraft(
  character: CharacterDraft,
  method?: CreationMethodConfig | null,
  startingFunds?: number | null,
): CharacterValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Stats validation
  let totalStats = 0;
  for (const k of STAT_KEYS) {
    const val = character.stats?.[k] ?? 0;
    totalStats += val;

    if (method?.stat_min !== null && method?.stat_min !== undefined) {
      if (val < method.stat_min) {
        errors.push(`能力値 ${k.toUpperCase()} が下限 (${method.stat_min}) 未満です: ${val}`);
      }
    }
    if (method?.stat_max !== null && method?.stat_max !== undefined) {
      if (val > method.stat_max) {
        errors.push(`能力値 ${k.toUpperCase()} が上限 (${method.stat_max}) を超えています: ${val}`);
      }
    }
  }

  const statPointsConfigured = method?.stat_points !== null && method?.stat_points !== undefined;
  const remainingStats = statPointsConfigured ? method!.stat_points! - totalStats : null;
  if (statPointsConfigured && totalStats > method!.stat_points!) {
    errors.push(
      `能力値ポイントが割り当て上限 (${method!.stat_points}) を超えています: ${totalStats}`,
    );
  }

  // 2. Skills validation
  let totalSkillSpent = 0;
  for (const [key, lvl] of Object.entries(character.skills || {})) {
    if (typeof lvl !== 'number' || lvl <= 0) continue;
    const def = getSkillDef(key);
    let mult = 1;
    if (method?.difficult_cost !== null && method?.difficult_cost !== undefined) {
      mult = def?.multiplier && def.multiplier > 1 ? method.difficult_cost : 1;
    } else {
      mult = def?.multiplier ?? 1;
    }
    totalSkillSpent += lvl * mult;

    if (method?.skill_level_max !== null && method?.skill_level_max !== undefined) {
      if (lvl > method.skill_level_max) {
        errors.push(
          `技能「${def?.name || key}」のレベルが上限 (${method.skill_level_max}) を超えています: ${lvl}`,
        );
      }
    }
  }

  if (method?.basic_skill_min !== null && method?.basic_skill_min !== undefined) {
    for (const def of Object.values(SKILL_CATALOG)) {
      if (def.basic) {
        const lvl = character.skills?.[def.key] ?? 0;
        if (lvl < method.basic_skill_min) {
          errors.push(
            `基本技能「${def.name}」が最低レベル (${method.basic_skill_min}) 未満です: ${lvl}`,
          );
        }
      }
    }
  }

  const skillPointsConfigured = method?.skill_points !== null && method?.skill_points !== undefined;
  const remainingSkillPoints = skillPointsConfigured ? method!.skill_points! - totalSkillSpent : null;
  if (skillPointsConfigured && totalSkillSpent > method!.skill_points!) {
    errors.push(
      `技能ポイントが割り当て上限 (${method!.skill_points}) を超えています: ${totalSkillSpent}`,
    );
  }

  // 3. Funds validation
  let totalEquipmentSpent = 0;
  for (const item of character.inventory || []) {
    const p = item.price_eb ?? 0;
    const q = item.qty ?? 1;
    totalEquipmentSpent += p * q;
  }

  const fundsConfigured = startingFunds !== null && startingFunds !== undefined;
  const remainingFunds = fundsConfigured ? startingFunds! - totalEquipmentSpent : null;
  if (fundsConfigured && remainingFunds! < 0) {
    errors.push(
      `所持品の合計額 (${totalEquipmentSpent.toLocaleString()} eb) が開始資金 (${startingFunds!.toLocaleString()} eb) を超えています`,
    );
  }

  // 4. Humanity & EMP calculation
  const initialEmp = character.stats?.emp ?? 6;
  const cyberwareItems = (character.cyberware || []).map((cw) => ({
    type: cw.type,
    staticLoss: cw.static_loss,
  }));
  const maxHum = maxHumanity(initialEmp, cyberwareItems);
  const totalStaticLoss = (character.cyberware || []).reduce(
    (sum, cw) => sum + (cw.static_loss ?? 0),
    0,
  );
  const curHum = initialEmp * 10 - totalStaticLoss;
  const curEmp = currentEmp(curHum, maxHum);

  const valid = errors.length === 0;

  return {
    valid,
    warnings,
    errors,
    stats: {
      total: totalStats,
      points: method?.stat_points ?? null,
      remaining: remainingStats,
      min: method?.stat_min ?? null,
      max: method?.stat_max ?? null,
      unconfigured: !statPointsConfigured,
    },
    skills: {
      totalSpent: totalSkillSpent,
      points: method?.skill_points ?? null,
      remaining: remainingSkillPoints,
      levelMax: method?.skill_level_max ?? null,
      basicMin: method?.basic_skill_min ?? null,
      unconfigured: !skillPointsConfigured,
    },
    funds: {
      totalSpent: totalEquipmentSpent,
      startingFunds: startingFunds ?? null,
      remaining: remainingFunds,
      unconfigured: !fundsConfigured,
    },
    humanity: {
      initialEmp,
      maxHumanity: maxHum,
      currentHumanity: curHum,
      currentEmp: curEmp,
      cyberwareCount: (character.cyberware || []).length,
    },
  };
}
