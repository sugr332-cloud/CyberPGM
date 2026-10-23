import { test, expect, type Page } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';
import { characters, boards, board_objects, board_tokens, combats, combat_participants } from '../apps/server/src/db/schema.js';
import { eq } from 'drizzle-orm';

const boardId = 'board-shop-map-regression';
const combatId = 'combat-shop-map-regression';
const pcId = 'pc-shop-map-regression';
const enemyId = 'enemy-shop-map-regression';

function seedCombat(status: 'setup' | 'active', cols = 5, rows = 4) {
  const { db, sqlite } = createDb(process.env.DATABASE_URL || 'data/test-e2e.db');
  for (const table of ['combat_log', 'combat_participants', 'combats', 'board_drops', 'board_tokens', 'board_objects', 'boards']) {
    sqlite.prepare(`DELETE FROM ${table}`).run();
  }
  sqlite.prepare('DELETE FROM characters WHERE id IN (?, ?)').run(pcId, enemyId);
  const now = Date.now();
  db.insert(characters).values([pcId, enemyId].map((id, index) => ({
    id, kind: index ? 'npc' : 'pc', name: index ? '配置テスト敵' : '配置テストPC', role: 'ソロ',
    stats: JSON.stringify({ int: 6, ref: 6, dex: 6, tech: 6, cool: 6, will: 6, luck: 6, move: 6, body: 6, emp: 6 }),
    hp: 40, hp_max: 40, humanity: 60, emp_max: 6, created_at: now, updated_at: now,
  }))).run();
  db.insert(boards).values({
    id: boardId, name: '配置テスト盤面',
    grid: JSON.stringify({ show: true, cell_m: 2, cell_px: 80, origin_x: 0, origin_y: 0, cols, rows }),
    created_at: now, updated_at: now,
  }).run();
  db.insert(board_objects).values({ id: 'wall-shop-map', board_id: boardId, kind: 'wall', label: '壁', x: 0, y: 0, w: 1, h: 1, passable: false, blocks_los: 'full' }).run();
  db.insert(combats).values({ id: combatId, status, board_id: boardId, round: 1, turn_index: 0, settings: '{}', created_at: now }).run();
  db.insert(combat_participants).values([pcId, enemyId].map((id, index) => ({
    id: `part-${id}`, combat_id: combatId, character_id: id, name: index ? '配置テスト敵' : '配置テストPC',
    side: index ? 'enemy' : 'ally', active: true, initiative: 15 - index, order_index: index,
  }))).run();
  return { db, sqlite };
}

async function cellCenter(page: Page, x: number, y: number) {
  const svg = page.locator('.board-view-container svg');
  await svg.scrollIntoViewIfNeeded();
  // Use the actual SVG transform, including letterboxing on narrow screens.
  return svg.evaluate((el, cell) => {
    const pt = el.createSVGPoint();
    pt.x = (cell.x + 0.5) * 80;
    pt.y = (cell.y + 0.5) * 80;
    const result = pt.matrixTransform(el.getScreenCTM()!);
    return { x: result.x, y: result.y };
  }, { x, y });
}

async function clickCell(page: Page, x: number, y: number) {
  const pos = await cellCenter(page, x, y);
  await page.mouse.click(pos.x, pos.y);
}

test.afterAll(() => {
  const { sqlite } = createDb(process.env.DATABASE_URL || 'data/test-e2e.db');
  sqlite.prepare('DELETE FROM combats WHERE id = ?').run(combatId);
  sqlite.prepare('DELETE FROM boards WHERE id = ?').run(boardId);
  sqlite.prepare('DELETE FROM characters WHERE id IN (?, ?)').run(pcId, enemyId);
  sqlite.close();
});

