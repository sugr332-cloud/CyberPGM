import { test, expect, type APIRequestContext } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';
import { characters } from '../apps/server/src/db/schema.js';
import { eq } from 'drizzle-orm';
import { generateUlid } from '@cyberpgm/shared';
import { joinAsPlayer } from './join.js';

// Phase 5b §8 E2E: 進行開始 → 選択肢を公開 → スマホで選んで出目 → GM が確定 → 手がかりが「資料」に届き次のシーンへ → エンカウンターから戦闘
test('Scenario play: publish a choice, player rolls, GM applies, clue reaches the phone, encounter starts combat', async ({ browser, request }) => {
  const dbPath = process.env.DATABASE_URL || 'data/test-e2e.db';
  const { db, sqlite } = createDb(dbPath);
  for (const t of ['story_checks', 'session_log', 'scenario_sessions', 'combat_log', 'combat_participants', 'combats', 'devices']) {
    sqlite.prepare(`DELETE FROM ${t}`).run();
  }
  sqlite.prepare("DELETE FROM characters WHERE name LIKE 'E2E ガンガー%'").run();
  db.update(characters).set({ hp: 35, status: '[]' }).where(eq(characters.name, 'ヴァイパー')).run();

  const mookId = generateUlid();
  const viper = db.select().from(characters).where(eq(characters.name, 'ヴァイパー')).get()!;
  db.insert(characters).values({ ...viper, id: mookId, kind: 'mook', name: 'E2E ガンガー', created_at: Date.now(), updated_at: Date.now() }).run();
  sqlite.close();

  // シナリオを API で用意する（2 シーン、手がかり、選択肢、エンカウンター）
  const gm = (await (await request.post('/api/auth/gm-token')).json()).token as string;
  const H = { Authorization: `Bearer ${gm}` };
  const api = (r: APIRequestContext, path: string, data: unknown) => r.post(path, { headers: H, data });
  const scenario = await (await api(request, '/api/scenarios', { title: 'E2E 進行テスト', use_template: false })).json();
  const sid = scenario.scenario.id;
  const s1 = await (await api(request, `/api/scenarios/${sid}/scenes`, { title: '裏口', read_aloud: '路地の奥に古いドアがある。' })).json();
  const s2 = await (await api(request, `/api/scenarios/${sid}/scenes`, { title: '倉庫' })).json();
  const scene1 = (s1.scene ?? s1).id;
  const scene2 = (s2.scene ?? s2).id;
  await api(request, `/api/scenarios/${sid}/links`, { from_scene_id: scene1, to_scene_id: scene2, condition: '裏口が開いた' });
  const clue = await (await api(request, `/api/scenarios/${sid}/clues`, { scene_id: scene1, title: '壊れた鍵', body: '裏口の鍵は壊されている。' })).json();
  await api(request, `/api/scenarios/scenes/${scene1}/choices`, {
    label: '裏口を探す',
    skill_key: 'perception',
    dv: 13,
    on_success: [{ kind: 'reveal_clue', clue_id: (clue.clue ?? clue).id }, { kind: 'next_scene', scene_id: scene2 }],
    on_failure: [{ kind: 'hp_change', amount: -3 }],
  });
  await api(request, `/api/scenarios/${sid}/encounters`, {
    title: '倉庫の見張り',
    scene_id: scene2,
    participants: [{ character_id: mookId, side: 'enemy', count: 2 }],
  });

  // GM: シナリオタブ → 進める → 進行開始
  const gmContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const gmPage = await gmContext.newPage();
  gmPage.on('dialog', (d) => d.accept());
  await gmPage.goto('/gm');
  await gmPage.getByRole('button', { name: 'シナリオ' }).first().click();
  await gmPage.getByRole('button', { name: '進める' }).click();
  await gmPage.locator('select').first().selectOption({ label: 'E2E 進行テスト' });
  await gmPage.getByRole('button', { name: '進行を開始する' }).click();
  await expect(gmPage.getByText('路地の奥に古いドアがある。')).toBeVisible();
  await gmPage.getByRole('button', { name: 'プレイヤーに公開' }).click();
  await gmPage.screenshot({ path: 'docs/agy/reports/img/phase5b-play-gm-1440.png' });

  // プレイヤー: 参加してヴァイパーを選び、行動 → 裏口を探す → 出目 8
  const session = await (await request.get('/api/session', { headers: H })).json();
  const playerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const phone = await playerContext.newPage();
  await joinAsPlayer(phone, session.code, 'ヴァイパー');
  await phone.getByRole('button', { name: '行動' }).click();
  await phone.getByRole('button', { name: /裏口を探す/ }).click();
  await expect(phone.getByText('判定のダイス入力')).toBeVisible();
  await phone.getByRole('button', { name: '8', exact: true }).click();
  await phone.screenshot({ path: 'docs/agy/reports/img/phase5b-play-phone-roll-390.png' });
  await phone.getByRole('button', { name: 'GM に出目を送信' }).click();
  await expect(phone.getByText('判定成功')).toBeVisible();

  // GM: 判定ボードに結果と反映する内容 → 確定して反映
  await expect(gmPage.getByText('反映する内容')).toBeVisible();
  await expect(gmPage.getByText('手がかりを公開: 壊れた鍵')).toBeVisible();
  await expect(gmPage.getByText('次のシーン: 倉庫')).toBeVisible();
  const row = gmPage.locator('[data-testid^="story-check-"]').first();
  await expect(row.getByText(/INT 4 \+ .+ 5 = 9 \+ 出目 8 = 17 vs 難易度 13/)).toBeVisible();
  await gmPage.screenshot({ path: 'docs/agy/reports/img/phase5b-check-board-1440.png' });
  await gmPage.getByRole('button', { name: '確定して反映' }).click();

  // スマホの「資料」に手がかりが届く
  await phone.getByRole('button', { name: '資料' }).click();
  await expect(phone.getByText('壊れた鍵')).toBeVisible();
  await phone.screenshot({ path: 'docs/agy/reports/img/phase5b-phone-handouts-390.png' });

  // GM: エンカウンターから戦闘 → 参加者に複製されたモブが 2 体
  await gmPage.getByRole('button', { name: '戦闘に入れる' }).click();
  await gmPage.getByRole('button', { name: '戦闘' }).first().click();
  await expect(gmPage.getByText('E2E ガンガー #1')).toBeVisible();
  await expect(gmPage.getByText('E2E ガンガー #2')).toBeVisible();

  await gmContext.close();
  await playerContext.close();
});

