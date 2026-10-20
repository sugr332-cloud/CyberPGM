/**
 * Cyberpunk RED rules calculation engine (scaffold for Phase 0)
 */

export interface InitiativeRollInput {
  ref: number;
  roll1d10: number;
}

export interface InitiativeResult {
  total: number;
  ref: number;
  roll: number;
}

/**
 * Calculate initiative: REF + 1d10
 */
export function calculateInitiative(input: InitiativeRollInput): InitiativeResult {
  return {
    total: input.ref + input.roll1d10,
    ref: input.ref,
    roll: input.roll1d10,
  };
}
