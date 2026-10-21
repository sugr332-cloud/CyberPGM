import { describe, it, expect } from 'vitest';
import { woundState, woundPenalty, deathSave, hpMaxFromStats } from '../src/wounds.js';
import { DEFAULT_RULES } from '../src/constants.js';

describe('wounds module (RULES_CHECK §3, FVTT _setWoundState, deathSave)', () => {
  it('determines wound state accurately (RULES_CHECK §3)', () => {
    // maxHp = 25 -> ceil(25 / 2) = 13
    expect(woundState(11, 25)).toBe('seriously');
    expect(woundState(13, 25)).toBe('ok');
    expect(woundState(25, 25)).toBe('ok');

    // maxHp = 35 -> ceil(35 / 2) = 18
    expect(woundState(17, 35)).toBe('seriously');
    expect(woundState(18, 35)).toBe('ok');

    // HP < 1 -> mortally wounded
    expect(woundState(0, 35)).toBe('mortally');
    expect(woundState(-5, 35)).toBe('mortally');
  });

  it('returns wound penalty based on state (-2 for seriously, -4 for mortally/dead)', () => {
    expect(woundPenalty('ok', DEFAULT_RULES)).toBe(0);
    expect(woundPenalty('seriously', DEFAULT_RULES)).toBe(-2);
    expect(woundPenalty('mortally', DEFAULT_RULES)).toBe(-4);
    expect(woundPenalty('dead', DEFAULT_RULES)).toBe(-4);
  });

  it('resolves death save (RULES_CHECK §3 cpr-actor.js deathSave)', () => {
    // Roll 10 is automatic failure
    const failRoll10 = deathSave({ roll: 10, penalty: 0, body: 8 });
    expect(failRoll10.success).toBe(false);
    expect(failRoll10.nextPenalty).toBe(0);

    // Roll + penalty < body -> success and increments penalty
    // roll 3 + penalty 1 = 4 < body 5 -> success, nextPenalty 2
    const successSave = deathSave({ roll: 3, penalty: 1, body: 5 });
    expect(successSave.success).toBe(true);
    expect(successSave.nextPenalty).toBe(2);

    // Roll + penalty >= body -> failure (no penalty increment)
    // roll 5 + penalty 1 = 6 >= body 5 -> failure, nextPenalty 1
    const failSave = deathSave({ roll: 5, penalty: 1, body: 5 });
    expect(failSave.success).toBe(false);
    expect(failSave.nextPenalty).toBe(1);
  });

  it('throws on invalid death save dice roll', () => {
    expect(() => deathSave({ roll: 0, body: 5 })).toThrow();
    expect(() => deathSave({ roll: 11, body: 5 })).toThrow();
  });
});

describe('hpMaxFromStats (FVTT cpr-actor.js)', () => {
  it('rounds the BODY + WILL average up', () => {
    expect(hpMaxFromStats(6, 6)).toBe(40);
    expect(hpMaxFromStats(6, 5)).toBe(40);
    expect(hpMaxFromStats(2, 2)).toBe(20);
    expect(hpMaxFromStats(8, 7)).toBe(50);
  });
});
