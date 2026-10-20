import { describe, it, expect } from 'vitest';
import { maxHumanity, currentEmp, humanityAfterInstall } from '../src/humanity.js';
import { DEFAULT_RULES } from '../src/constants.js';

describe('humanity module (RULES_CHECK §6, cpr-actor.js _calcMaxHumanity)', () => {
  it('calculates maxHumanity subtracting 2 per cyberware and 4 per borgware, ignoring 0-loss cyberware (RULES_CHECK §6)', () => {
    // EMP max 5, cybereye (static 7), biomonitor (static 0)
    // 5 * 10 - 2 (cybereye) - 0 (biomonitor) = 48
    const maxH = maxHumanity(5, [
      { type: 'cybereye', staticLoss: 7 },
      { type: 'biomonitor', staticLoss: 0 },
    ]);
    expect(maxH).toBe(48);

    // With borgware (-4) and bonus (+2)
    const maxHBorg = maxHumanity(
      6,
      [
        { type: 'cybereye', staticLoss: 7 },
        { type: 'borgware', staticLoss: 14 },
      ],
      2,
      DEFAULT_RULES,
    );
    // 6 * 10 - 2 - 4 + 2 = 56
    expect(maxHBorg).toBe(56);
  });

  it('calculates current EMP as floor(min(humanity, maxHumanity) / 10)', () => {
    // Current humanity 43, maxHumanity 48 -> min(43, 48) = 43 -> floor(43 / 10) = 4
    expect(currentEmp(43, 48)).toBe(4);

    // Current humanity exceeds max humanity -> capped at max
    expect(currentEmp(60, 48)).toBe(4);

    // Humanity 0 -> EMP 0
    expect(currentEmp(0, 48)).toBe(0);

    // Negative humanity (cyberpsychosis) -> never drops below 0
    expect(currentEmp(-10, 48)).toBe(0);
  });

  it('calculates humanity after installation', () => {
    expect(humanityAfterInstall(50, 7)).toBe(43);
    expect(humanityAfterInstall(43, 11)).toBe(32);
  });
});
