import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { generateSkillCatalog } from '../src/index.js';

describe('generateSkillCatalog', () => {
  it('generates catalog if fvtt repo exists', () => {
    // Check if FVTT repo is available in known test path or skip
    const candidatePath = '/var/home/hankyuu1/orca/projects/fvtt-cyberpunk-red-core';
    if (!fs.existsSync(candidatePath)) {
      return;
    }

    const catalog = generateSkillCatalog(candidatePath);
    expect(catalog.length).toBeGreaterThan(50);

    const perception = catalog.find((s) => s.key === 'perception');
    expect(perception).toBeDefined();
    expect(perception?.name).toBe('知覚');
    expect(perception?.stat).toBe('int');
    expect(perception?.provisional).toBe(false);
    expect(perception?.basic).toBe(true);

    const autofire = catalog.find((s) => s.key === 'autofire');
    expect(autofire?.name).toBe('フルオート射撃');
    expect(autofire?.name_en).toBe('Autofire');
    expect(autofire?.multiplier).toBe(2);
    expect(autofire?.difficulty).toBe('difficult');

    const paramedic = catalog.find((s) => s.key === 'paramedic');
    expect(paramedic?.name).toBe('救急医療');
    expect(paramedic?.multiplier).toBe(2);
    expect(paramedic?.provisional).toBe(false);

    // 公式の日本語版に出てこない技能は仮の名前のまま
    expect(catalog.find((s) => s.key === 'riding')?.provisional).toBe(true);
    expect(catalog.every((s) => /[^\x00-\x7f]/.test(s.name))).toBe(true);
  });
});
