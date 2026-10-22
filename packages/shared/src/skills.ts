import { SKILL_CATALOG as GENERATED_SKILL_CATALOG, type SkillCatalogEntry } from './skills-data.js';

export * from './skills-data.js';

/**
 * 種類を選んで取る技能（Phase 5u。日本語版 p.132〜139）。元にした FVTT の技能データにはないので、ここで足す。
 * 技能のキーは「基本キー:種類」（例: science:化学、martial_arts:空手、language:日本語）。種類を書かない基本キーも使える
 */
export interface SpecializedSkillEntry extends SkillCatalogEntry {
  /** 種類の呼び方（流派・楽器・分野・言語・地域） */
  specLabel: string;
  /** 選べる種類が決まっているもの（武術の流派） */
  specialties?: string[];
}

const RULEBOOK = 'Cyberpunk RED（日本語版）';
export const SPECIALIZED_SKILLS: Record<string, SpecializedSkillEntry> = {
  martial_arts: {
    key: 'martial_arts',
    name: '武術',
    name_en: 'Martial Arts',
    stat: 'dex',
    category: 'fightingSkills',
    basic: false,
    difficulty: 'difficult',
    multiplier: 2,
    sources: [{ book: RULEBOOK, page: 138 }],
    provisional: false,
    specLabel: '流派',
    specialties: ['合気道', '空手', '柔道', 'テコンドー'],
  },
  play_instrument: {
    key: 'play_instrument',
    name: '演奏',
    name_en: 'Play Instrument',
    stat: 'tech',
    category: 'performanceSkills',
    basic: false,
    difficulty: 'typical',
    multiplier: 1,
    sources: [{ book: RULEBOOK, page: 139 }],
    provisional: false,
    specLabel: '楽器',
  },
  science: {
    key: 'science',
    name: '科学',
    name_en: 'Science',
    stat: 'int',
    category: 'educationSkills',
    basic: false,
    difficulty: 'typical',
    multiplier: 1,
    sources: [{ book: RULEBOOK, page: 132 }],
    provisional: false,
    specLabel: '分野',
  },
  language: {
    key: 'language',
    name: '言語',
    name_en: 'Language',
    stat: 'int',
    category: 'educationSkills',
    basic: false,
    difficulty: 'typical',
    multiplier: 1,
    sources: [{ book: RULEBOOK, page: 133 }],
    provisional: false,
    specLabel: '言語',
  },
  local_expert: {
    key: 'local_expert',
    name: '土地鑑',
    name_en: 'Local Expert',
    stat: 'int',
    category: 'educationSkills',
    basic: false,
    difficulty: 'typical',
    multiplier: 1,
    sources: [{ book: RULEBOOK, page: 133 }],
    provisional: false,
    specLabel: '地域',
  },
};

/**
 * メドテクだけが《メディシン》で得る技能（Phase 5w。日本語版 p.149）。〈外科手術〉は 1 ポイントで 2 レベル、〈医療技術〉は薬品とクリオシステム操作のポイントの合計
 */
export const MEDTECH_SKILLS: Record<string, SkillCatalogEntry> = {
  surgery: { key: 'surgery', name: '外科手術', name_en: 'Surgery', stat: 'tech', category: 'techniqueSkills', basic: false, difficulty: 'typical', multiplier: 1, sources: [{ book: RULEBOOK, page: 149 }], provisional: false },
  medical_tech: { key: 'medical_tech', name: '医療技術', name_en: 'Medical Tech', stat: 'tech', category: 'techniqueSkills', basic: false, difficulty: 'typical', multiplier: 1, sources: [{ book: RULEBOOK, page: 149 }], provisional: false },
};

/** 技能の一覧（FVTT 由来の 63 技能 ＋ 種類を選ぶ 5 技能 ＋ メドテクの 2 技能） */
export const SKILL_CATALOG: Record<string, SkillCatalogEntry> = { ...GENERATED_SKILL_CATALOG, ...SPECIALIZED_SKILLS, ...MEDTECH_SKILLS };

/** 「科学:化学」のようなキーを基本キーと種類に分ける */
export function splitSkillKey(key: string): { base: string; spec: string | null } {
  const i = key.indexOf(':');
  return i < 0 ? { base: key, spec: null } : { base: key.slice(0, i), spec: key.slice(i + 1).trim() || null };
}

/** 種類つきの技能キーを作る（例: science + 化学 → science:化学） */
export function specializedSkillKey(base: string, spec: string): string {
  return `${base}:${spec.trim()}`;
}

// 技能の系統（日本語版コアルールブック p.131〜141 の表記）
export const SKILL_CATEGORIES: Record<string, string> = {
  awarenessSkills: '感知系',
  bodySkills: '動作系',
  controlSkills: '操作系',
  educationSkills: '学術系',
  fightingSkills: '近接戦闘系',
  performanceSkills: '芸能系',
  rangedweaponSkills: '遠隔戦闘系',
  socialSkills: '社交系',
  techniqueSkills: '技術系',
};

export function formatSkillCategory(category: string): string {
  return SKILL_CATEGORIES[category] || category;
}

/**
 * Looks up skill definition from catalog by key (case-insensitive).
 */
export function getSkillDef(key: string): SkillCatalogEntry | undefined {
  const { base, spec } = splitSkillKey(key);
  const def = SKILL_CATALOG[base.toLowerCase()];
  if (!def || !spec) return def;
  // 種類つき: 名前に種類を付ける（例: 科学：化学）
  return { ...def, key, name: `${def.name}：${spec}` };
}

/**
 * Converts a skill name (English display name, FVTT weapon skill name, Japanese name, or key)
 * to its canonical catalog key (e.g. 'Handgun' -> 'handgun', 'Melee Weapon' -> 'melee_weapon',
 * 'Evasion' -> 'evasion', 'Shoulder Arms' -> 'shoulder_arms').
 */
// 種類つきの名前のうち、元の一覧にある決まった技能（ストリートスラング・自分の居住地）
function JA_ALIAS_HIT(name: string): boolean {
  return name === '土地鑑：自分の居住地';
}

function GENERATED_NAME_HIT(name: string): boolean {
  return Object.values(GENERATED_SKILL_CATALOG).some((e) => e.name === name);
}

export function skillNameToKey(nameOrKey?: string | null): string {
  if (!nameOrKey) return '';
  // 本の表記どおり〈〉で囲まれていても読む
  const trimmed = nameOrKey.trim().replace(/^〈|〉$/g, '');
  if (!trimmed) return '';

  const lower = trimmed.toLowerCase();

  // 0. 種類つき（「science:化学」や「科学：化学」「〈演奏：ギター〉」）
  const bare = trimmed;
  const colon = bare.search(/[:：]/);
  if (colon > 0 && !GENERATED_NAME_HIT(bare) && !JA_ALIAS_HIT(bare)) {
    const head = bare.slice(0, colon);
    const spec = bare.slice(colon + 1).replace(/^[（(]|[）)]$/g, '').trim();
    const baseKey = Object.values(SPECIALIZED_SKILLS).find((s) => s.key === head.toLowerCase() || s.name === head || s.name_en.toLowerCase() === head.toLowerCase())?.key;
    if (baseKey && spec && !/選択|1種類/.test(spec)) return specializedSkillKey(baseKey, spec);
    if (baseKey) return baseKey;
  }

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
    軟体: 'contortionist',
    爆破: 'demolitions',
    乗馬: 'riding',
    '土地鑑：自分の居住地': 'local_expert_your_home',
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

