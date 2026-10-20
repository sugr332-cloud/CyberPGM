import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { importImagesFromFolder } from '../src/importer.js';

describe('tools/import-images', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-images-test-'));
    dbPath = path.join(tempDir, 'test.db');

    const sqlite = new Database(dbPath);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS images (
        id TEXT PRIMARY KEY,
        item_id TEXT,
        title TEXT,
        path TEXT NOT NULL,
        origin TEXT NOT NULL,
        license TEXT,
        attribution TEXT,
        source_book TEXT,
        source_page INTEGER,
        visibility TEXT NOT NULL DEFAULT 'gm',
        is_primary INTEGER NOT NULL DEFAULT 0
      );
    `);
    sqlite.close();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('imports images from manifest with correct visibility and metadata', () => {
    // 1x1 dummy PNG
    const dummyPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    fs.writeFileSync(path.join(tempDir, 'dummy1.png'), dummyPng);
    fs.writeFileSync(path.join(tempDir, 'dummy2.png'), dummyPng);

    const manifestContent = {
      note: 'Test manifest',
      images: [
        {
          file: 'dummy1.png',
          title: 'テスト画像1',
          source: 'テストルールブック',
          page_ja: 42,
          visibility: 'players',
        },
        {
          file: 'dummy2.png',
          title: 'テスト画像2',
          source: 'テストサプリメント',
          page_ja: 108,
          // visibility omitted -> should default to gm
        },
      ],
    };

    fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify(manifestContent));

    // First import
    const result1 = importImagesFromFolder({ dir: tempDir, dbPath });
    expect(result1.total).toBe(2);
    expect(result1.imported).toBe(2);
    expect(result1.skipped).toBe(0);

    // Verify DB records
    const sqlite = new Database(dbPath);
    const rows = sqlite.prepare('SELECT * FROM images ORDER BY title ASC').all() as any[];
    sqlite.close();

    expect(rows.length).toBe(2);

    expect(rows[0].title).toBe('テスト画像1');
    expect(rows[0].origin).toBe('book_scan');
    expect(rows[0].source_book).toBe('テストルールブック');
    expect(rows[0].source_page).toBe(42);
    expect(rows[0].visibility).toBe('players');

    expect(rows[1].title).toBe('テスト画像2');
    expect(rows[1].origin).toBe('book_scan');
    expect(rows[1].source_book).toBe('テストサプリメント');
    expect(rows[1].source_page).toBe(108);
    expect(rows[1].visibility).toBe('gm'); // default

    // Second import: same directory -> duplicate check prevents re-insertion
    const result2 = importImagesFromFolder({ dir: tempDir, dbPath });
    expect(result2.total).toBe(2);
    expect(result2.imported).toBe(0);
    expect(result2.skipped).toBe(2);
  });
});
