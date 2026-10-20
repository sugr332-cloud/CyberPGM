import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'yaml';
import Database from 'better-sqlite3';
import { ulid, calcPriceCategory, DEFAULT_PRICE_CATEGORIES, PriceCategoryDef } from '@cyberpgm/shared';

export interface ImportOptions {
  srcDir: string;
  dbPath: string;
  dryRun?: boolean;
  quiet?: boolean;
}

export interface CreditEntry {
  pattern: RegExp;
  attribution: string;
  license: string;
}

export interface ImportReportData {
  started_at: string;
  finished_at: string;
  counts_by_kind: Record<string, { added: number; updated: number; unchanged: number }>;
  total: { added: number; updated: number; unchanged: number };
  missing_name_ja: { id: string; fvtt_id: string; name_en: string; kind: string }[];
  missing_price: { id: string; fvtt_id: string; name_en: string; kind: string }[];
  missing_sources: { id: string; fvtt_id: string; name_en: string; kind: string }[];
  missing_images: { id: string; fvtt_id: string; name_en: string; img_path: string }[];
  missing_in_fvtt: { id: string; fvtt_id: string; name_en: string; kind: string }[];
}

interface FvttTableResult {
  range: [number, number];
  description?: string;
  name?: string;
  documentUuid?: string;
}

interface FvttItemDoc {
  _id: string;
  name: string;
  type?: string;
  img?: string | null;
  system?: {
    description?: { value?: string };
    price?: { market?: number };
    sources?: Array<{ book?: string; page?: number }>;
    weaponType?: string;
    weaponSkill?: string;
    damage?: string;
    rof?: number;
    magazine?: { max?: number; value?: number };
    handsReq?: number;
    concealable?: { concealable?: boolean; isConcealed?: boolean };
    quality?: string;
    fireModes?: { autoFire?: number; suppressiveFire?: boolean };
    critFailEffect?: string;
    dvTable?: string;
    ammoVariety?: string[];
    isRanged?: boolean;
    headLocation?: { sp?: number };
    bodyLocation?: { sp?: number };
    isHeadLocation?: boolean;
    isBodyLocation?: boolean;
    isShield?: boolean;
    shieldHitPoints?: { max?: number; value?: number };
    penalty?: number;
    type?: string;
    installLocation?: string;
    humanityLoss?: { roll?: string; static?: number };
    core?: boolean;
    size?: number;
    quickFix?: unknown;
    treatment?: unknown;
    [key: string]: unknown;
  };
}

