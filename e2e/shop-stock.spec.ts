import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';
import { eq } from 'drizzle-orm';
import { items, images, characters } from '../apps/server/src/db/schema.js';
import { e2eImagesDir } from '../playwright.config.js';
import { joinAsPlayer } from './join.js';

const itemIds = ['stock-test-weapon', 'stock-test-armor', 'stock-test-ammo'];
const itemNames = ['品揃え試験の銃', '品揃え試験の防具', '品揃え試験の弾薬'];

test('new shop stock: drag three items, remove, edit quantities, add on phone, and synchronize the player', async ({ browser, request }) => {
  const { db, sqlite } = createDb(process.env.DATABASE_URL || 'data/test-e2e.db');
  const gmContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  let shopId: string | undefined;
  try {
    for (const table of ['story_checks', 'session_log', 'scenario_sessions']) sqlite.prepare(`DELETE FROM ${table}`).run();
    const now = Date.now();
    sqlite.prepare('DELETE FROM characters WHERE id = ?').run('stock-test-pc');
    const base = db.select().from(characters).where(eq(characters.name, 'ヴァイパー')).get()!;
    db.insert(characters).values({ ...base, id: 'stock-test-pc', name: '品揃え試験PC', player_id: null, scenario_id: null }).run();
    for (let i = 0; i < 3; i++) {
      sqlite.prepare('DELETE FROM items WHERE id = ?').run(itemIds[i]);
      db.insert(items).values({ id: itemIds[i], kind: ['weapon', 'armor', 'ammo'][i], name_en: `Stock Test ${i}`, name_ja: itemNames[i], price_eb: [100, 50, 10][i], origin: 'homebrew', verify_status: 'homebrew', created_at: now, updated_at: now }).run();
      // 自作の画像だけを一時画像フォルダーへ置く。
      fs.writeFileSync(path.join(e2eImagesDir, `${itemIds[i]}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect x="8" y="8" width="48" height="48" rx="8" fill="${['#4FB6E3', '#F28C38', '#FF5A5F'][i]}"/></svg>`);
      db.insert(images).values({ id: `img-${itemIds[i]}`, item_id: itemIds[i], path: `${itemIds[i]}.svg`, origin: 'user', visibility: 'players', is_primary: true }).run();
    }
    const gm = await gmContext.newPage();
    await gm.goto('/gm');
    await gm.getByRole('button', { name: '商店', exact: true }).click();
    await gm.getByRole('button', { name: '＋ 新しい店を作る', exact: true }).click();
    await gm.getByPlaceholder('例: ナイトシティ・ガンズ').fill('品揃え試験店');
    const created = gm.waitForResponse((r) => r.url().endsWith('/api/shops') && r.request().method() === 'POST');
    await gm.getByRole('button', { name: '保存', exact: true }).click();
    shopId = (await (await created).json()).id;
    const editor = gm.getByTestId('shop-stock-editor');
    await expect(editor).toBeVisible(); // 新しい店を作るとそのまま編集へ
    const search = editor.getByLabel('品揃えのカタログを検索');
    await search.fill('品揃え試験');
    const catalog = gm.getByTestId('stock-catalog');
    const destination = gm.getByTestId('stock-drop-zone');
    await expect(catalog.locator('article')).toHaveCount(3);
    const image = catalog.locator('img').first();
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(64);
    // 全11分類を選べ、絞り込みと検索を併用できる。
    const category = editor.getByLabel('品揃えのカタログ分類');
    await expect(category.locator('option')).toHaveCount(12);
    for (const [i, kind] of ['weapon', 'armor', 'ammo'].entries()) {
      await category.selectOption(kind);
      await expect(catalog.locator('article')).toHaveCount(1);
      await expect(gm.getByTestId(`stock-catalog-${itemIds[i]}`)).toBeVisible();
    }
    await category.selectOption('');
    await expect(catalog.locator('article')).toHaveCount(3);
    // 店を公開したまま在庫を編集し、スマホはリロードしない。
    await gm.getByRole('button', { name: '「品揃え試験店」をスマホに出す', exact: true }).click();
    const health = await (await request.get('/api/health')).json();
    const phone = await phoneContext.newPage();
    await joinAsPlayer(phone, health.session, '品揃え試験PC', '品揃え試験');
    await phone.getByTestId('player-tab-shop').click();
    await expect(phone.getByText('品揃え試験店', { exact: true })).toBeVisible();
    await expect(phone.getByTestId('player-shop-item')).toHaveCount(0);
    for (let i = 0; i < 3; i++) {
      await gm.getByTestId(`stock-catalog-${itemIds[i]}`).dragTo(destination);
      await expect(gm.getByTestId(`stock-row-${itemIds[i]}`)).toBeVisible();
      await expect(phone.getByTestId('player-shop-item')).toHaveCount(i + 1);
      await expect(gm.getByTestId(`stock-catalog-${itemIds[i]}`).getByRole('button', { name: '追加済み ✓' })).toBeDisabled();
    }
    await gm.getByTestId(`stock-row-${itemIds[2]}`).dragTo(catalog);
    await expect(gm.getByTestId(`stock-row-${itemIds[2]}`)).toHaveCount(0);
    await expect(phone.getByTestId('player-shop-item')).toHaveCount(2);
    const row = gm.getByTestId(`stock-row-${itemIds[0]}`);
    await row.getByLabel(`${itemNames[0]}の在庫方式`).selectOption('number');
    await expect(row.getByLabel(`${itemNames[0]}の在庫数`)).toHaveValue('1');
    await row.getByLabel(`${itemNames[0]}の在庫数`).fill('4');
    await row.getByLabel(`${itemNames[0]}の在庫数`).press('Enter');
    await expect.poll(() => (sqlite.prepare('SELECT quantity FROM shop_stock WHERE shop_id = ? AND item_id = ?').get(shopId, itemIds[0]) as { quantity: number }).quantity).toBe(4);
    await expect(phone.getByTestId('player-shop-item').filter({ hasText: itemNames[0] })).toContainText('4');
    await gm.screenshot({ path: 'docs/agy/reports/img/phase6d-shop-stock-1440.png', fullPage: true });
    await gm.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => gm.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await gm.getByTestId(`stock-catalog-${itemIds[2]}`).getByRole('button', { name: '＋ 追加', exact: true }).click();
    await expect(gm.getByTestId(`stock-row-${itemIds[2]}`)).toBeVisible();
    await expect(phone.getByTestId('player-shop-item')).toHaveCount(3);
    await gm.getByRole('button', { name: `${itemNames[2]}を品揃えから外す`, exact: true }).click();
    await expect(phone.getByTestId('player-shop-item')).toHaveCount(2);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM shop_stock WHERE shop_id = ?').get(shopId)).toEqual({ n: 2 });
    await gm.screenshot({ path: 'docs/agy/reports/img/phase6d-shop-stock-390.png', fullPage: true });
    await gm.getByRole('button', { name: '編集を終える', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await gm.getByRole('button', { name: '品揃えを編集', exact: true }).click();
    await expect(row.getByLabel(`${itemNames[0]}の在庫数`)).toHaveValue('4');
  } finally {
    await phoneContext.close();
    await gmContext.close();
    if (shopId) sqlite.prepare('DELETE FROM shops WHERE id = ?').run(shopId);
    for (const id of itemIds) {
      sqlite.prepare('DELETE FROM items WHERE id = ?').run(id);
      fs.rmSync(path.join(e2eImagesDir, `${id}.svg`), { force: true });
    }
    sqlite.prepare('DELETE FROM characters WHERE id = ?').run('stock-test-pc');
    sqlite.close();
  }
});
