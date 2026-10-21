import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

interface FVTTSource {
  book?: string;
  page?: number;
}

interface FVTTSkillDoc {
  name?: string;
  system?: {
    stat?: string;
    category?: string;
    basic?: boolean;
    difficulty?: string;
    sources?: FVTTSource[];
  };
}

export interface SkillCatalogEntry {
  key: string;
  name: string;
  name_en: string;
  stat: string;
  category: string;
  basic: boolean;
  difficulty: 'typical' | 'difficult';
  multiplier: number;
  sources: Array<{ book: string; page: number }>;
  provisional: boolean;
}

/**
 * 技能の日本語名。公式の日本語版（無料配布の VA-11 HALL-A・シングルショットパック・カラオケナイト・
 * テイルズ・オブ・ザ・レッド＋・ガンマス）のキャラクターシートで使われている名前に合わせた。
 * OFFICIAL_UNCONFIRMED はそれらに出てこない技能で、コアルールブックで確かめるまでの仮の名前
 */
const NAMES_JA: Record<string, string> = {
  accounting: '経理',
  acting: '演技',
  air_vehicle_tech: '航空ヴィークル技術',
  animal_handling: '動物使い',
  athletics: '運動',
  autofire: 'フルオート射撃',
  basic_tech: '基礎技術',
  brawling: '格闘',
  bribery: '賄賂',
  bureaucracy: '官僚制度',
  business: 'ビジネス',
  composition: '文筆',
  conceal_reveal_object: '隠蔽／発見',
  concentration: '精神集中',
  conversation: '会話術',
  criminology: '犯罪捜査',
  cryptography: '暗号学',
  cybertech: 'サイバー技術',
  dance: '舞踊',
  deduction: '推理',
  drive_land_vehicle: '陸上ヴィークル運転',
  education: '教養',
  electronics_security_tech: '電子／保安技術',
  endurance: '忍耐',
  evasion: '回避',
  first_aid: '応急手当',
  forgery: '偽造',
  gamble: 'ギャンブル',
  handgun: 'ハンドガン',
  heavy_weapons: '重火器',
  human_perception: '真意看破',
  interrogation: '尋問',
  land_vehicle_tech: '陸上ヴィークル技術',
  language_streetslang: '言語：ストリートスラング',
  library_search: 'ライブラリ検索',
  lip_reading: '読唇術',
  local_expert_your_home: '土地鑑：自分の居住地',
  melee_weapon: '近接武器',
  paramedic: '救急医療',
  perception: '知覚',
  personal_grooming: '美容',
  persuasion: '説得',
  photography_film: '撮影',
  pick_lock: '鍵開け',
  pick_pocket: 'スリ',
  pilot_air_vehicle: '航空ヴィークル操縦',
  pilot_sea_vehicle: '海洋ヴィークル操縦',
  resist_torture_drugs: '拷問／薬物抵抗',
  sea_vehicle_tech: '海洋ヴィークル技術',
  shoulder_arms: 'ライフル',
  stealth: '隠密',
  streetwise: '裏社会',
  tactics: '戦術',
  tracking: '追跡',
  trading: '売買',
  wardrobe___style: 'ファッション',
  weaponstech: '武器技術',
  wilderness_survival: '野外生存術',
};

const OFFICIAL_UNCONFIRMED: Record<string, string> = {
  archery: '弓術',
  contortionist: '軟体',
  demolitions: '爆破',
  paint_draw_sculpt: '絵画／彫刻',
  riding: '乗馬',
};

function parseArgs() {
  const args = process.argv.slice(2);
  let srcDir = '';
  let outPath = path.resolve(process.cwd(), 'packages/shared/src/skills-data.ts');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--src' && i + 1 < args.length) {
      srcDir = args[++i];
    } else if (args[i] === '--out' && i + 1 < args.length) {
      outPath = path.resolve(process.cwd(), args[++i]);
    }
  }

  return { srcDir, outPath };
}

export function generateSkillCatalog(fvttRepoPath: string): SkillCatalogEntry[] {
  let skillsDir = path.join(fvttRepoPath, 'src/packs/internal/skills');
  if (!fs.existsSync(skillsDir) && fs.existsSync(fvttRepoPath)) {
    // If user passed direct skills directory
    skillsDir = fvttRepoPath;
  }

  if (!fs.existsSync(skillsDir)) {
    throw new Error(`Skills directory not found at: ${skillsDir}`);
  }

  const files = fs.readdirSync(skillsDir).filter((f) => f.startsWith('skill.') && f.endsWith('.yaml'));
  const entries: SkillCatalogEntry[] = [];

  for (const file of files) {
    const filePath = path.join(skillsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const doc = parse(content) as FVTTSkillDoc;

    const key = file.replace(/^skill\./, '').replace(/\.yaml$/, '');
    const englishName = doc.name ?? key;
    const name = NAMES_JA[key] ?? OFFICIAL_UNCONFIRMED[key] ?? englishName;
    const stat = doc.system?.stat ?? 'int';
    const category = doc.system?.category ?? 'general';
    const basic = Boolean(doc.system?.basic);
    const difficulty = (doc.system?.difficulty === 'difficult' ? 'difficult' : 'typical') as 'typical' | 'difficult';
    const multiplier = difficulty === 'difficult' ? 2 : 1;

    const sources = (doc.system?.sources ?? []).map((s) => ({
      book: s.book ?? 'Cyberpunk RED',
      page: Number(s.page) || 0,
    }));

    entries.push({
      key,
      name,
      name_en: englishName,
      stat,
      category,
      basic,
      difficulty,
      multiplier,
      sources,
      provisional: !NAMES_JA[key],
    });
  }

  entries.sort((a, b) => a.key.localeCompare(b.key));
  return entries;
}

function main() {
  const { srcDir, outPath } = parseArgs();

  if (!srcDir) {
    console.error('Error: --src <FVTT_REPO> is required');
    console.error('Usage: tsx tools/gen-skill-catalog/src/index.ts --src <FVTT_REPO> [--out <out_file>]');
    process.exit(1);
  }

  console.log(`Generating skill catalog from: ${srcDir}`);
  const catalog = generateSkillCatalog(srcDir);
  console.log(`Parsed ${catalog.length} skills.`);

  const fileContent = `/**
 * AUTO-GENERATED FILE — DO NOT EDIT DIRECTLY.
 * Generated by tools/gen-skill-catalog from FVTT Cyberpunk RED Core.
 * Under RTG Homebrew Content Policy: contains minimal mechanical metadata only (no rule text or descriptions).
 */

export interface SkillCatalogEntry {
  key: string;
  name: string;
  name_en: string;
  stat: string;
  category: string;
  basic: boolean;
  difficulty: 'typical' | 'difficult';
  multiplier: number;
  sources: Array<{ book: string; page: number }>;
  provisional: boolean;
}

export const SKILL_CATALOG: Record<string, SkillCatalogEntry> = ${JSON.stringify(
    Object.fromEntries(catalog.map((c) => [c.key, c])),
    null,
    2,
  )};
`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, fileContent, 'utf-8');
  console.log(`Saved skill catalog to: ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
