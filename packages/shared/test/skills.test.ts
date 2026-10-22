import { describe, it, expect } from 'vitest';
import {
  RTG_DISCLAIMER_EN,
  FVTT_CREDITS_JA,
  UNOFFICIAL_FAN_NOTE_JA,
  SKILL_CATALOG,
  getSkillDef,
  formatSkillName,
  skillNameToKey,
} from '../src/index.js';

describe('disclaimer constants', () => {
  it('contains expected Homebrew Content Policy and credits text', () => {
    expect(RTG_DISCLAIMER_EN).toContain('CyberPGM is unofficial content provided under the Homebrew Content Policy');
    expect(RTG_DISCLAIMER_EN).not.toContain('used with permission');
    expect(FVTT_CREDITS_JA).toContain('Cyberpunk RED - Core');
    expect(FVTT_CREDITS_JA).toContain('game-icons.net');
    expect(UNOFFICIAL_FAN_NOTE_JA).toContain('本ツールは非公式のファン作成ツールです');
  });
});

describe('skills catalog and formatting', () => {
  it('has 63 skills', () => {
    expect(Object.keys(SKILL_CATALOG).length).toBe(63);
  });

  it('formats skill names with the official Japanese names', () => {
    expect(formatSkillName('handgun')).toBe('ハンドガン');
    expect(formatSkillName('evasion')).toBe('回避');
    expect(formatSkillName('perception')).toBe('知覚');
    expect(formatSkillName('electronics_security_tech')).toBe('電子／保安技術');
    expect(formatSkillName('paramedic')).toBe('救急医療');
    expect(formatSkillName('accounting')).toBe('経理');
  });

  it('has a Japanese name for every catalog skill', () => {
    for (const s of Object.values(SKILL_CATALOG)) expect(s.name).toMatch(/[^\x00-\x7f]/);
  });

  it('falls back to key for unknown skills', () => {
    expect(formatSkillName('unknown_skill')).toBe('unknown_skill');
  });

  it('retrieves skill definition with metadata', () => {
    const autofire = getSkillDef('autofire');
    expect(autofire).toBeDefined();
    expect(autofire?.stat).toBe('ref');
    expect(autofire?.multiplier).toBe(2);
    expect(autofire?.difficulty).toBe('difficult');
    expect(autofire?.sources[0]?.book).toBe('Cyberpunk RED');
  });

  it('converts various skill name formats to canonical catalog key', () => {
    expect(skillNameToKey('Handgun')).toBe('handgun');
    expect(skillNameToKey('handgun')).toBe('handgun');
    expect(skillNameToKey('Evasion')).toBe('evasion');
    expect(skillNameToKey('Melee Weapon')).toBe('melee_weapon');
    expect(skillNameToKey('MeleeWeapon')).toBe('melee_weapon');
    expect(skillNameToKey('melee_weapon')).toBe('melee_weapon');
    expect(skillNameToKey('Shoulder Arms')).toBe('shoulder_arms');
    expect(skillNameToKey('Brawling')).toBe('brawling');
    expect(skillNameToKey('Autofire')).toBe('autofire');
    expect(skillNameToKey('拳銃')).toBe('handgun');
    expect(skillNameToKey('ハンドガン')).toBe('handgun');
    expect(skillNameToKey('ライフル')).toBe('shoulder_arms');
    expect(skillNameToKey('Conceal/Reveal Object')).toBe('conceal_reveal_object');
    expect(skillNameToKey('人間の洞察')).toBe('human_perception');
    expect(skillNameToKey('回避')).toBe('evasion');
    expect(skillNameToKey('近接武器')).toBe('melee_weapon');
  });
});

describe('rankInRange (Phase 5s)', () => {
  it('reads ranges like 3〜4, 9 and 1〜10', async () => {
    const { rankInRange } = await import('../src/roles.js');
    expect(rankInRange('3〜4', 4)).toBe(true);
    expect(rankInRange('3〜4', 5)).toBe(false);
    expect(rankInRange('9', 9)).toBe(true);
    expect(rankInRange('1〜10', 7)).toBe(true);
  });
});
