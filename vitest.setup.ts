import { beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb, closeDb } from './apps/server/src/db/client.js';

interface TempEnv {
  tempDbPath: string;
  tempImagesDir: string;
}

function setupTempDb(): TempEnv {
  const randomSuffix = Math.random().toString(36).substring(2, 10);
  const tempDbPath = path.join(os.tmpdir(), `cyberpgm-test-${Date.now()}-${randomSuffix}.db`);
  process.env.DB_PATH = tempDbPath;

  const tempImagesDir = path.join(os.tmpdir(), `cyberpgm-test-images-${Date.now()}-${randomSuffix}`);
  fs.mkdirSync(path.join(tempImagesDir, 'user'), { recursive: true });
  process.env.IMAGES_DIR = tempImagesDir;

  // Apply migrations to fresh temp DB
  const { sqlite, db } = createDb(tempDbPath);
  const migrationsFolder = path.resolve(process.cwd(), 'drizzle');
  migrate(db, { migrationsFolder });

  // Seed items/weapons/armors/cyberware/images catalog from test-e2e.db if available
  const templatePath = path.resolve(process.cwd(), 'data/test-e2e.db');
  if (fs.existsSync(templatePath)) {
    try {
      sqlite.exec(`ATTACH DATABASE '${templatePath}' AS template;`);
      sqlite.exec(`INSERT OR IGNORE INTO items SELECT * FROM template.items;`);
      sqlite.exec(`INSERT OR IGNORE INTO weapons SELECT * FROM template.weapons;`);
      sqlite.exec(`INSERT OR IGNORE INTO armors SELECT * FROM template.armors;`);
      sqlite.exec(`INSERT OR IGNORE INTO cyberwares SELECT * FROM template.cyberwares;`);
      sqlite.exec(`INSERT OR IGNORE INTO images SELECT * FROM template.images;`);
      sqlite.exec(`INSERT OR IGNORE INTO rule_constants SELECT * FROM template.rule_constants;`);
      sqlite.exec(`DETACH DATABASE template;`);
    } catch (err) {
      console.warn('Failed to copy template catalog into temp DB:', err);
    }
  }

  sqlite.close();
  return { tempDbPath, tempImagesDir };
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
});
