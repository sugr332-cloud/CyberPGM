import Database, { Database as SqliteDatabase } from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getProjectRoot } from '@cyberpgm/shared';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export function resolveDbPath(explicitPath?: string): string {
  if (explicitPath) return explicitPath;
  if (process.env.DB_PATH) return process.env.DB_PATH;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  // テスト中（VITEST が設定されている）なのに DB_PATH がなければ例外にする
  if (process.env.VITEST) {
    throw new Error('Running under VITEST but DB_PATH is not set! Tests must not use production DB.');
  }

  return path.join(getProjectRoot(), 'data/cyberpgm.db');
}

export function getImagesDir(): string {
  if (process.env.IMAGES_DIR) {
    return path.resolve(process.env.IMAGES_DIR);
  }
  return path.resolve(getProjectRoot(), 'data/images');
}

export function createDb(
  dbPath?: string,
): {
  sqlite: SqliteDatabase;
  db: AppDatabase;
} {
  const targetPath = resolveDbPath(dbPath);
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite: SqliteDatabase = new Database(targetPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db: AppDatabase = drizzle(sqlite, { schema });
  return { sqlite, db };
}

let currentInstance: { sqlite: SqliteDatabase; db: AppDatabase; path: string } | null = null;

export function getDb(): { sqlite: SqliteDatabase; db: AppDatabase } {
  const targetPath = resolveDbPath();
  if (!currentInstance || currentInstance.path !== targetPath) {
    if (currentInstance) {
      try {
        currentInstance.sqlite.close();
      } catch {
        // ignore
      }
    }
    const created = createDb(targetPath);
    currentInstance = { ...created, path: targetPath };
  }
  return currentInstance;
}

export function closeDb(): void {
  if (currentInstance) {
    try {
      currentInstance.sqlite.close();
    } catch {
      // ignore
    }
    currentInstance = null;
  }
}

// Proxies for seamless export of { sqlite, db }
export const sqlite: SqliteDatabase = new Proxy({} as SqliteDatabase, {
  get(_target, prop) {
    return (getDb().sqlite as any)[prop];
  },
});

export const db: AppDatabase = new Proxy({} as AppDatabase, {
  get(_target, prop) {
    return (getDb().db as any)[prop];
  },
});
