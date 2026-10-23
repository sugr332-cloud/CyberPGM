import { test, expect } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';
import { characters, boards, board_objects, board_tokens, combats, combat_participants } from '../apps/server/src/db/schema.js';
import { eq } from 'drizzle-orm';
import { generateUlid } from '@cyberpgm/shared';

// 手動で作ったコンテキストも必ず閉じ、次のテストに接続を残さない。
test.afterEach(async ({ browser }) => {
  await Promise.all(browser.contexts().map((context) => context.close()));
});

test('Phase 4b Board E2E: Board creation, movement BFS, shooting LoS with cover, separate window, TV view without enemy HP', async ({ browser }) => {
  const dbPath = process.env.DATABASE_URL || 'data/test-e2e.db';
  const { db, sqlite } = createDb(dbPath);
  // 大型拳銃の品目 ID は DB ごとに違うので名前で引く
  const heavyPistolId = (sqlite.prepare("SELECT id FROM items WHERE name_en = 'Heavy Pistol'").get() as { id: string }).id;

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
          item_id: heavyPistolId,
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
    // 前の実行で残った武器（古い品目 ID）を外して、この DB の大型拳銃を持たせる
    const inv = JSON.parse(viper.inventory || '[]').filter((i: any) => i.kind !== 'weapon');
    {
      inv.push({
        entry_id: generateUlid(),
        item_id: heavyPistolId,
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

  // Create Booster character behind the wall (x=8, y=5)
  const boosterId = generateUlid();
  db.insert(characters)
    .values({
      id: boosterId,
      name: 'ブースター',
      kind: 'mook',
      role: 'Booster',
      hp: 20,
      hp_max: 20,
      sp_head: 0,
      sp_body: 4,
      eb: 0,
      humanity: 30,
      emp_max: 3,
      stats: JSON.stringify({ int: 4, ref: 5, dex: 5, tech: 3, cool: 4, will: 4, luck: 0, move: 5, body: 6, emp: 3 }),
      skills: JSON.stringify({ Handgun: 4, Evasion: 4 }),
      cyberware: '[]',
      inventory: '[]',
      crit_injuries: '[]',
      created_at: now,
      updated_at: now,
    })
    .run();

  // Place Booster token at (8, 5) behind wall (wall is at x=5, y=3..8)
  db.insert(board_tokens)
    .values({
      id: generateUlid(),
      board_id: testBoardId,
      character_id: boosterId,
      x: 8,
      y: 5,
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
  const boosterPartId = generateUlid();

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

  db.insert(combat_participants)
    .values({
      id: boosterPartId,
      combat_id: combatId,
      character_id: boosterId,
      name: 'ブースター',
      side: 'enemy',
      initiative: 8,
      order_index: 2,
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

  // Scroll to top and capture Movement Range screenshot (1440px)
  await gmPage.evaluate(() => window.scrollTo(0, 0));
  await gmPage.screenshot({
    path: 'docs/agy/reports/img/phase4b-board-combat-move-1440.png',
  });

  // Select destination (3, 2)
  await gmPage.locator('.reachable-cells rect[data-cell="3,2"]').click();

  // Confirm Movement
  const confirmMoveBtn = gmPage.getByRole('button', { name: '移動を確定して反映' });
  await expect(confirmMoveBtn).toBeVisible();
  await confirmMoveBtn.click();
  await expect(confirmMoveBtn).toHaveCount(0);

  // --- Step 2: Test Shooting with Line of Sight (Yellow Cover vs Red Blocked) ---
  // Select "射撃"
  await gmPage.getByRole('button', { name: '射撃', exact: true }).click();

  // 1. Target Booster (behind full wall at x=5, y=3..8): line should be RED (#EF4444)
  await gmPage.getByRole('button', { name: 'ブースター', exact: true }).click();
  await expect(gmPage.locator('.los-line')).toBeVisible();
  await expect(gmPage.locator('.los-line line')).toHaveAttribute('stroke', '#EF4444');
  await expect(gmPage.getByText(/射線: × 射撃不可/)).toBeVisible();

  // 2. Target Ganger (behind wooden crate at x=4, y=2): line should be YELLOW (#EAB308)
  await gmPage.getByRole('button', { name: 'ガンガー', exact: true }).click();
  await expect(gmPage.locator('.los-line')).toBeVisible();
  await expect(gmPage.locator('.los-line line')).toHaveAttribute('stroke', '#EAB308');
  await expect(gmPage.getByText(/射線: △ 遮蔽越し/).first()).toBeVisible();
  await expect(gmPage.getByText(/遮蔽物に当てるかは GM が決める/i)).toBeVisible();

  // Scroll to top and capture Shooting LoS screenshot (1440px)
  await gmPage.evaluate(() => window.scrollTo(0, 0));
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
  // 出目は決め打ちで入っていないので入れる（Phase 5l）
  await gmPage.getByTestId('attack-roll-input').fill('7');
  await gmPage.getByPlaceholder('6, 6, 2').fill('6, 6, 2');
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

  // GM token does NOT show fake "0/1" HP
  await expect(windowPage.locator('.token-group', { hasText: '0/1' })).not.toBeVisible();
  await expect(windowPage.locator('.board-tokens text', { hasText: '0/1' })).not.toBeVisible();
  await expect(windowPage.locator('.gm-token-badge')).toBeVisible();

  // Screenshot 2: 別ウィンドウ（1280px）
  await windowPage.evaluate(() => window.scrollTo(0, 0));
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
  await expect(tvPage.locator('.board-view-container')).toBeVisible();
  await expect(tvPage.getByText('CyberPGM', { exact: true })).toBeVisible();

  // TV Screen: Verify board SVG has scaled up and is not fixed to 800px
  const tvSvg = tvPage.locator('.board-view-container svg');
  await expect(tvSvg).toBeVisible();
  const tvSvgBox = await tvSvg.boundingBox();
  expect(tvSvgBox).not.toBeNull();
  // 盤面全体が画面に収まる現行レイアウトで検証する（固定800px以上とは限らない）。
  expect(tvSvgBox!.height).toBeGreaterThan(0);
  expect(tvSvgBox!.height).toBeLessThanOrEqual(1080);
  expect(tvSvgBox!.width).toBeLessThanOrEqual(1920);
  await expect.poll(() => tvPage.getByTestId('board-viewport').evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true);

  // TV tokens: Ally token (Viper) shows ally name and numeric HP
  const viperTvToken = tvPage.locator('.token-group', { hasText: 'ヴァイパー' });
  await expect(viperTvToken).toBeVisible();
  await expect(viperTvToken.locator('text', { hasText: '35/35' })).toBeVisible();

  // TV tokens: Enemy token (Ganger) shows name but NO wound badge when healthy
  const gangerTvToken = tvPage.locator('.token-group', { hasText: 'ガンガー' });
  await expect(gangerTvToken).toBeVisible();
  await expect(gangerTvToken.locator('text', { hasText: '瀕死' })).not.toBeVisible();
  await expect(gangerTvToken.locator('text', { hasText: '重傷' })).not.toBeVisible();
  await expect(gangerTvToken.locator('text', { hasText: '死亡' })).not.toBeVisible();

  // Ally sidebar shows numeric HP
  await expect(tvPage.getByText(/HP 35\/35/i)).toBeVisible();

  // Enemy sidebar shows ONLY name and wound state badge ("健康") - NO numeric HP/SP!
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
