import { describe, it, expect } from 'vitest';
import { resolveD10, d10Distribution, successProbability } from '../src/dice.js';
import { DEFAULT_RULES } from '../src/constants.js';

describe('dice module (RULES_CHECK §1, cpr-die-extended.js)', () => {
  it('resolves normal d10 rolls (2..9) without extra roll', () => {
    for (let i = 2; i <= 9; i++) {
      const res = resolveD10(i);
      expect(res.value).toBe(i);
      expect(res.needsExtra).toBe(false);
    }
  });

  it('triggers critical extra roll on 10 (cpr-die-extended.js red modifier)', () => {
    // resolveD10(10) -> needsExtra
    const pending = resolveD10(10);
    expect(pending.needsExtra).toBe(true);
    expect(pending.value).toBe(10);

    // resolveD10(10, 3) -> 13
    const resolved = resolveD10(10, 3);
    expect(resolved.needsExtra).toBe(false);
    expect(resolved.value).toBe(13);

    // resolveD10(10, 10) -> 20 (no chain)
    const maxResolved = resolveD10(10, 10);
    expect(maxResolved.value).toBe(20);
  });

  it('triggers fumble extra roll on 1 (cpr-die-extended.js red modifier)', () => {
    // resolveD10(1) -> needsExtra
    const pending = resolveD10(1);
    expect(pending.needsExtra).toBe(true);
    expect(pending.value).toBe(1);

    // resolveD10(1, 4) -> -3
    const resolved = resolveD10(1, 4);
    expect(resolved.needsExtra).toBe(false);
    expect(resolved.value).toBe(-3);

    // resolveD10(1, 1) -> 0
    const zeroResolved = resolveD10(1, 1);
    expect(zeroResolved.value).toBe(0);

    // resolveD10(1, 10) -> -9
    const minResolved = resolveD10(1, 10);
    expect(minResolved.value).toBe(-9);
  });

  it('throws on invalid dice inputs', () => {
    expect(() => resolveD10(0)).toThrow();
    expect(() => resolveD10(11)).toThrow();
    expect(() => resolveD10(3.5)).toThrow();
    expect(() => resolveD10(10, 0)).toThrow();
    expect(() => resolveD10(10, 11)).toThrow();
    expect(() => resolveD10(1, 12)).toThrow();
  });

  it('provides a complete probability distribution summing to 1.0 (SPEC §7)', () => {
    const dist = d10Distribution();
    let sum = 0;
    for (const prob of dist.values()) {
      sum += prob;
    }
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });

  it('calculates success probability accurately: base 11 vs DV 13 = 0.80 (Issue #1, RULES_CHECK §7)', () => {
    // tieRule: 'fail' -> 11 + roll > 13 -> roll >= 3. Rolls 3..10 = 0.80
    const prob = successProbability(11, 13, 'dv', DEFAULT_RULES);
    expect(prob).toBe(0.8);
  });

  it('calculates success probability under tieRule success', () => {
    // 11 + roll >= 13 -> roll >= 2. Rolls 2..10 = 0.90
    const prob = successProbability(11, 13, 'dv', { ...DEFAULT_RULES, tieRule: 'success' });
    expect(prob).toBe(0.9);
  });

  it('calculates opposed defense probability (opposedTieWinner defender)', () => {
    // Defender base 12 vs Attacker total 18 -> 12 + roll >= 18 -> roll >= 6
    // Rolls 6..9 (4 * 0.1 = 0.40) + roll 10 (10 * 0.01 = 0.10) = 0.50
    const prob = successProbability(12, 18, 'defend', DEFAULT_RULES);
    expect(prob).toBe(0.5);

    // Defender base 12 vs Attacker total 18 with opposedTieWinner 'attacker'
    // 12 + roll > 18 -> roll >= 7
    // Rolls 7..9 (3 * 0.1 = 0.30) + roll 10 (10 * 0.01 = 0.10) = 0.40
    const probAttackerWin = successProbability(12, 18, 'defend', {
      ...DEFAULT_RULES,
      opposedTieWinner: 'attacker',
    });
    expect(probAttackerWin).toBe(0.4);
  });
});
