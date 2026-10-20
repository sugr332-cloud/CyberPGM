import * as fs from 'node:fs';
import * as path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '../apps/server/src/db/client.js';
import { e2eImagesDir } from '../playwright.config.js';

export default async function globalSetup() {
  const dbPath = process.env.DATABASE_URL || 'data/test-e2e.db';
  const { db, sqlite } = createDb(dbPath);
  const migrationsFolder = path.resolve(process.cwd(), 'drizzle');
  migrate(db, { migrationsFolder });
  sqlite.close();

  // Ensure e2e images temporary directory exists and is clean
  if (fs.existsSync(e2eImagesDir)) {
    fs.rmSync(e2eImagesDir, { recursive: true, force: true });
  }
  fs.mkdirSync(e2eImagesDir, { recursive: true });
}
