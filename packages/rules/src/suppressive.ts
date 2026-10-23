import { DEFAULT_RULES, RuleConstants } from './constants.js';
import { resolveOpposed } from './check.js';
import { BoardObstacle, checkLineOfSight, gridDistance, GridPoint } from './movement.js';

export type SuppressiveFacing = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
export interface SuppressiveCandidateInput {
  shooterId: string;
  shooter: GridPoint;
  targets: Array<{ id: string; position?: GridPoint; inVehicle?: boolean; inCover?: boolean }>;
  facing: SuppressiveFacing;
  objects: BoardObstacle[];
  metersPerSquare?: number;
  rules?: RuleConstants;
}

/** true means the target loses the opposed check and must move toward cover. */
export function losesSuppressiveContest(shooterTotal: number, resistanceTotal: number, rules: RuleConstants = DEFAULT_RULES): boolean {
  return resolveOpposed({ attackerTotal: shooterTotal, defenderTotal: resistanceTotal }, rules) === 'attacker';
}

/** Board-based candidates for p.174. GM can still add/remove IDs after this filter. */
export function suppressiveTargetCandidates(input: SuppressiveCandidateInput): string[] {
  const direction: Record<SuppressiveFacing, GridPoint> = {
    N: { x: 0, y: -1 }, NE: { x: 1, y: -1 }, E: { x: 1, y: 0 }, SE: { x: 1, y: 1 },
    S: { x: 0, y: 1 }, SW: { x: -1, y: 1 }, W: { x: -1, y: 0 }, NW: { x: -1, y: -1 },
  };
  const meters = input.metersPerSquare ?? DEFAULT_RULES.metersPerSquare;
  const rules = { ...(input.rules ?? DEFAULT_RULES), metersPerSquare: meters };
  const facing = direction[input.facing];
  return input.targets.filter((target) => {
    if (target.id === input.shooterId || !target.position || target.inVehicle || target.inCover) return false;
    const dx = target.position.x - input.shooter.x;
    const dy = target.position.y - input.shooter.y;
    if (dx * facing.x + dy * facing.y <= 0) return false;
    if (gridDistance(input.shooter, target.position, rules) * meters > 25) return false;
    return checkLineOfSight(input.shooter, target.position, input.objects, rules).status === 'clear';
  }).map((target) => target.id);
}
