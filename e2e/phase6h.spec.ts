import { test, expect } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';
import {
  boards,
  board_tokens,
  characters,
  combat_participants,
  combats,
  items,
  weapons,
  scenarios,
  scenario_sessions,
  session_log,
  encounters,
  scenes,
} from '../apps/server/src/db/schema.js';
import { joinAsPlayer } from './join.js';

const combatId = 'phase6h-combat';
const boardId = 'phase6h-board';
const gunId = 'phase6h-gun';
const ids = ['phase6h-pc-jack', 'phase6h-enemy-gunner'];
const names = ['ジャック6h', 'ガンナー6h'];

test.afterAll(() => {
  const { sqlite } = createDb(process.env.DATABASE_URL || 'data/test-e2e.db');
  for (const t of ['combat_log', 'combat_participants', 'combats', 'session_log', 'encounters', 'scenes', 'scenario_sessions', 'scenarios']) {
    sqlite.prepare(`DELETE FROM ${t}`).run();
  }
  sqlite.prepare("DELETE FROM characters WHERE id IN ('phase6h-pc-jack', 'phase6h-enemy-gunner')").run();
  sqlite.prepare('DELETE FROM weapons WHERE item_id = ?').run(gunId);
  sqlite.prepare('DELETE FROM items WHERE id = ?').run(gunId);
  sqlite.prepare('DELETE FROM board_tokens WHERE board_id = ?').run(boardId);
  sqlite.prepare('DELETE FROM boards WHERE id = ?').run(boardId);
});

