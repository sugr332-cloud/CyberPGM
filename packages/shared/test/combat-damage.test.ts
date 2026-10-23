import { describe, expect, it } from 'vitest';
import { combatDamageFormula, damageDiceGuide, brawlingDamageDice } from '../src/combat-damage.js';

describe('combat damage display (Phase 6d)', () => {
  const character = { stats: { body: 6 } };
  it('uses the selected inventory weapon formula and never guesses unknown damage', () => {
    expect(combatDamageFormula('ranged', character, { damage: '2d6' })).toBe('2d6');
    expect(combatDamageFormula('melee', character, { damage: '3d6' })).toBe('3d6');
    expect(combatDamageFormula('ranged', character, { damage: null })).toBeNull();
    expect(combatDamageFormula('ranged', character)).toBeNull();
    expect(damageDiceGuide(null)).toBe('ダメージ不明');
    expect(damageDiceGuide('2d6')).toBe('2d6（6 面ダイスを 2 個）');
    expect(damageDiceGuide('special')).toBe('special');
  });
  it('uses BODY for brawling and martial arts, with cyberarm minimum only for brawling (p.176,178)', () => {
    for (const [body, dice] of [[4, 1], [6, 2], [10, 3], [11, 4]]) {
      expect(combatDamageFormula('brawl', { stats: { body } })).toBe(`${dice}d6`);
      expect(combatDamageFormula('martial_arts', { stats: { body } })).toBe(`${dice}d6`);
    }
    expect(brawlingDamageDice(4, [{ name: 'サイバーアーム' }])).toBe(2);
    expect(brawlingDamageDice(4, [{ name: 'Cyberarm' }])).toBe(2);
    expect(brawlingDamageDice(4, [{ name: 'サイバーアーム用カバー' }])).toBe(1);
    expect(combatDamageFormula('martial_arts', { stats: { body: 4 }, cyberware: [{ name: 'Cyberarm' }] })).toBe('1d6');
    expect(combatDamageFormula('autofire', character, { damage: '5d6' })).toBe('2d6');
  });
});
