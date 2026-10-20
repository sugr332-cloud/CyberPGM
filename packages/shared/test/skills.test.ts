import { describe, it, expect } from 'vitest';
import {
  RTG_DISCLAIMER_EN,
  FVTT_CREDITS_JA,
  UNOFFICIAL_FAN_NOTE_JA,
  SKILL_CATALOG,
  getSkillDef,
  formatSkillName,
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

  it('formats provisional Japanese skill names correctly', () => {
    expect(formatSkillName('handgun')).toBe('拳銃');
    expect(formatSkillName('evasion')).toBe('回避');
    expect(formatSkillName('perception')).toBe('知覚');
    expect(formatSkillName('electronics_security_tech')).toBe('電子工学/セキュリティ');
  });

  it('falls back to English name for non-provisional JA skills', () => {
    expect(formatSkillName('paramedic')).toBe('Paramedic');
    expect(formatSkillName('accounting')).toBe('Accounting');
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
});
