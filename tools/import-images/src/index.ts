import path from 'node:path';
import { getProjectRoot } from '@cyberpgm/shared';
import { importImagesFromFolder } from './importer.js';

function parseArgs() {
  const args = process.argv.slice(2);
  let dir = '';
  let dbPath = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && i + 1 < args.length) {
      dir = args[i + 1];
      i++;
    } else if (args[i] === '--db' && i + 1 < args.length) {
      dbPath = args[i + 1];
      i++;
    }
  }

  return { dir, dbPath };
}

async function main() {
  const { dir, dbPath } = parseArgs();

  if (!dir) {
    console.error('Usage: tsx tools/import-images/src/index.ts --dir <folder> --db <db-path>');
    process.exit(1);
  }

  const resolvedDbPath = dbPath || path.resolve(getProjectRoot(), 'data/cyberpgm.db');
  console.log(`[import-images] Target dir: ${dir}`);
  console.log(`[import-images] Target db:  ${resolvedDbPath}`);

  try {
    const result = importImagesFromFolder({ dir, dbPath: resolvedDbPath });
    console.log(`[import-images] Completed: ${result.imported} imported, ${result.skipped} skipped (total: ${result.total})`);
  } catch (err) {
    console.error('[import-images] Error:', err);
    process.exit(1);
  }
}

main();
