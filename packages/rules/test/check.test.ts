import { describe, it, expect } from 'vitest';
import {
  skillBase,
  neededRoll,
  formatNeeded,
  resolveCheck,
  resolveOpposed,
} from '../src/check.js';
import { DEFAULT_RULES } from '../src/constants.js';

describe('check module (RULES_CHECK §1, SPEC §5.0.1)', () => {
  it('calculates skillBase with stat, level, wound penalty, and modifiers', () => {
    // Untrained
    expect(skillBase({ stat: 6 })).toBe(6);
    // Trained with wound penalty (-2) and gear mod (+1)
    expect(skillBase({ stat: 6, level: 4, woundPenalty: -2, mods: 1 })).toBe(9);
  });

  it('calculates neededRoll for base 14 vs DV 15 -> roll n=2 (RULES_CHECK §1)', () => {
    // 15 - 14 + 1 = 2
    const needed = neededRoll(14, 15, 'dv', DEFAULT_RULES);
    expect(needed).toEqual({ kind: 'roll', n: 2 });
    expect(formatNeeded(needed)).toBe('2 以上で成功');
  });

  it('calculates neededRoll for base 6 vs DV 15 -> roll n=10', () => {
    // 15 - 6 + 1 = 10
    const needed = neededRoll(6, 15, 'dv', DEFAULT_RULES);
    expect(needed).toEqual({ kind: 'roll', n: 10 });
    expect(formatNeeded(needed)).toBe('10 以上で成功');
  });

  it('calculates neededRoll for base 6 vs DV 20 -> extra n=5', () => {
    // 20 - 6 + 1 = 15 -> 10 + 5
    const needed = neededRoll(6, 20, 'dv', DEFAULT_RULES);
    expect(needed).toEqual({ kind: 'extra', n: 5 });
    expect(formatNeeded(needed)).toBe('10 → 追加ロールで 5 以上');
  });

  it('calculates neededRoll for defense: base 12 vs attack total 18 -> roll n=6 (opposedTieWinner defender)', () => {
    // 18 - 12 = 6 (tie wins)
    const needed = neededRoll(12, 18, 'defend', DEFAULT_RULES);
    expect(needed).toEqual({ kind: 'roll', n: 6 });
    expect(formatNeeded(needed)).toBe('6 以上で成功');
  });

  it('switches to tieRule success: 14 vs 15 is any (Issue #1)', () => {
    // 15 - 14 = 1 <= 2 -> any
    const needed = neededRoll(14, 15, 'dv', { ...DEFAULT_RULES, tieRule: 'success' });
    expect(needed).toEqual({ kind: 'any' });
    expect(formatNeeded(needed)).toBe('2 以上で成功');
  });

  it('detects impossible checks (needed total > 20)', () => {
    // DV 30 vs base 5 -> 30 - 5 + 1 = 26 > 20
    const needed = neededRoll(5, 30, 'dv', DEFAULT_RULES);
    expect(needed).toEqual({ kind: 'impossible' });
    expect(formatNeeded(needed)).toBe('成功しない');
  });

  it('resolves check against DV correctly', () => {
    // Base 10 + roll 5 = 15 vs DV 13 -> Success
    const resSuccess = resolveCheck({ base: 10, first: 5, target: 13, mode: 'dv' });
    expect(resSuccess.total).toBe(15);
    expect(resSuccess.success).toBe(true);
    expect(resSuccess.needsExtra).toBe(false);

    // Base 10 + roll 3 = 13 vs DV 13 (tieRule: fail) -> Fail
    const resTieFail = resolveCheck({ base: 10, first: 3, target: 13, mode: 'dv' });
    expect(resTieFail.total).toBe(13);
    expect(resTieFail.success).toBe(false);

    // Critical roll: first 10, extra 4 = 14 + 10 = 24 vs DV 20 -> Success
    const resCrit = resolveCheck({ base: 10, first: 10, extra: 4, target: 20, mode: 'dv' });
    expect(resCrit.total).toBe(24);
    expect(resCrit.success).toBe(true);

    // Pending extra roll
    const resPending = resolveCheck({ base: 10, first: 10, target: 20, mode: 'dv' });
    expect(resPending.needsExtra).toBe(true);

    // Defend mode
    const resDefendWin = resolveCheck({ base: 10, first: 5, target: 15, mode: 'defend' }, DEFAULT_RULES);
    expect(resDefendWin.success).toBe(true); // tie wins for defender

    const resDefendAttackerWin = resolveCheck(
      { base: 10, first: 5, target: 15, mode: 'defend' },
      { ...DEFAULT_RULES, opposedTieWinner: 'attacker' },
    );
    expect(resDefendAttackerWin.success).toBe(false);
  });

  it('resolves opposed checks and tie breaks correctly (Issue #1)', () => {
    expect(resolveOpposed({ attackerTotal: 18, defenderTotal: 15 }, DEFAULT_RULES)).toBe('attacker');
    expect(resolveOpposed({ attackerTotal: 15, defenderTotal: 18 }, DEFAULT_RULES)).toBe('defender');

    // Default tie winner: defender
    expect(resolveOpposed({ attackerTotal: 15, defenderTotal: 15 }, DEFAULT_RULES)).toBe('defender');

    // Custom tie winner: attacker
    expect(
      resolveOpposed(
        { attackerTotal: 15, defenderTotal: 15 },
        { ...DEFAULT_RULES, opposedTieWinner: 'attacker' },
      ),
    ).toBe('attacker');
  });
});
