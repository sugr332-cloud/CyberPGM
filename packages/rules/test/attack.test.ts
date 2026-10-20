import { describe, it, expect } from 'vitest';
import {
  rangedDv,
  attackBase,
  canDodgeRanged,
  attacksPerAction,
  autofireMultiplier,
} from '../src/attack.js';
import { DEFAULT_RULES } from '../src/constants.js';
import type { DvTable } from '@cyberpgm/shared';

describe('attack module (RULES_CHECK §2, §4)', () => {
  // DV Pistol table from Phase 0 import
  const dvPistol: DvTable = [
    { range: [0, 6], dv: 13 },
    { range: [7, 12], dv: 15 },
    { range: [13, 25], dv: 20 },
    { range: [26, 50], dv: 25 },
    { range: [51, 100], dv: 30 },
    { range: [101, 200], dv: 35 },
    { range: [201, 400], dv: 'N/A' },
    { range: [401, 800], dv: 'N/A' },
  ];

  it('looks up ranged DV based on distance, inclusive of bounds and ceiling (RULES_CHECK §2)', () => {
    expect(rangedDv(dvPistol, 0)).toBe(13);
    expect(rangedDv(dvPistol, 6)).toBe(13);
    expect(rangedDv(dvPistol, 7)).toBe(15);
    expect(rangedDv(dvPistol, 8)).toBe(15);
    expect(rangedDv(dvPistol, 12.1)).toBe(20); // ceil -> 13
    expect(rangedDv(dvPistol, 50)).toBe(25);
    expect(rangedDv(dvPistol, -1)).toBeNull(); // Negative distance
    expect(rangedDv(dvPistol, 300)).toBeNull(); // N/A
    expect(rangedDv(dvPistol, 900)).toBeNull(); // Out of range
    // String number dv
    expect(rangedDv([{ range: [0, 5], dv: '15' }], 3)).toBe(15);
    expect(rangedDv([{ range: [0, 5], dv: 'invalid' }], 3)).toBeNull();
  });

  it('calculates attackBase with aimed shot penalty (-8) when aimed (RULES_CHECK §2 CPRAimedAttackRoll)', () => {
    // Normal shot: REF 8 + Handgun 6 = 14
    expect(attackBase({ stat: 8, skillLevel: 6 }, DEFAULT_RULES)).toBe(14);

    // Aimed shot: REF 8 + Handgun 6 - 8 = 6
    expect(attackBase({ stat: 8, skillLevel: 6, aimed: true }, DEFAULT_RULES)).toBe(6);

    // With wound penalty (-2) and situational bonus (+1): 8 + 6 - 2 + 1 - 8 = 5
    expect(
      attackBase(
        { stat: 8, skillLevel: 6, woundPenalty: -2, situational: 1, aimed: true },
        DEFAULT_RULES,
      ),
    ).toBe(5);
  });

  it('determines if target can dodge ranged attacks (REF >= 8, Issue #2)', () => {
    expect(canDodgeRanged(7, DEFAULT_RULES)).toBe(false);
    expect(canDodgeRanged(8, DEFAULT_RULES)).toBe(true);
    expect(canDodgeRanged(10, DEFAULT_RULES)).toBe(true);
  });

  it('gets attacks per action from weapon ROF', () => {
    expect(attacksPerAction({ rof: 1 })).toBe(1);
    expect(attacksPerAction({ rof: 2 })).toBe(2);
    expect(attacksPerAction({ rof: null })).toBe(1);
  });

  it('calculates autofire multiplier up to weapon or ammo cap (RULES_CHECK §2 CPRDamageRoll._computeBase)', () => {
    // Attack 19 vs DV 17, weaponCap 3, 2d6 [4,3] -> diff 2 <= cap 3 -> multiplier 2
    expect(autofireMultiplier({ attackTotal: 19, dv: 17, weaponCap: 3 })).toBe(2);

    // Attack 22 vs DV 17, weaponCap 3 -> diff 5 capped at 3 -> multiplier 3
    expect(autofireMultiplier({ attackTotal: 22, dv: 17, weaponCap: 3 })).toBe(3);

    // Attack 17 vs DV 17 -> tie does not exceed DV -> multiplier 0 (miss)
    expect(autofireMultiplier({ attackTotal: 17, dv: 17, weaponCap: 3 })).toBe(0);

    // Attack 15 vs DV 17 -> multiplier 0 (miss)
    expect(autofireMultiplier({ attackTotal: 15, dv: 17, weaponCap: 3 })).toBe(0);

    // With ammoCap lower than weaponCap (e.g. ammoCap 2 vs weaponCap 4)
    expect(autofireMultiplier({ attackTotal: 25, dv: 17, weaponCap: 4, ammoCap: 2 })).toBe(2);
  });
});
