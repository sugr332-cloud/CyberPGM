import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDb } from '../apps/server/src/db/client.js';
import {
  characters,
  boards,
  board_objects,
  board_tokens,
  combats,
  combat_participants,
} from '../apps/server/src/db/schema.js';

test('Phase 6a E2E: GM combat token drag (move action, invalid cell, GM reposition + undo) and skill info (?) toggle in GM editor & mobile player creation', async ({
  browser,
}) => {
  const dbPath = process.env.DATABASE_URL || 'data/test-e2e.db';
  const { db, sqlite } = createDb(dbPath);
  const now = Date.now();

  for (const t of [
    'combat_log',
    'combat_participants',
    'combats',
    'board_drops',
    'board_tokens',
    'board_objects',
    'boards',
    'char_log',
    'characters',
  ]) {
    sqlite.prepare(`DELETE FROM ${t}`).run();
  }

  // 1. Seed PC and Enemy + Board + Active Combat
  const viperId = 'char-viper-6a';
  const gangerId = 'char-ganger-6a';
  const boardId = 'board-6a-e2e';
  const combatId = 'combat-6a-e2e';

  db.insert(characters)
    .values([
      {
        id: viperId,
        kind: 'pc',
        name: 'ヴァイパー',
        role: 'Solo',
        stats: JSON.stringify({
          int: 6,
          ref: 8,
          dex: 8,
          tech: 5,
          cool: 6,
          will: 7,
          luck: 6,
          move: 4,
          body: 7,
          emp: 6,
        }),
        skills: JSON.stringify({ handgun: 6, evasion: 6 }),
        hp: 40,
        hp_max: 40,
        sp_head: 11,
        sp_body: 11,
        humanity: 60,
        emp_max: 6,
        created_at: now,
        updated_at: now,
      },
      {
        id: gangerId,
        kind: 'npc',
        name: 'ガンガー',
        role: 'Solo',
        stats: JSON.stringify({
          int: 4,
          ref: 6,
          dex: 6,
          tech: 4,
          cool: 5,
          will: 5,
          luck: 0,
          move: 5,
          body: 6,
          emp: 4,
        }),
        skills: JSON.stringify({ handgun: 4, evasion: 4 }),
        hp: 30,
        hp_max: 30,
        sp_head: 7,
        sp_body: 7,
        humanity: 40,
        emp_max: 4,
        created_at: now,
        updated_at: now,
      },
    ])
    .run();

  db.insert(boards)
    .values({
      id: boardId,
      name: 'Phase6a 市街地',
      grid: JSON.stringify({
        show: true,
        cell_m: 2,
        origin_x: 0,
        origin_y: 0,
        cell_px: 40,
        cols: 16,
        rows: 10,
      }),
      created_at: now,
      updated_at: now,
    })
    .run();

  // Impassable wall at (5, 2..3)
  db.insert(board_objects)
    .values({
      id: 'obj-wall-6a',
      board_id: boardId,
      kind: 'wall',
      label: '防護壁',
      x: 5,
      y: 2,
      w: 1,
      h: 2,
      rotation: 0,
      passable: false,
      blocks_los: 'full',
    })
    .run();

  // Tokens: Viper at (2, 2), Ganger at (8, 2)
  db.insert(board_tokens)
    .values([
      {
        id: 'tok-viper-6a',
        board_id: boardId,
        character_id: viperId,
        x: 2,
        y: 2,
        gm_only: false,
      },
      {
        id: 'tok-ganger-6a',
        board_id: boardId,
        character_id: gangerId,
        x: 8,
        y: 2,
        gm_only: false,
      },
    ])
    .run();

  db.insert(combats)
    .values({
      id: combatId,
      status: 'active',
      round: 1,
      turn_index: 0,
      board_id: boardId,
      settings: JSON.stringify({ tieBreak: 'reroll', board_id: boardId }),
      created_at: now,
    })
    .run();

  db.insert(combat_participants)
    .values([
      {
        id: 'part-viper-6a',
        combat_id: combatId,
        character_id: viperId,
        side: 'ally',
        name: 'ヴァイパー',
        initiative: 16,
        order_index: 0,
        active: true,
        out: false,
        move_used: false,
        action_used: false,
        state: '{}',
      },
      {
        id: 'part-ganger-6a',
        combat_id: combatId,
        character_id: gangerId,
        side: 'enemy',
        name: 'ガンガー',
        initiative: 11,
        order_index: 1,
        active: true,
        out: false,
        move_used: false,
        action_used: false,
        state: '{}',
      },
    ])
    .run();

  // --- Part A: GM Combat Token Dragging (1440px) ---
  const gmContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const gmPage = await gmContext.newPage();
  gmPage.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  await gmPage.goto('/gm');
  await gmPage.getByRole('button', { name: '戦闘' }).click();
  await expect(gmPage.locator('.board-view-container')).toBeVisible();

  const svg = gmPage.locator('.board-view-container svg');
  await expect(svg).toBeVisible();
  const cellCenter = async (cx: number, cy: number) => {
    await gmPage.evaluate(() => window.scrollTo(0, 0));
    const svgBox = (await svg.boundingBox())!;
    return {
      x: svgBox.x + (cx + 0.5) * (svgBox.width / 16),
      y: svgBox.y + (cy + 0.5) * (svgBox.height / 10),
    };
  };

  // 1. Select "移動" for active participant (Viper, MOVE 4 at (2,2))
  await gmPage.getByRole('button', { name: '移動', exact: true }).click();
  await expect(gmPage.locator('.reachable-cells rect').first()).toBeVisible();

  // Drag Viper from (2,2) to unreachable cell (10,2) -> should show red hover outline, then reject on drop and return to (2,2)
  const startViper = await cellCenter(2, 2);
  const farCell = await cellCenter(10, 2);
  await gmPage.mouse.move(startViper.x, startViper.y);
  await gmPage.mouse.down();
  await gmPage.mouse.move(farCell.x, farCell.y, { steps: 5 });
  await expect(gmPage.getByTestId('drag-hover-cell')).toHaveAttribute('data-valid', 'false');
  await gmPage.mouse.up();

  await expect(gmPage.getByTestId('board-drag-message')).toContainText('そのマスへは移動できません（移動力 4 マス）');
  await expect(gmPage.getByText('移動先:')).toContainText('未選択');

  // Drag Viper from (2,2) to reachable cell (4,2) -> green hover outline, capture 1440px screenshot while dragging, then release to select destination
  const startViper2 = await cellCenter(2, 2);
  const validDest = await cellCenter(4, 2);
  await gmPage.mouse.move(startViper2.x, startViper2.y);
  await gmPage.mouse.down();
  await gmPage.mouse.move(validDest.x, validDest.y, { steps: 5 });
  await expect(gmPage.getByTestId('drag-hover-cell')).toHaveAttribute('data-valid', 'true');
  await expect(gmPage.getByTestId('token-tok-viper-6a')).toHaveAttribute('data-dragging', 'true');

  // Screenshot 1: GM combat screen dragging a token (1440px)
  await gmPage.screenshot({
    path: 'docs/agy/reports/img/phase6a-gm-drag-1440.png',
  });

  await gmPage.mouse.up();
  await expect(gmPage.getByText('(4, 2)')).toBeVisible();

  // Confirm move
  await gmPage.getByRole('button', { name: '移動を確定して反映' }).click();
  await expect(gmPage.getByText('移動アクション: 使用済み')).toBeVisible();

  // 2. Drag non-active participant (Ganger at (8,2)) onto impassable wall at (5,2) -> rejected
  const startGanger = await cellCenter(8, 2);
  const wallCell = await cellCenter(5, 2);
  await gmPage.mouse.move(startGanger.x, startGanger.y);
  await gmPage.mouse.down();
  await gmPage.mouse.move(wallCell.x, wallCell.y, { steps: 5 });
  await expect(gmPage.getByTestId('drag-hover-cell')).toHaveAttribute('data-valid', 'false');
  await gmPage.mouse.up();
  await expect(gmPage.getByTestId('board-drag-message')).toContainText('通れない置物');

  // 3. Drag Ganger from (8,2) to valid cell (7,4) -> GM reposition logged, and Undo restores (8,2)
  const startGanger2 = await cellCenter(8, 2);
  const gmDest = await cellCenter(7, 4);
  await gmPage.mouse.move(startGanger2.x, startGanger2.y);
  await gmPage.mouse.down();
  await gmPage.mouse.move(gmDest.x, gmDest.y, { steps: 5 });
  await expect(gmPage.getByTestId('drag-hover-cell')).toHaveAttribute('data-valid', 'true');
  await gmPage.mouse.up();

  await expect(gmPage.getByText('GM がコマを動かした: ガンガー (8,2)→(7,4)')).toBeVisible();
  const tokAfterMove = db.select().from(board_tokens).where(eq(board_tokens.id, 'tok-ganger-6a')).get();
  expect(tokAfterMove).toMatchObject({ x: 7, y: 4 });

  // Click Undo ("一手戻る")
  await gmPage.getByRole('button', { name: /一手戻る/ }).click();
  await expect
    .poll(() => {
      const tok = db.select().from(board_tokens).where(eq(board_tokens.id, 'tok-ganger-6a')).get();
      return tok ? `${tok.x},${tok.y}` : '';
    })
    .toBe('8,2');

  // --- Part B (1): GM CharacterEditorView skill (?) toggle ---
  await gmPage.getByRole('button', { name: 'キャラ作成' }).click();
  const editor = gmPage.getByTestId('character-editor');
  await editor.getByRole('button', { name: 'ヴァイパー' }).click();
  const handgunHelpBtn = editor.getByTestId('skill-info-btn-handgun');
  await expect(handgunHelpBtn).toBeVisible();
  await handgunHelpBtn.click();

  const gmSkillPanel = editor.getByTestId('skill-info-panel-handgun');
  await expect(gmSkillPanel).toBeVisible();
  await expect(gmSkillPanel).toContainText('判定 = 能力値 + 技能レベル + 1d10');
  await expect(gmSkillPanel).toContainText('【反応】8 + 〈ハンドガン〉6 + 1d10');
  await expect(gmSkillPanel).toContainText('2. 効果・使い道');

  // Click (?) again to close
  await handgunHelpBtn.click();
  await expect(gmSkillPanel).not.toBeVisible();

  await gmContext.close();

  // --- Part B (2): Mobile Player CharacterCreatePage skill (?) toggle (390px) ---
  const playerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const playerPage = await playerContext.newPage();

  await playerPage.goto('/player/create');
  await expect(playerPage.getByText('1. 基本情報を設定します')).toBeVisible();
  await playerPage.getByRole('button', { name: '次へ: 能力値を決める →' }).click();
  await playerPage.getByRole('button', { name: '次へ: 技能を選ぶ →' }).click();
  await expect(playerPage.getByText('3. 技能ポイントを割り振ります')).toBeVisible();

  // Filter to Ranged Combat skills or search "ハンドガン" so Handgun is at the top of the screen
  await playerPage.getByPlaceholder('技能名・用途で検索…').fill('ハンドガン');
  const playerHandgunBtn = playerPage.getByTestId('skill-info-btn-handgun');
  await expect(playerHandgunBtn).toBeVisible();
  await playerHandgunBtn.click();

  const playerSkillPanel = playerPage.getByTestId('skill-info-panel-handgun');
  await expect(playerSkillPanel).toBeVisible();
  await expect(playerSkillPanel).toContainText('1. 計算のしかた');
  await expect(playerSkillPanel).toContainText('判定 = 能力値 + 技能レベル + 1d10');
  await expect(playerSkillPanel).toContainText('2. 効果・使い道');
  await expect(playerSkillPanel).toContainText('戦闘の「射撃」「照準射撃」');
  await playerSkillPanel.scrollIntoViewIfNeeded();

  // Screenshot 2: Mobile character creation screen with skill (?) detail open (390px)
  await playerPage.screenshot({
    path: 'docs/agy/reports/img/phase6a-player-skillinfo-390.png',
  });

  // Click (?) again to close
  await playerHandgunBtn.click();
  await expect(playerSkillPanel).not.toBeVisible();

  await playerContext.close();
});
