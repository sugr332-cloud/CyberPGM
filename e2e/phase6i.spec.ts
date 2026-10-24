import { test, expect } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';
import { items } from '../apps/server/src/db/schema.js';
import { eq } from 'drizzle-orm';

const testItemA = 'phase6i-e2e-item-a';
const testItemB = 'phase6i-e2e-item-b';

test.afterAll(() => {
  const { sqlite } = createDb(process.env.DATABASE_URL || 'data/test-e2e.db');
  sqlite.prepare("DELETE FROM items WHERE id IN ('phase6i-e2e-item-a', 'phase6i-e2e-item-b')").run();
});

test('Phase 6i: DB 全エンティティの CSV/JSON 入出力・確認状態一括変更・未確認品一覧', async ({ page }) => {
  const dbPath = process.env.DATABASE_URL || 'data/test-e2e.db';
  const { db } = createDb(dbPath);
  const now = Date.now();

  // Seed two unverified items
  for (const item of [
    {
      id: testItemA,
      kind: 'weapon',
      name_en: 'E2E Unverified Pistol A',
      name_ja: 'E2E未確認ピストルA',
      price_eb: 300,
      origin: 'homebrew',
      verify_status: 'unverified',
      created_at: now,
      updated_at: now,
    },
    {
      id: testItemB,
      kind: 'cyberware',
      name_en: 'E2E Unverified Cyber B',
      name_ja: 'E2E未確認サイバーB',
      price_eb: 400,
      origin: 'homebrew',
      verify_status: 'unverified',
      created_at: now,
      updated_at: now,
    },
  ]) {
    const existing = db.select().from(items).where(eq(items.id, item.id)).get();
    if (!existing) {
      db.insert(items).values(item).run();
    }
  }

  // 1. Open GM page
  await page.goto('/gm');
  await page.waitForLoadState('networkidle');

  // 2. Click DB tab
  const dbTab = page.locator('button', { hasText: 'DB' }).first();
  await expect(dbTab).toBeVisible();
  await dbTab.click();

  // 3. Verify Unverified Items view
  await expect(page.locator('text=未確認品一覧 & 一括確認')).toBeVisible();
  await expect(page.locator('text=E2E未確認ピストルA')).toBeVisible();
  await expect(page.locator('text=E2E未確認サイバーB')).toBeVisible();

  // 4. Test Bulk Verify on UI
  // Check the checkbox for testItemA
  const checkboxA = page.locator(`tr:has-text("E2E未確認ピストルA") input[type="checkbox"]`);
  await checkboxA.check();

  // Click bulk verify button "公式確認済み"
  const bulkOfficialBtn = page.locator('button', { hasText: '公式確認済み (official_verified)' });
  await expect(bulkOfficialBtn).toBeVisible();
  await bulkOfficialBtn.click();

  // Verify item A disappears from unverified list
  await expect(page.locator('text=E2E未確認ピストルA')).not.toBeVisible();
  await expect(page.locator('text=E2E未確認サイバーB')).toBeVisible();

  // 5. Switch to All Entities sub-tab
  const entitiesSubTab = page.locator('button', { hasText: '全エンティティ入出力' }).first();
  await entitiesSubTab.click();

  // Verify entity list is displayed
  await expect(page.locator('text=全エンティティの一括入出力')).toBeVisible();
  await expect(page.locator('text=全テーブル一括エクスポート (JSON)')).toBeVisible();

  // Select 'items' entity and verify export/import UI
  await expect(page.locator('h3', { hasText: 'items' })).toBeVisible();
  await expect(page.locator('button', { hasText: 'JSON エクスポート' })).toBeVisible();
  await expect(page.locator('button', { hasText: 'CSV エクスポート' })).toBeVisible();
});
