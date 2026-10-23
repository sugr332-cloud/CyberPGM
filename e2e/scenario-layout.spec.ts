import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';
import { characters } from '../apps/server/src/db/schema.js';
import { eq } from 'drizzle-orm';

const actorIds = ['ui-check-pc1', 'ui-check-pc2', 'ui-check-npc', 'ui-check-mook'];
let scenarioId: string;
let sessionId: string;
let gmHeaders: Record<string, string>;
let audioId: string;

async function openPlay(page: Page) {
  await page.goto('/gm');
  await page.getByRole('button', { name: 'シナリオ', exact: true }).first().click();
  await page.getByRole('button', { name: '進める', exact: true }).click();
  await expect(page.getByTestId('scenario-play')).toBeVisible();
}

async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post(path, { headers: gmHeaders, data });
  expect(response.ok()).toBe(true);
  return response.json();
}

test.beforeEach(async ({ request }) => {
  const { db, sqlite } = createDb(process.env.DATABASE_URL || 'data/test-e2e.db');
  for (const t of ['story_checks', 'session_log', 'scenario_sessions', 'combat_log', 'combat_participants', 'combats']) sqlite.prepare(`DELETE FROM ${t}`).run();
  const base = db.select().from(characters).where(eq(characters.name, 'ヴァイパー')).get()!;
  for (const id of actorIds) sqlite.prepare('DELETE FROM characters WHERE id = ?').run(id);
  db.insert(characters).values(actorIds.map((id, i) => ({ ...base, id, name: ['UI PC1', 'UI PC2', 'UI NPC', 'UI モブ'][i], kind: ['pc', 'pc', 'npc', 'mook'][i], player_id: null, scenario_id: null, skills: JSON.stringify({ perception: 5, 'science:化学': 4 }) }))).run();
  sqlite.close();
  const gm = await (await request.post('/api/auth/gm-token')).json();
  gmHeaders = { Authorization: `Bearer ${gm.token}` };
  const created = await post(request, '/api/scenarios', { title: 'シナリオUIテスト', use_template: false });
  scenarioId = created.scenario.id;
  const sceneData = await post(request, `/api/scenarios/${scenarioId}/scenes`, { title: '判定テストの部屋', read_aloud: '中央でシーンと判定を確認する。', gm_notes: '横画面で操作を確認する。' });
  const sceneId = (sceneData.scene ?? sceneData).id;
  await post(request, `/api/scenarios/scenes/${sceneId}/choices`, { label: '部屋を調べる', skill_key: 'perception', dv: 13 });
  const started = await post(request, '/api/scenario-sessions/start', { scenario_id: scenarioId, initial_scene_id: sceneId });
  sessionId = started.sessionId;
  const wav = Buffer.alloc(4844, 128);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  const audio = await request.post('/api/audio', { headers: gmHeaders, multipart: { file: { name: 'UI-silence.wav', mimeType: 'audio/wav', buffer: wav } } });
  expect(audio.ok()).toBe(true);
  audioId = (await audio.json()).audio.id;
});

test.afterEach(() => {
  const { sqlite } = createDb(process.env.DATABASE_URL || 'data/test-e2e.db');
  if (scenarioId) sqlite.prepare('DELETE FROM scenarios WHERE id = ?').run(scenarioId);
  for (const id of actorIds) sqlite.prepare('DELETE FROM characters WHERE id = ?').run(id);
  sqlite.close();
});

