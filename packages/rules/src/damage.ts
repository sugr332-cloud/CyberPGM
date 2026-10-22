import { DEFAULT_RULES, RuleConstants } from './constants.js';

export interface ResolveDamageInput {
  dice: number[];
  multiplier?: number;
  location: 'body' | 'head';
  /** 頭部に当たったときの倍率。既定 2、致命的損傷「頭蓋損傷」があれば 3（日本語版 p.188） */
  headMultiplier?: number;
  sp: number;
  ignoreArmorPercent?: number;
  ignoreBelowSP?: number;
  ablation?: number;
  shieldHp?: number;
  isExplosive?: boolean;
  lethal?: boolean;
  currentHp?: number;
}

export interface ResolveDamageResult {
  rawTotal: number;
  critical: boolean;
  critBonus: number;
  effectiveSp: number;
  penetrating: number;
  hpLoss: number;
  spAfter: number;
  shieldHpAfter: number;
  criticalInjuryTable: 'head' | 'body' | null;
}

/**
 * Resolves damage calculation according to Cyberpunk RED rules (RULES_CHECK §3 and Review 02).
 */
export function resolveDamage(
  input: ResolveDamageInput,
  rules: RuleConstants = DEFAULT_RULES,
): ResolveDamageResult {
  const multiplier = input.multiplier !== undefined && input.multiplier > 0 ? input.multiplier : 1;
  const diceSum = input.dice.reduce((acc, d) => acc + d, 0);
  const rawTotal = diceSum * multiplier;

  // Count sixes for critical
  const sixes = input.dice.filter((d) => d === 6).length;
  const critical = sixes >= rules.critSixesNeeded;
  const critBonus = critical ? rules.critBonusDamage : 0;

  // Shield resolution (FVTT _applyDamage behavior)
  let shieldHpAfter = input.shieldHp ?? 0;
  let shieldBlocked = false;
  let remainingDamage = rawTotal;

  if (typeof input.shieldHp === 'number' && input.shieldHp > 0) {
    const rawDamageForShield = rawTotal + critBonus;
    const shieldDmg = Math.min(rawDamageForShield, input.shieldHp);
    shieldHpAfter = input.shieldHp - shieldDmg;

    if (!input.isExplosive) {
      // Non-explosive attacks stop at the shield entirely
      shieldBlocked = true;
    } else {
      // Explosive attacks stop if the shield survives; if broken (shieldHpAfter === 0),
      // the full unmitigated raw damage proceeds to armor
      if (shieldHpAfter > 0) {
        shieldBlocked = true;
      } else {
        remainingDamage = rawTotal;
      }
    }
  }

  // Armor resolution: SP < ignoreBelowSP ignores armor (strict less-than)
  let effectiveSp: number;
  if (typeof input.ignoreBelowSP === 'number' && input.sp < input.ignoreBelowSP) {
    effectiveSp = 0;
  } else {
    const ignorePct = input.ignoreArmorPercent ?? 0;
    effectiveSp = Math.round(input.sp * (1 - ignorePct / 100));
  }

  let penetrating = 0;
  let spAfter = input.sp;
  let hpLoss = 0;
  let criticalInjuryTable: 'head' | 'body' | null = null;

  if (shieldBlocked) {
    // Attack blocked by shield: 0 penetrating, 0 hpLoss, SP remains intact, no injury table
    penetrating = 0;
    hpLoss = 0;
    spAfter = input.sp;
    criticalInjuryTable = null;
  } else {
    const penetrationRaw = Math.max(0, remainingDamage - effectiveSp);
    penetrating = input.location === 'head' ? penetrationRaw * (input.headMultiplier ?? 2) : penetrationRaw;

    if (penetrationRaw > 0) {
      const ablationAmt = input.ablation ?? rules.defaultAblation;
      spAfter = Math.max(0, input.sp - ablationAmt);
    }

    hpLoss = penetrating + critBonus;
    criticalInjuryTable = critical ? input.location : null;

    // Non-lethal attack handling: cannot reduce HP below 1
    if (input.lethal === false && typeof input.currentHp === 'number') {
      if (input.currentHp <= 0) {
        hpLoss = 0;
      } else {
        const maxLoss = input.currentHp - 1;
        hpLoss = Math.min(hpLoss, Math.max(0, maxLoss));
      }
    }
  }

  return {
    rawTotal,
    critical,
    critBonus,
    effectiveSp,
    penetrating,
    hpLoss,
    spAfter,
    shieldHpAfter,
    criticalInjuryTable,
  };
}

export interface CriticalInjuryEntry {
  range: [number, number];
  name?: string;
  summary: string;
  quickFix?: {
    dvFirstAid?: number;
    dvParamedic?: number;
    type?: string;
    [key: string]: unknown;
  } | null;
  treatment?: {
    dvParamedic?: number;
    dvSurgery?: number;
    type?: string;
    [key: string]: unknown;
  } | null;
  sources?: unknown;
  /** どちらの表の損傷か（Phase 5q から記録） */
  table?: 'body' | 'head';
}

/**
 * Looks up a critical injury from a table by 2d6 roll.
 */
export function lookupCriticalInjury(
  table: CriticalInjuryEntry[],
  roll2d6: number,
): CriticalInjuryEntry | null {
  for (const entry of table) {
    const [minRoll, maxRoll] = entry.range;
    if (roll2d6 >= minRoll && roll2d6 <= maxRoll) {
      return entry;
    }
  }
  return null;
}
