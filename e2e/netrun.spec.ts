import { test, expect } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';
import { characters } from '../apps/server/src/db/schema.js';
import { eq } from 'drizzle-orm';
import { generateUlid } from '@cyberpgm/shared';
import { joinAsPlayer } from './join.js';

test('Phase 5z Netrun Flow: Create Architecture, Jack In, Pathfinder, Backdoor, Descend, Encounter ICE, Sword, Mobile Player View, and Jack Out', async ({
  browser,
}) => {
  const dbPath = process.env.DATABASE_URL || 'data/test-e2e.db';
  const { db, sqlite } = createDb(dbPath);

  // Clean combat & net architectures in test DB
  sqlite.prepare('DELETE FROM combat_log').run();
  sqlite.prepare('DELETE FROM combat_participants').run();
  sqlite.prepare('DELETE FROM combats').run();
  sqlite.prepare('DELETE FROM devices').run();
  sqlite.prepare("DELETE FROM rule_constants WHERE key LIKE 'net_architecture.%'").run();

  // Ensure Ganger mook exists
  let ganger = db.select().from(characters).where(eq(characters.name, 'ガンガー')).get();
  if (!ganger) {
    const now = Date.now();
    const gId = generateUlid();
    db.insert(characters)
      .values({
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
      })
      .run();
    ganger = db.select().from(characters).where(eq(characters.id, gId)).get();
  }

  // Ensure Viper is configured as Netrunner Rank 4 with Cyberdeck (Sword + Armor) and Virtuality Goggles
  const viper = db.select().from(characters).where(eq(characters.name, 'ヴァイパー')).get();
  if (viper) {
    const skills = JSON.parse(viper.skills || '{}');
    skills.interface = 4;
    const extra = JSON.parse(viper.extra || '{}');
    extra.role_ranks = { ...(extra.role_ranks || {}), Netrunner: 4 };
    extra.cyberdeck = {
      slots: 7,
      programs: ['Sword', 'Armor', 'Speedy Gonzalvez'],
      hardware: ['Insulated Wiring'],
    };
    const inv = JSON.parse(viper.inventory || '[]');
    if (!inv.some((it: any) => String(it.name || '').includes('ヴァーチャリティ'))) {
      inv.push({
        entry_id: generateUlid(),
        name: 'ヴァーチャリティ・ゴーグル',
        kind: 'gear',
        qty: 1,
        equipped: true,
      });
    }
    db.update(characters)
      .set({
        role: 'Netrunner',
        hp: 40,
        hp_max: 40,
        skills: JSON.stringify(skills),
        extra: JSON.stringify(extra),
        inventory: JSON.stringify(inv),
        status: '[]',
      })
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

  // Open Scenario Maker -> NET構造体・セキュリティ tab
  await gmPage.getByRole('button', { name: 'シナリオ', exact: true }).click();
  await gmPage.getByTestId('tab-netrun').click();
  await expect(gmPage.getByTestId('netrun-gm-panel')).toBeVisible();

  // Create deterministic 3-floor NET Architecture via UI
  await gmPage.getByLabel('NET構造体の名前').fill('アラサカ試験サブネット');
  await gmPage.getByTestId('netrun-manual-create-btn').click();
  await expect(gmPage.getByText('「アラサカ試験サブネット」を作成しました')).toBeVisible();

  // Set Floor 3 Black ICE to Hellhound and save
  await gmPage.getByLabel('F3 ブラックICE').fill('Hellhound');
  await gmPage.getByTestId('netrun-save-arch-btn').click();
  await expect(gmPage.getByText('NET構造体を保存しました')).toBeVisible();

  // 2. Switch to Combat Tab and start combat
  await gmPage.getByRole('button', { name: '戦闘', exact: true }).click();
  await gmPage.getByRole('button', { name: '戦闘を始める' }).click();
  await expect(gmPage.getByRole('heading', { name: 'PC 参加者' })).toBeVisible();

  // Add 1 Ganger as enemy mook
  const npcSelect = gmPage.locator('select').filter({ hasText: 'NPC/モブを選択' });
  await npcSelect.selectOption({ label: 'ガンガー (モブ / Ganger)' });
  const countInput = gmPage.locator('div').filter({ hasText: /^人数:/ }).locator('input');
  if (await countInput.isVisible()) {
    await countInput.fill('1');
  }
  await gmPage.getByRole('button', { name: '敵として追加' }).click();
  await expect(gmPage.getByText('ガンガー #1', { exact: true })).toBeVisible();

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
  await expect(gmPage.getByText(/ラウンド 1/i)).toBeVisible();

  // 3. Select "NET アクション" in Turn Guide
  await gmPage.getByRole('button', { name: 'NET アクション', exact: true }).click();
  await expect(gmPage.getByTestId('netrun-combat-status')).toBeVisible();
  await expect(gmPage.getByTestId('netrun-remaining-actions')).toContainText('3 / 3 回');

  // Step 3a: Jack In (NET 1 -> 2 remaining)
  await gmPage.getByTestId('net-sub-action-select').selectOption('jack_in');
  await gmPage.getByRole('button', { name: '判定と反映内容を計算' }).click();
  await expect(gmPage.getByText(/ジャックイン: アラサカ試験サブネット/i)).toBeVisible();
  await gmPage.getByRole('button', { name: '確定して反映' }).click();
  await expect(gmPage.getByTestId('netrun-combat-status')).toContainText('ジャックイン中: 第 1 階層');
  await expect(gmPage.getByTestId('netrun-remaining-actions')).toContainText('2 / 3 回');

  // Step 3b: Pathfinder (NET 1 -> 1 remaining; reveals F1 and F2 stopping at F2 password DV 8)
  await gmPage.getByTestId('net-sub-action-select').selectOption('pathfinder');
  await gmPage.getByTestId('attack-roll-input').fill('8');
  await gmPage.getByRole('button', { name: '判定と反映内容を計算' }).click();
  await expect(gmPage.getByText(/パスファインダー: インタフェース/i)).toBeVisible();
  await gmPage.getByRole('button', { name: '確定して反映' }).click();
  await expect(gmPage.getByTestId('netrun-floor-item-1')).toContainText('ファイル');
  await expect(gmPage.getByTestId('netrun-floor-item-2')).toContainText('パスワード');
  await expect(gmPage.getByTestId('netrun-remaining-actions')).toContainText('1 / 3 回');

  // Step 3c: Descend to Floor 2 (NET 0 -> still 1 remaining)
  await gmPage.getByTestId('net-sub-action-select').selectOption('descend');
  await gmPage.getByTestId('net-target-floor-select').selectOption('2');
  await gmPage.getByRole('button', { name: '判定と反映内容を計算' }).click();
  await gmPage.getByRole('button', { name: '確定して反映' }).click();
  await expect(gmPage.getByTestId('netrun-combat-status')).toContainText('ジャックイン中: 第 2 階層');

  // Step 3d: Backdoor on Floor 2 Password (NET 1 -> 0 remaining)
  await gmPage.getByTestId('net-sub-action-select').selectOption('backdoor');
  await gmPage.getByTestId('net-target-floor-select').selectOption('2');
  await gmPage.getByTestId('attack-roll-input').fill('8');
  await gmPage.getByRole('button', { name: '判定と反映内容を計算' }).click();
  await expect(gmPage.getByText(/突破成功/i)).toBeVisible();
  await gmPage.getByRole('button', { name: '確定して反映' }).click();
  await expect(gmPage.getByTestId('netrun-floor-item-2')).toContainText('[突破済]');
  await expect(gmPage.getByTestId('netrun-remaining-actions')).toContainText('0 / 3 回');

  // End Viper's Round 1 turn and advance other participants' turns to Round 2
  for (let i = 0; i < 8; i++) {
    const curTurnHeading = (await gmPage.locator('h2').filter({ hasText: 'のターンです' }).textContent()) ?? '';
    await gmPage.getByRole('button', { name: '手番を終える' }).click();
    await expect(gmPage.locator('h2').filter({ hasText: 'のターンです' })).not.toHaveText(curTurnHeading);
    if (
      (await gmPage.getByText('ラウンド 2', { exact: true }).isVisible()) &&
      (await gmPage.getByRole('heading', { name: 'ヴァイパー のターンです' }).isVisible())
    ) {
      break;
    }
  }
  await expect(gmPage.getByText('ラウンド 2', { exact: true })).toBeVisible();
  await expect(gmPage.getByRole('heading', { name: 'ヴァイパー のターンです' })).toBeVisible();

  // Re-open NET アクション on Viper's Round 2 turn
  await gmPage.getByRole('button', { name: 'NET アクション', exact: true }).click();
  await expect(gmPage.getByTestId('netrun-remaining-actions')).toContainText('3 / 3 回');
  await expect(gmPage.getByTestId('netrun-floor-item-2')).toContainText('[突破済]');

  // Activate Armor program (NET 1 -> 2 remaining)
  await gmPage.getByTestId('net-sub-action-select').selectOption('activate');
  await gmPage.getByTestId('net-program-select').selectOption('Armor');
  await gmPage.getByRole('button', { name: '判定と反映内容を計算' }).click();
  await gmPage.getByRole('button', { name: '確定して反映' }).click();
  await expect(gmPage.getByTestId('netrun-rezzed-list')).toContainText('アーマー (REZ 7/7)');

  // Step 3e: Descend to Floor 3 -> Encounter Black ICE (Hellhound)
  await gmPage.getByTestId('net-sub-action-select').selectOption('descend');
  await gmPage.getByTestId('net-target-floor-select').selectOption('3');
  // Speed check rolls: attackFirst = ICE speed roll (2), defenseFirst = Netrunner speed roll (9) so Netrunner wins speed check
  await gmPage.getByTestId('attack-roll-input').fill('2');
  await gmPage.getByTestId('defense-roll-input').fill('9');
  await gmPage.getByTestId('damage-dice-input').fill('4, 4');
  await gmPage.getByRole('button', { name: '判定と反映内容を計算' }).click();
  await expect(gmPage.getByText(/ヘルハウンド/i).first()).toBeVisible();
  await gmPage.getByRole('button', { name: '確定して反映' }).click();
  await expect(gmPage.getByTestId('netrun-combat-status')).toContainText('ジャックイン中: 第 3 階層');
  await expect(gmPage.getByTestId('netrun-active-ice-list')).toContainText('ヘルハウンド');

  // Step 3f: Attack Hellhound with Sword (3d6 = 6,6,6 = 18 damage -> REZ 20 -> 2)
  await gmPage.getByTestId('net-sub-action-select').selectOption('program');
  await gmPage.getByTestId('net-program-select').selectOption('Sword');
  await gmPage.getByTestId('attack-roll-input').fill('8');
  await gmPage.getByTestId('defense-roll-input').fill('2');
  await gmPage.getByTestId('damage-dice-input').fill('6, 6, 6');
  await gmPage.getByRole('button', { name: '判定と反映内容を計算' }).click();
  await expect(gmPage.getByText(/REZ 20 → 2/i)).toBeVisible();

  // Screenshot 1: GM Combat Screen (1440px) showing NET floor map, rezzed Armor, active ICE, and Sword calculation preview
  await gmPage.screenshot({
    path: 'docs/agy/reports/img/phase5z-gm-combat-1440.png',
  });

  await gmPage.getByRole('button', { name: '確定して反映' }).click();
  await expect(gmPage.getByTestId('netrun-active-ice-list')).toContainText('REZ 2/20');

  // 4. Player Mobile Context (390x844) — verify NET status panel without DVs
  const playerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  });
  const playerPage = await playerContext.newPage();

  await joinAsPlayer(playerPage, sessionCode, 'ヴァイパー');
  await playerPage.getByRole('button', { name: '行動' }).click();
  const playerNetPanel = playerPage.getByTestId('player-netrun-panel');
  await expect(playerNetPanel).toBeVisible();
  await expect(playerNetPanel).toContainText('NET ジャックイン中 (第 3 階層)');
  await expect(playerNetPanel).toContainText('NET アクション残り: 1 / 3 回');
  await expect(playerNetPanel).toContainText('アーマー (REZ 7/7)');
  // Player map shows revealed floors without exposing DV numbers
  await expect(playerPage.getByTestId('player-netrun-map')).not.toContainText('DV8');

  // Screenshot 2: Mobile Player Screen (390px)
  await playerPage.screenshot({
    path: 'docs/agy/reports/img/phase5z-player-390.png',
  });

  // 5. Back to GM Screen: Safe Jack Out (uses 3rd NET action -> disconnects)
  await gmPage.bringToFront();
  await gmPage.getByTestId('net-sub-action-select').selectOption('jack_out');
  await gmPage.getByRole('button', { name: '判定と反映内容を計算' }).click();
  await expect(gmPage.getByText(/安全にジャックアウト/i)).toBeVisible();
  await gmPage.getByRole('button', { name: '確定して反映' }).click();
  await expect(gmPage.getByTestId('netrun-combat-status')).toContainText('未接続');

  await gmContext.close();
  await playerContext.close();
});
