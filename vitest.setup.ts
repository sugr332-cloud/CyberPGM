import { beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb, closeDb } from './apps/server/src/db/client.js';

interface TempEnv {
  tempDbPath: string;
  tempImagesDir: string;
  tempSavesDir: string;
  tempSourceDir: string;
}

function setupTempDb(): TempEnv {
  const randomSuffix = Math.random().toString(36).substring(2, 10);
  const tempDbPath = path.join(os.tmpdir(), `cyberpgm-test-${Date.now()}-${randomSuffix}.db`);
  process.env.DB_PATH = tempDbPath;

  const tempImagesDir = path.join(os.tmpdir(), `cyberpgm-test-images-${Date.now()}-${randomSuffix}`);
  fs.mkdirSync(path.join(tempImagesDir, 'user'), { recursive: true });
  process.env.IMAGES_DIR = tempImagesDir;

  const tempSavesDir = path.join(os.tmpdir(), `cyberpgm-test-saves-${Date.now()}-${randomSuffix}`);
  fs.mkdirSync(tempSavesDir, { recursive: true });
  process.env.SAVES_DIR = tempSavesDir;
  process.env.AUDIO_DIR = path.join(tempSavesDir, 'audio');

  const tempSourceDir = path.join(tempSavesDir, 'sources');
  fs.mkdirSync(tempSourceDir);
  const sourceDir = path.resolve('data/sources/core-ja');
  for (const name of ['roles.json', 'skills.json', 'netrun.json']) {
    if (fs.existsSync(path.join(sourceDir, name))) fs.copyFileSync(path.join(sourceDir, name), path.join(tempSourceDir, name));
  }
  process.env.CORE_SOURCE_DIR = tempSourceDir;

  // Apply migrations to fresh temp DB
  const { sqlite, db } = createDb(tempDbPath);
  const migrationsFolder = path.resolve(process.cwd(), 'drizzle');
  migrate(db, { migrationsFolder });

  // Seed items/weapons/armors/cyberware/images catalog from test-e2e.db if available
  const templatePath = path.resolve(process.cwd(), 'data/test-e2e.db');
  if (fs.existsSync(templatePath)) {
    const tempCatalogPath = path.join(tempSavesDir, 'catalog.db');
    for (const ext of ['', '-wal']) {
      if (fs.existsSync(templatePath + ext)) fs.copyFileSync(templatePath + ext, tempCatalogPath + ext);
    }
    try {
      sqlite.prepare('ATTACH DATABASE ? AS template').run(tempCatalogPath);
      const copyTable = (tableName: string) => {
        try {
          const tempCols = (sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map((c) => c.name);
          const tplCols = (sqlite.prepare(`PRAGMA template.table_info(${tableName})`).all() as Array<{ name: string }>).map((c) => c.name);
          const common = tempCols.filter((c) => tplCols.includes(c));
          if (common.length > 0) {
            const colList = common.map((c) => `"${c}"`).join(', ');
            sqlite.exec(`INSERT OR IGNORE INTO ${tableName} (${colList}) SELECT ${colList} FROM template.${tableName};`);
          }
        } catch {
          // ignore table copy failure
        }
      };

      copyTable('items');
      copyTable('weapons');
      copyTable('armors');
      copyTable('cyberwares');
      copyTable('images');
      copyTable('rule_constants');
      sqlite.exec(`DETACH DATABASE template;`);
    } catch (err) {
      console.warn('Failed to copy template catalog into temp DB:', err);
    }
  }

  sqlite.close();
  return { tempDbPath, tempImagesDir, tempSavesDir, tempSourceDir };
}

let activeEnv: TempEnv | null = setupTempDb();

beforeAll(() => {
  if (!process.env.DB_PATH || !activeEnv) {
    activeEnv = setupTempDb();
  }
});

afterAll(() => {
  closeDb();

  if (activeEnv) {
    if (activeEnv.tempDbPath) {
      for (const ext of ['', '-wal', '-shm']) {
        const file = activeEnv.tempDbPath + ext;
        if (fs.existsSync(file)) {
          try {
            fs.unlinkSync(file);
          } catch {
            // ignore
          }
        }
      }
    }

    if (activeEnv.tempSavesDir && fs.existsSync(activeEnv.tempSavesDir)) {
      fs.rmSync(activeEnv.tempSavesDir, { recursive: true, force: true });
    }

    if (activeEnv.tempImagesDir && fs.existsSync(activeEnv.tempImagesDir)) {
      try {
        fs.rmSync(activeEnv.tempImagesDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }

    activeEnv = null;
  }

  delete process.env.DB_PATH;
  delete process.env.IMAGES_DIR;
  delete process.env.SAVES_DIR;
  delete process.env.AUDIO_DIR;
  delete process.env.CORE_SOURCE_DIR;
});
