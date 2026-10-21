import { test, expect } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';
import { characters, items } from '../apps/server/src/db/schema.js';
import { eq } from 'drizzle-orm';

// Phase 5c §5 E2E: 商店の詳細に効果とフレーバー（下書き）→ 編集で下書きの印が消える → 戦闘カードの武器から同じ内容
test('Item notes: shop detail shows drafts, GM edits them, and the combat card shows the same text', async ({ browser, request }) => {
  const dbPath = process.env.DATABASE_URL || 'data/test-e2e.db';
  const { db, sqlite } = createDb(dbPath);
  for (const t of ['combat_log', 'combat_participants', 'combats', 'story_checks', 'session_log', 'scenario_sessions']) {
    sqlite.prepare(`DELETE FROM ${t}`).run();
  }
  const hp = db.select().from(items).where(eq(items.name_en, 'Heavy Pistol')).get()!;
  // 前の実行の編集を下書きに戻しておく
  const gm = (await (await request.post('/api/auth/gm-token')).json()).token as string;
  await request.post(`/api/items/${hp.id}/reset-notes`, { headers: { Authorization: `Bearer ${gm}` } });
  const viper = db.select().from(characters).where(eq(characters.name, 'ヴァイパー')).get()!;
  const inv = JSON.parse(viper.inventory || '[]').filter((i: { kind?: string }) => i.kind !== 'weapon');
  inv.push({ entry_id: 'e2e-hp', item_id: hp.id, name: '大型拳銃', kind: 'weapon', qty: 1, equipped: true, ammo: 8 });
  db.update(characters).set({ inventory: JSON.stringify(inv) }).where(eq(characters.id, viper.id)).run();
  sqlite.close();

  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto('/gm');
  await page.getByRole('button', { name: '商店' }).first().click();
  await page.getByTestId('item-search-input').fill('Heavy Pistol');
  await page.locator('[data-testid^="item-card-"]').filter({ hasText: 'Heavy Pistol' }).filter({ hasText: '3d6 · ROF 2' }).first().click();

  const notes = page.getByTestId('item-detail-panel').getByTestId('item-notes');
  await expect(notes.getByText('隠して持てる。')).toBeVisible();
  await expect(notes.getByText('ナイトシティでいちばんよく見る銃。上着の下にちょうど収まる。')).toBeVisible();
  await expect(notes.getByText('下書き', { exact: true })).toHaveCount(2);
  await page.screenshot({ path: 'docs/agy/reports/img/phase5c-shop-detail-1440.png' });

  await notes.getByRole('button', { name: '編集' }).click();
  await page.getByLabel('フレーバー').fill('GM が書き直した一文。');
  await notes.getByRole('button', { name: '保存', exact: true }).click();
  await expect(notes.getByText('GM が書き直した一文。')).toBeVisible();
  await expect(notes.getByText('下書き', { exact: true })).toHaveCount(1); // 効果は下書きのまま、フレーバーは GM の文

  // 戦闘を始めて、ヴァイパーのカードから武器を開く
  await page.getByRole('button', { name: '戦闘' }).first().click();
  await page.getByRole('button', { name: '戦闘を始める' }).click();
  await page.getByRole('button', { name: '行動順を確定して戦闘開始' }).first().click();
  await page.locator('[data-testid^="participant-card-"]').filter({ hasText: 'ヴァイパー' }).first().click();
  await page.getByTestId('card-item-row').filter({ hasText: '大型拳銃' }).first().click();
  const popup = page.getByTestId('item-popup');
  await expect(popup.getByText('3d6 · ROF 2 · 装弾数 8')).toBeVisible();
  await expect(popup.getByText('GM が書き直した一文。')).toBeVisible();
  await expect(popup.getByRole('button', { name: '編集' })).toHaveCount(0); // 戦闘の窓では編集しない
  await page.screenshot({ path: 'docs/agy/reports/img/phase5c-combat-item-popup-1440.png' });
});
