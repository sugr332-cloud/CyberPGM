import { DEFAULT_RULES, RuleConstants } from './constants.js';
import { resolveD10 } from './dice.js';

export interface SkillBaseInput {
  stat: number;
  level?: number;
  woundPenalty?: number;
  mods?: number;
}

/**
 * Calculates skill base value: stat + level + woundPenalty + mods.
 * Untrained skills default to level 0.
 */
export function skillBase(input: SkillBaseInput): number {
  return input.stat + (input.level ?? 0) + (input.woundPenalty ?? 0) + (input.mods ?? 0);
}

export type NeededRoll =
  | { kind: 'any' }
  | { kind: 'roll'; n: number }
  | { kind: 'extra'; n: number }
  | { kind: 'impossible' };

/**
 * Calculates the needed roll to succeed.
 * - 'dv': base + roll > target (or >= target if tieRule === 'success')
 * - 'defend': base + roll >= target (or > target if opposedTieWinner === 'attacker')
 */
export function neededRoll(
  base: number,
  target: number,
  mode: 'dv' | 'defend',
  rules: RuleConstants = DEFAULT_RULES,
): NeededRoll {
  let neededTotal: number;

  if (mode === 'dv') {
    neededTotal = rules.tieRule === 'success' ? target - base : target - base + 1;
  } else {
    // mode === 'defend'
    neededTotal = rules.opposedTieWinner === 'defender' ? target - base : target - base + 1;
  }

  if (neededTotal <= 1) {
    // 1 or lower: since 1 is always a fumble, roll 2+ succeeds (not 100% guaranteed)
    return { kind: 'any' };
  }
  if (neededTotal <= 10) {
    return { kind: 'roll', n: neededTotal };
  }
  if (neededTotal <= 20) {
    return { kind: 'extra', n: neededTotal - 10 };
  }
  return { kind: 'impossible' };
}

/**
 * Formats NeededRoll for UI display according to SPEC §5.0.1.
 */
export function formatNeeded(n: NeededRoll): string {
  switch (n.kind) {
    case 'any':
      return '2 以上で成功';
    case 'roll':
      return `${n.n} 以上で成功`;
    case 'extra':
      return `10 → 追加ロールで ${n.n} 以上`;
    case 'impossible':
      return '成功しない';
  }
}

export interface ResolveCheckInput {
  base: number;
  first: number;
  extra?: number;
  target: number;
  mode: 'dv' | 'defend';
}

export interface ResolveCheckResult {
  total: number;
  success: boolean;
  needsExtra: boolean;
}

/**
 * Resolves a check against a target DV or opposed roll.
 */
export function resolveCheck(
  input: ResolveCheckInput,
  rules: RuleConstants = DEFAULT_RULES,
): ResolveCheckResult {
  const d10 = resolveD10(input.first, input.extra);
  const total = input.base + d10.value;

  let success = false;
  if (input.mode === 'dv') {
    success = rules.tieRule === 'success' ? total >= input.target : total > input.target;
  } else {
    success =
      rules.opposedTieWinner === 'defender' ? total >= input.target : total > input.target;
  }

  return {
    total,
    success,
    needsExtra: d10.needsExtra,
  };
}

export interface ResolveOpposedInput {
  attackerTotal: number;
  defenderTotal: number;
}

/**
 * Determines the winner of an opposed check.
 */
export function resolveOpposed(
  input: ResolveOpposedInput,
  rules: RuleConstants = DEFAULT_RULES,
): 'attacker' | 'defender' {
  if (input.attackerTotal === input.defenderTotal) {
    return rules.opposedTieWinner;
  }
  return input.attackerTotal > input.defenderTotal ? 'attacker' : 'defender';
}
