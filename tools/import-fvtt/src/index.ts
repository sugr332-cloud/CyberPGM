import { runImport } from './importer.js';

function parseArgs() {
  const args = process.argv.slice(2);
  let srcDir = '';
  let dbPath = './data/cyberpgm.db';
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--src' && i + 1 < args.length) {
      srcDir = args[++i];
    } else if (args[i] === '--db' && i + 1 < args.length) {
      dbPath = args[++i];
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  return { srcDir, dbPath, dryRun };
}

function main() {
  const { srcDir, dbPath, dryRun } = parseArgs();

  if (!srcDir) {
    console.error('Error: --src <FVTT_REPO> is required');
    console.error('Usage: tsx tools/import-fvtt/src/index.ts --src <FVTT_REPO> [--db <db_path>] [--dry-run]');
    process.exit(1);
  }

  console.log(`Starting FVTT Import...`);
  console.log(`Source: ${srcDir}`);
  console.log(`Database: ${dbPath}`);
  console.log(`Dry Run: ${dryRun}`);

  try {
    const report = runImport({ srcDir, dbPath, dryRun });

    console.log('\n=== FVTT Import Report ===');
    console.log(`Started:  ${report.started_at}`);
    console.log(`Finished: ${report.finished_at}`);
    console.log('\n--- Counts by Kind ---');
    console.table(report.counts_by_kind);
    console.log('\n--- Total ---');
    console.log(`Added:     ${report.total.added}`);
    console.log(`Updated:   ${report.total.updated}`);
    console.log(`Unchanged: ${report.total.unchanged}`);
    console.log(`\nMissing name_ja:   ${report.missing_name_ja.length} items`);
    console.log(`Missing price:     ${report.missing_price.length} items`);
    console.log(`Missing sources:   ${report.missing_sources.length} items`);
    console.log(`Missing images:    ${report.missing_images.length} items`);
    console.log(`Missing in FVTT:   ${report.missing_in_fvtt.length} items`);

    if (report.missing_images.length > 0) {
      console.log('\nMissing images list (sample first 5):');
      console.log(report.missing_images.slice(0, 5));
    }
  } catch (err) {
    console.error('Import failed:', err);
    process.exit(1);
  }
}

main();
