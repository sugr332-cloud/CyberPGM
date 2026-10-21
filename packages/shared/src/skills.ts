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

  // 2. Direct match on catalog entry name — official Japanese (e.g. "ハンドガン") or English (e.g. "Handgun", "Shoulder Arms")
  for (const entry of Object.values(SKILL_CATALOG)) {
    if (entry.name.toLowerCase() === lower || entry.name_en.toLowerCase() === lower) {
      return entry.key;
    }
  }

  // 3. Normalized comparison (remove spaces, underscores, hyphens)
  const stripped = lower.replace(/[\s_-]+/g, '');
  for (const entry of Object.values(SKILL_CATALOG)) {
    if (entry.key.replace(/[\s_-]+/g, '') === stripped) {
      return entry.key;
    }
    if (entry.name_en.toLowerCase().replace(/[\s_-]+/g, '') === stripped) {
      return entry.key;
    }
  }

  // 4. Older / unofficial Japanese names (names used before Phase 5o, and spelling variants in the official books)
  const JA_SKILL_MAP: Record<string, string> = {
    拳銃: 'handgun',
    肩撃ち銃: 'shoulder_arms',
    肩撃ち武器: 'shoulder_arms',
    ショルダーアームズ: 'shoulder_arms',
    アスレチック: 'athletics',
    隠匿: 'stealth',
    集中: 'concentration',
    オートファイア: 'autofire',
    取引: 'trading',
    裏社会の事情通: 'streetwise',
    会話: 'conversation',
    人間の洞察: 'human_perception',
    '電子工学/セキュリティ': 'electronics_security_tech',
    サイバーテック: 'cybertech',
    舞踏: 'dance',
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