test('Phase 6h: 状況修正・状態異常の付け外し・戦闘ログをセッションログへ', async ({ browser, request }) => {
  test.setTimeout(120000);
  const dbPath = process.env.DATABASE_URL || 'data/test-e2e.db';
  const { db, sqlite } = createDb(dbPath);
  const contexts: Array<Awaited<ReturnType<typeof browser.newContext>>> = [];

  try {
    // 1. テーブルのクリーンアップ
    for (const t of ['combat_log', 'combat_participants', 'combats', 'session_log', 'encounters', 'scenes', 'scenario_sessions', 'scenarios']) {
      sqlite.prepare(`DELETE FROM ${t}`).run();
    }
    sqlite.prepare("DELETE FROM characters WHERE id IN ('phase6h-pc-jack', 'phase6h-enemy-gunner')").run();
    sqlite.prepare('DELETE FROM weapons WHERE item_id = ?').run(gunId);
    sqlite.prepare('DELETE FROM items WHERE id = ?').run(gunId);
    sqlite.prepare('DELETE FROM board_tokens WHERE board_id = ?').run(boardId);
    sqlite.prepare('DELETE FROM boards WHERE id = ?').run(boardId);

    const now = Date.now();

    // 2. 武器とキャラクターの作成
    db.insert(items).values({
      id: gunId,
      kind: 'weapon',
      name_en: 'Phase 6h Heavy Pistol',
      name_ja: 'ヘビーピストル6h',
      origin: 'official_verified',
      verify_status: 'official_verified',
      created_at: now,
      updated_at: now,
    } as any).run();

    db.insert(weapons).values({
      item_id: gunId,
      weapon_type: 'heavyPistol',
      skill: 'Handgun',
      damage: '3d6',
      rof: 2,
      magazine_max: 8,
      dv_table_key: 'DV Pistol',
      is_ranged: true,
      suppressive: false,
      ignore_armor_percent: 0,
    } as any).run();

    const stats = { int: 6, ref: 8, dex: 7, tech: 6, cool: 6, will: 6, luck: 5, move: 6, body: 7, emp: 6 };

    db.insert(characters).values([
      {
        id: ids[0],
        kind: 'pc',
        name: names[0],
        role: 'Solo',
        stats: JSON.stringify(stats),
        skills: JSON.stringify({ handgun: 6, evasion: 6, brawling: 4 }),
        hp: 40,
        hp_max: 40,
        sp_head: 7,
        sp_body: 7,
        humanity: 50,
        emp_max: 6,
        status: '[]',
        inventory: JSON.stringify([
          { entry_id: 'phase6h-weapon-1', item_id: gunId, name: 'ヘビーピストル6h', kind: 'weapon', qty: 1, equipped: true, ammo: 8 },
        ]),
        cyberware: '[]',
        created_at: now,
        updated_at: now,
      },
      {
        id: ids[1],
        kind: 'npc',
        name: names[1],
        role: 'Solo',
        stats: JSON.stringify(stats),
        skills: JSON.stringify({ handgun: 5, evasion: 5, brawling: 4 }),
        hp: 30,
        hp_max: 30,
        sp_head: 4,
        sp_body: 4,
        humanity: 40,
        emp_max: 4,
        status: '[]',
        inventory: '[]',
        cyberware: '[]',
        created_at: now,
        updated_at: now,
      },
    ] as any).run();

    // 盤面とトークン
    db.insert(boards).values({
      id: boardId,
      name: 'Phase 6h Board',
      grid: JSON.stringify({ show: true, cell_m: 2, cell_px: 80, cols: 20, rows: 12 }),
      created_at: now,
      updated_at: now,
    }).run();

    db.insert(board_tokens).values([
      { id: 'token-6h-0', board_id: boardId, character_id: ids[0], x: 2, y: 4, gm_only: false },
      { id: 'token-6h-1', board_id: boardId, character_id: ids[1], x: 5, y: 4, gm_only: false },
    ] as any).run();

    // 戦闘（Active）
    db.insert(combats).values({
      id: combatId,
      board_id: boardId,
      status: 'active',
      round: 1,
      turn_index: 0,
      settings: JSON.stringify({ hideEnemyStats: false }),
      created_at: now,
    } as any).run();

    db.insert(combat_participants).values([
      {
        id: 'part-6h-0',
        combat_id: combatId,
        character_id: ids[0],
        side: 'ally',
        name: names[0],
        initiative: 20,
        initiative_roll: '{}',
        order_index: 0,
        active: true,
        out: false,
        move_used: false,
        action_used: false,
        state: '{}',
      },
      {
        id: 'part-6h-1',
        combat_id: combatId,
        character_id: ids[1],
        side: 'enemy',
        name: names[1],
        initiative: 15,
        initiative_roll: '{}',
        order_index: 1,
        active: true,
        out: false,
        move_used: false,
        action_used: false,
        state: '{}',
      },
    ] as any).run();

    // ==========================================
    // A. 状況修正の E2E 検証
    // ==========================================
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    contexts.push(gmContext);
    const gm = await gmContext.newPage();
    gm.on('dialog', (dialog) => dialog.accept());
    const gmToken = (await (await request.post('/api/auth/gm-token')).json()).token;
    await gm.addInitScript((val) => localStorage.setItem('cpgm_gm_token', val), gmToken);

    await gm.goto('/gm/combat');
    await gm.getByTestId('action-btn-ranged').click();
    await gm.getByRole('button', { name: names[1], exact: true }).click();

    // 初期状態の成功ライン確認
    await expect(gm.getByTestId('attack-line')).toBeVisible();

    // 状況修正「煙や暗闇で視界が悪い」にチェック (-4)
    const obscuredCheck = gm.getByTestId('situation-check-obscured');
    await expect(obscuredCheck).toBeVisible();
    await obscuredCheck.check();

    // 成功ラインの内訳に「煙や暗闇で視界が悪い −4」が出る
    await expect(gm.getByTestId('attack-line')).toContainText('煙や暗闇で視界が悪い −4');

    // 「その他 ±」に -2 を順次入力（キーボードからの負数入力確認）
    const customInput = gm.getByTestId('situation-custom-input');
    await customInput.fill('');
    await customInput.pressSequentially('-2');

    // 成功ラインに「その他 −2」が出る
    await expect(gm.getByTestId('attack-line')).toContainText('その他 −2');

    // 「戦闘の既定として保存」をクリック
    await gm.getByTestId('save-default-situations-btn').click();

    // 1440px スクリーンショット撮影（GM 判定欄・状況修正）
    await gm.screenshot({ path: 'docs/agy/reports/img/phase6h-situation-modifier-1440.png', fullPage: true });

    // スマホ側でも確認（390px）
    const health = await (await request.get('/api/health')).json();
    const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    contexts.push(phoneContext);
    const phone = await phoneContext.newPage();
    await joinAsPlayer(phone, health.session, names[0], 'Phase 6h');

    await phone.getByTestId('player-tab-act').click();
    await phone.screenshot({ path: 'docs/agy/reports/img/phase6h-situation-modifier-390.png', fullPage: true });

    // ==========================================
    // B. 状態異常の付け外しの E2E 検証
    // ==========================================
    await gm.getByRole('button', { name: /敵 \(\d+\)/ }).click();
    await gm.getByTestId('participant-card-part-6h-1').click();

    // 状態付与で「気絶」を選び、残りラウンドに「2」を入力して付与
    await gm.getByTestId('add-status-select-part-6h-1').selectOption('気絶');
    await gm.getByTestId('add-status-rounds-part-6h-1').fill('2');
    await gm.getByTestId('add-status-btn-part-6h-1').click();

    // 参加者カードに「気絶 あと 2R」が表示されること
    await expect(gm.getByTestId('gm-participant-status-part-6h-1')).toContainText('気絶 あと 2R');

    // スクリーンショット撮影（1440px 状態管理）
    await gm.screenshot({ path: 'docs/agy/reports/img/phase6h-status-management-1440.png', fullPage: true });

    // 味方タブに切り替え、自身（ジャック）を展開して「気絶」を付与
    await gm.getByRole('button', { name: /味方 \(\d+\)/ }).click();
    await gm.getByTestId('participant-card-part-6h-0').click();
    await gm.getByTestId('add-status-select-part-6h-0').selectOption('気絶');
    await gm.getByTestId('add-status-rounds-part-6h-0').fill('2');
    await gm.getByTestId('add-status-btn-part-6h-0').click();

    // スマホ側で状態バッジ「気絶 あと 2R」が表示されること
    await expect(phone.getByTestId('player-combat-status-list')).toContainText('気絶 あと 2R');
    await phone.screenshot({ path: 'docs/agy/reports/img/phase6h-status-management-390.png', fullPage: true });

    // GM側でジャックの気絶を「×」ボタンで手動解除
    await gm.getByTestId('remove-status-part-6h-0-気絶').click();
    await expect(gm.getByTestId('gm-participant-status-part-6h-0')).not.toContainText('気絶');

    // 手番終了を押し、ガンナーのラウンドが経過して気絶が自動解除されることを確認
    await gm.getByRole('button', { name: '手番終了 → 次の参加者へ' }).click();
    await gm.getByRole('button', { name: '手番終了 → 次の参加者へ' }).click();
    await gm.getByRole('button', { name: '手番終了 → 次の参加者へ' }).click();
    await gm.getByRole('button', { name: '手番終了 → 次の参加者へ' }).click();

    // 敵タブに切り替えて気絶が外れていること
    await gm.getByRole('button', { name: /敵 \(\d+\)/ }).click();
    const enemyStatusText = await gm.getByTestId('gm-participant-status-part-6h-1').textContent();
    expect(enemyStatusText).not.toContain('気絶 あと 2R');

    // ==========================================
    // C. 戦闘ログをセッションログへの E2E 検証
    // ==========================================
    const scenarioId = 'scenario-6h-e2e';
    const sessionId = 'session-6h-e2e';
    const sceneId = 'scene-6h-e2e';
    const encounterId = 'encounter-6h-e2e';

    db.insert(scenarios).values({
      id: scenarioId,
      title: 'テストシナリオ6h',
      status: 'ready',
      created_at: now,
      updated_at: now,
    } as any).run();

    db.insert(scenes).values({
      id: sceneId,
      scenario_id: scenarioId,
      title: '廃ビルの対決',
      sort_index: 0,
      board_id: boardId,
      npc_ids: '[]',
      created_at: now,
      updated_at: now,
    } as any).run();

    db.insert(encounters).values({
      id: encounterId,
      scenario_id: scenarioId,
      scene_id: sceneId,
      title: '暴徒との戦闘6h',
      participants: '[]',
      created_at: now,
      updated_at: now,
    } as any).run();

    db.insert(scenario_sessions).values({
      id: sessionId,
      scenario_id: scenarioId,
      current_scene_id: sceneId,
      status: 'active',
      started_at: now,
    } as any).run();

    // セッションログにエンカウンター投入ログを記録
    db.insert(session_log).values({
      id: 'slog-encounter-6h',
      scenario_session_id: sessionId,
      at: now,
      kind: 'combat',
      text: '戦闘投入: 暴徒との戦闘6h',
      ref: JSON.stringify({ combat_id: combatId, encounter_id: encounterId }),
    }).run();

    // 戦闘画面で攻撃判定を行って戦闘ログを残す
    await gm.goto('/gm/combat');
    await gm.getByTestId('action-btn-ranged').click();
    await gm.getByRole('button', { name: names[1], exact: true }).click();
    await gm.getByTestId('attack-roll-input').fill('8');
    await gm.getByTestId('damage-dice-input').fill('4,5,3');
    await gm.getByRole('button', { name: '判定と反映内容を計算', exact: true }).click();
    await expect(gm.getByRole('button', { name: '確定して反映', exact: true })).toBeEnabled();
    const applyPromise = gm.waitForResponse((r) => r.url().includes(`/api/combats/${combatId}/apply`) && r.ok());
    await gm.getByRole('button', { name: '確定して反映', exact: true }).click();
    await applyPromise;

    // 「戦闘を終える」をクリック
    const endPromise = gm.waitForResponse((r) => r.url().includes(`/api/combats/${combatId}`) && r.request().method() === 'PATCH' && r.ok());
    await gm.getByRole('button', { name: '戦闘を終える', exact: true }).click();
    await endPromise;

    // GM画面のシナリオタブへ遷移
    await gm.goto('/gm');
    await gm.getByRole('button', { name: 'シナリオ', exact: true }).click();
    await gm.getByRole('button', { name: '進める', exact: true }).click();

    // セッションログに戦闘の要約が表示されていること
    await expect(gm.getByTestId('scenario-log')).toBeVisible();
    await expect(gm.getByTestId('scenario-log')).toContainText('【戦闘ログ要約】');
    await expect(gm.getByTestId('scenario-log')).toContainText('ジャック6h');

    // スクリーンショット撮影（1440px セッションログ）
    await gm.screenshot({ path: 'docs/agy/reports/img/phase6h-session-log-1440.png', fullPage: true });

    // スマホ側でもシナリオログ表示または画面キャプチャ（390px）
    const phoneSession = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    contexts.push(phoneSession);
    const phonePage = await phoneSession.newPage();
    await phonePage.addInitScript((val) => localStorage.setItem('cpgm_gm_token', val), gmToken);
    await phonePage.goto('/gm');
    await phonePage.getByRole('button', { name: 'シナリオ', exact: true }).click();
    await phonePage.getByRole('button', { name: '進める', exact: true }).click();
    await expect(phonePage.getByTestId('scenario-log')).toBeVisible();
    await phonePage.screenshot({ path: 'docs/agy/reports/img/phase6h-session-log-390.png', fullPage: true });

  } finally {
    for (const ctx of contexts) {
      await ctx.close().catch(() => {});
    }
  }
});
