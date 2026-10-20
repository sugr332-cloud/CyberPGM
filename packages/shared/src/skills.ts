import { SKILL_CATALOG, type SkillCatalogEntry } from './skills-data.js';

export * from './skills-data.js';

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
