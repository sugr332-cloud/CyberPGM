import Database, { Database as SqliteDatabase } from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { getProjectRoot } from '@cyberpgm/shared';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export function createDb(
  dbPath: string = process.env.DATABASE_URL ||
    path.join(getProjectRoot(), 'data/cyberpgm.db'),
): {
  sqlite: SqliteDatabase;
  db: AppDatabase;
} {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite: SqliteDatabase = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db: AppDatabase = drizzle(sqlite, { schema });
  return { sqlite, db };
}

// Default instance for server runtime
export const { sqlite, db }: { sqlite: SqliteDatabase; db: AppDatabase } = createDb();
