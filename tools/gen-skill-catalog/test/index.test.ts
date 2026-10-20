import { describe, it, expect } from 'vitest';
import path from 'node:path';
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
    expect(perception?.provisional).toBe(true);
    expect(perception?.basic).toBe(true);

    const autofire = catalog.find((s) => s.key === 'autofire');
    expect(autofire?.name).toBe('オートファイア');
    expect(autofire?.multiplier).toBe(2);
    expect(autofire?.difficulty).toBe('difficult');

    const paramedic = catalog.find((s) => s.key === 'paramedic');
    expect(paramedic?.name).toBe('Paramedic');
    expect(paramedic?.multiplier).toBe(2);
    expect(paramedic?.provisional).toBe(true);
  });
});
