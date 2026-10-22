import { describe, it, expect } from 'vitest';
import { resolveDamage, lookupCriticalInjury, CriticalInjuryEntry } from '../src/damage.js';

describe('damage module (RULES_CHECK §3, FVTT _applyDamage)', () => {
  it('resolves normal penetrating damage with critical: [6,6,4] vs SP 7 body (RULES_CHECK §3)', () => {
    // rawTotal 16, penetrating 9, critBonus 5, hpLoss 14, spAfter 6, table 'body'
    const res = resolveDamage({
      dice: [6, 6, 4],
      location: 'body',
      sp: 7,
    });

    expect(res.rawTotal).toBe(16);
    expect(res.critical).toBe(true);
    expect(res.critBonus).toBe(5);
    expect(res.effectiveSp).toBe(7);
    expect(res.penetrating).toBe(9);
    expect(res.hpLoss).toBe(14);
    expect(res.spAfter).toBe(6);
    expect(res.criticalInjuryTable).toBe('body');
  });

  it('does not ablate or deal HP loss when non-critical damage does not penetrate SP: [3,2,1] vs SP 7', () => {
    // rawTotal 6, penetrating 0, hpLoss 0, spAfter 7
    const res = resolveDamage({
      dice: [3, 2, 1],
      location: 'body',
      sp: 7,
    });

    expect(res.rawTotal).toBe(6);
    expect(res.critical).toBe(false);
    expect(res.critBonus).toBe(0);
    expect(res.penetrating).toBe(0);
    expect(res.hpLoss).toBe(0);
    expect(res.spAfter).toBe(7);
    expect(res.criticalInjuryTable).toBeNull();
  });

  it('deals critical bonus even when SP is not penetrated: [6,6,1] vs SP 15 (RULES_CHECK §3, FVTT _applyDamage)', () => {
    // rawTotal 13 <= SP 15 -> penetrating 0, hpLoss 5, spAfter 15
    const res = resolveDamage({
      dice: [6, 6, 1],
      location: 'body',
      sp: 15,
    });

    expect(res.rawTotal).toBe(13);
    expect(res.critical).toBe(true);
    expect(res.critBonus).toBe(5);
    expect(res.penetrating).toBe(0);
    expect(res.hpLoss).toBe(5);
    expect(res.spAfter).toBe(15);
    expect(res.criticalInjuryTable).toBe('body');
  });

  it('triples penetrating damage for headshots with headMultiplier 3 (cracked skull, p.188)', () => {
    const res = resolveDamage({ dice: [5, 4, 2], location: 'head', headMultiplier: 3, sp: 7 });
    expect(res.penetrating).toBe(12);
    expect(res.hpLoss).toBe(12);
  });

  it('doubles penetrating damage for headshots, but does not double critBonus', () => {
    // Headshot without critical: [5,4,2] vs head SP 7
    // rawTotal 11, penetrationRaw 4 * 2 = penetrating 8, hpLoss 8, spAfter 6
    const resNormal = resolveDamage({
      dice: [5, 4, 2],
      location: 'head',
      sp: 7,
    });
    expect(resNormal.penetrating).toBe(8);
    expect(resNormal.hpLoss).toBe(8);
    expect(resNormal.spAfter).toBe(6);
    expect(resNormal.criticalInjuryTable).toBeNull();

    // Headshot with critical: [6,6,3] vs head SP 7
    // rawTotal 15, penetrationRaw 8 * 2 = penetrating 16, critBonus 5, hpLoss 21 (16 + 5), spAfter 6
    const resCrit = resolveDamage({
      dice: [6, 6, 3],
      location: 'head',
      sp: 7,
    });
    expect(resCrit.penetrating).toBe(16);
    expect(resCrit.critBonus).toBe(5);
    expect(resCrit.hpLoss).toBe(21);
    expect(resCrit.spAfter).toBe(6);
    expect(resCrit.criticalInjuryTable).toBe('head');
  });

  it('applies melee armor ignoring percentage: ignoreArmorPercent 50, [5,4] vs SP 7 (RULES_CHECK §3)', () => {
    // effectiveSp = round(7 * 0.5) = 4. rawTotal 9. penetrating 9 - 4 = 5.
    const res = resolveDamage({
      dice: [5, 4],
      location: 'body',
      sp: 7,
      ignoreArmorPercent: 50,
    });

    expect(res.effectiveSp).toBe(4);
    expect(res.penetrating).toBe(5);
    expect(res.hpLoss).toBe(5);
    expect(res.spAfter).toBe(6);
  });

  it('applies autofire multiplier and custom ablation', () => {
    // Autofire multiplier 2 with 2d6 [4,3] -> rawTotal 14 vs SP 10, ablation 2
    const res = resolveDamage({
      dice: [4, 3],
      multiplier: 2,
      location: 'body',
      sp: 10,
      ablation: 2,
    });

    expect(res.rawTotal).toBe(14);
    expect(res.penetrating).toBe(4);
    expect(res.hpLoss).toBe(4);
    expect(res.spAfter).toBe(8);
  });

  it('handles shield HP absorption: non-explosive stops at shield (FVTT _applyDamage, Review 02)', () => {
    // Shield HP 10 vs damage 16: shield breaks (shieldHpAfter 0), but attack stops completely
    const res = resolveDamage({
      dice: [10, 6],
      location: 'body',
      sp: 7,
      shieldHp: 10,
    });

    expect(res.shieldHpAfter).toBe(0);
    expect(res.hpLoss).toBe(0);
    expect(res.penetrating).toBe(0);
    expect(res.spAfter).toBe(7);
    expect(res.criticalInjuryTable).toBeNull();
  });

  it('handles shield HP absorption: explosive stops if shield survives (Issue #14, Review 02)', () => {
    // Shield HP 20 vs damage 16 (explosive): shield HP becomes 4, attack stops
    const res = resolveDamage({
      dice: [10, 6],
      location: 'body',
      sp: 7,
      shieldHp: 20,
      isExplosive: true,
    });

    expect(res.shieldHpAfter).toBe(4);
    expect(res.hpLoss).toBe(0);
    expect(res.penetrating).toBe(0);
    expect(res.spAfter).toBe(7);
    expect(res.criticalInjuryTable).toBeNull();
  });

  it('handles shield HP absorption: explosive breaks shield and full unmitigated damage hits armor (Issue #14, Review 02)', () => {
    // Shield HP 10 vs damage 16 (explosive): shield breaks (shieldHpAfter 0),
    // full unmitigated damage (16) proceeds to body SP 7 -> penetrating 9, hpLoss 9, spAfter 6
    const res = resolveDamage({
      dice: [10, 6],
      location: 'body',
      sp: 7,
      shieldHp: 10,
      isExplosive: true,
    });

    expect(res.shieldHpAfter).toBe(0);
    expect(res.effectiveSp).toBe(7);
    expect(res.penetrating).toBe(9);
    expect(res.hpLoss).toBe(9);
    expect(res.spAfter).toBe(6);
    expect(res.criticalInjuryTable).toBeNull();
  });

  it('handles ignoreBelowSP strictly less than SP boundary (Review 02)', () => {
    // SP === ignoreBelowSP: armor is NOT ignored
    const resEqual = resolveDamage({
      dice: [5, 5],
      location: 'body',
      sp: 4,
      ignoreBelowSP: 4,
    });
    expect(resEqual.effectiveSp).toBe(4);
    expect(resEqual.penetrating).toBe(6); // 10 - 4

    // SP < ignoreBelowSP: armor IS ignored
    const resStrictlyLess = resolveDamage({
      dice: [5, 5],
      location: 'body',
      sp: 3,
      ignoreBelowSP: 4,
    });
    expect(resStrictlyLess.effectiveSp).toBe(0);
    expect(resStrictlyLess.penetrating).toBe(10);
  });

  it('handles non-lethal damage capping hpLoss at currentHp - 1 (Review 02)', () => {
    // currentHp 10, raw damage would deal 15 hpLoss -> capped at 9
    const resCapped = resolveDamage({
      dice: [10, 5],
      location: 'body',
      sp: 0,
      lethal: false,
      currentHp: 10,
    });
    expect(resCapped.hpLoss).toBe(9);

    // currentHp 0 (already down) -> hpLoss is 0
    const resAlreadyDown = resolveDamage({
      dice: [10, 5],
      location: 'body',
      sp: 0,
      lethal: false,
      currentHp: 0,
    });
    expect(resAlreadyDown.hpLoss).toBe(0);

    // currentHp < 0 -> hpLoss is 0
    const resNegative = resolveDamage({
      dice: [10, 5],
      location: 'body',
      sp: 0,
      lethal: false,
      currentHp: -5,
    });
    expect(resNegative.hpLoss).toBe(0);

    // currentHp 20, damage 5 -> hpLoss is 5 (not capped)
    const resNormalNonLethal = resolveDamage({
      dice: [3, 2],
      location: 'body',
      sp: 0,
      lethal: false,
      currentHp: 20,
    });
    expect(resNormalNonLethal.hpLoss).toBe(5);

    // lethal: true (default) -> deals full 15 hpLoss even if currentHp is 10
    const resLethal = resolveDamage({
      dice: [10, 5],
      location: 'body',
      sp: 0,
      lethal: true,
      currentHp: 10,
    });
    expect(resLethal.hpLoss).toBe(15);
  });

  it('looks up critical injury by 2d6 roll (RULES_CHECK §3, SPEC §5.0.1)', () => {
    const injuryTable: CriticalInjuryEntry[] = [
      {
        range: [2, 2],
        name: 'Dismembered Arm',
        summary: '<p>Arm removed.</p>',
        quickFix: { dvFirstAid: 0, dvParamedic: 0, type: 'notApplicable' },
        treatment: { dvParamedic: 0, dvSurgery: 17, type: 'surgery' },
      },
      {
        range: [7, 7],
        name: 'Foreign Object',
        summary: '<p>Foreign object in body.</p>',
        quickFix: { dvFirstAid: 13, dvParamedic: 13, type: 'firstAid' },
        treatment: { dvParamedic: 13, dvSurgery: 13, type: 'paramedic' },
      },
    ];

    expect(lookupCriticalInjury(injuryTable, 2)?.name).toBe('Dismembered Arm');
    expect(lookupCriticalInjury(injuryTable, 7)?.name).toBe('Foreign Object');
    expect(lookupCriticalInjury(injuryTable, 12)).toBeNull();
  });
});
