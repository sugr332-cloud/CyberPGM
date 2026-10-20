import { DEFAULT_RULES, RuleConstants } from './constants.js';

export interface ResolveDamageInput {
  dice: number[];
  multiplier?: number;
  location: 'body' | 'head';
  sp: number;
  ignoreArmorPercent?: number;
  ignoreBelowSP?: number;
  ablation?: number;
  shieldHp?: number;
  isExplosive?: boolean;
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
 * Resolves damage calculation according to Cyberpunk RED rules (RULES_CHECK §3).
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

  // Shield resolution
  let remainingDamage = rawTotal;
  let shieldHpAfter = input.shieldHp ?? 0;

  if (typeof input.shieldHp === 'number' && input.shieldHp > 0 && !input.isExplosive) {
    const absorbed = Math.min(remainingDamage, input.shieldHp);
    shieldHpAfter = input.shieldHp - absorbed;
    remainingDamage -= absorbed;
  }

  // Armor resolution
  let effectiveSp: number;
  if (typeof input.ignoreBelowSP === 'number' && input.sp <= input.ignoreBelowSP) {
    effectiveSp = 0;
  } else {
    const ignorePct = input.ignoreArmorPercent ?? 0;
    effectiveSp = Math.round(input.sp * (1 - ignorePct / 100));
  }

  const penetrationRaw = Math.max(0, remainingDamage - effectiveSp);
  const penetrating = input.location === 'head' ? penetrationRaw * 2 : penetrationRaw;

  // Ablation occurs only when damage penetrates SP
  let spAfter = input.sp;
  if (penetrationRaw > 0) {
    const ablationAmt = input.ablation ?? rules.defaultAblation;
    spAfter = Math.max(0, input.sp - ablationAmt);
  }

  // HP loss = penetrating (doubled if head) + critBonus (SP does not reduce critBonus, not doubled on head)
  const hpLoss = penetrating + critBonus;
  const criticalInjuryTable = critical ? input.location : null;

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
