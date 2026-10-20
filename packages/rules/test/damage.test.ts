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

  it('handles shield HP absorption: shield HP 10 vs damage 16 (RULES_CHECK §3)', () => {
    // Shield absorbs 10, breaks (0 HP left). Remaining 6 hits body SP 0
    const res = resolveDamage({
      dice: [10, 6],
      location: 'body',
      sp: 0,
      shieldHp: 10,
    });

    expect(res.shieldHpAfter).toBe(0);
    expect(res.hpLoss).toBe(6);
  });

  it('explosive damage ignores shields', () => {
    const res = resolveDamage({
      dice: [6, 4],
      location: 'body',
      sp: 4,
      shieldHp: 10,
      isExplosive: true,
    });

    // Shield untouched, full damage hits body
    expect(res.shieldHpAfter).toBe(10);
    expect(res.effectiveSp).toBe(4);
    expect(res.penetrating).toBe(6);
  });

  it('ignores SP when SP <= ignoreBelowSP', () => {
    const res = resolveDamage({
      dice: [5, 5],
      location: 'body',
      sp: 4,
      ignoreBelowSP: 4,
    });

    expect(res.effectiveSp).toBe(0);
    expect(res.penetrating).toBe(10);
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