test('shop categories filter the displayed catalog and preserve the search term', async ({ page }) => {
  await page.goto('/gm');
  await page.getByRole('button', { name: '商店', exact: true }).click();
  for (const kind of ['weapon', 'armor', 'cyberware', 'gear', 'ammo', 'upgrade']) {
    const response = page.waitForResponse((r) => {
      const url = new URL(r.url());
      return url.pathname === '/api/items' && url.searchParams.get('kind') === kind;
    });
    await page.getByTestId(`shop-category-${kind}`).click();
    const result = await (await response).json();
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((i: { kind: string }) => i.kind === kind)).toBe(true);
    const cards = page.locator('[data-testid^="item-card-"][data-item-kind]');
    await expect(cards).toHaveCount(result.items.length);
    await expect(page.locator(`[data-testid^="item-card-"][data-item-kind]:not([data-item-kind="${kind}"])`)).toHaveCount(0);
  }
  await page.getByTestId('shop-category-weapon').click();
  await page.getByTestId('item-search-input').fill('Heavy Pistol');
  await expect(page.locator('[data-item-kind="weapon"]').first()).toContainText('Heavy Pistol');
  await page.getByTestId('shop-category-armor').click();
  await expect(page.locator('[data-testid^="item-card-"][data-item-kind]')).toHaveCount(0);
  await expect(page.getByTestId('item-search-input')).toHaveValue('Heavy Pistol');
});

test('setup map supports click placement, blocked cells, drag movement, and saved positions', async ({ page }) => {
  const { db, sqlite } = seedCombat('setup');
  await page.goto('/gm/combat');
  const participant = page.getByTestId(`board-participant-part-${pcId}`);
  await expect(participant).toBeVisible();
  await participant.click();
  const placed = page.locator(`.token-group[data-character-id="${pcId}"]`);
  await expect(placed).toHaveAttribute('data-cell', '1,0');
  await expect(placed).toHaveAttribute('data-focused', 'true');
  await expect(placed).toBeVisible();
  await participant.click();
  await expect(placed).toHaveCount(1);
  await page.getByTestId(`board-place-cell-part-${pcId}`).click();
  await clickCell(page, 0, 0);
  await expect(page.getByTestId('board-placement-message')).toContainText('通れない置物');
  await clickCell(page, 1, 1);
  const token = page.locator(`.token-group[data-character-id="${pcId}"]`);
  await expect(token).toHaveAttribute('data-cell', '1,1');
  await expect(token).toContainText('配置テストPC');
  await page.getByTestId(`board-place-cell-part-${enemyId}`).click();
  // Occupied cells cannot be selected; the existing token stays in place.
  await clickCell(page, 1, 1);
  await expect(page.locator(`.token-group[data-character-id="${enemyId}"]`)).toHaveCount(0);
  await clickCell(page, 4, 1);
  await expect(page.locator(`.token-group[data-character-id="${enemyId}"]`)).toHaveAttribute('data-cell', '4,1');
  const start = await cellCenter(page, 1, 1);
  const end = await cellCenter(page, 2, 2);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await expect(token).toHaveAttribute('data-cell', '2,2');
  expect(db.select().from(board_tokens).where(eq(board_tokens.character_id, pcId)).get()).toMatchObject({ x: 2, y: 2 });
  await page.reload();
  await expect(token).toHaveAttribute('data-cell', '2,2');
  await page.screenshot({ path: 'test-results/shop-map-setup.png', fullPage: true });
  sqlite.close();
});

