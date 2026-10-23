import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';
import { e2eCoreSourceDir } from '../playwright.config.js';
import { joinAsPlayer } from './join.js';
import { loreFixture, npcFixture } from '../test-fixtures/phase6b.js';

const originals = new Map<string, Buffer | null>();
test.beforeAll(() => {
  for (const [name, data] of [['lore.json', loreFixture], ['npcs.json', npcFixture]] as const) {
    const file = path.join(e2eCoreSourceDir, name);
    originals.set(file, fs.existsSync(file) ? fs.readFileSync(file) : null);
    fs.writeFileSync(file, JSON.stringify(data));
  }
});
test.afterAll(() => {
  for (const [file, data] of originals) {
    if (data) fs.writeFileSync(file, data);
    else fs.rmSync(file, { force: true });
  }
});

test('Phase 6b: lore search, related entries, copy, global search and mobile layout', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/gm');
  await page.getByRole('button', { name: '資料', exact: true }).click();
  const lore = page.getByTestId('lore-view');
  const detail = page.getByTestId('lore-detail');
  await expect(lore.getByTestId('lore-genres')).toBeVisible();
  await expect(lore.getByLabel('資料の一覧')).toHaveCount(0);
  await lore.getByTestId('lore-genre-timeline').click();
  await expect(lore.getByLabel('資料の一覧').getByRole('button').first()).toContainText('1999〜2001');
  await lore.getByLabel('資料を検索').fill('neo　港');
  const entry = lore.getByLabel('資料の一覧').getByRole('button');
  await expect(entry).toHaveCount(1);
  await entry.click();
  await expect(detail.getByRole('heading', { level: 3 })).toContainText('テスト都市の再開発');
  await expect(detail.locator('mark')).toContainText(['ＮＥＯ', '港', '港']);
  await detail.getByRole('button', { name: 'コピー', exact: true }).click();
  await expect(detail.getByRole('status')).toHaveText('コピーしました');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('試験用の年表。ＮＥＯ社が港を再開発する。\n・物資を運ぶ運河が完成。');
  await page.screenshot({ path: 'docs/agy/reports/img/phase6b-lore-1440.png' });
  await detail.getByRole('button', { name: 'NEO 社（テスト資料）' }).click();
  await expect(detail.getByRole('heading', { level: 3 })).toHaveText('NEO 社（テスト資料）');
  await lore.getByLabel('資料の分類').selectOption('world');
  await expect(lore.getByLabel('資料の一覧').getByRole('button')).toHaveCount(1);
  await page.getByRole('button', { name: 'PC', exact: true }).click();
  await page.getByTestId('global-search').fill('ＮｅＯ 2045');
  await page.getByTestId('global-search-results').getByRole('button').filter({ hasText: 'テスト都市の再開発' }).click();
  await expect(detail.getByRole('heading', { level: 3 })).toContainText('テスト都市の再開発');
  await expect(lore.getByLabel('資料の分類')).toHaveValue('timeline');
  await expect(lore.getByLabel('資料を検索')).toHaveValue('');

  await page.setViewportSize({ width: 390, height: 844 });
  await lore.getByLabel('資料を検索').fill('neo 2045');
  await expect(lore.getByLabel('資料の一覧').getByRole('button')).toHaveCount(1);
  await expect(page.getByTestId('gm-bottom-nav').getByRole('button', { name: '資料', exact: true })).toBeVisible();
  await expect(detail.getByRole('heading', { level: 3 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/agy/reports/img/phase6b-lore-390.png', fullPage: true });

  const file = path.join(e2eCoreSourceDir, 'lore.json');
  const contents = fs.readFileSync(file);
  try {
    fs.unlinkSync(file);
    await page.reload();
    await page.getByRole('button', { name: '資料', exact: true }).click();
    await expect(page.getByText('世界観の資料（手元のルール資料）がありません')).toBeVisible();
  } finally { fs.writeFileSync(file, contents); }
});

test('Phase 6b: register a rulebook NPC, open it and add it to combat', async ({ page }) => {
  let characterId: string | undefined;
  let combatId: string | undefined;
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/gm');
    await page.getByRole('button', { name: 'キャラ作成', exact: true }).click();
    const editor = page.getByTestId('character-editor');
    await editor.getByRole('button', { name: 'ルールブックの NPC から作る' }).click();
    const picker = page.getByTestId('npc-template-picker');
    await expect(picker.getByText('テスト用: PC と同じ人数を目安にする')).toBeVisible();
    await expect(picker.getByTestId('npc-template-test-guard')).toContainText('35');
    await page.screenshot({ path: 'docs/agy/reports/img/phase6b-npc-list-1440.png' });
    const created = page.waitForResponse((r) => r.url().endsWith('/api/npc-templates/test-guard/register') && r.request().method() === 'POST');
    await picker.getByTestId('npc-template-test-guard').getByRole('button', { name: '登録' }).click();
    const result = await (await created).json();
    characterId = result.character.id;
    await expect(editor.getByLabel('名前')).toHaveValue('テスト護衛6b');
    await expect(editor.getByRole('status')).toContainText('注意:');
    await expect(editor.getByLabel('REF', { exact: true })).toHaveValue('6');
    await expect(editor.getByLabel('最大 HP')).toHaveValue('35');

    await page.getByRole('button', { name: '戦闘', exact: true }).click();
    const createdCombat = page.waitForResponse((r) => r.url().endsWith('/api/combats') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '戦闘を始める', exact: true }).click();
    combatId = (await (await createdCombat).json()).combat.id;
    await page.locator('select').filter({ hasText: 'NPC/モブを選択' }).selectOption(characterId);
    await page.getByRole('button', { name: '敵として追加', exact: true }).click();
    await expect(page.getByText('テスト護衛6b', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '行動順を確定して戦闘開始' }).first().click();
    await expect(page.getByTestId('action-btn-move')).toBeVisible();
  } finally {
    const { sqlite } = createDb(process.env.DATABASE_URL || 'data/test-e2e.db');
    try {
      if (combatId) {
        sqlite.prepare('DELETE FROM combat_log WHERE combat_id = ?').run(combatId);
        sqlite.prepare('DELETE FROM combat_participants WHERE combat_id = ?').run(combatId);
        sqlite.prepare('DELETE FROM combats WHERE id = ?').run(combatId);
      }
      if (characterId) sqlite.prepare('DELETE FROM characters WHERE id = ?').run(characterId);
    } finally { sqlite.close(); }
  }
});


