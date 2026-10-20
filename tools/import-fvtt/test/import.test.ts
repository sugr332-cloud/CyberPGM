import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { runImport, findAttribution } from '../src/importer.js';

describe('FVTT Importer', () => {
  const testDbPath = path.resolve(process.cwd(), 'data/test_import.db');
  const fixtureSrcDir = path.resolve(process.cwd(), 'tools/import-fvtt/test/fixtures');

  function initTestDb() {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    const dbDir = path.dirname(testDbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const sqlite = new Database(testDbPath);
    sqlite.pragma('foreign_keys = ON');

    // Run migration sql files directly in order
    const drizzleDir = path.resolve(process.cwd(), 'drizzle');
    const sqlFiles = fs
      .readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const sqlFile of sqlFiles) {
      const migrationSql = fs.readFileSync(path.join(drizzleDir, sqlFile), 'utf-8');
      const statements = migrationSql.split('--> statement-breakpoint');
      for (const stmt of statements) {
        if (stmt.trim()) {
          sqlite.exec(stmt);
        }
      }
    }
    sqlite.close();
  }

  beforeEach(() => {
    initTestDb();
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it('imports items correctly with expected column values', () => {
    const report = runImport({
      srcDir: fixtureSrcDir,
      dbPath: testDbPath,
    });

    expect(report.total.added).toBe(3);
    expect(report.total.updated).toBe(0);
    expect(report.total.unchanged).toBe(0);

    const sqlite = new Database(testDbPath);

    // Verify weapon
    const weaponItem = sqlite
      .prepare('SELECT * FROM items WHERE fvtt_id = ?')
      .get('testWeapon000001') as Record<string, unknown>;
    expect(weaponItem).toBeDefined();
    expect(weaponItem.name_en).toBe('Test Pistol');
    expect(weaponItem.name_ja).toBe('テストピストル');
    expect(weaponItem.kind).toBe('weapon');
    expect(weaponItem.price_eb).toBe(100);
    expect(weaponItem.price_category).toBe('premium');
    expect(weaponItem.source_book).toBe('Test Book');
    expect(weaponItem.source_page_en).toBe(42);
    expect(weaponItem.origin).toBe('fvtt');
    expect(weaponItem.verify_status).toBe('unofficial');

    const weaponSub = sqlite
      .prepare('SELECT * FROM weapons WHERE item_id = ?')
      .get(weaponItem.id as string) as Record<string, unknown>;
    expect(weaponSub).toBeDefined();
    expect(weaponSub.weapon_type).toBe('pistol');
    expect(weaponSub.damage).toBe('2d6');
    expect(weaponSub.rof).toBe(2);
    expect(weaponSub.magazine_max).toBe(12);
    expect(weaponSub.is_ranged).toBe(1);

    // Verify armor
    const armorItem = sqlite
      .prepare('SELECT * FROM items WHERE fvtt_id = ?')
      .get('testArmor0000001') as Record<string, unknown>;
    expect(armorItem).toBeDefined();
    expect(armorItem.kind).toBe('armor');
    const armorSub = sqlite
      .prepare('SELECT * FROM armors WHERE item_id = ?')
      .get(armorItem.id as string) as Record<string, unknown>;
    expect(armorSub.sp_body).toBe(11);
    expect(armorSub.is_body).toBe(1);

    // Verify cyberware
    const cyberItem = sqlite
      .prepare('SELECT * FROM items WHERE fvtt_id = ?')
      .get('testCyber0000001') as Record<string, unknown>;
    expect(cyberItem).toBeDefined();
    expect(cyberItem.kind).toBe('cyberware');
    const cyberSub = sqlite
      .prepare('SELECT * FROM cyberwares WHERE item_id = ?')
      .get(cyberItem.id as string) as Record<string, unknown>;
    expect(cyberSub.cw_type).toBe('cybereye');
    expect(cyberSub.humanity_loss_static).toBe(7);

    // Verify image
    const imageRecord = sqlite
      .prepare('SELECT * FROM images WHERE item_id = ?')
      .get(weaponItem.id as string) as Record<string, unknown>;
    expect(imageRecord).toBeDefined();
    expect(imageRecord.path).toBe('fvtt/compendium/weapons/test_pistol.svg');
    expect(imageRecord.origin).toBe('fvtt_icon');
    expect(imageRecord.visibility).toBe('players');
    expect(imageRecord.attribution).toContain('TestAuthor');

    sqlite.close();
  });

  it('does not increase count on second run (idempotent)', () => {
    // Run 1
    const report1 = runImport({
      srcDir: fixtureSrcDir,
      dbPath: testDbPath,
    });
    expect(report1.total.added).toBe(3);

    // Run 2
    const report2 = runImport({
      srcDir: fixtureSrcDir,
      dbPath: testDbPath,
    });
    expect(report2.total.added).toBe(0);
    expect(report2.total.updated).toBe(0);
    expect(report2.total.unchanged).toBe(3);

    const sqlite = new Database(testDbPath);
    const count = sqlite.prepare('SELECT count(*) as c FROM items').get() as { c: number };
    expect(count.c).toBe(3);
    sqlite.close();
  });

  it('does not overwrite GM edited columns on subsequent run', () => {
    // Run 1
    runImport({
      srcDir: fixtureSrcDir,
      dbPath: testDbPath,
    });

    const sqlite = new Database(testDbPath);
    // Simulate GM manual edits
    sqlite
      .prepare(
        `UPDATE items SET
          name_ja_override = 'カスタムテスト拳銃',
          summary_ja = 'GM要約メモ',
          source_page_ja = 99,
          verify_status = 'official_verified',
          tags = '["favorite"]',
          notes = 'GM用メモテキスト'
        WHERE fvtt_id = 'testWeapon000001'`,
      )
      .run();
    sqlite.close();

    // Run 2
    const report2 = runImport({
      srcDir: fixtureSrcDir,
      dbPath: testDbPath,
    });
    expect(report2.total.added).toBe(0);

    const sqlite2 = new Database(testDbPath);
    const editedItem = sqlite2
      .prepare('SELECT * FROM items WHERE fvtt_id = ?')
      .get('testWeapon000001') as Record<string, unknown>;

    expect(editedItem.name_ja_override).toBe('カスタムテスト拳銃');
    expect(editedItem.summary_ja).toBe('GM要約メモ');
    expect(editedItem.source_page_ja).toBe(99);
    expect(editedItem.verify_status).toBe('official_verified');
    expect(editedItem.tags).toBe('["favorite"]');
    expect(editedItem.notes).toBe('GM用メモテキスト');

    sqlite2.close();
  });

  it('preserves image visibility when GM manually changes it to gm (Issue #14 Review 02)', () => {
    // Run 1
    runImport({
      srcDir: fixtureSrcDir,
      dbPath: testDbPath,
    });

    const sqlite = new Database(testDbPath);
    // GM changes visibility of fvtt_icon to 'gm'
    sqlite.prepare(`UPDATE images SET visibility = 'gm' WHERE origin = 'fvtt_icon'`).run();
    const updatedImg = sqlite
      .prepare(`SELECT visibility FROM images WHERE origin = 'fvtt_icon'`)
      .get() as { visibility: string };
    expect(updatedImg.visibility).toBe('gm');
    sqlite.close();

    // Run 2
    runImport({
      srcDir: fixtureSrcDir,
      dbPath: testDbPath,
    });

    // Check visibility remains 'gm'
    const sqlite2 = new Database(testDbPath);
    const finalImg = sqlite2
      .prepare(`SELECT visibility FROM images WHERE origin = 'fvtt_icon'`)
      .get() as { visibility: string };
    expect(finalImg.visibility).toBe('gm');
    sqlite2.close();
  });

  it('sets license = unknown and attribution = see CREDITS.md when icon has no matching credits entry', () => {
    const result = findAttribution('src/icons/compendium/unknown/uncredited.svg', []);
    expect(result.license).toBe('unknown');
    expect(result.attribution).toBe('see CREDITS.md');
  });
});
