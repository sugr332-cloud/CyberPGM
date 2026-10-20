import { DEFAULT_RULES, RuleConstants } from './constants.js';
import type { DvTable, Weapon } from '@cyberpgm/shared';

/**
 * Looks up the ranged DV for a given distance in meters from a DV table.
 * If distance is fractional, it is rounded up (ceil).
 * Returns null if distance is not covered by any range or if DV is "N/A".
 */
export function rangedDv(dvTable: DvTable, distanceM: number): number | null {
  if (distanceM < 0) return null;
  const d = Math.ceil(distanceM);

  for (const entry of dvTable) {
    const [minDist, maxDist] = entry.range;
    if (d >= minDist && d <= maxDist) {
      if (entry.dv === 'N/A' || entry.dv === 'null') {
        return null;
      }
      const num = typeof entry.dv === 'number' ? entry.dv : Number(entry.dv);
      return Number.isFinite(num) ? num : null;
    }
  }

  return null;
}

export interface AttackBaseInput {
  stat: number;
  skillLevel?: number;
  woundPenalty?: number;
  aimed?: boolean;
  situational?: number;
}

/**
 * Calculates attack base value: stat + skillLevel + woundPenalty + situational + (aimed penalty).
 */
export function attackBase(
  input: AttackBaseInput,
  rules: RuleConstants = DEFAULT_RULES,
): number {
  const penalty = input.aimed ? rules.aimedShotPenalty : 0;
  return (
    input.stat +
    (input.skillLevel ?? 0) +
    (input.woundPenalty ?? 0) +
    (input.situational ?? 0) +
    penalty
  );
}

/**
 * Checks whether a target can dodge ranged attacks.
 * In Cyberpunk RED, targets with REF >= rangedDodgeMinRef (default 8) can dodge ranged attacks.
 */
export function canDodgeRanged(
  targetRef: number,
  rules: RuleConstants = DEFAULT_RULES,
): boolean {
  return targetRef >= rules.rangedDodgeMinRef;
}

/**
 * Returns number of attacks per action allowed by the weapon (ROF).
 */
export function attacksPerAction(
  weapon: Pick<Weapon, 'rof'> | { rof?: number | null },
): number {
  return typeof weapon.rof === 'number' && weapon.rof > 0 ? weapon.rof : 1;
}

export interface AutofireMultiplierInput {
  attackTotal: number;
  dv: number;
  weaponCap: number;
  ammoCap?: number | null;
}

/**
 * Calculates autofire multiplier: min(attackTotal - dv, cap).
 * Returns 0 if attackTotal <= dv (miss).
 * Cap is the minimum of weaponCap and ammoCap (if provided).
 */
export function autofireMultiplier(input: AutofireMultiplierInput): number {
  if (input.attackTotal <= input.dv) {
    return 0;
  }
  const diff = input.attackTotal - input.dv;
  const cap =
    typeof input.ammoCap === 'number'
      ? Math.min(input.weaponCap, input.ammoCap)
      : input.weaponCap;
  return Math.max(0, Math.min(diff, cap));
}
