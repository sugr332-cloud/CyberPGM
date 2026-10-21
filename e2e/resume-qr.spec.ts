import { test, expect } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';

// Phase 5d §3 E2E: 保存 → 読み込み → GM の画面に PC ごとの QR → ヴァイパーの URL をスマホで開くとシートが出る
test('Resume QR: after loading a save, each PC has a QR that opens their sheet on the phone', async ({ browser, request }) => {
  const dbPath = process.env.DATABASE_URL || 'data/test-e2e.db';
  const { sqlite } = createDb(dbPath);
  sqlite.prepare('DELETE FROM devices').run();
  sqlite.close();

  const gm = (await (await request.post('/api/auth/gm-token')).json()).token as string;
  // ほかのスペックの保存・読み込みで PC が入れ替わっていることがあるので、ヴァイパーがいなければ作る
  const list = await (await request.get('/api/characters', { headers: { Authorization: `Bearer ${gm}` } })).json();
  if (!list.characters.some((c: { name: string; kind: string }) => c.name === 'ヴァイパー' && c.kind === 'pc')) {
    await request.post('/api/characters', {
      headers: { Authorization: `Bearer ${gm}` },
      data: {
        kind: 'pc',
        name: 'ヴァイパー',
        role: 'ソロ',
        stats: { int: 4, ref: 8, dex: 7, tech: 3, cool: 6, will: 5, luck: 5, move: 6, body: 7, emp: 5 },
        skills: { handgun: 6, evasion: 6 },
        hp: 35,
        hp_max: 35,
        humanity: 50,
        emp_max: 5,
      },
    });
  }
  const save = await (await request.post('/api/saves', { headers: { Authorization: `Bearer ${gm}` }, data: { name: 'E2E 再開テスト' } })).json();

  const gmPage = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  gmPage.on('dialog', (d) => d.accept());
  await gmPage.goto('/gm');
  await gmPage.getByRole('button', { name: /保存・読み込み/ }).click();
  await gmPage.getByTestId(`save-row-${save.save.id}`).getByRole('button', { name: '読み込む' }).click();

  const panel = gmPage.getByTestId('resume-qr-panel');
  await expect(panel.getByText('セーブ「E2E 再開テスト」を読み込みました')).toBeVisible();
  const viperCard = panel.getByTestId('resume-qr-card').filter({ hasText: 'ヴァイパー' });
  await expect(viperCard.locator('svg')).toBeVisible();
  await gmPage.screenshot({ path: 'docs/agy/reports/img/phase5d-resume-qr-1440.png' });
  const url = new URL((await viperCard.getAttribute('data-url'))!);
  expect(url.searchParams.get('pc')).toBeTruthy();
  expect(save.save.id).toBeTruthy();

  // スマホ: QR の URL を開くだけで、キャラ選びなしでヴァイパーのシートが開く
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
  await phone.goto(`${url.pathname}${url.search}`);
  await expect(phone.getByText('キャラクターを選択:')).toHaveCount(0);
  await expect(phone.getByText('ヴァイパー').first()).toBeVisible();
  await expect(phone.getByTestId('player-tab-sheet')).toBeVisible();
  await phone.screenshot({ path: 'docs/agy/reports/img/phase5d-phone-from-qr-390.png' });

  // PC タブの「このキャラの QR」は 1 人分だけ
  await panel.getByRole('button', { name: '閉じる' }).click();
  await gmPage.getByRole('button', { name: 'PC' }).first().click();
  await gmPage.getByRole('button', { name: 'このキャラの QR' }).first().click();
  await expect(gmPage.getByTestId('resume-qr-card')).toHaveCount(1);
});