interface ExistingItemRow {
  id: string;
  kind: string;
  name_en: string;
  name_ja: string | null;
  name_ja_override: string | null;
  summary_ja: string | null;
  description_en: string | null;
  price_eb: number | null;
  price_category: string | null;
  source_book: string | null;
  source_page_en: number | null;
  source_page_ja: number | null;
  origin: string;
  verify_status: string;
  fvtt_id: string | null;
  fvtt_type: string | null;
  raw_system: string | null;
  tags: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export function parseCredits(creditsContent: string): CreditEntry[] {
  const entries: CreditEntry[] = [];
  const lines = creditsContent.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^-\s*`([^`]+)`\s*(.+)$/);
    if (match) {
      const rawPattern = match[1].replace(/\\/g, '/');
      const text = match[2];

      const escaped = rawPattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      const reg = new RegExp(`^${escaped}$`, 'i');

      let license = 'CC-BY 3.0';
      if (/public domain/i.test(text)) {
        license = 'Public Domain';
      }

      entries.push({
        pattern: reg,
        attribution: text,
        license,
      });
    }
  }

  return entries;
}

export function findAttribution(
  relIconPath: string,
  creditEntries: CreditEntry[],
): { attribution: string; license: string } {
  const normalized = relIconPath.replace(/\\/g, '/');
  for (const entry of creditEntries) {
    if (entry.pattern.test(normalized)) {
      return { attribution: entry.attribution, license: entry.license };
    }
  }
  return { attribution: 'see CREDITS.md', license: 'CC-BY 3.0' };
}

export function loadBabeleTranslations(fvttRepoPath: string): Map<string, string> {
  const nameMap = new Map<string, string>();
  const babeleDir = path.join(fvttRepoPath, 'src/babele/ja-JP');

  if (!fs.existsSync(babeleDir)) {
    return nameMap;
  }

  const files = fs.readdirSync(babeleDir);
  for (const file of files) {
    if (file.endsWith('.json')) {
      try {
        const content = fs.readFileSync(path.join(babeleDir, file), 'utf-8');
        const data = JSON.parse(content) as { entries?: Record<string, { name?: string }> };
        if (data.entries && typeof data.entries === 'object') {
          for (const [key, val] of Object.entries(data.entries)) {
            if (val && typeof val.name === 'string') {
              nameMap.set(key, val.name);
            }
          }
        }
      } catch (err) {
        console.warn(`Failed to parse Babele file ${file}:`, err);
      }
    }
  }

  return nameMap;
}

export function getFvttRepoCommit(fvttRepoPath: string): string | null {
  try {
    const headFile = path.join(fvttRepoPath, '.git/HEAD');
    if (!fs.existsSync(headFile)) return null;
    const headContent = fs.readFileSync(headFile, 'utf-8').trim();
    if (headContent.startsWith('ref: ')) {
      const refPath = path.join(fvttRepoPath, '.git', headContent.substring(5));
      if (fs.existsSync(refPath)) {
        return fs.readFileSync(refPath, 'utf-8').trim();
      }
    } else {
      return headContent;
    }
  } catch {
    // ignore git read failure
  }
  return null;
}

export function mapFvttTypeToKind(fvttType: string | undefined): string {
  switch (fvttType) {
    case 'weapon':
      return 'weapon';
    case 'armor':
      return 'armor';
    case 'cyberware':
      return 'cyberware';
    case 'cyberdeck':
      return 'cyberdeck';
    case 'gear':
      return 'gear';
    case 'clothing':
      return 'clothing';
    case 'ammo':
      return 'ammo';
    case 'itemUpgrade':
      return 'upgrade';
    case 'program':
      return 'program';
    case 'vehicle':
      return 'vehicle';
    case 'drug':
      return 'drug';
    default:
      return 'gear';
  }
}

export function runImport(options: ImportOptions): ImportReportData {
  const startedAt = new Date();
  const { srcDir, dbPath, dryRun = false } = options;

  if (!fs.existsSync(srcDir)) {
    throw new Error(`FVTT repository source directory not found: ${srcDir}`);
  }

  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const gitCommit = getFvttRepoCommit(srcDir);

  let creditEntries: CreditEntry[] = [];
  const creditsPath = path.join(srcDir, 'CREDITS.md');
  if (fs.existsSync(creditsPath)) {
    creditEntries = parseCredits(fs.readFileSync(creditsPath, 'utf-8'));
  }

  const babeleMap = loadBabeleTranslations(srcDir);

  const report: ImportReportData = {
    started_at: startedAt.toISOString(),
    finished_at: '',
    counts_by_kind: {},
    total: { added: 0, updated: 0, unchanged: 0 },
    missing_name_ja: [],
    missing_price: [],
    missing_sources: [],
    missing_images: [],
    missing_in_fvtt: [],
  };

  const imagesTargetDir = path.resolve(process.cwd(), 'data/images');

  const tx = sqlite.transaction(() => {
    // 1. Initialize price_category in rule_constants if not exists
    const existingPriceCategory = sqlite
      .prepare('SELECT key FROM rule_constants WHERE key = ?')
      .get('price_category');
    if (!existingPriceCategory) {
      sqlite
        .prepare('INSERT INTO rule_constants (key, value, note) VALUES (?, ?, ?)')
        .run('price_category', JSON.stringify(DEFAULT_PRICE_CATEGORIES), 'Default price category ranges');
    }

    const priceCatRow = sqlite
      .prepare('SELECT value FROM rule_constants WHERE key = ?')
      .get('price_category') as { value: string } | undefined;
    let priceCategories: PriceCategoryDef[] = DEFAULT_PRICE_CATEGORIES;
    if (priceCatRow) {
      try {
        priceCategories = JSON.parse(priceCatRow.value);
      } catch {
        priceCategories = DEFAULT_PRICE_CATEGORIES;
      }
    }

    // 2. Load DV Tables
    const dvTablesDir = path.join(srcDir, 'src/packs/internal/dv-tables');
    if (fs.existsSync(dvTablesDir)) {
      const files = fs.readdirSync(dvTablesDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dvTablesDir, file), 'utf-8');
          const doc = yaml.parse(content) as { name?: string; description?: string; results?: FvttTableResult[] };
          if (doc && doc.name && doc.results) {
            const dvEntries = doc.results.map((r) => ({
              range: r.range,
              dv: Number(r.description) || r.description,
            }));
            const key = `dv_table.${doc.name}`;
            const existing = sqlite.prepare('SELECT key FROM rule_constants WHERE key = ?').get(key);
            if (!existing) {
              sqlite
                .prepare('INSERT INTO rule_constants (key, value, note) VALUES (?, ?, ?)')
                .run(key, JSON.stringify(dvEntries), doc.description || null);
            } else {
              sqlite
                .prepare('UPDATE rule_constants SET value = ?, note = ? WHERE key = ?')
                .run(JSON.stringify(dvEntries), doc.description || null, key);
            }
          }
        } catch (err) {
          console.warn(`Failed to process DV table ${file}:`, err);
        }
      }
    }

    // 3. Load Critical Injury Tables
    const critTableDir = path.join(srcDir, 'src/packs/internal/critical-injury-tables');
    const loadCritInjuriesForLocation = (tableName: string, locKey: 'head' | 'body', packSubdir: string) => {
      const tableFile = path.join(critTableDir, tableName);
      if (!fs.existsSync(tableFile)) return;

      const itemsDir = path.join(srcDir, `src/packs/core/${packSubdir}`);
      const itemMap = new Map<string, FvttItemDoc>();
      if (fs.existsSync(itemsDir)) {
        for (const itemFile of fs.readdirSync(itemsDir)) {
          if (itemFile.endsWith('.yaml') || itemFile.endsWith('.yml')) {
            try {
              const itemDoc = yaml.parse(fs.readFileSync(path.join(itemsDir, itemFile), 'utf-8')) as FvttItemDoc;
              if (itemDoc && itemDoc._id) {
                itemMap.set(itemDoc._id, itemDoc);
              }
            } catch {
              // ignore
            }
          }
        }
      }

      try {
        const tableDoc = yaml.parse(fs.readFileSync(tableFile, 'utf-8')) as { results?: FvttTableResult[] };
        if (tableDoc && tableDoc.results) {
          const list: Array<{
            range: [number, number];
            name?: string;
            summary: string;
            quickFix: unknown;
            treatment: unknown;
            sources: unknown;
          }> = [];
          for (const res of tableDoc.results) {
            const docIdMatch = res.documentUuid?.match(/Item\.([A-Za-z0-9]+)$/);
            const itemId = docIdMatch ? docIdMatch[1] : null;
            const itemData = itemId ? itemMap.get(itemId) : null;

            list.push({
              range: res.range,
              name: res.name,
              summary: itemData?.system?.description?.value ?? '',
              quickFix: itemData?.system?.quickFix ?? null,
              treatment: itemData?.system?.treatment ?? null,
              sources: itemData?.system?.sources ?? null,
            });
          }

          const constKey = `critical_injury.${locKey}`;
          const existing = sqlite.prepare('SELECT key FROM rule_constants WHERE key = ?').get(constKey);
          if (!existing) {
            sqlite
              .prepare('INSERT INTO rule_constants (key, value, note) VALUES (?, ?, ?)')
              .run(constKey, JSON.stringify(list), `Critical injuries table for ${locKey}`);
          } else {
            sqlite
              .prepare('UPDATE rule_constants SET value = ?, note = ? WHERE key = ?')
              .run(JSON.stringify(list), `Critical injuries table for ${locKey}`, constKey);
          }
        }
      } catch (err) {
        console.warn(`Failed to process critical injury table ${tableName}:`, err);
      }
    };

    loadCritInjuriesForLocation('table.critical_injuries_head.yaml', 'head', 'critical-injuries-head');
    loadCritInjuriesForLocation('table.critical_injuries_body.yaml', 'body', 'critical-injuries-body');

    // 4. Load Core Items
    const packDirs = [
      'weapons',
      'armor',
      'cyberware',
      'gear',
      'clothing',
      'ammo',
      'upgrades',
      'programs',
      'vehicles',
      'drugs',
    ];

    const fvttIdsInFiles = new Set<string>();

    for (const packDir of packDirs) {
      const fullPackDir = path.join(srcDir, 'src/packs/core', packDir);
      if (!fs.existsSync(fullPackDir)) continue;

      const files = fs.readdirSync(fullPackDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

      for (const file of files) {
        const filePath = path.join(fullPackDir, file);
        let doc: FvttItemDoc | null = null;
        try {
          doc = yaml.parse(fs.readFileSync(filePath, 'utf-8')) as FvttItemDoc;
        } catch (err) {
          console.warn(`Failed to parse YAML file ${filePath}:`, err);
          continue;
        }

        if (!doc || !doc._id || !doc.name) {
          continue;
        }

        const fvttId = String(doc._id);
        fvttIdsInFiles.add(fvttId);

        const fvttType = doc.type;
        const kind = mapFvttTypeToKind(fvttType);

        if (!report.counts_by_kind[kind]) {
          report.counts_by_kind[kind] = { added: 0, updated: 0, unchanged: 0 };
        }

        const nameEn = String(doc.name);
        const nameJa = babeleMap.get(nameEn) || null;
        const descriptionEn = doc.system?.description?.value || null;
        const priceEb =
          typeof doc.system?.price?.market === 'number'
            ? doc.system.price.market
            : null;
        const priceCategory = calcPriceCategory(priceEb, priceCategories);
        const sourceBook = doc.system?.sources?.[0]?.book || null;
        const sourcePageEn =
          typeof doc.system?.sources?.[0]?.page === 'number'
            ? doc.system.sources[0].page
            : null;
        const rawSystem = doc.system ? JSON.stringify(doc.system) : null;
        const now = Date.now();

        if (!nameJa) {
          report.missing_name_ja.push({ id: '', fvtt_id: fvttId, name_en: nameEn, kind });
        }
        if (priceEb === null || priceEb === 0) {
          report.missing_price.push({ id: '', fvtt_id: fvttId, name_en: nameEn, kind });
        }
        if (!sourceBook && !sourcePageEn) {
          report.missing_sources.push({ id: '', fvtt_id: fvttId, name_en: nameEn, kind });
        }

        let imgRelPath: string | null = null;
        let imgCredit = { attribution: 'see CREDITS.md', license: 'CC-BY 3.0' };
        if (doc.img && typeof doc.img === 'string') {
          const srcImgPath = doc.img.replace(/^systems\/cyberpunk-red-core\//, 'src/');
          const fullSrcImgPath = path.join(srcDir, srcImgPath);

          if (fs.existsSync(fullSrcImgPath)) {
            const subPath = srcImgPath.replace(/^src\/icons\//, '');
            imgRelPath = path.join('fvtt', subPath);
            const fullTargetImgPath = path.join(imagesTargetDir, imgRelPath);

            imgCredit = findAttribution(srcImgPath, creditEntries);

            if (!dryRun) {
              const targetDir = path.dirname(fullTargetImgPath);
              if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
              }
              fs.copyFileSync(fullSrcImgPath, fullTargetImgPath);
            }
          } else {
            report.missing_images.push({
              id: '',
              fvtt_id: fvttId,
              name_en: nameEn,
              img_path: doc.img,
            });
          }
        }

        const existingItem = sqlite
          .prepare('SELECT * FROM items WHERE fvtt_id = ?')
          .get(fvttId) as ExistingItemRow | undefined;

        let itemId: string;

        if (!existingItem) {
          itemId = ulid();
          if (!dryRun) {
            sqlite
              .prepare(
                `INSERT INTO items (
                  id, kind, name_en, name_ja, name_ja_override, summary_ja, description_en,
                  price_eb, price_category, source_book, source_page_en, source_page_ja,
                  origin, verify_status, fvtt_id, fvtt_type, raw_system, tags, notes,
                  created_at, updated_at
                ) VALUES (
                  ?, ?, ?, ?, NULL, NULL, ?,
                  ?, ?, ?, ?, NULL,
                  'fvtt', 'unofficial', ?, ?, ?, '[]', NULL,
                  ?, ?
                )`,
              )
              .run(
                itemId,
                kind,
                nameEn,
                nameJa,
                descriptionEn,
                priceEb,
                priceCategory,
                sourceBook,
                sourcePageEn,
                fvttId,
                fvttType,
                rawSystem,
                now,
                now,
              );

            insertOrUpdateSubtables(sqlite, itemId, kind, doc);

            if (imgRelPath) {
              const imageId = ulid();
              sqlite
                .prepare(
                  `INSERT INTO images (
                    id, item_id, path, origin, license, attribution, source_book, source_page, visibility, is_primary
                  ) VALUES (?, ?, ?, 'fvtt_icon', ?, ?, ?, ?, 'gm', 1)`,
                )
                .run(
                  imageId,
                  itemId,
                  imgRelPath,
                  imgCredit.license,
                  imgCredit.attribution,
                  sourceBook,
                  sourcePageEn,
                );
            }
          }

          report.counts_by_kind[kind].added++;
          report.total.added++;
        } else {
          itemId = existingItem.id;

          const isDiff =
            existingItem.name_en !== nameEn ||
            existingItem.name_ja !== nameJa ||
            existingItem.description_en !== descriptionEn ||
            existingItem.price_eb !== priceEb ||
            existingItem.price_category !== priceCategory ||
            existingItem.source_book !== sourceBook ||
            existingItem.source_page_en !== sourcePageEn ||
            existingItem.raw_system !== rawSystem;

          if (isDiff) {
            if (!dryRun) {
              sqlite
                .prepare(
                  `UPDATE items SET
                    kind = ?, name_en = ?, name_ja = ?, description_en = ?,
                    price_eb = ?, price_category = ?, source_book = ?, source_page_en = ?,
                    fvtt_type = ?, raw_system = ?, updated_at = ?
                  WHERE id = ?`,
                )
                .run(
                  kind,
                  nameEn,
                  nameJa,
                  descriptionEn,
                  priceEb,
                  priceCategory,
                  sourceBook,
                  sourcePageEn,
                  fvttType,
                  rawSystem,
                  now,
                  itemId,
                );

              insertOrUpdateSubtables(sqlite, itemId, kind, doc);

              if (imgRelPath) {
                const existingImg = sqlite
                  .prepare(
                    `SELECT id FROM images WHERE item_id = ? AND origin = 'fvtt_icon'`,
                  )
                  .get(itemId) as { id: string } | undefined;
                if (!existingImg) {
                  const imageId = ulid();
                  sqlite
                    .prepare(
                      `INSERT INTO images (
                        id, item_id, path, origin, license, attribution, source_book, source_page, visibility, is_primary
                      ) VALUES (?, ?, ?, 'fvtt_icon', ?, ?, ?, ?, 'gm', 1)`,
                    )
                    .run(
                      imageId,
                      itemId,
                      imgRelPath,
                      imgCredit.license,
                      imgCredit.attribution,
                      sourceBook,
                      sourcePageEn,
                    );
                } else {
                  sqlite
                    .prepare(
                      `UPDATE images SET path = ?, license = ?, attribution = ?, source_book = ?, source_page = ? WHERE id = ?`,
                    )
                    .run(
                      imgRelPath,
                      imgCredit.license,
                      imgCredit.attribution,
                      sourceBook,
                      sourcePageEn,
                      existingImg.id,
                    );
                }
              }
            }

            report.counts_by_kind[kind].updated++;
            report.total.updated++;
          } else {
            report.counts_by_kind[kind].unchanged++;
            report.total.unchanged++;
          }
        }
      }
    }

    // 5. Find items in DB from origin='fvtt' that are missing in FVTT files
    const allDbFvttItems = sqlite
      .prepare(`SELECT id, fvtt_id, name_en, kind FROM items WHERE origin = 'fvtt'`)
      .all() as Array<{ id: string; fvtt_id: string; name_en: string; kind: string }>;

    for (const dbItem of allDbFvttItems) {
      if (dbItem.fvtt_id && !fvttIdsInFiles.has(dbItem.fvtt_id)) {
        report.missing_in_fvtt.push({
          id: dbItem.id,
          fvtt_id: dbItem.fvtt_id,
          name_en: dbItem.name_en,
          kind: dbItem.kind,
        });
      }
    }

    if (dryRun) {
      throw new RollbackError();
    }
  });

  try {
    tx();
  } catch (err) {
    if (!(err instanceof RollbackError)) {
      throw err;
    }
  }

  const finishedAt = new Date();
  report.finished_at = finishedAt.toISOString();

  const timestampStr = finishedAt.toISOString().replace(/[:.]/g, '-');
  const reportDir = path.resolve(process.cwd(), 'data/import-reports');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  const reportFilePath = path.join(reportDir, `fvtt-${timestampStr}.json`);
  fs.writeFileSync(reportFilePath, JSON.stringify(report, null, 2), 'utf-8');

  if (!dryRun) {
    try {
      const runId = ulid();
      sqlite
        .prepare(
          `INSERT INTO import_runs (id, source, source_commit, started_at, finished_at, report)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          'fvtt-cyberpunk-red-core',
          gitCommit,
          startedAt.getTime(),
          finishedAt.getTime(),
          JSON.stringify(report),
        );
    } catch (err) {
      console.warn('Failed to record import_run to DB:', err);
    }
  }

  sqlite.close();

  return report;
}

