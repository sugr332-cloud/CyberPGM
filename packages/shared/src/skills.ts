import { SKILL_CATALOG, type SkillCatalogEntry } from './skills-data.js';

export * from './skills-data.js';

export const SKILL_CATEGORIES: Record<string, string> = {
  awarenessSkills: '認識',
  bodySkills: '身体',
  controlSkills: '操縦',
  educationSkills: '教育',
  fightingSkills: '戦闘',
  performanceSkills: '演技',
  rangedweaponSkills: '射撃',
  socialSkills: '社会',
  techniqueSkills: '技術',
};

export function formatSkillCategory(category: string): string {
  return SKILL_CATEGORIES[category] || category;
}

/**
 * Looks up skill definition from catalog by key (case-insensitive).
 */
export function getSkillDef(key: string): SkillCatalogEntry | undefined {
  return SKILL_CATALOG[key.toLowerCase()];
}

/**
 * Returns user-facing display name for a skill key.
 * Falls back to the key if not found in catalog.
 */
export function formatSkillName(key: string): string {
  const def = getSkillDef(key);
  return def ? def.name : key;
}
