import { describe, it, expect } from 'vitest';
import { validateCharacterDraft } from '../src/creation.js';
import { CharacterDraft, CreationMethodConfig } from '@cyberpgm/shared';

describe('validateCharacterDraft', () => {
  const baseDraft: CharacterDraft = {
    name: 'V',
    role: 'Solo',
    stats: {
      int: 6,
      ref: 7,
      dex: 7,
      tech: 4,
      cool: 6,
      will: 6,
      luck: 5,
      move: 6,
      body: 7,
      emp: 6,
    },
    skills: {
      athletics: 2,
      brawling: 2,
      autofire: 4, // x2 skill
      handgun: 3,
    },
    inventory: [
      { name: 'Heavy Pistol', qty: 1, price_eb: 100 },
      { name: 'Heavy Armorjack Body', qty: 1, price_eb: 100 },
    ],
    cyberware: [
      { name: 'Neural Link', static_loss: 7 },
      { name: 'Interface Plugs', static_loss: 7 },
    ],
  };

  it('skips checks when method fields are null', () => {
    const nullMethod: CreationMethodConfig = {
      key: 'complete_package',
      label: '完全版の作成方法（仮）',
      stat_points: null,
      stat_min: null,
      stat_max: null,
      skill_points: null,
      skill_level_max: null,
      basic_skill_min: null,
      difficult_cost: null,
      uses_starting_funds: true,
    };

    const res = validateCharacterDraft(baseDraft, nullMethod, null);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.stats.unconfigured).toBe(true);
    expect(res.skills.unconfigured).toBe(true);
    expect(res.funds.unconfigured).toBe(true);

    // Humanity calculated correctly
    expect(res.humanity.initialEmp).toBe(6);
    // 2 cyberware items with static loss => maxHumanity = 6 * 10 - 2 * 2 = 56
    expect(res.humanity.maxHumanity).toBe(56);
    // current humanity = 60 - 14 = 46
    expect(res.humanity.currentHumanity).toBe(46);
    // current emp = floor(46 / 10) = 4
    expect(res.humanity.currentEmp).toBe(4);
  });

  it('detects violations when limits are configured', () => {
    const strictMethod: CreationMethodConfig = {
      key: 'custom',
      label: '制限付き',
      stat_points: 50, // baseDraft sum is 61
      stat_min: 3,
      stat_max: 6, // ref: 7, dex: 7, body: 7 violate
      skill_points: 10,
      skill_level_max: 3, // autofire: 4 violates
      basic_skill_min: 2, // perception is 0, violates
      difficult_cost: 3, // if custom difficult_cost = 3
      uses_starting_funds: true,
    };

    const res = validateCharacterDraft(baseDraft, strictMethod, 150); // total 200 > 150
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);

    // Checks error messages
    const errText = res.errors.join(' ');
    expect(errText).toContain('能力値ポイントが割り当て上限');
    expect(errText).toContain('上限 (6) を超えています');
    expect(errText).toContain('技能「フルオート射撃」のレベルが上限 (3) を超えています');
    expect(errText).toContain('基本技能「知覚」が最低レベル (2) 未満です');
    expect(errText).toContain('所持品の合計額');
  });

  it('uses FVTT multiplier 2 for difficult skills when difficult_cost is null', () => {
    const method: CreationMethodConfig = {
      key: 'test',
      label: 'テスト',
      stat_points: null,
      stat_min: null,
      stat_max: null,
      skill_points: 12,
      skill_level_max: null,
      basic_skill_min: null,
      difficult_cost: null,
      uses_starting_funds: null,
    };

    // athletics: 2 (x1) = 2
    // brawling: 2 (x1) = 2
    // handgun: 3 (x1) = 3
    // evasion: 4 (x2) = 8
    // total = 2 + 2 + 3 + 8 = 15 > 12
    const res = validateCharacterDraft(baseDraft, method, null);
    expect(res.skills.totalSpent).toBe(15);
    expect(res.errors.join(' ')).toContain('技能ポイントが割り当て上限 (12) を超えています: 15');
  });
});
