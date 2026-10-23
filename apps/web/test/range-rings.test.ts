import { describe, expect, it } from 'vitest';
import { createRangeRings } from '../src/utils/range-rings.js';

describe('createRangeRings', () => {
  it('uses each weapon DV band upper bound and converts meters to squares', () => {
    expect(createRangeRings([
      { range: [0, 6], dv: 13 },
      { range: [7, 12], dv: 15 },
      { range: [13, 25], dv: 20 },
    ], 2, 12)).toEqual([
      { meters: 6, radiusSquares: 3, label: '目安 〜6m 難易度 13', dv: 13 },
      { meters: 12, radiusSquares: 6, label: '目安 〜12m 難易度 15', dv: 15 },
      { meters: 25, radiusSquares: 12.5, label: '目安 〜25m 難易度 20', dv: 20 },
    ]);
  });

  it('uses melee reach and movement rings if no ranged weapon table is selected', () => {
    expect(createRangeRings(null, 2, 12)).toEqual([
      { meters: 2, radiusSquares: 1, label: '目安 〜2m', dv: null },
      { meters: 12, radiusSquares: 6, label: '目安 〜12m', dv: null },
    ]);
  });

  it('falls back when the selected weapon has no usable table', () => {
    expect(createRangeRings([{ range: [0, 6], dv: 'N/A' }], 2, 10).map((ring) => ring.meters)).toEqual([2, 10]);
  });
});