test('Phase 6c: player clue and data tabs fit 390px and keep their contents separate', async ({ page, request }) => {
  const gmToken = (await (await request.post('/api/auth/gm-token')).json()).token;
  const headers = { Authorization: `Bearer ${gmToken}` };
  const post = async (url: string, data: unknown) => {
    const res = await request.post(url, { headers, data });
    expect(res.ok()).toBe(true);
    return res.json();
  };
  const { sqlite } = createDb(process.env.DATABASE_URL || 'data/test-e2e.db');
  for (const table of ['story_checks', 'session_log', 'scenario_sessions']) sqlite.prepare(`DELETE FROM ${table}`).run();
  sqlite.close();
  const { scenario } = await post('/api/scenarios', { title: '手掛かりと資料の試験', use_template: false });
  try {
    const sceneData = await post(`/api/scenarios/${scenario.id}/scenes`, { title: '試験の港' });
    const sceneId = (sceneData.scene ?? sceneData).id;
    const clueData = await post(`/api/scenarios/${scenario.id}/clues`, { scene_id: sceneId, title: '試験の足跡', body: '倉庫へ続く足跡がある。' });
    const handoutData = await post(`/api/scenarios/${scenario.id}/handouts`, { scene_id: sceneId, title: '試験のメモ', body: '入口に残された伝言。' });
    const session = await post('/api/scenario-sessions/start', { scenario_id: scenario.id, initial_scene_id: sceneId });
    const health = await (await request.get('/api/health')).json();
    await page.setViewportSize({ width: 390, height: 844 });
    await joinAsPlayer(page, health.session, 'ヴァイパー', '資料確認');
    await page.getByRole('button', { name: '手掛かり', exact: true }).click();
    await expect(page.getByRole('heading', { name: '手掛かり', exact: true })).toBeVisible();
    await expect(page.getByText('まだ公開された手掛かりはありません')).toBeVisible();
    await post(`/api/scenario-sessions/${session.sessionId}/reveal`, { kind: 'clue', itemId: (clueData.clue ?? clueData).id });
    await post(`/api/scenario-sessions/${session.sessionId}/reveal`, { kind: 'handout', itemId: (handoutData.handout ?? handoutData).id });
    await expect(page.getByText('試験の足跡', { exact: true })).toBeVisible();
    await expect(page.getByText('試験のメモ', { exact: true })).toBeVisible();
    await expect(page.getByTestId('lore-view')).toHaveCount(0);
    await expect(page.getByTestId('player-tab-handouts')).toContainText('CLUE');
    const tabs = page.locator('[data-testid^="player-tab-"]');
    await expect(tabs).toHaveCount(7);
    for (const tab of await tabs.all()) {
      const box = (await tab.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      expect(box.y + box.height).toBeLessThanOrEqual(844);
      expect(await tab.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await page.screenshot({ path: 'docs/agy/reports/img/phase6c-player-clues-390.png' });
    await page.getByRole('button', { name: '資料', exact: true }).click();
    await expect(page.getByRole('heading', { name: '資料', exact: true })).toBeVisible();
    await expect(page.getByTestId('lore-genres')).toBeVisible();
    await expect(page.getByTestId('player-tab-lore')).toContainText('DATA');
    await expect(page.getByText('試験の足跡', { exact: true })).toHaveCount(0);
    await page.getByTestId('lore-genre-timeline').click();
    await page.getByLabel('資料の一覧').getByRole('button').filter({ hasText: 'テスト都市の再開発' }).click();
    await expect(page.getByTestId('lore-detail')).toContainText('ＮＥＯ社が港を再開発する');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'docs/agy/reports/img/phase6c-player-data-390.png', fullPage: true });
  } finally {
    await request.delete(`/api/scenarios/${scenario.id}`, { headers });
  }
});
