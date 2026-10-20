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

export interface ReachableOptions {
  start: GridPoint;
  maxSquares: number;
  isPassable: (pt: GridPoint) => boolean;
  canStop?: (pt: GridPoint) => boolean;
  bounds?: { cols: number; rows: number };
  diagonalRule?: 'chebyshev' | 'alternate';
}

/**
 * Finds all reachable squares from start within maxSquares using shortest path (BFS / Dijkstra).
 * Impassable cells (walls) cannot be traversed.
 * If canStop is provided, cells where canStop is false can be passed through but cannot be stopped on.
 */
export function findReachableSquares(options: ReachableOptions): GridPoint[] {
  const { start, maxSquares, isPassable, canStop, bounds, diagonalRule = 'chebyshev' } = options;
  if (maxSquares <= 0) return [];

  const key = (x: number, y: number) => `${x},${y}`;
  const stateKey = (x: number, y: number, parity: number) =>
    diagonalRule === 'alternate' ? `${x},${y},${parity}` : `${x},${y}`;
  const visited = new Map<string, number>(); // stateKey -> minCost

  interface Node {
    x: number;
    y: number;
    cost: number;
    diagonals: number;
  }

  const queue: Node[] = [{ x: start.x, y: start.y, cost: 0, diagonals: 0 }];
  visited.set(stateKey(start.x, start.y, 0), 0);

  const reachableMap = new Map<string, GridPoint>();

  const directions = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: 1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: 1 },
    { dx: -1, dy: -1 },
  ];

  while (queue.length > 0) {
    // Dijkstra pop min cost
    queue.sort((a, b) => a.cost - b.cost);
    const curr = queue.shift()!;

    for (const { dx, dy } of directions) {
      const nx = curr.x + dx;
      const ny = curr.y + dy;

      if (bounds && (nx < 0 || nx >= bounds.cols || ny < 0 || ny >= bounds.rows)) {
        continue;
      }

      if (!isPassable({ x: nx, y: ny })) {
        continue;
      }

      const isDiag = dx !== 0 && dy !== 0;
      let stepCost = 1;
      let nextDiagonals = curr.diagonals;

      if (isDiag) {
        nextDiagonals += 1;
        if (diagonalRule === 'alternate') {
          // In alternate rule: diagonals cost 1, 2, 1, 2...
          stepCost = nextDiagonals % 2 === 1 ? 1 : 2;
        } else {
          stepCost = 1; // chebyshev
        }
      }

      const nextCost = curr.cost + stepCost;
      if (nextCost > maxSquares) {
        continue;
      }

      const parity = nextDiagonals % 2;
      const sKey = stateKey(nx, ny, parity);
      const prevCost = visited.get(sKey);
      if (prevCost !== undefined && prevCost <= nextCost) {
        continue;
      }

      visited.set(sKey, nextCost);
      queue.push({ x: nx, y: ny, cost: nextCost, diagonals: nextDiagonals });

      // Check if can stop on this square
      if (!canStop || canStop({ x: nx, y: ny })) {
        reachableMap.set(key(nx, ny), { x: nx, y: ny });
      }
    }
  }

  return Array.from(reachableMap.values());
}

/**
 * Checks whether target point is reachable from start.
 */
export function isSquareReachable(
  target: GridPoint,
  options: ReachableOptions,
): boolean {
  const reachable = findReachableSquares(options);
  return reachable.some((pt) => pt.x === target.x && pt.y === target.y);
}

export interface BoardObstacle {
  id?: string;
  label?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number; // 0, 90, 180, 270
  blocks_los: 'none' | 'partial' | 'full';
  cover_hp?: number | null;
}

export type LosStatus = 'clear' | 'cover' | 'blocked';

export interface LosResult {
  status: LosStatus;
  distanceSquares: number;
  distanceMeters: number;
  coverObjects: BoardObstacle[];
  blockingObjects: BoardObstacle[];
}

/**
 * Tests if the line segment from p0 to p1 intersects the rectangle box.
 * Box rotated 90 or 270 swaps width and height.
 * Corner/edge grazing without entering the box interior is treated as non-blocking.
 */
export function lineIntersectsBox(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  box: { x: number; y: number; w: number; h: number; rotation?: number },
): boolean {
  const rot = box.rotation ?? 0;
  const w = rot === 90 || rot === 270 ? box.h : box.w;
  const h = rot === 90 || rot === 270 ? box.w : box.h;

  const minX = box.x;
  const maxX = box.x + w;
  const minY = box.y;
  const maxY = box.y + h;

  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;

  let txMin = -Infinity;
  let txMax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (p0.x < minX || p0.x > maxX) return false;
  } else {
    const t1 = (minX - p0.x) / dx;
    const t2 = (maxX - p0.x) / dx;
    txMin = Math.min(t1, t2);
    txMax = Math.max(t1, t2);
  }

  let tyMin = -Infinity;
  let tyMax = Infinity;
  if (Math.abs(dy) < 1e-9) {
    if (p0.y < minY || p0.y > maxY) return false;
  } else {
    const t1 = (minY - p0.y) / dy;
    const t2 = (maxY - p0.y) / dy;
    tyMin = Math.min(t1, t2);
    tyMax = Math.max(t1, t2);
  }

  const tEnter = Math.max(txMin, tyMin);
  const tExit = Math.min(txMax, tyMax);

  const tStart = Math.max(tEnter, 0);
  const tEnd = Math.min(tExit, 1);

  // Strictly entering the box has positive interval length (> 1e-6)
  return tEnd - tStart > 1e-6;
}

/**
 * Checks Line of Sight between shooter and target.
 * Line is drawn between cell centers (x + 0.5, y + 0.5).
 */
export function checkLineOfSight(
  shooter: GridPoint,
  target: GridPoint,
  obstacles: BoardObstacle[],
  rules: RuleConstants = DEFAULT_RULES,
): LosResult {
  const p0 = { x: shooter.x + 0.5, y: shooter.y + 0.5 };
  const p1 = { x: target.x + 0.5, y: target.y + 0.5 };

  const distSq = gridDistance(shooter, target, rules);
  const distM = distSq * rules.metersPerSquare;

  const coverObjects: BoardObstacle[] = [];
  const blockingObjects: BoardObstacle[] = [];

  for (const obs of obstacles) {
    // Destroyed cover does not block
    if (obs.cover_hp !== null && obs.cover_hp !== undefined && obs.cover_hp <= 0) {
      continue;
    }
    if (obs.blocks_los === 'none') {
      continue;
    }

    if (lineIntersectsBox(p0, p1, obs)) {
      if (obs.blocks_los === 'full') {
        blockingObjects.push(obs);
      } else if (obs.blocks_los === 'partial') {
        coverObjects.push(obs);
      }
    }
  }

  let status: LosStatus = 'clear';
  if (blockingObjects.length > 0) {
    status = 'blocked';
  } else if (coverObjects.length > 0) {
    status = 'cover';
  }

  return {
    status,
    distanceSquares: distSq,
    distanceMeters: distM,
    coverObjects,
    blockingObjects,
  };
}
