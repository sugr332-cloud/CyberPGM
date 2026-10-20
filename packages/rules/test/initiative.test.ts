import { describe, it, expect } from 'vitest';
import { initiativeTotal, sortInitiative } from '../src/initiative.js';
import { DEFAULT_RULES } from '../src/constants.js';

describe('initiative module (RULES_CHECK §2, settings.js criticalInitiative)', () => {
  it('calculates initiative with exploding/fumbling d10 by default', () => {
    // Normal roll
    const normal = initiativeTotal(7, 5, undefined, DEFAULT_RULES);
    expect(normal.total).toBe(12);
    expect(normal.needsExtra).toBe(false);

    // Exploding roll (10 + 3)
    const crit = initiativeTotal(7, 10, 3, DEFAULT_RULES);
    expect(crit.total).toBe(20);
    expect(crit.needsExtra).toBe(false);

    // Fumbling roll (1 - 4)
    const fumble = initiativeTotal(7, 1, 4, DEFAULT_RULES);
    expect(fumble.total).toBe(4);
    expect(fumble.needsExtra).toBe(false);

    // Pending extra
    const pending = initiativeTotal(7, 10, undefined, DEFAULT_RULES);
    expect(pending.needsExtra).toBe(true);
  });

  it('calculates initiative without crits when initiativeCrit is false', () => {
    const rules = { ...DEFAULT_RULES, initiativeCrit: false };
    const res = initiativeTotal(7, 10, undefined, rules);
    expect(res.total).toBe(17);
    expect(res.needsExtra).toBe(false);

    expect(() => initiativeTotal(7, 0, undefined, rules)).toThrow();
    expect(() => initiativeTotal(7, 11, undefined, rules)).toThrow();
  });

  it('sorts initiative by total descending, breaking ties with REF (tieBreak ref)', () => {
    const entries = [
      { id: '1', total: 15, ref: 6 },
      { id: '2', total: 18, ref: 7 },
      { id: '3', total: 15, ref: 8 },
      { id: '4', total: 15, ref: 6 },
    ];

    const sorted = sortInitiative(entries, 'ref');

    // 1st: id 2 (total 18)
    expect(sorted[0].id).toBe('2');
    expect(sorted[0].needsReroll).toBe(false);

    // 2nd: id 3 (total 15, ref 8)
    expect(sorted[1].id).toBe('3');
    expect(sorted[1].needsReroll).toBe(false);

    // 3rd & 4th: id 1 and id 4 (both total 15, ref 6) -> needsReroll: true, order preserved
    expect(sorted[2].id).toBe('1');
    expect(sorted[2].needsReroll).toBe(true);
    expect(sorted[3].id).toBe('4');
    expect(sorted[3].needsReroll).toBe(true);
  });

  it('marks all ties as needsReroll when tieBreak is manual (RULES_CHECK §2)', () => {
    const entries = [
      { id: '1', total: 15, ref: 8 },
      { id: '2', total: 18, ref: 6 },
      { id: '3', total: 15, ref: 6 },
    ];

    const sorted = sortInitiative(entries, 'manual');
    expect(sorted[0].id).toBe('2');
    expect(sorted[0].needsReroll).toBe(false);

    expect(sorted[1].id).toBe('1');
    expect(sorted[1].needsReroll).toBe(true);
    expect(sorted[2].id).toBe('3');
    expect(sorted[2].needsReroll).toBe(true);
  });
});
