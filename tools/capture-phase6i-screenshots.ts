import * as path from 'node:path';
import * as fs from 'node:fs';

const port = '8792';
const dbPath = path.resolve('data/test-e2e.db');
const imgDir = path.resolve('docs/agy/reports/img');

process.env.PORT = port;
process.env.DB_PATH = dbPath;
process.env.DATABASE_URL = dbPath;

async function main() {
  if (!fs.existsSync(imgDir)) {
    fs.mkdirSync(imgDir, { recursive: true });
  }

  // 1. Seed sample unverified items
  const { createDb } = await import('../apps/server/src/db/client.js');
  const { items } = await import('../apps/server/src/db/schema.js');
  const { eq } = await import('drizzle-orm');

  const { db } = createDb(dbPath);
  const now = Date.now();
  const sampleItems = [
    {
      id: 'screen-unverified-01',
      kind: 'weapon',
      name_en: 'Street Samurai Katana',
      name_ja: 'ストリート・サムライ・カタナ',
      price_eb: 500,
      origin: 'homebrew',
      verify_status: 'unverified',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'screen-unverified-02',
      kind: 'cyberware',
      name_en: 'Subdermal Pocket',
      name_ja: '皮下ポケット',
      price_eb: 200,
      origin: 'homebrew',
      verify_status: 'unverified',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'screen-unverified-03',
      kind: 'armor',
      name_en: 'Reinforced Leather Jacket',
      name_ja: '強化レザージャケット',
      price_eb: 150,
      origin: 'homebrew',
      verify_status: 'unverified',
      created_at: now,
      updated_at: now,
    },
  ];

  for (const item of sampleItems) {
    const existing = db.select().from(items).where(eq(items.id, item.id)).get();
    if (!existing) {
      db.insert(items).values(item).run();
    }
  }

  // 2. Start server
  const { startServer } = await import('../apps/server/src/index.js');
  console.log(`Starting in-process server on port ${port}...`);
  await startServer();

  // 3. Launch Chrome via Playwright
  const { chromium } = await import('@playwright/test');
  console.log('Server started. Launching Chrome browser...');
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
  });

  try {
    // 4. PC 1440px Screenshot
    console.log('Capturing PC 1440px screenshots...');
    const pagePc = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await pagePc.goto(`http://127.0.0.1:${port}/gm`);
    await pagePc.waitForLoadState('networkidle');

    // Click DB tab in header
    const dbTab = pagePc.locator('button', { hasText: 'DB' }).first();
    await dbTab.click();
    await pagePc.waitForTimeout(1000);

    // Screenshot 1: Unverified items view (1440px)
    await pagePc.screenshot({
      path: path.join(imgDir, 'phase6i-db-io-unverified-1440.png'),
      fullPage: false,
    });
    console.log('Saved phase6i-db-io-unverified-1440.png');

    // Switch to All Entities sub-tab
    const entitiesSubTab = pagePc.locator('button', { hasText: '全エンティティ入出力' }).first();
    await entitiesSubTab.click();
    await pagePc.waitForTimeout(1000);

    // Screenshot 2: All Entities view (1440px)
    await pagePc.screenshot({
      path: path.join(imgDir, 'phase6i-db-io-entities-1440.png'),
      fullPage: false,
    });
    console.log('Saved phase6i-db-io-entities-1440.png');
    await pagePc.close();

    // 5. Mobile 390px Screenshot
    console.log('Capturing Mobile 390px screenshots...');
    const pageMobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await pageMobile.goto(`http://127.0.0.1:${port}/gm`);
    await pageMobile.waitForLoadState('networkidle');

    // Click DB tab in header
    const dbTabMobile = pageMobile.locator('button', { hasText: 'DB' }).first();
    await dbTabMobile.click();
    await pageMobile.waitForTimeout(1000);

    // Screenshot 3: Unverified items view (390px)
    await pageMobile.screenshot({
      path: path.join(imgDir, 'phase6i-db-io-unverified-390.png'),
      fullPage: false,
    });
    console.log('Saved phase6i-db-io-unverified-390.png');

    // Switch to All Entities sub-tab
    const entitiesSubTabMobile = pageMobile.locator('button', { hasText: '全エンティティ入出力' }).first();
    await entitiesSubTabMobile.click();
    await pageMobile.waitForTimeout(1000);

    // Screenshot 4: All Entities view (390px)
    await pageMobile.screenshot({
      path: path.join(imgDir, 'phase6i-db-io-entities-390.png'),
      fullPage: false,
    });
    console.log('Saved phase6i-db-io-entities-390.png');
    await pageMobile.close();

    console.log('All 4 screenshots captured successfully.');
  } finally {
    await browser.close();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
