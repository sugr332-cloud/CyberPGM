import { describe, it, expect } from 'vitest';
import { moveSquares, gridDistance, distanceMeters } from '../src/movement.js';
import { DEFAULT_RULES } from '../src/constants.js';

describe('movement module (RULES_CHECK §2, cpr-actor.js walk/run, Issue #10)', () => {
  it('calculates move allowance in squares (MOVE, and double for run)', () => {
    expect(moveSquares(5)).toBe(5);
    expect(moveSquares(5, false)).toBe(5);
    expect(moveSquares(5, true)).toBe(10);
  });

  it('calculates grid distance using chebyshev by default: (4,6) to (8,4) is 4 squares / 8m (RULES_CHECK §2)', () => {
    // dx = 4, dy = 2 -> chebyshev max(4, 2) = 4 squares
    const sq = gridDistance({ x: 4, y: 6 }, { x: 8, y: 4 }, DEFAULT_RULES);
    expect(sq).toBe(4);

    // meters = 4 squares * 2m = 8m
    const meters = distanceMeters({ x: 4, y: 6 }, { x: 8, y: 4 }, DEFAULT_RULES);
    expect(meters).toBe(8);
  });

  it('calculates grid distance using alternate diagonal rule (Issue #10)', () => {
    const rules = { ...DEFAULT_RULES, diagonalRule: 'alternate' as const };
    // dx = 4, dy = 2 -> max(4, 2) + floor(min(4, 2) / 2) = 4 + 1 = 5 squares
    expect(gridDistance({ x: 0, y: 0 }, { x: 4, y: 2 }, rules)).toBe(5);

    // dx = 3, dy = 3 -> 3 + floor(3 / 2) = 3 + 1 = 4 squares
    expect(gridDistance({ x: 0, y: 0 }, { x: 3, y: 3 }, rules)).toBe(4);
  });
});
