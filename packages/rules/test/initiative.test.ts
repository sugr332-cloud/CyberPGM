import { describe, it, expect } from 'vitest';
import { initiativeTotal, sortInitiative } from '../src/initiative.js';
import { DEFAULT_RULES } from '../src/constants.js';

describe('initiative module (RULES_CHECK §2, settings.js criticalInitiative)', () => {
  it('calculates initiative as REF + 1d10 without extra rolls by default (p.126)', () => {
    expect(initiativeTotal(7, 5, undefined, DEFAULT_RULES)).toEqual({ total: 12, needsExtra: false });
    // 10 も 1 も振り足さない
    expect(initiativeTotal(7, 10, undefined, DEFAULT_RULES)).toEqual({ total: 17, needsExtra: false });
    expect(initiativeTotal(7, 1, undefined, DEFAULT_RULES)).toEqual({ total: 8, needsExtra: false });

    expect(() => initiativeTotal(7, 0, undefined, DEFAULT_RULES)).toThrow();
    expect(() => initiativeTotal(7, 11, undefined, DEFAULT_RULES)).toThrow();
  });

  it('applies exploding/fumbling d10 when initiativeCrit is turned on', () => {
    const rules = { ...DEFAULT_RULES, initiativeCrit: true };
    expect(initiativeTotal(7, 10, 3, rules)).toEqual({ total: 20, needsExtra: false });
    expect(initiativeTotal(7, 1, 4, rules)).toEqual({ total: 4, needsExtra: false });
    expect(initiativeTotal(7, 10, undefined, rules).needsExtra).toBe(true);
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

// Phase 5m: 同値は同じ値の人どうしで振り直す（ルール）
describe('rerollTies', () => {
  it('re-rolls only the tied entries, again if they tie again', async () => {
    const { rerollTies } = await import('../src/initiative.js');
    const rolls = [4, 4, 9, 2]; // a,b が 4 で同じ → もう一度 9 と 2
    const roll = () => rolls.shift()!;
    const out = rerollTies(
      [
        { id: 'a', total: 15, ref: 5 },
        { id: 'c', total: 20, ref: 8 },
        { id: 'b', total: 15, ref: 9 },
      ],
      roll,
    );
    expect(out.map((e) => e.id)).toEqual(['c', 'a', 'b']);
    expect(out[0].tiebreak).toEqual([]);
    expect(out[1].tiebreak).toEqual([4, 9]);
    expect(out[2].tiebreak).toEqual([4, 2]);
  });
});
