import { test, expect } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';

// Phase 5i E2E: 名前の登録 → キャラを選ぶ → 別の Wi-Fi（記録なし）で名前を選ぶと自動で自分のキャラ → 未クリアのシナリオの縛り
test('Players: register, auto-select own character on a fresh phone, scenario lock', async ({ browser, request }) => {
  const dbPath = process.env.DATABASE_URL || 'data/test-e2e.db';
  const { sqlite } = createDb(dbPath);
  for (const t of ['story_checks', 'session_log', 'scenario_sessions', 'devices']) sqlite.prepare(`DELETE FROM ${t}`).run();
  sqlite.prepare('UPDATE characters SET player_id = NULL, scenario_id = NULL').run();
  sqlite.prepare("DELETE FROM players WHERE name = 'はなこ'").run();
  sqlite.close();

  const gm = (await (await request.post('/api/auth/gm-token')).json()).token as string;
  const H = { Authorization: `Bearer ${gm}` };
  const code = (await (await request.get('/api/session', { headers: H })).json()).code as string;
  const scenarioA = (await (await request.post('/api/scenarios', { headers: H, data: { title: '港の取引', use_template: false } })).json()).scenario.id;
  const scenarioB = (await (await request.post('/api/scenarios', { headers: H, data: { title: '夜の病院', use_template: false } })).json()).scenario.id;
  const sessionA = (await (await request.post('/api/scenario-sessions/start', { headers: H, data: { scenario_id: scenarioA } })).json()).sessionId;

  // 1 台目: 名前を登録してニクスを選ぶ（シナリオ「港の取引」の進行中なので、ニクスはこのシナリオに入る）
  const phone1 = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
  await phone1.goto(`/player?join=${code}`);
  await expect(phone1.getByText('あなたは？')).toBeVisible();
  await phone1.getByPlaceholder('例: たろう').fill('はなこ');
  await phone1.screenshot({ path: 'docs/agy/reports/img/phase5i-who-are-you-390.png' });
  await phone1.getByRole('button', { name: '登録する' }).click();
  await expect(phone1.getByText('はなこ さんのキャラクターを選択:')).toBeVisible();
  await phone1.getByRole('button', { name: /ニクス/ }).click();
  await expect(phone1.getByTestId('player-tab-sheet')).toBeVisible();

  // 2 台目（別の Wi-Fi で記録がないのと同じ）: 名前をタップするだけで、GM の承認なしにニクスが開く
  const phone2 = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
  await phone2.goto(`/player?join=${code}`);
  await phone2.getByRole('button', { name: 'はなこ', exact: true }).click();
  await expect(phone2.getByTestId('player-tab-sheet')).toBeVisible();
  await expect(phone2.getByRole('heading', { name: 'ニクス' })).toBeVisible();

  // 「港の取引」を中断して「夜の病院」を始めると、ニクスは選べない
  await request.post(`/api/scenario-sessions/${sessionA}/end`, { headers: H });
  const sessionB = (await (await request.post('/api/scenario-sessions/start', { headers: H, data: { scenario_id: scenarioB } })).json()).sessionId;
  phone2.on('dialog', (d) => d.accept());
  await phone2.getByRole('button', { name: 'キャラを変える' }).click();
  await phone2.goto(`/player?join=${code}`);
  const nyxButton = phone2.getByRole('button', { name: /ニクス/ });
  await expect(nyxButton).toContainText('「港の取引」が未クリアのため、「港の取引」以外では選べません');
  await expect(nyxButton).toBeDisabled();
  await phone2.screenshot({ path: 'docs/agy/reports/img/phase5i-locked-390.png' });

  // GM の PC タブ: 持ち主と「未クリア」が見え、「シナリオから外す」で選べるようになる
  await request.post(`/api/scenario-sessions/${sessionB}/end`, { headers: H });
  const gmPage = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await gmPage.goto('/gm');
  const nyxCard = gmPage.getByTestId('pc-card').filter({ hasText: 'ニクス' });
  await expect(nyxCard.getByText('「港の取引」未クリア')).toBeVisible();
  await expect(nyxCard.locator('select')).toHaveValue(/.+/);
  await gmPage.screenshot({ path: 'docs/agy/reports/img/phase5i-gm-pc-owner-1440.png' });
  gmPage.on('dialog', (d) => d.accept());
  await nyxCard.getByRole('button', { name: 'シナリオから外す' }).click();
  await expect(nyxCard.getByText('「港の取引」未クリア')).toHaveCount(0);

  // 前のテストで開いたままのスマホも「港の取引」に入ったので、後のテストのために外す
  const cleanup = createDb(dbPath);
  cleanup.sqlite.prepare('UPDATE characters SET scenario_id = NULL').run();
  cleanup.sqlite.close();
});
