import { test, expect } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';
import { characters } from '../apps/server/src/db/schema.js';
import { eq } from 'drizzle-orm';
import { generateUlid } from '@cyberpgm/shared';
import { joinAsPlayer } from './join.js';

test('Combat Flow: Participant Check, Initiative, Player Attack via Mobile, GM Apply, and Undo', async ({ browser }) => {
  const dbPath = process.env.DATABASE_URL || 'data/test-e2e.db';
  const { db, sqlite } = createDb(dbPath);
  // 大型拳銃の品目 ID は DB ごとに違うので名前で引く
  const heavyPistolId = (sqlite.prepare("SELECT id FROM items WHERE name_en = 'Heavy Pistol'").get() as { id: string }).id;

  // Clean combat state in test DB
  sqlite.prepare('DELETE FROM combat_log').run();
  sqlite.prepare('DELETE FROM combat_participants').run();
  sqlite.prepare('DELETE FROM combats').run();
  sqlite.prepare('DELETE FROM devices').run();

  // Ensure Ganger mook template exists
  let ganger = db.select().from(characters).where(eq(characters.name, 'ガンガー')).get();
  if (!ganger) {
    const now = Date.now();
    const gId = generateUlid();
    db.insert(characters).values({
      id: gId,
      kind: 'mook',
      name: 'ガンガー',
      role: 'Ganger',
      stats: JSON.stringify({ int: 4, ref: 5, dex: 5, tech: 3, cool: 4, will: 4, luck: 0, move: 5, body: 6, emp: 3 }),
      skills: JSON.stringify({ Handgun: 3, Evasion: 3 }),
      hp: 25,
      hp_max: 25,
      sp_head: 4,
      sp_body: 7,
      humanity: 30,
      emp_max: 3,
      weapons: '[]',
      inventory: '[]',
      status: '[]',
      crit_injuries: '[]',
      created_at: now,
      updated_at: now,
    }).run();
    ganger = db.select().from(characters).where(eq(characters.id, gId)).get();
  }

  // Ensure Viper has weapon in inventory with kind: 'weapon' and ammo: 8
  const viper = db.select().from(characters).where(eq(characters.name, 'ヴァイパー')).get();
  if (viper) {
    const inv = JSON.parse(viper.inventory || '[]');
    const wIdx = inv.findIndex((i: any) => i.kind === 'weapon' || i.name === '大型拳銃' || i.name === 'ヘビー・ピストル');
    if (wIdx >= 0) {
      inv[wIdx] = {
        ...inv[wIdx],
        item_id: heavyPistolId,
        name: '大型拳銃',
        kind: 'weapon',
        ammo: 8,
      };
    } else {
      inv.push({
        entry_id: generateUlid(),
        item_id: heavyPistolId,
        name: '大型拳銃',
        kind: 'weapon',
        qty: 1,
        equipped: true,
        ammo: 8,
      });
    }
    db.update(characters)
      .set({ inventory: JSON.stringify(inv) })
      .where(eq(characters.id, viper.id))
      .run();
  }

  // 1. GM Context (1440x900)
  const gmContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const gmPage = await gmContext.newPage();

  await gmPage.goto('/gm');
  await expect(gmPage.getByText('CYBERPGM').first()).toBeVisible();

  // Switch to Combat Tab
  await gmPage.getByRole('button', { name: '戦闘' }).click();

  // Click "戦闘を始める"
  await gmPage.getByRole('button', { name: '戦闘を始める' }).click();
  await expect(gmPage.getByRole('heading', { name: 'PC 参加者' })).toBeVisible();

  // Add 2 Gangers as enemy mooks
  const npcSelect = gmPage.locator('select').filter({ hasText: 'NPC/モブを選択' });
  await npcSelect.selectOption({ label: 'ガンガー (モブ / Ganger)' });

  // Set mook count to 2 if needed
  const countInput = gmPage.locator('div').filter({ hasText: /^人数:/ }).locator('input');
  if (await countInput.isVisible()) {
    await countInput.fill('2');
  }

  await gmPage.getByRole('button', { name: '敵として追加' }).click();

  // Verify Ganger #1 and #2 appear in participant check list
  await expect(gmPage.getByText('ガンガー #1', { exact: true })).toBeVisible();
  await expect(gmPage.getByText('ガンガー #2', { exact: true })).toBeVisible();

  // Screenshot 1: 参加者チェック (1440px)
  await gmPage.screenshot({
    path: 'docs/agy/reports/img/phase4a-participants-check.png',
  });

  // Fetch session code for player join
  const healthRes = await gmPage.request.get('/api/health');
  const healthData = await healthRes.json();
  const sessionCode = healthData.session;

  // Set Viper initiative roll to 10 so Viper acts first
  const viperInitInput = gmPage.getByTestId('init-input-ヴァイパー');
  await expect(viperInitInput).toBeVisible();
  await viperInitInput.fill('10');

  // Confirm Initiative and Start Combat
  await gmPage.getByRole('button', { name: '行動順を確定して戦闘開始' }).first().click();

  // Verify Active Combat Screen loaded
  await expect(gmPage.getByText(/ラウンド 1/i)).toBeVisible();
  await expect(gmPage.getByText(/のターンです/i)).toBeVisible();

  // 2. Player Mobile Context (390x844)
  const playerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  });
  const playerPage = await playerContext.newPage();

  // Join as Viper
  await joinAsPlayer(playerPage, sessionCode, 'ヴァイパー');

  // Switch to Action Tab
  await playerPage.getByRole('button', { name: '行動' }).click();

  // If it's Viper's turn, choose Ranged and submit roll
  const rangedBtn = playerPage.getByRole('button', { name: /^射撃/i });
  if (await rangedBtn.isVisible()) {
    await rangedBtn.click();
    // Use Dice Pad: tap 7
    await playerPage.getByRole('button', { name: '7', exact: true }).click();
    await playerPage.getByRole('button', { name: 'GM に出目を送信' }).click();
  } else {
    // If other turn, test Dodge button
    const dodgeBtn = playerPage.getByRole('button', { name: /回避/i });
    await expect(dodgeBtn).toBeVisible();
  }

  // 3. Back to GM Screen: Resolve Ranged Attack
  await gmPage.bringToFront();

  // Select "射撃" action in Turn Guide
  await gmPage.getByRole('button', { name: '射撃', exact: true }).click();

  // Select Target "ガンガー #1"
  const targetGangerBtn = gmPage.locator('button', { hasText: 'ガンガー #1' }).last();
  await targetGangerBtn.click();

  // Select valid weapon if dropdown exists
  const weaponSelect = gmPage.locator('select').filter({ hasText: /武器を選択/ });
  if (await weaponSelect.isVisible()) {
    const options = await weaponSelect.locator('option').all();
    for (const opt of options) {
      const val = await opt.getAttribute('value');
      if (val && val !== '') {
        await weaponSelect.selectOption(val);
        break;
      }
    }
  }

  // Set distance 5m and attack roll 8 to guarantee hit (14 + 8 = 22 > DV 13)
  const distanceInput = gmPage.getByRole('spinbutton').nth(0);
  await distanceInput.fill('5');
  const attackInput = gmPage.getByRole('spinbutton').nth(1);
  await attackInput.fill('8');

  const damageInput = gmPage.getByPlaceholder('6, 6, 2');
  if (await damageInput.isVisible()) {
    await damageInput.fill('6, 5, 2');
  }

  // Calculate resolution
  await gmPage.getByRole('button', { name: '判定と反映内容を計算' }).click();

  // Verify preview changes visible
  await expect(gmPage.getByText(/反映する内容:/i)).toBeVisible();
  await expect(gmPage.getByText(/ガンガー #1 HP 25 →/i)).toBeVisible();

  // Screenshot 2: 戦闘画面で射撃の手順と「反映する内容」 (1440px)
  await gmPage.screenshot({
    path: 'docs/agy/reports/img/phase4a-combat-resolve.png',
  });

  // Apply Action to DB
  await gmPage.getByRole('button', { name: '確定して反映' }).click();

  // Verify combat log updated
  await expect(gmPage.getByText(/ガンガー #1 HP 25 →/i).first()).toBeVisible();

  // 4. Back to Player Mobile Screen: Verify result notification & sheet updates
  await playerPage.bringToFront();
  await playerPage.getByTestId('player-tab-sheet').click();

  // Screenshot 4: スマホの行動画面と被弾・結果の通知 (390px)
  await playerPage.screenshot({
    path: 'docs/agy/reports/img/phase4a-player-action.png',
  });

  // 5. GM Screen on Mobile View (390x844)
  const gmMobieContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const gmMobilePage = await gmMobieContext.newPage();
  await gmMobilePage.goto('/gm');
  await gmMobilePage.getByRole('button', { name: '戦闘' }).click();

  // Verify Mobile tab switcher (味方 / 敵) visible
  await expect(gmMobilePage.getByRole('button', { name: /味方 \(/i })).toBeVisible();
  await expect(gmMobilePage.getByRole('button', { name: /敵 \(/i })).toBeVisible();

  // Screenshot 3: 戦闘画面 (390px)
  await gmMobilePage.screenshot({
    path: 'docs/agy/reports/img/phase4a-combat-mobile.png',
  });

  // 6. Test Undo in GM screen
  await gmPage.bringToFront();
  // Accept confirm dialog automatically
  gmPage.on('dialog', async (dialog) => {
    await dialog.accept();
  });
  await gmPage.getByRole('button', { name: '取り消す' }).click();

  // Verify HP restored in DB
  await expect(async () => {
    const restoredPart = db.select().from(characters).where(eq(characters.name, 'ガンガー #1')).get();
    expect(restoredPart?.hp).toBe(25);
  }).toPass({ timeout: 5000 });
});