test('choice checks allow any combination of PCs, NPCs and mobs; skill search includes specialties', async ({ page, request }) => {
  await openPlay(page);
  await page.getByRole('button', { name: '判定作成', exact: true }).click();
  const dialog = page.getByTestId('story-check-dialog');
  await expect(dialog.getByTestId('story-check-create')).toBeDisabled();
  for (const name of ['UI PC2', 'UI NPC', 'UI モブ']) await dialog.getByRole('checkbox', { name: new RegExp(name) }).check();
  await expect(dialog.getByLabel('判定の技能', { exact: true })).toHaveValue('perception');
  await dialog.getByTestId('story-check-create').click();
  await expect(dialog).toHaveCount(0);
  const checks = (await (await request.get(`/api/scenario-sessions/${sessionId}/checks`, { headers: gmHeaders })).json()).checks;
  expect(checks.map((c: { actor_character_id: string }) => c.actor_character_id).sort()).toEqual(actorIds.slice(1).sort());
  await expect(page.locator('[data-testid^="story-check-"]').filter({ has: page.getByLabel('出目', { exact: true }) })).toHaveCount(3);

  await page.getByRole('button', { name: '＋ 判定を作成', exact: true }).click();
  await dialog.getByLabel('判定者を検索').fill('UI NPC');
  await dialog.getByRole('checkbox', { name: /UI NPC/ }).check();
  await dialog.getByLabel('判定の技能を検索', { exact: true }).fill('化学');
  await dialog.getByLabel('判定の技能', { exact: true }).selectOption('science:化学');
  await dialog.getByLabel('判定の難易度').fill('15');
  await dialog.getByTestId('story-check-create').click();
  await expect(dialog).toHaveCount(0);
  const row = page.locator('[data-testid^="story-check-"]').filter({ hasText: 'GM が追加した判定' });
  await expect(row).toContainText('UI NPC');
  await expect(row.getByLabel('技能', { exact: true })).toHaveValue('science:化学');
  await row.getByLabel('技能を検索', { exact: true }).fill('athletics');
  await row.getByLabel('技能', { exact: true }).selectOption('athletics');
  await expect(row.getByLabel('技能', { exact: true })).toHaveValue('athletics');
});

test('landscape layout uses a wide center for checks, with BGM next to the log and working controls', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openPlay(page);
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const main = (await page.getByTestId('scenario-main').boundingBox())!;
    const reference = (await page.getByTestId('scenario-reference').boundingBox())!;
    const log = (await page.getByTestId('scenario-log').boundingBox())!;
    const bgm = (await page.getByTestId('scenario-bgm-panel').boundingBox())!;
    expect(main.width).toBeGreaterThan(reference.width * 1.6);
    expect(bgm.x).toBeGreaterThanOrEqual(log.x + log.width);
    expect(Math.abs(bgm.y - log.y)).toBeLessThan(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/scenario-layout-${width}.png`, fullPage: true });
  }
  const bgm = page.getByTestId('scenario-bgm-panel');
  await bgm.getByLabel('BGM', { exact: true }).selectOption(audioId);
  await expect(bgm.getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await bgm.getByRole('button', { name: '停止', exact: true }).click();
  await expect(bgm.getByRole('button', { name: '再生', exact: true })).toBeVisible();
  const volume = bgm.getByLabel('音量', { exact: true });
  await volume.focus();
  await volume.press('ArrowLeft');
  await expect.poll(async () => (await (await request.get('/api/display', { headers: gmHeaders })).json()).display.bgm.volume).toBe(69);
  await bgm.getByRole('checkbox', { name: 'ループ', exact: true }).uncheck();
  await expect.poll(async () => (await (await request.get('/api/display', { headers: gmHeaders })).json()).display.bgm.loop).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/scenario-layout-mobile.png', fullPage: true });
});

test('a rejected check request keeps the actor selection and shows the server error', async ({ page }) => {
  await openPlay(page);
  await page.getByRole('button', { name: '判定作成', exact: true }).click();
  const dialog = page.getByTestId('story-check-dialog');
  await dialog.getByRole('checkbox', { name: /UI NPC/ }).check();
  await page.route('**/api/scenario-sessions/*/checks', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 409, json: { error: 'テスト用: 作成をやり直してください' } });
    else await route.continue();
  });
  await dialog.getByTestId('story-check-create').click();
  await expect(dialog.getByRole('alert')).toContainText('作成をやり直してください');
  await expect(dialog.getByRole('checkbox', { name: /UI NPC/ })).toBeChecked();
  await expect(dialog.getByTestId('story-check-create')).toBeEnabled();
});
