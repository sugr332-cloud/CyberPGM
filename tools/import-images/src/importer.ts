import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { generateUlid, getProjectRoot } from '@cyberpgm/shared';

export interface ManifestImage {
  file: string;
  title: string;
  source?: string;
  page_ja?: number;
  visibility?: 'gm' | 'players' | 'public' | string;
  width?: number;
  height?: number;
  suggested_use?: string;
}

export interface Manifest {
  note?: string;
  images: ManifestImage[];
}

export interface ImportImagesOptions {
  dir: string;
  dbPath: string;
}

export interface ImportResult {
  total: number;
  imported: number;
  skipped: number;
}

export function importImagesFromFolder(options: ImportImagesOptions): ImportResult {
  const { dir, dbPath } = options;

  if (!fs.existsSync(dir)) {
    throw new Error(`Directory not found: ${dir}`);
  }

  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in ${dir}`);
  }

  const manifestRaw = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(manifestRaw) as Manifest;

  if (!manifest.images || !Array.isArray(manifest.images)) {
    throw new Error(`Invalid manifest: images array is missing`);
  }

  const sqlite = new Database(dbPath);

  // Determine images directory
  let imagesDir: string;
  try {
    imagesDir = path.resolve(getProjectRoot(), 'data/images');
  } catch {
    imagesDir = path.resolve(process.cwd(), 'data/images');
  }

  const checkStmt = sqlite.prepare('SELECT id FROM images WHERE path = ?');
  const insertStmt = sqlite.prepare(`
    INSERT INTO images (
      id, item_id, title, path, origin, license, attribution, source_book, source_page, visibility, is_primary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let imported = 0;
  let skipped = 0;

  const runImport = sqlite.transaction(() => {
    for (const item of manifest.images) {
      if (!item.file) continue;

      const absFilePath = path.resolve(dir, item.file);

      // Determine the path to record
      let recordPath: string;
      if (absFilePath.startsWith(imagesDir + path.sep)) {
        recordPath = path.relative(imagesDir, absFilePath);
      } else {
        recordPath = absFilePath;
      }

      // Check if duplicate path already exists
      const existing = checkStmt.get(recordPath);
      if (existing) {
        skipped++;
        continue;
      }

      const id = generateUlid();
      const title = item.title || null;
      const origin = 'book_scan';
      const license = null;
      const attribution = null;
      const sourceBook = item.source || null;
      const sourcePage = typeof item.page_ja === 'number' ? item.page_ja : null;
      const visibility = item.visibility || 'gm';
      const isPrimary = 0;

      insertStmt.run(
        id,
        null,
        title,
        recordPath,
        origin,
        license,
        attribution,
        sourceBook,
        sourcePage,
        visibility,
        isPrimary,
      );

      imported++;
    }
  });

  try {
    runImport();
  } finally {
    sqlite.close();
  }

  return {
    total: manifest.images.length,
    imported,
    skipped,
  };
}
