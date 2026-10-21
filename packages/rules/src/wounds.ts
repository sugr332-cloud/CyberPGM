import { DEFAULT_RULES, RuleConstants } from './constants.js';

export type WoundState = 'ok' | 'seriously' | 'mortally' | 'dead';

/**
 * Determines wound state based on current and maximum HP.
 * - hp < 1: mortally wounded
 * - hp < ceil(maxHp / 2): seriously wounded
 * - otherwise: ok
 * Note: 'dead' is not returned by HP alone (it is triggered by failed death save).
 */
export function woundState(hp: number, maxHp: number): WoundState {
  if (hp < 1) {
    return 'mortally';
  }
  if (hp < Math.ceil(maxHp / 2)) {
    return 'seriously';
  }
  return 'ok';
}

/**
 * Returns modifier penalty for a wound state (0, -2, or -4).
 */
export function woundPenalty(
  state: WoundState,
  rules: RuleConstants = DEFAULT_RULES,
): number {
  switch (state) {
    case 'seriously':
      return rules.seriousWoundPenalty;
    case 'mortally':
    case 'dead':
      return rules.mortalWoundPenalty;
    case 'ok':
    default:
      return 0;
  }
}

export interface DeathSaveInput {
  roll: number;
  penalty?: number;
  body: number;
}

export interface DeathSaveResult {
  success: boolean;
  nextPenalty: number;
}

/**
 * Resolves a death save.
 * Roll of 10 always fails.
 * Success if (roll + penalty) < body.
 * On success, next penalty is incremented by 1.
 */
export function deathSave(input: DeathSaveInput): DeathSaveResult {
  if (!Number.isInteger(input.roll) || input.roll < 1 || input.roll > 10) {
    throw new Error(`Invalid death save roll: ${input.roll}. Must be an integer between 1 and 10.`);
  }

  const penalty = input.penalty ?? 0;

  // A natural roll of 10 is an automatic failure
  if (input.roll === 10) {
    return {
      success: false,
      nextPenalty: penalty,
    };
  }

  const total = input.roll + penalty;
  const success = total < input.body;

  return {
    success,
    nextPenalty: success ? penalty + 1 : penalty,
  };
}

/**
 * Max HP from BODY and WILL (FVTT cpr-actor.js: 10 + 5 * ceil((WILL + BODY) / 2)).
 */
export function hpMaxFromStats(body: number, will: number): number {
  return 10 + 5 * Math.ceil((body + will) / 2);
}
