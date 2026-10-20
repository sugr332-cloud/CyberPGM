import { describe, it, expect } from 'vitest';
import * as rules from '../src/index.js';

describe('rules index re-exports', () => {
  it('exports all expected functions and constants', () => {
    expect(rules.DEFAULT_RULES).toBeDefined();
    expect(typeof rules.resolveD10).toBe('function');
    expect(typeof rules.d10Distribution).toBe('function');
    expect(typeof rules.successProbability).toBe('function');
    expect(typeof rules.skillBase).toBe('function');
    expect(typeof rules.neededRoll).toBe('function');
    expect(typeof rules.formatNeeded).toBe('function');
    expect(typeof rules.resolveCheck).toBe('function');
    expect(typeof rules.resolveOpposed).toBe('function');
    expect(typeof rules.initiativeTotal).toBe('function');
    expect(typeof rules.sortInitiative).toBe('function');
    expect(typeof rules.rangedDv).toBe('function');
    expect(typeof rules.attackBase).toBe('function');
    expect(typeof rules.canDodgeRanged).toBe('function');
    expect(typeof rules.attacksPerAction).toBe('function');
    expect(typeof rules.autofireMultiplier).toBe('function');
    expect(typeof rules.resolveDamage).toBe('function');
    expect(typeof rules.lookupCriticalInjury).toBe('function');
    expect(typeof rules.woundState).toBe('function');
    expect(typeof rules.woundPenalty).toBe('function');
    expect(typeof rules.deathSave).toBe('function');
    expect(typeof rules.moveSquares).toBe('function');
    expect(typeof rules.gridDistance).toBe('function');
    expect(typeof rules.distanceMeters).toBe('function');
    expect(typeof rules.maxHumanity).toBe('function');
    expect(typeof rules.currentEmp).toBe('function');
    expect(typeof rules.humanityAfterInstall).toBe('function');
  });
});
