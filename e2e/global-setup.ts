import * as fs from 'node:fs';
import * as path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '../apps/server/src/db/client.js';
import { execFileSync } from 'node:child_process';
import { e2eImagesDir, e2eSavesDir } from '../playwright.config.js';

export default async function globalSetup() {
  const dbPath = process.env.DATABASE_URL || 'data/test-e2e.db';
  const { db, sqlite } = createDb(dbPath);
  const migrationsFolder = path.resolve(process.cwd(), 'drizzle');
  migrate(db, { migrationsFolder });

  // 毎回同じ状態から始める: 前の実行で残ったキャラ・保存・進行・戦闘・盤面を消し、デモの PC 4 人を入れ直す
  // （品目のカタログはそのまま使う）
  for (const t of [
    'story_checks', 'session_log', 'scenario_sessions', 'combat_log', 'combat_participants', 'combats',
    'board_drops', 'board_tokens', 'board_objects', 'boards', 'transactions', 'money_log', 'char_log',
    'character_submissions', 'devices', 'saves', 'characters',
  ]) {
    sqlite.prepare(`DELETE FROM ${t}`).run();
  }
  sqlite.close();
  execFileSync('npx', ['tsx', 'apps/server/src/db/seed-demo.ts'], {
    env: { ...process.env, DB_PATH: dbPath, DATABASE_URL: dbPath },
    stdio: 'ignore',
  });

  if (fs.existsSync(e2eSavesDir)) fs.rmSync(e2eSavesDir, { recursive: true, force: true });
  fs.mkdirSync(e2eSavesDir, { recursive: true });

  // Ensure e2e images temporary directory exists and is clean
  if (fs.existsSync(e2eImagesDir)) {
    fs.rmSync(e2eImagesDir, { recursive: true, force: true });
  }
  fs.mkdirSync(e2eImagesDir, { recursive: true });

  // FVTT のアイコン（読み取りだけ）は一時フォルダに写す。アップロードは一時フォルダに入り、data/images には書かない
  const fvttIcons = path.resolve(process.cwd(), 'data/images/fvtt');
  if (fs.existsSync(fvttIcons)) {
    fs.cpSync(fvttIcons, path.join(e2eImagesDir, 'fvtt'), { recursive: true });
  }
}
