import { describe, expect, it } from 'vitest';
import { losesSuppressiveContest, suppressiveTargetCandidates } from '../src/suppressive.js';

describe('suppressive fire (p.174)', () => {
  it('selects only forward, in-range, uncovered, non-vehicle targets with clear line of sight', () => {
    const candidates = suppressiveTargetCandidates({
      shooterId: 'shooter', shooter: { x: 0, y: 0 }, facing: 'E', metersPerSquare: 2,
      objects: [{ id: 'wall', x: 4, y: 0, w: 1, h: 1, blocks_los: 'full' }],
      targets: [
        { id: 'self', position: { x: 0, y: 0 } },
        { id: 'clear', position: { x: 3, y: 2 } },
        { id: 'far', position: { x: 13, y: 0 } },
        { id: 'behind', position: { x: -2, y: 0 } },
        { id: 'covered', position: { x: 2, y: 1 }, inCover: true },
        { id: 'vehicle', position: { x: 2, y: -1 }, inVehicle: true },
        { id: 'blocked', position: { x: 6, y: 0 } },
      ],
    });
    expect(candidates).toEqual(['clear']);
  });

  it('uses the existing opposed-check tie rule and identifies wins and losses', () => {
    expect(losesSuppressiveContest(15, 14)).toBe(true);
    expect(losesSuppressiveContest(14, 15)).toBe(false);
    expect(losesSuppressiveContest(15, 15)).toBe(false); // ties go to defender
    expect(losesSuppressiveContest(15, 15, { tieRule: 'attacker', opposedTieWinner: 'attacker' } as any)).toBe(true);
  });
});
