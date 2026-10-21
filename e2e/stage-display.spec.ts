import { test, expect } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';

// 1x1 の PNG（背景と立ち絵の代わり）
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// Phase 5e §4 E2E: 背景と立ち絵 → 表示ウィンドウに出る（操作の欄はない）→ 戦闘開始 → 戦闘中にモブを 2 体足す → 別ウィンドウと TV に出る
test('Stage display: background and portraits on the display window, then mobs join mid-combat', async ({ browser, request }) => {
  // ほかのスペックの進行・戦闘が残っていれば片付ける
  const { sqlite } = createDb(process.env.DATABASE_URL || 'data/test-e2e.db');
  for (const t of ['story_checks', 'session_log', 'scenario_sessions', 'combat_log', 'combat_participants', 'combats']) {
    sqlite.prepare(`DELETE FROM ${t}`).run();
  }
  sqlite.close();

  const gm = (await (await request.post('/api/auth/gm-token')).json()).token as string;
  const H = { Authorization: `Bearer ${gm}` };
  const uploadPng = async (title: string) =>
    (await (await request.post('/api/images', { headers: H, multipart: { image: { name: `${title}.png`, mimeType: 'image/png', buffer: PNG }, title, visibility: 'players' } })).json()).image.id as string;
  const bgId = await uploadPng('背景: バー');
  const portraitId = await uploadPng('立ち絵: ヴァイパー');

  const chars = (await (await request.get('/api/characters', { headers: H })).json()).characters as Array<{ id: string; name: string }>;
  const viper = chars.find((c) => c.name === 'ヴァイパー')!;
  await request.patch(`/api/characters/${viper.id}`, { headers: H, data: { portrait_image_id: portraitId } });
  const mook = (await (await request.post('/api/characters', {
    headers: H,
    data: { kind: 'mook', name: 'E2E チンピラ', role: 'ソロ', stats: { int: 3, ref: 5, dex: 5, tech: 3, cool: 4, will: 4, luck: 0, move: 5, body: 5, emp: 3 }, skills: {}, hp: 25, hp_max: 25, humanity: 30, emp_max: 3 },
  })).json()).character;

  const scenario = await (await request.post('/api/scenarios', { headers: H, data: { title: 'E2E 舞台', use_template: false } })).json();
  const scene = await (await request.post(`/api/scenarios/${scenario.scenario.id}/scenes`, { headers: H, data: { title: 'バー' } })).json();
  await request.patch(`/api/scenarios/scenes/${(scene.scene ?? scene).id}`, { headers: H, data: { background_image_id: bgId } });

  // GM: 進行を始め、舞台パネルでヴァイパーを登場させる
  const gmPage = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  gmPage.on('dialog', (d) => d.accept());
  await gmPage.goto('/gm');
  await gmPage.getByRole('button', { name: 'シナリオ' }).first().click();
  await gmPage.getByRole('button', { name: '進める' }).click();
  await gmPage.locator('select').first().selectOption({ label: 'E2E 舞台' });
  await gmPage.getByRole('button', { name: '進行を開始する' }).click();
  const panel = gmPage.getByTestId('stage-panel');
  await expect(panel).toBeVisible();
  await panel.getByLabel('登場させるキャラ').selectOption({ label: 'ヴァイパー' });
  await expect(panel.getByTestId('stage-portrait-row')).toHaveCount(1);
  await panel.getByRole('button', { name: '左' }).click();
  await panel.scrollIntoViewIfNeeded();
  await gmPage.screenshot({ path: 'docs/agy/reports/img/phase5e-stage-panel-1440.png' });

  // 表示ウィンドウ: 背景と立ち絵が出て、操作の欄はない
  const session = await (await request.get('/api/session', { headers: H })).json();
  const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await tv.goto(`/screen?code=${session.code}`);
  const stage = tv.getByTestId('screen-stage');
  await expect(stage).toBeVisible();
  await expect(stage.getByTestId('screen-portrait')).toHaveCount(1);
  await expect(stage.getByText('ヴァイパー')).toBeVisible();
  await expect(tv.locator('select, input, textarea')).toHaveCount(0);
  await expect(tv.getByRole('button')).toHaveCount(0); // BGM がないので「音声を有効にする」も出ない
  await tv.screenshot({ path: 'docs/agy/reports/img/phase5e-display-story-1920.png' });

  // 戦闘を始め、戦闘中にモブを 2 体足す
  await gmPage.getByRole('button', { name: '戦闘' }).first().click();
  await gmPage.getByRole('button', { name: '戦闘を始める' }).click();
  await gmPage.getByRole('button', { name: '行動順を確定して戦闘開始' }).first().click();
  await gmPage.getByRole('button', { name: '参加者を足す' }).click();
  const dialog = gmPage.getByTestId('join-combat-dialog');
  await dialog.getByLabel('足すキャラ').selectOption({ label: 'E2E チンピラ（モブ）' });
  await dialog.getByLabel('人数').fill('2');
  await dialog.getByRole('button', { name: '足す' }).click();
  await expect(gmPage.getByText('E2E チンピラ #1').first()).toBeVisible();
  await expect(gmPage.getByText('E2E チンピラ #2').first()).toBeVisible();
  await gmPage.screenshot({ path: 'docs/agy/reports/img/phase5e-combat-join-1440.png' });

  const win = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await win.goto('/gm/combat');
  await expect(win.getByText('E2E チンピラ #2').first()).toBeVisible();
  await expect(win.getByTestId('stage-panel')).toHaveCount(0); // 舞台パネルは GM のメインウィンドウだけ

  await expect(tv.getByText('E2E チンピラ #1').first()).toBeVisible();
  await tv.screenshot({ path: 'docs/agy/reports/img/phase5e-display-combat-1920.png' });
  expect(mook.id).toBeTruthy();
});
