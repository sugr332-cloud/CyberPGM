import { DEFAULT_RULES, RuleConstants } from './constants.js';

export interface GridPoint {
  x: number;
  y: number;
}

/**
 * Calculates movement allowance in squares.
 * Base movement = MOVE squares. Running doubles movement (MOVE * 2 squares).
 */
export function moveSquares(move: number, isRunning: boolean = false): number {
  return move * (isRunning ? 2 : 1);
}

/**
 * Calculates grid distance between two points in squares.
 * - 'chebyshev': max(|dx|, |dy|)
 * - 'alternate': diagonals count as 1, 2, 1, 2... (max(dx, dy) + floor(min(dx, dy) / 2))
 */
export function gridDistance(
  a: GridPoint,
  b: GridPoint,
  rules: RuleConstants = DEFAULT_RULES,
): number {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);

  if (rules.diagonalRule === 'alternate') {
    const minDiff = Math.min(dx, dy);
    const maxDiff = Math.max(dx, dy);
    return maxDiff + Math.floor(minDiff / 2);
  }

  // 'chebyshev' (default)
  return Math.max(dx, dy);
}

/**
 * Calculates distance in meters between two points: squares * metersPerSquare.
 */
export function distanceMeters(
  a: GridPoint,
  b: GridPoint,
  rules: RuleConstants = DEFAULT_RULES,
): number {
  return gridDistance(a, b, rules) * rules.metersPerSquare;
}
