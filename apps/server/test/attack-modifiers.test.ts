import { describe, expect, it } from 'vitest';
import type { CombatParticipant } from '@cyberpgm/shared';
import { db } from '../src/db/client.js';
import { attackModifierTotal, rangedAttackModifiers } from '../src/services/attack-modifiers.js';

describe('ranged attack wound modifiers', () => {
  it('cancels the serious-wound penalty with the drug and keeps the death-save penalty', () => {
    const actor = { character: { inventory: [], cyberware: [] } } as unknown as CombatParticipant;
    const weapon = { weapon_type: 'pistol' };
    const withoutWound = rangedAttackModifiers(db, actor, weapon, undefined, 'ranged', undefined, {
      wound: 0, grapple: 0, ignoreSeriousWound: false, precision: 0,
    });
    const seriousWoundWithDrug = rangedAttackModifiers(db, actor, weapon, undefined, 'ranged', undefined, {
      wound: -2, grapple: 0, ignoreSeriousWound: true, precision: 0,
    });

    expect(attackModifierTotal(seriousWoundWithDrug)).toBe(attackModifierTotal(withoutWound));
    expect(seriousWoundWithDrug).toContainEqual({ key: 'ignore_wound', label: '重傷（ドラッグで無視）', value: 0 });

    const dyingWithDrug = rangedAttackModifiers(db, actor, weapon, undefined, 'ranged', undefined, {
      wound: -4, grapple: 0, ignoreSeriousWound: true, precision: 0,
    });
    expect(dyingWithDrug).toContainEqual({ key: 'wound', label: '瀕死', value: -4 });
    expect(attackModifierTotal(dyingWithDrug)).toBe(-4);
  });
});