// Phase 5b §2 視界を隠す: TV では隠したマスのコマを送らない
test('Scenario play: fog hides tokens on the TV screen', async ({ browser, request }) => {
  const dbPath = process.env.DATABASE_URL || 'data/test-e2e.db';
  const { db, sqlite } = createDb(dbPath);
  for (const t of ['story_checks', 'session_log', 'scenario_sessions', 'combat_log', 'combat_participants', 'combats']) {
    sqlite.prepare(`DELETE FROM ${t}`).run();
  }
  const nyx = db.select().from(characters).where(eq(characters.name, 'ニクス')).get()!;
  const viper = db.select().from(characters).where(eq(characters.name, 'ヴァイパー')).get()!;
  sqlite.close();

  const gm = (await (await request.post('/api/auth/gm-token')).json()).token as string;
  const H = { Authorization: `Bearer ${gm}` };
  const board = (await (await request.post('/api/boards', { headers: H, data: { name: 'E2E 視界', grid: { cols: 12, rows: 8, cell_m: 2 } } })).json()).board;
  await request.post(`/api/boards/${board.id}/tokens`, { headers: H, data: { character_id: viper.id, x: 1, y: 1 } });
  await request.post(`/api/boards/${board.id}/tokens`, { headers: H, data: { character_id: nyx.id, x: 9, y: 5 } });
  const fog: Array<{ x: number; y: number }> = [];
  for (let x = 6; x < 12; x++) for (let y = 0; y < 8; y++) fog.push({ x, y });
  await request.patch(`/api/boards/${board.id}/fog`, { headers: H, data: { fog } });

  const scenario = await (await request.post('/api/scenarios', { headers: H, data: { title: 'E2E 視界テスト', use_template: false } })).json();
  const scene = await (await request.post(`/api/scenarios/${scenario.scenario.id}/scenes`, { headers: H, data: { title: '倉庫街' } })).json();
  await request.patch(`/api/scenarios/scenes/${(scene.scene ?? scene).id}`, { headers: H, data: { board_id: board.id } });
  await request.post('/api/scenario-sessions/start', { headers: H, data: { scenario_id: scenario.scenario.id } });

  const session = await (await request.get('/api/session', { headers: H })).json();
  const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvContext.newPage();
  await tv.goto(`/screen?code=${session.code}`);
  await expect(tv.locator('svg text', { hasText: 'ヴァイパー' }).first()).toBeVisible();
  await expect(tv.locator('svg text', { hasText: 'ニクス' })).toHaveCount(0); // 隠したマスにいるので送られない
  await tv.screenshot({ path: 'docs/agy/reports/img/phase5b-tv-fog-1920.png' });
  await tvContext.close();
});
