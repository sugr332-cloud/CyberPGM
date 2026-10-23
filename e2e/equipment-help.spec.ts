import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDb } from '../apps/server/src/db/client.js';
import { characters, items } from '../apps/server/src/db/schema.js';
import { joinAsPlayer } from './join.js';

const characterId = 'equipment-help-pc';

test.afterEach(() => {
  const { sqlite } = createDb(process.env.DATABASE_URL || 'data/test-e2e.db');
  sqlite.prepare('DELETE FROM characters WHERE id = ?').run(characterId);
  sqlite.close();
});

test('equipment question buttons show weapon, armor, cyberware and gear specs, effects and flavor without editing', async ({ browser, request }) => {
  const { db, sqlite } = createDb(process.env.DATABASE_URL || 'data/test-e2e.db');
  for (const t of ['story_checks', 'session_log', 'scenario_sessions']) sqlite.prepare(`DELETE FROM ${t}`).run();
  const base = db.select().from(characters).where(eq(characters.name, 'ヴァイパー')).get()!;
  const catalog = ['weapon', 'armor', 'cyberware', 'gear'].map((kind) => {
    const item = db.select().from(items).where(eq(items.kind, kind)).all().find((i) => i.effect_ja && i.flavor_ja)!;
    expect(item, `${kind} needs a catalog fixture`).toBeTruthy();
    return item;
  });
  const displayName = (i: typeof items.$inferSelect) => i.name_ja_override || i.name_ja || i.name_en;
  db.insert(characters).values({
    ...base, id: characterId, name: '装備確認PC', scenario_id: null, player_id: null,
    weapons: JSON.stringify(['Heavy Pistol']),
    inventory: JSON.stringify([
      ...catalog.filter((i) => i.kind !== 'cyberware').map((i) => ({ entry_id: `help-${i.id}`, item_id: i.id, name: displayName(i), kind: i.kind, qty: 1, equipped: true })),
      { entry_id: 'manual-help', name: '未登録の試作品', kind: 'gear', qty: 1 },
    ]),
    cyberware: JSON.stringify([{ item_id: catalog[2].id, name: displayName(catalog[2]), static_loss: 2 }]),
  }).run();
  sqlite.close();
  const health = await (await request.get('/api/health')).json();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await joinAsPlayer(page, health.session, '装備確認PC');
  await page.getByTestId('player-tab-gear').click();
  for (const item of catalog) {
    const help = page.getByRole('button', { name: `${displayName(item)}の性能・効果・フレーバー`, exact: true });
    await expect(help.getByText('?', { exact: true })).toBeVisible();
    await help.click();
    const popup = page.getByTestId('item-popup');
    await expect(popup.getByText('性能', { exact: true })).toBeVisible();
    await expect(popup.getByTestId('item-notes')).toContainText(item.effect_ja!);
    await expect(popup.getByTestId('item-notes')).toContainText(item.flavor_ja!);
    await expect(popup.locator('input, textarea')).toHaveCount(0);
    await expect(popup.getByRole('button', { name: '編集', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (item.kind === 'weapon') await page.screenshot({ path: 'test-results/player-equipment-help-390.png', fullPage: true });
    await popup.getByRole('button', { name: '閉じる', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Heavy Pistolの性能・効果・フレーバー', exact: true }).click();
  await expect(page.getByTestId('item-popup').getByTestId('item-notes')).toBeVisible();
  await page.getByTestId('item-popup').getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: '未登録の試作品の性能・効果・フレーバー', exact: true }).click();
  await expect(page.getByTestId('item-popup')).toContainText('品目の情報なし');
  await context.close();
});