class RollbackError extends Error {
  constructor() {
    super('Rollback transaction for dry run');
  }
}

function insertOrUpdateSubtables(
  sqlite: Database.Database,
  itemId: string,
  kind: string,
  doc: FvttItemDoc,
) {
  const sys = doc.system || {};

  if (kind === 'weapon') {
    const weaponType = sys.weaponType || null;
    const skill = sys.weaponSkill || null;
    const damage = sys.damage || null;
    const rof = typeof sys.rof === 'number' ? sys.rof : null;
    const magazineMax = typeof sys.magazine?.max === 'number' ? sys.magazine.max : null;
    const hands = typeof sys.handsReq === 'number' ? sys.handsReq : null;
    const concealable = sys.concealable?.concealable ? 1 : 0;
    const quality = sys.quality || null;
    const autofire = typeof sys.fireModes?.autoFire === 'number' ? sys.fireModes.autoFire : null;
    const critFailEffect = sys.critFailEffect || null;
    const dvTableKey = sys.dvTable || null;
    const ammoTypes = Array.isArray(sys.ammoVariety) ? JSON.stringify(sys.ammoVariety) : null;
    const isRanged = sys.isRanged ? 1 : 0;

    const existing = sqlite.prepare('SELECT item_id FROM weapons WHERE item_id = ?').get(itemId);
    if (!existing) {
      sqlite
        .prepare(
          `INSERT INTO weapons (
            item_id, weapon_type, skill, damage, rof, magazine_max, hands,
            concealable, quality, autofire, crit_fail_effect, dv_table_key, ammo_types, is_ranged
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          itemId,
          weaponType,
          skill,
          damage,
          rof,
          magazineMax,
          hands,
          concealable,
          quality,
          autofire,
          critFailEffect,
          dvTableKey,
          ammoTypes,
          isRanged,
        );
    } else {
      sqlite
        .prepare(
          `UPDATE weapons SET
            weapon_type = ?, skill = ?, damage = ?, rof = ?, magazine_max = ?, hands = ?,
            concealable = ?, quality = ?, autofire = ?, crit_fail_effect = ?, dv_table_key = ?, ammo_types = ?, is_ranged = ?
          WHERE item_id = ?`,
        )
        .run(
          weaponType,
          skill,
          damage,
          rof,
          magazineMax,
          hands,
          concealable,
          quality,
          autofire,
          critFailEffect,
          dvTableKey,
          ammoTypes,
          isRanged,
          itemId,
        );
    }
  } else if (kind === 'armor') {
    const spHead = typeof sys.headLocation?.sp === 'number' ? sys.headLocation.sp : null;
    const spBody = typeof sys.bodyLocation?.sp === 'number' ? sys.bodyLocation.sp : null;
    const isHead = sys.isHeadLocation ? 1 : 0;
    const isBody = sys.isBodyLocation ? 1 : 0;
    const isShield = sys.isShield ? 1 : 0;
    const shieldHp = typeof sys.shieldHitPoints?.max === 'number' ? sys.shieldHitPoints.max : null;
    const penalty = typeof sys.penalty === 'number' ? sys.penalty : null;

    const existing = sqlite.prepare('SELECT item_id FROM armors WHERE item_id = ?').get(itemId);
    if (!existing) {
      sqlite
        .prepare(
          `INSERT INTO armors (
            item_id, sp_head, sp_body, is_head, is_body, is_shield, shield_hp, penalty
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(itemId, spHead, spBody, isHead, isBody, isShield, shieldHp, penalty);
    } else {
      sqlite
        .prepare(
          `UPDATE armors SET
            sp_head = ?, sp_body = ?, is_head = ?, is_body = ?, is_shield = ?, shield_hp = ?, penalty = ?
          WHERE item_id = ?`,
        )
        .run(spHead, spBody, isHead, isBody, isShield, shieldHp, penalty, itemId);
    }
  } else if (kind === 'cyberware') {
    const cwType = sys.type || null;
    const installLocation = sys.installLocation || null;
    const humanityLossRoll = sys.humanityLoss?.roll || null;
    const humanityLossStatic =
      typeof sys.humanityLoss?.static === 'number' ? sys.humanityLoss.static : null;
    const isCore = sys.core ? 1 : 0;
    const slotSize = typeof sys.size === 'number' ? sys.size : null;

    const existing = sqlite.prepare('SELECT item_id FROM cyberwares WHERE item_id = ?').get(itemId);
    if (!existing) {
      sqlite
        .prepare(
          `INSERT INTO cyberwares (
            item_id, cw_type, install_location, humanity_loss_roll, humanity_loss_static, is_core, slot_size
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(itemId, cwType, installLocation, humanityLossRoll, humanityLossStatic, isCore, slotSize);
    } else {
      sqlite
        .prepare(
          `UPDATE cyberwares SET
            cw_type = ?, install_location = ?, humanity_loss_roll = ?, humanity_loss_static = ?, is_core = ?, slot_size = ?
          WHERE item_id = ?`,
        )
        .run(cwType, installLocation, humanityLossRoll, humanityLossStatic, isCore, slotSize, itemId);
    }
  }
}
