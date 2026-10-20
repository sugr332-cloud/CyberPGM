import { DEFAULT_RULES, RuleConstants } from './constants.js';

export interface ResolveD10Result {
  value: number;
  needsExtra: boolean;
}

/**
 * Resolves a 1d10 roll with critical (10) or fumble (1) extra roll.
 * Extra rolls do not chain.
 * Throws an Error if dice values are not integers in 1..10.
 */
export function resolveD10(first: number, extra?: number): ResolveD10Result {
  if (!Number.isInteger(first) || first < 1 || first > 10) {
    throw new Error(`Invalid d10 roll: ${first}. Must be an integer between 1 and 10.`);
  }

  if (first === 10) {
    if (extra === undefined) {
      return { value: 10, needsExtra: true };
    }
    if (!Number.isInteger(extra) || extra < 1 || extra > 10) {
      throw new Error(`Invalid extra d10 roll: ${extra}. Must be an integer between 1 and 10.`);
    }
    return { value: 10 + extra, needsExtra: false };
  }

  if (first === 1) {
    if (extra === undefined) {
      return { value: 1, needsExtra: true };
    }
    if (!Number.isInteger(extra) || extra < 1 || extra > 10) {
      throw new Error(`Invalid extra d10 roll: ${extra}. Must be an integer between 1 and 10.`);
    }
    return { value: 1 - extra, needsExtra: false };
  }

  return { value: first, needsExtra: false };
}

/**
 * Returns the probability distribution of a Cyberpunk RED 1d10 exploding/fumbling roll.
 * Rolls:
 *   - 2..9: 0.1 each
 *   - 11..20 (10 + 1..10): 0.01 each
 *   - 0..-9 (1 - 1..10): 0.01 each
 * Total sum = 1.0.
 */
export function d10Distribution(): Map<number, number> {
  const dist = new Map<number, number>();

  // Normal rolls: 2 to 9 (0.1 each)
  for (let r = 2; r <= 9; r++) {
    dist.set(r, 0.1);
  }

  // Critical rolls: 10 + 1..10 = 11..20 (0.01 each)
  for (let e = 1; e <= 10; e++) {
    dist.set(10 + e, 0.01);
  }

  // Fumble rolls: 1 - 1..10 = 0..-9 (0.01 each)
  for (let e = 1; e <= 10; e++) {
    dist.set(1 - e, 0.01);
  }

  return dist;
}

/**
 * Calculates the success probability for a check.
 * - mode 'dv': check if (base + roll) > target (or >= target if rules.tieRule === 'success')
 * - mode 'defend': opposed check where defender succeeds if (base + roll) >= target
 *   (or > target if rules.opposedTieWinner === 'attacker')
 */
export function successProbability(
  base: number,
  target: number,
  mode: 'dv' | 'defend',
  rules: RuleConstants = DEFAULT_RULES,
): number {
  const dist = d10Distribution();
  let totalProb = 0;

  for (const [roll, prob] of dist.entries()) {
    const total = base + roll;
    let isSuccess = false;

    if (mode === 'dv') {
      if (rules.tieRule === 'success') {
        isSuccess = total >= target;
      } else {
        isSuccess = total > target;
      }
    } else {
      // mode === 'defend'
      if (rules.opposedTieWinner === 'defender') {
        isSuccess = total >= target;
      } else {
        isSuccess = total > target;
      }
    }

    if (isSuccess) {
      totalProb += prob;
    }
  }

  // Round to prevent floating point inaccuracies (e.g. 0.8000000000000002)
  return Math.round(totalProb * 1e9) / 1e9;
}
