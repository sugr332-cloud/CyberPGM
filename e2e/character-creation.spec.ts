import { test, expect } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';
import { characters, character_submissions } from '../apps/server/src/db/schema.js';
import { eq } from 'drizzle-orm';
import path from 'node:path';

test('Character creation flow: Player creates character on mobile, submits to GM, GM accepts in reception, and checks skills', async ({ browser }) => {
  const dbPath = process.env.DATABASE_URL || 'data/test-e2e.db';
  const { db } = createDb(dbPath);

  // Clean up submissions and test character
  db.delete(character_submissions).run();
  db.delete(characters).where(eq(characters.name, 'シルバー')).run();

  // 1. Mobile Context (390x844) - Player
  const playerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const playerPage = await playerContext.newPage();

  // Go to /player
  await playerPage.goto('/player');
  const createNavBtn = playerPage.getByRole('button', { name: '＋ 新しくキャラを作る' });
  await expect(createNavBtn).toBeVisible();

  // Click "新しくキャラを作る"
  await createNavBtn.click();
  await expect(playerPage).toHaveURL(/\/player\/create/);

  // Step 1: 基本
  await expect(playerPage.getByText('1. 基本情報を設定します')).toBeVisible();
  const nameInput = playerPage.locator('input[placeholder*="V, ジョニー"]');
  await nameInput.fill('シルバー');

  // Role: "ソロ" (Solo)
  const soloBtn = playerPage.getByRole('button', { name: /ソロ/ });
  await soloBtn.click();

  // Sample avatar upload & crop
  const sampleImagePath = path.resolve('docs/agy/reports/img/phase2-gm-pc.png');
  const fileInput = playerPage.locator('input[type="file"]');
  await fileInput.setInputFiles(sampleImagePath);

  // Click "決定" on square crop modal
  const cropConfirmBtn = playerPage.getByRole('button', { name: '決定' });
  await expect(cropConfirmBtn).toBeVisible();
  await cropConfirmBtn.click();

  // Wait for cropped avatar to appear
  await expect(playerPage.locator('img[alt="Avatar"]')).toBeVisible();

  // Screenshot 1: 基本 (390px)
  await playerPage.screenshot({
    path: 'docs/agy/reports/img/phase3b-create-01-basic.png',
  });

  // Next -> Step 2: 能力値
  await playerPage.getByRole('button', { name: '次へ: 能力値を決める →' }).click();
  await expect(playerPage.getByText('2. 10個の能力値を決定します')).toBeVisible();

  // Screenshot 2: 能力値 (390px)
  await playerPage.screenshot({
    path: 'docs/agy/reports/img/phase3b-create-02-stats.png',
  });

  // Next -> Step 3: 技能
  await playerPage.getByRole('button', { name: '次へ: 技能を選ぶ →' }).click();
  await expect(playerPage.getByText('3. 技能ポイントを割り振ります')).toBeVisible();

  // Expand formula explanation
  const formulaToggle = playerPage.getByRole('button', { name: /判定の計算方法/ });
  await formulaToggle.click();
  await expect(playerPage.getByText('技能判定の基本ルール:')).toBeVisible();

  // Screenshot 3: 技能 (390px)
  await playerPage.screenshot({
    path: 'docs/agy/reports/img/phase3b-create-03-skills.png',
  });

  // Next -> Step 4: 装備
  await playerPage.getByRole('button', { name: '次へ: 装備を選ぶ →' }).click();
  await expect(playerPage.getByText('4. 初期装備とサイバーウェアを選びます')).toBeVisible();

  // Select an item from catalog (e.g., first item)
  const firstItemSelectBtn = playerPage.locator('button', { hasText: '選択' }).first();
  await expect(firstItemSelectBtn).toBeVisible();
  await firstItemSelectBtn.click();

  // Screenshot 4: 装備 (390px)
  await playerPage.screenshot({
    path: 'docs/agy/reports/img/phase3b-create-04-gear.png',
  });

  // Next -> Step 5: 送信
  await playerPage.getByRole('button', { name: '次へ: 確認と送信 →' }).click();
  await expect(playerPage.getByText('5. 内容を確認してGMに送信します')).toBeVisible();
  await expect(playerPage.getByText('作成ルール検証チェック')).toBeVisible();

  // Screenshot 5: 送信 (390px)
  await playerPage.screenshot({
    path: 'docs/agy/reports/img/phase3b-create-05-submit.png',
  });

  // Click "GMに送る"
  const submitBtn = playerPage.getByRole('button', { name: '🚀 GMに送る' });
  await submitBtn.click();

  // Verify status is "GMの受付待ちです"
  await expect(playerPage.getByText('GMの受付待ちです')).toBeVisible();

  // 2. Desktop Context (1440x900) - GM
  const gmContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const gmPage = await gmContext.newPage();
  gmPage.on('console', (msg) => console.log('GM CONSOLE:', msg.text()));
  gmPage.on('dialog', async (dialog) => {
    console.log('GM DIALOG:', dialog.message());
    await dialog.dismiss();
  });
  await gmPage.goto('/gm');

  // Verify GM Dashboard and navigate to PC Tab -> キャラ受付
  const pcTabBtn = gmPage.getByRole('button', { name: 'PC', exact: true });
  await pcTabBtn.click();

  const receptionSubTabBtn = gmPage.getByRole('button', { name: /キャラ受付/ });
  await receptionSubTabBtn.click();

  // Verify submission "シルバー" appears in list
  await expect(gmPage.getByText('シルバー').first()).toBeVisible();

  // Screenshot 6: キャラ受付 (1440px)
  await gmPage.screenshot({
    path: 'docs/agy/reports/img/phase3b-gm-reception.png',
  });

  // Accept "シルバー"
  const acceptBtn = gmPage.getByRole('button', { name: '取り込む', exact: true }).first();
  await Promise.all([
    gmPage.waitForResponse((res) => res.url().includes('/accept') && res.status() === 200),
    acceptBtn.click(),
  ]);

  // Verify switch to PC list and "シルバー" is in PC cards
  await gmPage.getByRole('button', { name: 'PC 一覧', exact: true }).click();
  await expect(gmPage.getByText('シルバー').first()).toBeVisible();

  // Navigate to 技能 (Skills) tab
  const skillsTabBtn = gmPage.getByRole('button', { name: '技能', exact: true });
  await skillsTabBtn.click();

  // Verify SkillsView is rendered
  await expect(gmPage.getByText('技能一覧')).toBeVisible();

  // Select "知覚" row
  const perceptionRow = gmPage.locator('td', { hasText: '知覚' }).first();
  await perceptionRow.click();

  // Click DV 15 ("困難") button
  const dv15Btn = gmPage.getByRole('button', { name: /困難/ });
  await dv15Btn.click();

  // Verify PC success rates are displayed
  await expect(gmPage.getByText(/各PCの成功率/)).toBeVisible();
  await expect(gmPage.getByText('シルバー').first()).toBeVisible();

  // Screenshot 7: 技能タブ (1440px)
  await gmPage.screenshot({
    path: 'docs/agy/reports/img/phase3b-gm-skills.png',
  });

  // Clean up
  db.delete(character_submissions).run();
  db.delete(characters).where(eq(characters.name, 'シルバー')).run();
});
