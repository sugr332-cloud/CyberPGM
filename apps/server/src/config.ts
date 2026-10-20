import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getProjectRoot } from '@cyberpgm/shared';

export type AppConfig = Record<string, unknown>;

export function getConfigPath(): string {
  const root = getProjectRoot();
  return path.join(root, 'data', 'config.json');
}

/**
 * Creates a daily snapshot backup of the sqlite database if one doesn't already exist for today.
 */
export function createDailyBackup(dbFilePath: string): string | null {
  if (!fs.existsSync(dbFilePath)) return null;

  const root = getProjectRoot();
  const backupsDir = path.join(root, 'data', 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const backupFileName = `cyberpgm-${today}.db`;
  const backupFilePath = path.join(backupsDir, backupFileName);

  if (fs.existsSync(backupFilePath)) {
    return backupFilePath; // Already backed up today
  }

  fs.copyFileSync(dbFilePath, backupFilePath);
  return backupFilePath;
}

/**
 * Generates an ambiguous-character-free 6-char session code.
 * (Excludes 0, O, 1, I, l)
 */
export function generateSessionCode(): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}
