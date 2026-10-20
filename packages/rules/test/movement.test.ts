import { describe, it, expect } from 'vitest';
import {
  moveSquares,
  gridDistance,
  distanceMeters,
  findReachableSquares,
  checkLineOfSight,
} from '../src/movement.js';
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

  it('calculates (0,0) to (3,4) is chebyshev 4 squares = 8m (Phase 4b §9)', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 3, y: 4 };
    expect(gridDistance(a, b, DEFAULT_RULES)).toBe(4);
    expect(distanceMeters(a, b, DEFAULT_RULES)).toBe(8);

    // With alternate rule: max(3, 4) + floor(min(3, 4) / 2) = 4 + 1 = 5 squares = 10m
    const altRules = { ...DEFAULT_RULES, diagonalRule: 'alternate' as const };
    expect(gridDistance(a, b, altRules)).toBe(5);
    expect(distanceMeters(a, b, altRules)).toBe(10);
  });

  describe('findReachableSquares (Phase 4b §3, §9)', () => {
    it('detours around impassable walls using BFS and excludes squares out of range', () => {
      // 5x5 grid:
      // Start at (0, 2), maxSquares = 2
      // Wall from (1, 0) to (1, 3): cells (1, 0), (1, 1), (1, 2), (1, 3) are impassable
      // (2, 2) is straight line distance 2, but requires walking around wall at (1, 4)
      // Path to (2, 2): (0,2) -> (0,3) -> (0,4) -> (1,4) -> (2,4) -> (2,3) -> (2,2) = 6 moves
      // Thus (2, 2) is unreachable with maxSquares = 2
      const walls = new Set(['1,0', '1,1', '1,2', '1,3']);
      const isPassable = (pt: { x: number; y: number }) => !walls.has(`${pt.x},${pt.y}`);

      const reachable = findReachableSquares({
        start: { x: 0, y: 2 },
        maxSquares: 2,
        isPassable,
        bounds: { cols: 10, rows: 10 },
      });

      // Reachable squares must not include wall squares or (2, 2)
      expect(reachable.some((p) => p.x === 2 && p.y === 2)).toBe(false);
      expect(reachable.some((p) => p.x === 1 && p.y === 2)).toBe(false);
      // (0, 0), (0, 1), (0, 3), (0, 4) should be reachable
      expect(reachable.some((p) => p.x === 0 && p.y === 1)).toBe(true);
      expect(reachable.some((p) => p.x === 0 && p.y === 4)).toBe(true);

      // With maxSquares = 6, (2, 2) becomes reachable around the wall
      const reachableWith6 = findReachableSquares({
        start: { x: 0, y: 2 },
        maxSquares: 6,
        isPassable,
        bounds: { cols: 10, rows: 10 },
      });
      expect(reachableWith6.some((p) => p.x === 2 && p.y === 2)).toBe(true);
    });

    it('cannot stop on another token square but can pass through it (Phase 4b §3, §9)', () => {
      // Token at (1, 0). Start at (0, 0), maxSquares = 2.
      // Can pass through (1, 0) to reach (2, 0), but cannot stop on (1, 0).
      const tokens = new Set(['1,0']);
      const isPassable = () => true;
      const canStop = (pt: { x: number; y: number }) => !tokens.has(`${pt.x},${pt.y}`);

      const reachable = findReachableSquares({
        start: { x: 0, y: 0 },
        maxSquares: 2,
        isPassable,
        canStop,
        bounds: { cols: 5, rows: 5 },
      });

      // (1, 0) cannot be stopped on
      expect(reachable.some((p) => p.x === 1 && p.y === 0)).toBe(false);
      // But (2, 0) is reachable by passing through (1, 0)
      expect(reachable.some((p) => p.x === 2 && p.y === 0)).toBe(true);
    });
  });

  describe('checkLineOfSight (Phase 4b §4, §9)', () => {
    it('returns clear when no obstacles block the line', () => {
      const shooter = { x: 0, y: 0 };
      const target = { x: 4, y: 0 };
      const result = checkLineOfSight(shooter, target, []);
      expect(result.status).toBe('clear');
      expect(result.distanceSquares).toBe(4);
      expect(result.distanceMeters).toBe(8);
      expect(result.coverObjects).toHaveLength(0);
      expect(result.blockingObjects).toHaveLength(0);
    });

    it('returns cover (yellow) when passing through partial cover object (crate)', () => {
      const shooter = { x: 0, y: 0 };
      const target = { x: 4, y: 0 };
      const crate = {
        id: 'crate-1',
        label: '木箱',
        x: 2,
        y: 0,
        w: 1,
        h: 1,
        blocks_los: 'partial' as const,
        cover_hp: 20,
      };

      const result = checkLineOfSight(shooter, target, [crate]);
      expect(result.status).toBe('cover');
      expect(result.coverObjects).toHaveLength(1);
      expect(result.coverObjects[0].id).toBe('crate-1');
      expect(result.blockingObjects).toHaveLength(0);
    });

    it('returns blocked (red) when passing through full wall', () => {
      const shooter = { x: 0, y: 0 };
      const target = { x: 4, y: 0 };
      const wall = {
        id: 'wall-1',
        label: 'コンクリート壁',
        x: 2,
        y: 0,
        w: 1,
        h: 1,
        blocks_los: 'full' as const,
      };

      const result = checkLineOfSight(shooter, target, [wall]);
      expect(result.status).toBe('blocked');
      expect(result.blockingObjects).toHaveLength(1);
      expect(result.blockingObjects[0].id).toBe('wall-1');
    });

    it('handles rotated objects correctly (rotation 90 vs 0)', () => {
      const shooter = { x: 0, y: 0 };
      const target = { x: 0, y: 4 };

      // Object at (1, 1), w=1, h=3
      // At rotation 0: spans x in [1, 2], y in [1, 4]. Does not intersect line x=0.5
      const obstacleRot0 = {
        x: 1,
        y: 1,
        w: 1,
        h: 3,
        rotation: 0,
        blocks_los: 'full' as const,
      };
      expect(checkLineOfSight(shooter, target, [obstacleRot0]).status).toBe('clear');

      // At rotation 90: w and h swap -> spans x in [0, 3] if anchored or x in [1, 4], y in [1, 2]
      // Wait: with our formula: x in [x, x+h], y in [y, y+w].
      // For object at (0, 2), w=1, h=3, rot=0: x in [0, 1], y in [2, 5]. Intersects x=0.5.
      // If at (1, 2), rot=90: x in [1, 4], y in [2, 3]. Does not intersect x=0.5.
      // If at (-1, 2), rot=90: x in [-1, 2], y in [2, 3]. Intersects x=0.5!
      const obstacleRot90 = {
        x: -1,
        y: 2,
        w: 1,
        h: 3,
        rotation: 90,
        blocks_los: 'full' as const,
      };
      expect(checkLineOfSight(shooter, target, [obstacleRot90]).status).toBe('blocked');
    });

    it('treats corner grazing as non-blocking', () => {
      // Shooter at (0, 0), Target at (2, 2). Line center to center passes exactly through (1, 1).
      // Obstacle at (1, 0) with w=1, h=1 touches the line at top-left corner (1, 1) but does not enter interior.
      const shooter = { x: 0, y: 0 };
      const target = { x: 2, y: 2 };
      const cornerObstacle = {
        x: 1,
        y: 0,
        w: 1,
        h: 1,
        blocks_los: 'full' as const,
      };
      expect(checkLineOfSight(shooter, target, [cornerObstacle]).status).toBe('clear');
    });

    it('treats destroyed cover (cover_hp <= 0) as non-blocking', () => {
      const shooter = { x: 0, y: 0 };
      const target = { x: 4, y: 0 };
      const brokenCrate = {
        id: 'broken-1',
        x: 2,
        y: 0,
        w: 1,
        h: 1,
        blocks_los: 'partial' as const,
        cover_hp: 0,
      };
      expect(checkLineOfSight(shooter, target, [brokenCrate]).status).toBe('clear');
    });

    it('accurately finds reachable squares with alternate diagonal rule respecting diagonal parity (§12.6)', () => {
      const start = { x: 0, y: 0 };
      const reachable = findReachableSquares({
        start,
        maxSquares: 4,
        isPassable: () => true,
        bounds: { cols: 10, rows: 10 },
        diagonalRule: 'alternate',
      });
      const keySet = new Set(reachable.map((p) => `${p.x},${p.y}`));
      expect(keySet.has('3,2')).toBe(true);

      for (const pt of reachable) {
        const d = gridDistance(start, pt, { ...DEFAULT_RULES, diagonalRule: 'alternate' });
        expect(d).toBeLessThanOrEqual(4);
      }
    });
  });
});
