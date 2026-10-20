import { test, expect } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';
import { characters, boards, board_objects, board_tokens, combats, combat_participants } from '../apps/server/src/db/schema.js';
import { eq } from 'drizzle-orm';
import { generateUlid } from '@cyberpgm/shared';

test('Phase 4b Board E2E: Board creation, movement BFS, shooting LoS with cover, separate window, TV view without enemy HP', async ({ browser }) => {
  const dbPath = process.env.DATABASE_URL || 'data/test-e2e.db';
  const { db, sqlite } = createDb(dbPath);

  // 1. Clean DB state for reliable test run
  sqlite.prepare('DELETE FROM combat_log').run();
  sqlite.prepare('DELETE FROM combat_participants').run();
  sqlite.prepare('DELETE FROM combats').run();
  sqlite.prepare('DELETE FROM board_drops').run();
  sqlite.prepare('DELETE FROM board_tokens').run();
  sqlite.prepare('DELETE FROM board_objects').run();
  sqlite.prepare('DELETE FROM boards').run();
  sqlite.prepare('DELETE FROM devices').run();

  const now = Date.now();

  // Ensure Ganger enemy exists
  let ganger = db.select().from(characters).where(eq(characters.name, 'ガンガー')).get();
  if (!ganger) {
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

  // Ensure Viper has weapon in inventory
  let viper = db.select().from(characters).where(eq(characters.name, 'ヴァイパー')).get();
  if (!viper) {
    const vId = generateUlid();
    db.insert(characters).values({
      id: vId,
      kind: 'pc',
      name: 'ヴァイパー',
      role: 'ソロ',
      stats: JSON.stringify({ int: 6, ref: 8, dex: 7, tech: 4, cool: 6, will: 5, luck: 5, move: 6, body: 7, emp: 4 }),
      skills: JSON.stringify({ Handgun: 6, Evasion: 5, Brawling: 4 }),
      hp: 35,
      hp_max: 35,
      sp_head: 7,
      sp_body: 7,
      humanity: 40,
      emp_max: 4,
      weapons: '[]',
      inventory: JSON.stringify([
        {
          entry_id: generateUlid(),
          item_id: '01M5BTW75NVPEE0BDG9BDF05HW',
          name: '大型拳銃',
          kind: 'weapon',
          qty: 1,
          equipped: true,
          ammo: 8,
        },
      ]),
      status: '[]',
      crit_injuries: '[]',
      created_at: now,
      updated_at: now,
    }).run();
    viper = db.select().from(characters).where(eq(characters.id, vId)).get();
  } else {
    const inv = JSON.parse(viper.inventory || '[]');
    const hasWep = inv.some((i: any) => i.kind === 'weapon');
    if (!hasWep) {
      inv.push({
        entry_id: generateUlid(),
        item_id: '01M5BTW75NVPEE0BDG9BDF05HW',
        name: '大型拳銃',
        kind: 'weapon',
        qty: 1,
        equipped: true,
        ammo: 8,
      });
      db.update(characters)
        .set({ inventory: JSON.stringify(inv) })
        .where(eq(characters.id, viper.id))
        .run();
    }
  }

  // 2. Pre-create Board with Wall and Wooden Crate
  const testBoardId = generateUlid();
  db.insert(boards)
    .values({
      id: testBoardId,
      name: 'E2E市街戦盤面',
      background_image_id: null,
      grid: JSON.stringify({
        show: true,
        cell_m: 2,
        origin_x: 0,
        origin_y: 0,
        cell_px: 40,
        cols: 20,
        rows: 15,
      }),
      created_at: now,
      updated_at: now,
    })
    .run();

  // Add Wall: x=5, y=3..8 (tall wall blocking x=5)
  db.insert(board_objects)
    .values({
      id: generateUlid(),
      board_id: testBoardId,
      kind: 'wall',
      label: '防壁',
      x: 5,
      y: 3,
      w: 1,
      h: 6,
      rotation: 0,
      passable: false,
      blocks_los: 'full',
      cover_hp: null,
      cover_hp_max: null,
    })
    .run();

  // Add Wooden Crate: x=4, y=2 (partial cover)
  const crateId = generateUlid();
  db.insert(board_objects)
    .values({
      id: crateId,
      board_id: testBoardId,
      kind: 'crate',
      label: '木箱',
      x: 4,
      y: 2,
      w: 1,
      h: 1,
      rotation: 0,
      passable: true,
      blocks_los: 'partial',
      cover_hp: 20,
      cover_hp_max: 20,
    })
    .run();

  // Place Viper token at (2, 2)
  db.insert(board_tokens)
    .values({
      id: generateUlid(),
      board_id: testBoardId,
      character_id: viper!.id,
      x: 2,
      y: 2,
      gm_only: false,
    })
    .run();

  // Place Ganger token at (8, 2)
  db.insert(board_tokens)
    .values({
      id: generateUlid(),
      board_id: testBoardId,
      character_id: ganger!.id,
      x: 8,
      y: 2,
      gm_only: false,
    })
    .run();

  // Add a GM-only token at (10, 5)
  db.insert(board_tokens)
    .values({
      id: generateUlid(),
      board_id: testBoardId,
      character_id: null,
      x: 10,
      y: 5,
      gm_only: true,
    })
    .run();

  // 3. Pre-create Combat linked to this board
  const combatId = generateUlid();
  const viperPartId = generateUlid();
  const gangerPartId = generateUlid();

  db.insert(combats)
    .values({
      id: combatId,
      board_id: testBoardId,
      status: 'active',
      round: 1,
      turn_index: 0,
      settings: JSON.stringify({ tieBreak: 'ref', board_id: testBoardId }),
      created_at: now,
      ended_at: null,
    })
    .run();

  db.insert(combat_participants)
    .values({
      id: viperPartId,
      combat_id: combatId,
      character_id: viper!.id,
      name: viper!.name,
      side: 'ally',
      initiative: 18,
      order_index: 0,
      active: true,
      out: false,
    })
    .run();

  db.insert(combat_participants)
    .values({
      id: gangerPartId,
      combat_id: combatId,
      character_id: ganger!.id,
      name: ganger!.name,
      side: 'enemy',
      initiative: 12,
      order_index: 1,
      active: true,
      out: false,
    })
    .run();

  // 4. GM Screen (1440px viewport)
  const gmContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const gmPage = await gmContext.newPage();
  gmPage.on('console', msg => console.log('GM CONSOLE:', msg.text()));
  gmPage.on('pageerror', err => console.log('GM PAGE ERROR:', err.stack || err.message));

  await gmPage.goto('/gm');
  await expect(gmPage.getByText('CYBERPGM').first()).toBeVisible();

  // Switch to Combat tab
  await gmPage.getByRole('button', { name: '戦闘' }).click();

  // Verify Board is displayed
  await expect(gmPage.getByText(/E2E市街戦盤面/i).first()).toBeVisible();
  await expect(gmPage.locator('.board-view-container')).toBeVisible();

  // Verify Tokens on board
  await expect(gmPage.getByText('ヴァイパー').first()).toBeVisible();
  await expect(gmPage.getByText('ガンガー').first()).toBeVisible();

  // Fetch session code from server
  const healthRes = await gmPage.request.get('/api/health');
  const healthData = await healthRes.json();
  const sessionCode = healthData.session;

  // --- Step 1: Test Movement BFS ---
  // Click "移動"
  await gmPage.getByRole('button', { name: '移動', exact: true }).click();

  // Verify reachable cells are highlighted in SVG
  const reachableCells = gmPage.locator('.reachable-cells rect');
  await expect(reachableCells.first()).toBeVisible();

  // Select destination (3, 2)
  await gmPage.locator('.reachable-cells rect[data-cell="3,2"]').click();

  // Confirm Movement
  const confirmMoveBtn = gmPage.getByRole('button', { name: '移動を確定して反映' });
  await expect(confirmMoveBtn).toBeVisible();
  await confirmMoveBtn.click();

  // --- Step 2: Test Shooting with Line of Sight (Yellow Cover) ---
  // Select "射撃"
  await gmPage.getByRole('button', { name: '射撃', exact: true }).click();

  // Select target: ガンガー
  await gmPage.getByRole('button', { name: 'ガンガー', exact: true }).click();

  // Verify automatic distance calculation and LoS line
  await expect(gmPage.locator('.los-line')).toBeVisible();
  await expect(gmPage.getByText(/射線: △ 遮蔽越し/).first()).toBeVisible();
  await expect(gmPage.getByText(/遮蔽物に当てるかは GM が決める/i)).toBeVisible();

  // Screenshot 1: 盤面つきの戦闘画面で移動範囲と射線（1440px）
  await gmPage.screenshot({
    path: 'docs/agy/reports/img/phase4b-board-combat-1440.png',
  });

  // Check "遮蔽物に当てる"
  const coverCheckbox = gmPage.getByLabel('遮蔽物に当てる');
  await coverCheckbox.check();

  // Fill cover damage: 10
  const coverDamageInput = gmPage.locator('input[placeholder="ダメージ値"]');
  await coverDamageInput.fill('10');

  // Calculate preview and Apply
  await gmPage.getByRole('button', { name: '判定と反映内容を計算' }).click();
  await expect(gmPage.getByRole('button', { name: '確定して反映' })).toBeVisible();
  await gmPage.getByRole('button', { name: '確定して反映' }).click();

  // --- Step 3: Test Separate Window /gm/combat (1280px) ---
  const windowContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const windowPage = await windowContext.newPage();
  await windowPage.goto('/gm/combat');

  // Verify standalone combat window loads board and active state
  await expect(windowPage.locator('.board-view-container')).toBeVisible();
  await expect(windowPage.getByText(/E2E市街戦盤面/i).first()).toBeVisible();

  // Screenshot 2: 別ウィンドウ（1280px）
  await windowPage.screenshot({
    path: 'docs/agy/reports/img/phase4b-board-window-1280.png',
  });

  // --- Step 4: Test TV Shared Screen /screen (1920px) ---
  const tvContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const tvPage = await tvContext.newPage();
  await tvPage.goto(`/screen?code=${sessionCode}`);

  // Verify TV screen loads without login or PIN
  await expect(tvPage.getByText(/CyberPGM/i)).toBeVisible();
  await expect(tvPage.locator('.board-view-container')).toBeVisible();

  // Ally shows numeric HP
  await expect(tvPage.getByText(/HP 35\/35/i)).toBeVisible();

  // Enemy shows ONLY name and wound state badge ("健康" or "重傷") - NO numeric HP/SP!
  await expect(tvPage.getByText('ガンガー', { exact: true }).first()).toBeVisible();
  await expect(tvPage.getByText('健康').first()).toBeVisible();
  const enemyNumericHp = tvPage.getByText(/HP 25\/25/i);
  await expect(enemyNumericHp).not.toBeVisible();

  // GM-only token is NOT visible on TV screen
  const gmBadge = tvPage.locator('.gm-token-badge');
  await expect(gmBadge).not.toBeVisible();

  // Screenshot 3: TV（1920px）
  await tvPage.screenshot({
    path: 'docs/agy/reports/img/phase4b-board-tv-1920.png',
  });

  // --- Step 5: Test Mobile View (390px) ---
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto('/gm/combat');

  // Verify Board view container is rendered and scrollable
  await expect(mobilePage.locator('.board-view-container')).toBeVisible();

  // Screenshot 4: 盤面の 390px
  await mobilePage.screenshot({
    path: 'docs/agy/reports/img/phase4b-board-mobile-390.png',
  });

  // Clean up
  await gmContext.close();
  await windowContext.close();
  await tvContext.close();
  await mobileContext.close();
});
