import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { db } from '../apps/server/src/db/client.js';
import { devices } from '../apps/server/src/db/schema.js';

test('GM login, player QR join, and real-time fund notification flow', async ({ browser }) => {
  // Clear any existing active devices before E2E test
  db.delete(devices).run();

  // Read current GM PIN from data/config.json
  const configPath = path.resolve(process.cwd(), 'data/config.json');
  expect(fs.existsSync(configPath)).toBe(true);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const pin = config.gmPin;
  expect(pin).toBeDefined();

  // 1. GM Context (1440x900)
  const gmContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const gmPage = await gmContext.newPage();

  // Access GM window
  await gmPage.goto('/gm');
  await expect(gmPage.getByPlaceholder(/GM PIN/i)).toBeVisible();

  // Login with PIN
  await gmPage.getByPlaceholder(/GM PIN/i).fill(pin);
  await gmPage.getByRole('button', { name: 'ログイン' }).click();

  // Verify GM Dashboard loaded
  await expect(gmPage.getByText('CYBERPGM').first()).toBeVisible();
  await expect(gmPage.getByText('ヴァイパー').first()).toBeVisible();
  await expect(gmPage.getByRole('button', { name: '参加用 QR' })).toBeVisible();
  await expect(gmPage.getByRole('button', { name: '保存・読み込み' })).toBeVisible();
  await expect(gmPage.getByText(/Homebrew Content Policy of R. Talsorian Games/i)).toBeVisible();
  await expect(gmPage.getByText(/Cyberpunk RED - Core/i)).toBeVisible();

  // Take Screenshot: GM PC Management
  await gmPage.screenshot({
    path: 'docs/agy/reports/img/phase2-gm-pc.png',
  });

  // Open "参加用 QR" Modal
  await gmPage.getByRole('button', { name: /参加用 QR/i }).click();
  await expect(gmPage.getByRole('heading', { name: 'セッション参加用 QR' })).toBeVisible();

  // Take Screenshot: GM QR Modal
  await gmPage.screenshot({
    path: 'docs/agy/reports/img/phase2-gm-qr.png',
  });

  // Close QR Modal
  await gmPage.getByRole('button', { name: '✕' }).click();

  // Open "保存・読み込み" Modal
  await gmPage.getByRole('button', { name: /保存・読み込み/i }).click();
  await expect(gmPage.getByRole('heading', { name: 'セッションの保存と読み込み' })).toBeVisible();

  // Take Screenshot: GM Saves Modal
  await gmPage.screenshot({
    path: 'docs/agy/reports/img/phase2-gm-saves.png',
  });

  // Close Saves Modal
  await gmPage.getByRole('button', { name: '✕' }).click();

  // Fetch current session code via API
  const healthRes = await gmPage.request.get('/api/health');
  const healthData = await healthRes.json();
  const sessionCode = healthData.session;
  expect(sessionCode.length).toBe(6);

  // 2. Player Context (Mobile: 390x844)
  const playerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  });
  const playerPage = await playerContext.newPage();

  // Navigate to /player?join=<sessionCode>
  await playerPage.goto(`/player?join=${sessionCode}`);
  await expect(playerPage.getByText('自分のキャラクターを選択:')).toBeVisible();

  // Take Screenshot: Player Join Screen
  await playerPage.screenshot({
    path: 'docs/agy/reports/img/phase2-player-join.png',
  });

  // Select "ヴァイパー"
  await playerPage.getByRole('button', { name: /ヴァイパー/i }).click();

  // Verify Player Character Sheet loaded
  await expect(playerPage.getByRole('heading', { name: 'ヴァイパー' })).toBeVisible();
  await expect(playerPage.getByText(/ソロ/i)).toBeVisible();
  await expect(playerPage.getByText(/HP/i)).toBeVisible();
  await expect(playerPage.getByText('拳銃')).toBeVisible();
  await expect(playerPage.getByText('回避')).toBeVisible();

  // Take Screenshot: Player Character Sheet
  await playerPage.screenshot({
    path: 'docs/agy/reports/img/phase2-player-sheet.png',
  });

  // 3. GM sends +500 eb to ヴァイパー
  // Click "+ 500 eb" on the first PC card (Viper)
  const plus500Btn = gmPage.getByRole('button', { name: /＋ 500 eb/i }).first();
  await plus500Btn.click();

  // 4. Verify notification banner on Player Page
  const banner = playerPage.getByTestId('notify-banner');
  await expect(banner).toBeVisible({ timeout: 5000 });
  await expect(banner).toContainText('+500 eb');
  await expect(banner).toContainText('依頼の報酬');

  // Take Screenshot: Player Notification Banner
  await playerPage.screenshot({
    path: 'docs/agy/reports/img/phase2-player-notify.png',
  });

  // Cleanup
  await gmContext.close();
  await playerContext.close();
});
