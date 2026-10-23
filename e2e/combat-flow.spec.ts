import { test, expect, type Page } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';
import { characters, boards, board_tokens, items, weapons, rule_constants } from '../apps/server/src/db/schema.js';
import { joinAsPlayer } from './join.js';

const ids = ['flow-pc1', 'flow-pc2', 'flow-npc'];
const names = ['進行PC1', '進行PC2', '進行NPC'];
const boardId = 'flow-board';
const weaponId = 'flow-weapon';
const secondWeaponId = 'flow-second-weapon';

async function moveTo(page: Page, x: number, y: number) {
  await page.getByTestId('action-btn-move').click();
  const svg = page.locator('.board-view-container svg');
  await svg.scrollIntoViewIfNeeded();
  const pos = await svg.evaluate((el, cell) => {
    const point = el.createSVGPoint();
    point.x = (cell.x + 0.5) * 80;
    point.y = (cell.y + 0.5) * 80;
    const screen = point.matrixTransform(el.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  }, { x, y });
  await page.mouse.click(pos.x, pos.y);
  await page.getByRole('button', { name: '移動を確定して反映', exact: true }).click();
}

test('combat flow: GM and mobile attacks, HP, automatic/manual turns, rounds, undo and end', async ({ browser }) => {
  test.setTimeout(90000);
  const { db, sqlite } = createDb(process.env.DATABASE_URL || 'data/test-e2e.db');
  const gmContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    for (const table of ['story_checks', 'session_log', 'scenario_sessions', 'combat_log', 'combat_participants', 'combats']) {
      sqlite.prepare(`DELETE FROM ${table}`).run();
    }
    sqlite.prepare('DELETE FROM boards WHERE id = ?').run(boardId);
    for (const id of ids) sqlite.prepare('DELETE FROM characters WHERE id = ?').run(id);
    sqlite.prepare('DELETE FROM items WHERE id = ?').run(weaponId);
    sqlite.prepare('DELETE FROM items WHERE id = ?').run(secondWeaponId);
    sqlite.prepare("DELETE FROM rule_constants WHERE key IN ('dv_table.Flow Test Pistol', 'dv_table.Flow Test Rifle')").run();
    const now = Date.now();
    // 自作の試験武器。カタログの名前やダメージ式に依存しない。
    db.insert(items).values({ id: weaponId, kind: 'weapon', name_en: 'Flow Test Pistol', name_ja: '進行試験銃', origin: 'homebrew', verify_status: 'homebrew', created_at: now, updated_at: now }).run();
    db.insert(items).values({ id: secondWeaponId, kind: 'weapon', name_en: 'Flow Test Rifle', name_ja: '進行試験ライフル', origin: 'homebrew', verify_status: 'homebrew', created_at: now, updated_at: now }).run();
    db.insert(weapons).values([
      { item_id: weaponId, weapon_type: 'heavyPistol', skill: 'Handgun', damage: '2d6', rof: 1, magazine_max: 8, dv_table_key: 'Flow Test Pistol', is_ranged: true },
      { item_id: secondWeaponId, weapon_type: 'assaultRifle', skill: 'Shoulder Arms', damage: '2d6', rof: 1, magazine_max: 8, dv_table_key: 'Flow Test Rifle', is_ranged: true },
    ] as any).run();
    db.insert(rule_constants).values([
      { key: 'dv_table.Flow Test Pistol', value: JSON.stringify([{ range: [0, 6], dv: 13 }, { range: [7, 12], dv: 15 }, { range: [13, 25], dv: 20 }]) },
      { key: 'dv_table.Flow Test Rifle', value: JSON.stringify([{ range: [0, 4], dv: 11 }, { range: [5, 10], dv: 14 }, { range: [11, 30], dv: 19 }]) },
    ]).run();
    db.insert(characters).values(ids.map((id, i) => ({
      id, kind: i === 2 ? 'npc' : 'pc', name: names[i], role: '',
      stats: JSON.stringify({ int: 6, ref: i === 2 ? 2 : 8, dex: 6, tech: 6, cool: 6, will: 6, luck: 6, move: 6, body: 6, emp: 6 }),
      skills: JSON.stringify({ handgun: 6, evasion: 0 }), hp: 40, hp_max: 40, sp_head: 0, sp_body: 0, humanity: 60, emp_max: 6,
      inventory: JSON.stringify([
        { entry_id: `gun-${id}`, item_id: weaponId, kind: 'weapon', name: '進行試験銃', qty: 1, equipped: true, ammo: 8 },
        ...(i === 0 ? [{ entry_id: `rifle-${id}`, item_id: secondWeaponId, kind: 'weapon', name: '進行試験ライフル', qty: 1, equipped: true, ammo: 8 }] : []),
      ]),
      created_at: now, updated_at: now,
    }))).run();
    db.insert(boards).values({ id: boardId, name: '戦闘進行の試験盤面', grid: JSON.stringify({ show: true, cell_m: 2, cell_px: 80, origin_x: 0, origin_y: 0, cols: 6, rows: 4 }), created_at: now, updated_at: now }).run();
    db.insert(board_tokens).values(ids.map((id, i) => ({ id: `tok-${id}`, board_id: boardId, character_id: id, x: 1 + i, y: 1 }))).run();

    const gm = await gmContext.newPage();
    // NPC の自動イニシアチブだけを固定。PC の出目は画面から入力する。
    const gmToken = (await (await gm.request.post('/api/auth/gm-token')).json()).token;
    // この試験は認証済みGMの操作を検証する。初回トークン取得とNPC一覧取得の競合を避ける。
    await gm.addInitScript((token) => { localStorage.setItem('cpgm_gm_token', token); Math.random = () => 0.4; }, gmToken);
    // 古いコマHPが含まれる盤面スナップショットでも、戦闘キャラの最新HPを使う必要がある。
    await gm.route(`**/api/boards/${boardId}`, async (route) => {
      const res = await route.fetch();
      const data = await res.json();
      if (data.board?.tokens) data.board.tokens = data.board.tokens.map((t: { character_id: string }) => ({ ...t, hp: 40, hp_max: 40 }));
      await route.fulfill({ response: res, json: data });
    });
    await gm.goto('/gm/combat');
    const created = gm.waitForResponse((r) => r.url().endsWith('/api/combats') && r.request().method() === 'POST');
    await gm.getByRole('button', { name: '戦闘を始める', exact: true }).click();
    const setup = (await (await created).json()).combat;
    const combatId = setup.id;
    for (const p of setup.participants) {
      const input = gm.getByTestId(`init-input-${p.name}`);
      const checkbox = input.locator('../..').getByRole('checkbox');
      const checked = ids.includes(p.character_id);
      if (await checkbox.isChecked() !== checked) await checkbox.click();
      await expect(checkbox).toBeChecked({ checked });
    }
    await gm.getByTestId(`init-input-${names[0]}`).fill('8');
    await gm.getByTestId(`init-input-${names[1]}`).fill('6');
    await gm.locator('select').filter({ hasText: 'NPC/モブを選択' }).selectOption(ids[2]);
    await gm.getByRole('button', { name: '敵として追加', exact: true }).click();
    const linked = await gm.request.patch(`/api/combats/${combatId}`, { headers: { Authorization: `Bearer ${gmToken}` }, data: { board_id: boardId } });
    expect(linked.ok()).toBe(true);
    await gm.getByRole('button', { name: '行動順を確定して戦闘開始', exact: true }).first().click();
    const state = () => sqlite.prepare('SELECT status, round, turn_index FROM combats WHERE id = ?').get(combatId);
    const hp = () => (sqlite.prepare('SELECT hp FROM characters WHERE id = ?').get(ids[2]) as { hp: number }).hp;
    await expect.poll(state).toMatchObject({ status: 'active', round: 1, turn_index: 0 });
    const parts = sqlite.prepare('SELECT id, character_id, initiative FROM combat_participants WHERE combat_id = ? ORDER BY order_index').all(combatId) as Array<{ id: string; character_id: string; initiative: number }>;
    expect(parts.map((p) => p.character_id)).toEqual(ids);
    expect(parts.map((p) => p.initiative)).toEqual([16, 14, 7]);
    const npcCard = gm.getByTestId(`participant-card-${parts[2].id}`);

    const phone = await phoneContext.newPage();
    const health = await (await gm.request.get('/api/health')).json();
    await joinAsPlayer(phone, health.session, names[0], '戦闘進行試験');
    await phone.getByTestId('player-tab-act').click();
    const playerHp = () => phone.evaluate(async (npcId) => {
      const token = localStorage.getItem('cpgm_player_token');
      const res = await fetch('/api/combats/current', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      return data.combat?.participants.find((p: { character_id: string }) => p.character_id === npcId)?.character.hp;
    }, ids[2]);
    const turn = async (index: number, round: number) => {
      await expect.poll(state).toMatchObject({ status: 'active', turn_index: index, round });
      await expect(gm.getByText(`手番:`, { exact: false }).filter({ hasText: names[index] })).toBeVisible();
      await expect(phone.getByText(index === 0 ? `あなた（${names[0]}）の手番です` : `${names[index]} の手番です`, { exact: true })).toBeVisible();
      await expect(phone.getByText(`ラウンド ${round}`, { exact: true })).toBeVisible();
    };
    const checkHp = async (value: number) => {
      await expect.poll(hp).toBe(value);
      await expect(npcCard).toContainText(`${value} / 40`);
      await expect.poll(playerHp).toBe(value);
    };
    await turn(0, 1);

    await gm.getByTestId('action-btn-ranged').click();
    await expect(gm.getByTestId('range-rings')).toBeVisible();
    await expect(gm.getByTestId('range-rings').locator('g[data-range-meters]')).toHaveCount(3);
    const rangeToggle = gm.getByTestId('range-rings-toggle').getByRole('checkbox');
    await rangeToggle.uncheck();
    await expect(gm.getByTestId('range-rings')).toHaveCount(0);
    await rangeToggle.check();
    await gm.locator('select').filter({ hasText: '進行試験銃' }).selectOption(`rifle-${ids[0]}`);
    const gmRangeCircle = gm.getByTestId('range-rings').locator('[data-range-meters="4"] circle');
    await expect(gmRangeCircle).toBeVisible();
    await expect(gmRangeCircle).toHaveAttribute('cx', '120');
    await expect(gmRangeCircle).toHaveAttribute('cy', '120');
    await gm.screenshot({ path: 'docs/agy/reports/img/phase6g-range-rings-gm-1440.png', fullPage: true });

    await phone.getByTestId('attack-weapon').filter({ hasText: '進行試験ライフル' }).click();
    await phone.getByTestId('player-action-move').click();
    await expect(phone.getByTestId('range-rings').locator('[data-range-meters="4"]')).toBeVisible();
    await expect(phone.getByTestId('range-rings').locator('g[data-range-meters]')).toHaveCount(3);
    await phone.screenshot({ path: 'docs/agy/reports/img/phase6g-range-rings-mobile-390.png', fullPage: true });
    await phone.getByRole('button', { name: '閉じる', exact: true }).click();

    // GM が攻撃の出目とダメージを入力。計算だけでは HP は変化しない。
    await gm.getByTestId('action-btn-ranged').click();
    await expect(gm.locator('select').filter({ hasText: '進行試験銃' }).locator('option:checked')).toContainText('2d6');
    await expect(gm.getByTestId('gm-damage-guide')).toHaveText('ダメージ: 2d6（6 面ダイスを 2 個）');
    await gm.getByRole('button', { name: names[2], exact: true }).click();
    await gm.getByTestId('attack-roll-input').fill('8');
    await gm.getByTestId('damage-dice-input').fill('4, 3');
    await gm.getByRole('button', { name: '判定と反映内容を計算', exact: true }).click();
    await expect(gm.getByText(`${names[2]} HP 40 → 33 (7 ダメージ)`, { exact: false })).toBeVisible();
    await checkHp(40);
    await gm.screenshot({ path: 'docs/agy/reports/img/phase6d-weapon-dice-1440.png', fullPage: true });
    await gm.getByRole('button', { name: '確定して反映', exact: true }).click();
    await checkHp(33);
    await expect(phone.getByTestId('combat-result-banner')).toBeVisible();
    await turn(0, 1); // 移動が未使用なら同じ手番
    await moveTo(gm, 1, 2);
    await turn(1, 1); // 行動と移動を使うと自動で進む
    await gm.getByRole('button', { name: '手番終了 → 次の参加者へ', exact: true }).click();
    await turn(2, 1);

    // NPC がPC1を撃つ。GMカード・盤面・TV・スマホシートの4か所を再読み込みなしで照合。
    const screen = await gmContext.newPage();
    await screen.goto(`/screen?code=${health.session}`);
    const tvNearRing = screen.getByTestId('range-rings').locator('[data-range-meters="6"] circle');
    await expect(tvNearRing).toHaveAttribute('cx', '280');
    await expect(tvNearRing).toHaveAttribute('cy', '120');
    await screen.screenshot({ path: 'docs/agy/reports/img/phase6g-range-rings-tv.png', fullPage: true });
    const checkPcBars = async (value: number) => {
      await expect(gm.getByTestId(`gm-hp-${ids[0]}`)).toHaveAttribute('aria-valuenow', String(value));
      await expect(gm.getByTestId(`board-hp-${ids[0]}`)).toHaveAttribute('aria-valuenow', String(value));
      await expect(screen.getByTestId(`screen-hp-${ids[0]}`)).toHaveAttribute('aria-valuenow', String(value));
      await expect(screen.getByTestId(`board-hp-${ids[0]}`)).toHaveAttribute('aria-valuenow', String(value));
      await expect(phone.getByTestId('player-hp')).toHaveAttribute('aria-valuenow', String(value));
      for (const bar of [gm.getByTestId(`gm-hp-${ids[0]}`), screen.getByTestId(`screen-hp-${ids[0]}`), phone.getByTestId('player-hp')]) {
        await expect.poll(async () => bar.evaluate((el) => Math.abs(el.getBoundingClientRect().width / el.parentElement!.getBoundingClientRect().width - Number(el.getAttribute('aria-valuenow')) / Number(el.getAttribute('aria-valuemax'))))).toBeLessThan(0.015);
      }
      const boardBar = gm.getByTestId(`board-hp-${ids[0]}`);
      const filled = Number(await boardBar.locator('rect').nth(1).getAttribute('width'));
      const full = Number(await boardBar.locator('rect').first().getAttribute('width'));
      expect(filled / full).toBeCloseTo(value / 40, 3);
      expect((sqlite.prepare('SELECT hp FROM characters WHERE id = ?').get(ids[0]) as { hp: number }).hp).toBe(value);
      await expect(gm.getByTestId(`participant-card-${parts[0].id}`)).toContainText(`${value} / 40`);
      await expect(screen.getByTestId(`screen-hp-${ids[0]}`).locator('../..')).toContainText(`HP ${value}/40`);
    };
    await phone.getByTestId('player-tab-sheet').click();
    await checkPcBars(40);
    await gm.getByTestId('action-btn-ranged').click();
    await gm.getByRole('button', { name: names[0], exact: true }).click();
    await gm.getByTestId('attack-roll-input').fill('8');
    await gm.getByTestId('damage-dice-input').fill('4, 3');
    await gm.getByRole('button', { name: '判定と反映内容を計算', exact: true }).click();
    await gm.getByRole('button', { name: '確定して反映', exact: true }).click();
    await checkPcBars(33);
    await gm.screenshot({ path: 'docs/agy/reports/img/phase6d-hp-damage-1440.png', fullPage: true });
    gm.once('dialog', (dialog) => dialog.accept());
    await gm.getByRole('button', { name: /一手戻る/ }).click();
    await checkPcBars(40);
    // HP回復・修正も同じ戦闘データに同期すること。
    for (const value of [33, 36, 33]) {
      const patched = await gm.request.patch(`/api/characters/${ids[0]}`, { headers: { Authorization: `Bearer ${gmToken}` }, data: { hp: value } });
      expect(patched.ok()).toBe(true);
      await checkPcBars(value);
    }
    const medHeaders = { Authorization: `Bearer ${gmToken}` };
    expect((await gm.request.post(`/api/medical/${ids[0]}/healing`, { headers: medHeaders, data: { on: true } })).ok()).toBe(true);
    expect((await gm.request.post('/api/medical/time', { headers: medHeaders, data: { hours: 24, rested_ids: [ids[0]] } })).ok()).toBe(true);
    await checkPcBars(39); // BODY 6で自然治癒
    expect((await gm.request.post(`/api/medical/${ids[0]}/undo`, { headers: medHeaders })).ok()).toBe(true);
    await checkPcBars(33);
    expect((await gm.request.patch(`/api/characters/${ids[0]}`, { headers: medHeaders, data: { hp: 40 } })).ok()).toBe(true);
    await checkPcBars(40);
    await phone.getByTestId('player-tab-act').click();
    await gm.getByRole('button', { name: '手番終了 → 次の参加者へ', exact: true }).click();
    await turn(0, 2);

    // スマホから対象・武器・攻撃出目を選ぶ。移動を先に済ませておき、攻撃確定で自動進行することも確認。
    await moveTo(gm, 1, 1);
    await turn(0, 2);
    await phone.getByTestId('attack-target').filter({ hasText: names[2] }).click();
    await phone.getByTestId('attack-weapon').first().click();
    await expect(phone.getByTestId('attack-weapon').first()).toContainText('ダメージ 2d6');
    await phone.getByTestId('player-action-ranged').click();
    await phone.getByRole('button', { name: '8', exact: true }).click();
    await phone.getByRole('button', { name: 'GM に出目を送信', exact: true }).click();
    await expect(gm.getByTestId('attack-roll-input')).toHaveValue('8');
    await expect(gm.getByTestId('roll-from-attack')).toContainText(names[0]);
    await gm.getByTestId('damage-dice-input').fill('4, 3');
    await gm.getByRole('button', { name: '判定と反映内容を計算', exact: true }).click();
    await checkHp(33);
    await gm.getByRole('button', { name: '確定して反映', exact: true }).click();
    await checkHp(26);
    await turn(1, 2);
    await gm.screenshot({ path: 'docs/agy/reports/img/phase6c-combat-gm-1440.png', fullPage: true });

    // 攻撃と自動進行を一緒に取り消す。スマホを再読み込みせずに手番が戻る必要がある。
    gm.once('dialog', (dialog) => dialog.accept());
    await gm.getByRole('button', { name: /一手戻る/ }).click();
    await checkHp(33);
    await turn(0, 2);
    await expect(phone.getByTestId('player-action-ranged')).not.toHaveAttribute('aria-disabled', 'true');
    expect(sqlite.prepare('SELECT move_used, action_used FROM combat_participants WHERE id = ?').get(parts[0].id)).toMatchObject({ move_used: 1, action_used: 0 });

    // 移動しない選択で手番を進め、2 周目のラウンド更新も確認。
    for (const [index, round] of [[1, 2], [2, 2], [0, 3]]) {
      await gm.getByRole('button', { name: '手番終了 → 次の参加者へ', exact: true }).click();
      await turn(index, round);
    }
    gm.once('dialog', (dialog) => dialog.dismiss()); // モブは消さずに終了する
    await gm.getByRole('button', { name: '戦闘を終える', exact: true }).click();
    await expect.poll(state).toMatchObject({ status: 'ended' });
    await expect(gm.getByRole('button', { name: '戦闘を始める', exact: true })).toBeVisible();
    await expect(gm.getByText('手番:', { exact: false })).toHaveCount(0);
    await expect(phone.getByText(/の手番です/)).toHaveCount(0);
    await expect(phone.getByTestId('attack-picker')).toHaveCount(0);
    // 再読み込み後も古い戦闘に戻らない。
    await phone.reload();
    await phone.getByTestId('player-tab-act').click();
    await expect(phone.getByText(/の手番です/)).toHaveCount(0);
  } finally {
    await phoneContext.close();
    await gmContext.close();
    for (const table of ['combat_log', 'combat_participants', 'combats']) sqlite.prepare(`DELETE FROM ${table}`).run();
    sqlite.prepare('DELETE FROM boards WHERE id = ?').run(boardId);
    for (const id of ids) sqlite.prepare('DELETE FROM characters WHERE id = ?').run(id);
    sqlite.prepare('DELETE FROM items WHERE id = ?').run(weaponId);
    sqlite.prepare('DELETE FROM items WHERE id = ?').run(secondWeaponId);
    sqlite.prepare("DELETE FROM rule_constants WHERE key IN ('dv_table.Flow Test Pistol', 'dv_table.Flow Test Rifle')").run();
    sqlite.close();
  }
});
