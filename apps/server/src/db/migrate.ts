import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db, sqlite } from './client.js';
import * as path from 'node:path';

async function runMigrate() {
  console.log('Running SQLite migrations...');
  const migrationsFolder = path.resolve(process.cwd(), 'drizzle');
  migrate(db, { migrationsFolder });
  console.log('Migrations completed successfully.');
  sqlite.close();
}

runMigrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