test('auto placement repairs off-board tokens on a small map without overlaps or walls', async ({ page }) => {
  const { db, sqlite } = seedCombat('active', 2, 2);
  db.insert(board_tokens).values({ id: 'outside-shop-map', board_id: boardId, character_id: pcId, x: 12, y: 2 }).run();
  await page.goto('/gm/combat');
  await page.getByTestId('board-auto-place').click();
  await expect(page.getByTestId('board-placement-message')).toContainText('2 人を配置しました');
  const tokens = db.select().from(board_tokens).where(eq(board_tokens.board_id, boardId)).all();
  expect(tokens).toHaveLength(2);
  expect(new Set(tokens.map((t) => `${t.x},${t.y}`)).size).toBe(2);
  for (const t of tokens) {
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.x).toBeLessThan(2);
    expect(t.y).toBeGreaterThanOrEqual(0);
    expect(t.y).toBeLessThan(2);
    expect(`${t.x},${t.y}`).not.toBe('0,0');
  }
  await expect(page.locator('.token-group')).toHaveCount(2);
  // Repeating the operation never creates duplicate tokens.
  await page.getByTestId('board-auto-place').click();
  await expect(page.getByTestId('board-placement-message')).toContainText('0 人を配置しました');
  expect(db.select().from(board_tokens).where(eq(board_tokens.board_id, boardId)).all()).toHaveLength(2);
  sqlite.close();
});

test('mobile touch placement and drag repositioning work during combat with undo', async ({ browser }) => {
  const { db, sqlite } = seedCombat('active');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('/gm/combat');
  await page.getByTestId(`board-participant-part-${pcId}`).tap();
  const token = page.locator(`.token-group[data-character-id="${pcId}"]`);
  await expect(token).toHaveAttribute('data-cell', '1,0');
  const start = await cellCenter(page, 1, 0);
  const end = await cellCenter(page, 2, 2);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
  await expect(page.getByTestId('drag-hover-cell')).toHaveAttribute('data-valid', 'true');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(token).toHaveAttribute('data-cell', '2,2');
  expect(db.select().from(board_tokens).where(eq(board_tokens.character_id, pcId)).get()).toMatchObject({ x: 2, y: 2 });
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /一手戻る/ }).click();
  await expect(token).toHaveAttribute('data-cell', '1,0');
  await page.screenshot({ path: 'test-results/shop-map-mobile.png', fullPage: true });
  await context.close();
  sqlite.close();
});


test('large maps remain completely visible without map scrolling on laptops and phones', async ({ page }) => {
  const { db, sqlite } = seedCombat('active', 50, 40);
  await page.goto('/gm/combat');
  await page.getByTestId(`board-participant-part-${pcId}`).click();
  await page.getByTestId(`board-place-cell-part-${enemyId}`).click();
  await clickCell(page, 49, 39);
  const enemy = page.locator(`.token-group[data-character-id="${enemyId}"]`);
  await expect(enemy).toHaveAttribute('data-cell', '49,39');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const frame = page.getByTestId('board-viewport');
    await frame.scrollIntoViewIfNeeded();
    await expect.poll(() => frame.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true);
    const metrics = await frame.locator('svg').evaluate((svg) => {
      const rect = svg.getBoundingClientRect();
      const corners = [[0, 0], [4000, 0], [0, 3200], [4000, 3200]].map(([x, y]) => {
        const point = svg.createSVGPoint(); point.x = x; point.y = y;
        const screen = point.matrixTransform(svg.getScreenCTM()!);
        return screen.x >= rect.left - 1 && screen.x <= rect.right + 1 && screen.y >= rect.top - 1 && screen.y <= rect.bottom + 1;
      });
      return { corners, height: rect.height, width: rect.width, windowHeight: innerHeight };
    });
    expect(metrics.corners).toEqual([true, true, true, true]);
    expect(metrics.height).toBeLessThan(viewport.height);
    expect(metrics.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `test-results/map-fit-${viewport.width}.png` });
  }
  // Even on the small display, cells at the opposite edge can be selected correctly.
  await page.getByTestId(`board-place-cell-part-${pcId}`).click();
  await clickCell(page, 48, 39);
  await expect(page.locator(`.token-group[data-character-id="${pcId}"]`)).toHaveAttribute('data-cell', '48,39');
  expect(db.select().from(board_tokens).where(eq(board_tokens.character_id, pcId)).get()).toMatchObject({ x: 48, y: 39 });
  sqlite.close();
});
