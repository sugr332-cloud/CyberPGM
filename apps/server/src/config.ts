import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getProjectRoot } from '@cyberpgm/shared';

export interface AppConfig {
  gmPin: string;
}

export function getConfigPath(): string {
  const root = getProjectRoot();
  return path.join(root, 'data', 'config.json');
}

/**
 * Loads or initializes GM PIN in data/config.json.
 */
export function getOrCreateGmPin(): { pin: string; isNew: boolean } {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const data = JSON.parse(content) as AppConfig;
      if (data.gmPin && typeof data.gmPin === 'string') {
        return { pin: data.gmPin, isNew: false };
      }
    } catch {
      // ignore and recreate
    }
  }

  // Generate 6-digit random PIN
  const pin = Math.floor(100000 + Math.random() * 900000).toString();
  fs.writeFileSync(configPath, JSON.stringify({ gmPin: pin }, null, 2), 'utf-8');
  return { pin, isNew: true };
}

export function updateGmPin(newPin: string): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify({ gmPin: newPin }, null, 2), 'utf-8');
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
