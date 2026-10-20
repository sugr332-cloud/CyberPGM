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
 * Converts a skill name (English display name, FVTT weapon skill name, Japanese name, or key)
 * to its canonical catalog key (e.g. 'Handgun' -> 'handgun', 'Melee Weapon' -> 'melee_weapon',
 * 'Evasion' -> 'evasion', 'Shoulder Arms' -> 'shoulder_arms').
 */
export function skillNameToKey(nameOrKey?: string | null): string {
  if (!nameOrKey) return '';
  const trimmed = nameOrKey.trim();
  if (!trimmed) return '';

  const lower = trimmed.toLowerCase();

  // 1. Direct match on key in catalog
  if (SKILL_CATALOG[lower]) {
    return SKILL_CATALOG[lower].key;
  }

  // 2. Direct match on catalog entry name (e.g. "Handgun", "Melee Weapon", "Shoulder Arms")
  for (const entry of Object.values(SKILL_CATALOG)) {
    if (entry.name.toLowerCase() === lower) {
      return entry.key;
    }
  }

  // 3. Normalized comparison (remove spaces, underscores, hyphens)
  const stripped = lower.replace(/[\s_-]+/g, '');
  for (const entry of Object.values(SKILL_CATALOG)) {
    if (entry.key.replace(/[\s_-]+/g, '') === stripped) {
      return entry.key;
    }
    if (entry.name.toLowerCase().replace(/[\s_-]+/g, '') === stripped) {
      return entry.key;
    }
  }

  // 4. Known Japanese name mapping
  const JA_SKILL_MAP: Record<string, string> = {
    拳銃: 'handgun',
    ハンドガン: 'handgun',
    肩撃ち銃: 'shoulder_arms',
    ショルダーアームズ: 'shoulder_arms',
    近接武器: 'melee_weapon',
    格闘: 'brawling',
    回避: 'evasion',
    アスレチック: 'athletics',
    運動: 'athletics',
    隠匿: 'stealth',
    隠密: 'stealth',
    知覚: 'perception',
  };
  if (JA_SKILL_MAP[trimmed]) {
    return JA_SKILL_MAP[trimmed];
  }

  // Fallback: lowercase with underscores
  return lower.replace(/[\s-]+/g, '_');
}

/**
 * Returns user-facing display name for a skill key.
 * Falls back to the key if not found in catalog.
 */
export function formatSkillName(key: string): string {
  const def = getSkillDef(key);
  return def ? def.name : key;
}

