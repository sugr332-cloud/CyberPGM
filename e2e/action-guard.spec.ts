import { test, expect } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';
import { characters, items, weapons, combats, combat_participants } from '../apps/server/src/db/schema.js';
import { joinAsPlayer } from './join.js';

const pcId = 'action-guard-pc';
const npcId = 'action-guard-npc';
const gunId = 'action-guard-gun';

test.afterAll(() => {
  const { sqlite } = createDb(process.env.DATABASE_URL || 'data/test-e2e.db');
  sqlite.prepare("DELETE FROM combat_participants WHERE combat_id = 'action-guard-combat'").run();
  sqlite.prepare("DELETE FROM combats WHERE id = 'action-guard-combat'").run();
  for (const id of [pcId, npcId]) sqlite.prepare('DELETE FROM characters WHERE id = ?').run(id);
  sqlite.prepare('DELETE FROM weapons WHERE item_id = ?').run(gunId);
  sqlite.prepare('DELETE FROM items WHERE id = ?').run(gunId);
  sqlite.close();
});

test('action guard UI uses the shared action input table on GM and phone', async ({ browser }) => {
  test.setTimeout(90000);
  const { db, sqlite } = createDb(process.env.DATABASE_URL || 'data/test-e2e.db');
  for (const table of ['combat_log', 'combat_participants', 'combats']) sqlite.prepare(`DELETE FROM ${table}`).run();
  for (const id of [pcId, npcId]) sqlite.prepare('DELETE FROM characters WHERE id = ?').run(id);
  sqlite.prepare('DELETE FROM weapons WHERE item_id = ?').run(gunId);
  sqlite.prepare('DELETE FROM items WHERE id = ?').run(gunId);
  const now = Date.now();
  db.insert(items).values({ id: gunId, kind: 'weapon', name_en: 'Action Guard Pistol', name_ja: '確認用拳銃', origin: 'homebrew', verify_status: 'homebrew', created_at: now, updated_at: now }).run();
  db.insert(weapons).values({ item_id: gunId, weapon_type: 'heavyPistol', skill: 'Handgun', damage: '2d6', rof: 1, magazine_max: 8, dv_table_key: 'DV Pistol', is_ranged: true } as any).run();
  const base = { int: 6, ref: 8, dex: 6, tech: 6, cool: 6, will: 6, luck: 5, move: 4, body: 6, emp: 6 };
  db.insert(characters).values([
    { id: pcId, kind: 'pc', name: '行動確認PC', role: '', stats: JSON.stringify(base), skills: JSON.stringify({ handgun: 4, evasion: 2 }), hp: 40, hp_max: 40, sp_head: 0, sp_body: 0, humanity: 60, emp_max: 6, extra: JSON.stringify({ vehicles: [{ id: 'action-car', name: '確認用車両', kind: 'car', sdp: 30, sdp_max: 30, sp: 10, move: 20, seats: 4, upgrades: [] }] }), inventory: JSON.stringify([{ entry_id: 'action-gun-entry', item_id: gunId, kind: 'weapon', name: '確認用拳銃', qty: 1, equipped: true, ammo: 8 }]), created_at: now, updated_at: now },
    { id: npcId, kind: 'npc', name: '行動確認相手', role: '', stats: JSON.stringify({ ...base, ref: 2 }), skills: JSON.stringify({ evasion: 0 }), hp: 20, hp_max: 40, sp_head: 0, sp_body: 0, humanity: 40, emp_max: 4, created_at: now, updated_at: now },
  ] as any).run();
  db.insert(combats).values({ id: 'action-guard-combat', status: 'active', round: 1, turn_index: 0, settings: JSON.stringify({}), created_at: now }).run();
  db.insert(combat_participants).values([
    { id: 'action-guard-pc-part', combat_id: 'action-guard-combat', character_id: pcId, side: 'ally', name: '行動確認PC', initiative: 20, order_index: 0, active: true, out: false, move_used: false, action_used: false, state: '{}' },
    { id: 'action-guard-npc-part', combat_id: 'action-guard-combat', character_id: npcId, side: 'enemy', name: '行動確認相手', initiative: 10, order_index: 1, active: true, out: false, move_used: false, action_used: false, state: '{}' },
  ] as any).run();

  const gmContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const gm = await gmContext.newPage();
  const gmToken = (await (await gm.request.post('/api/auth/gm-token')).json()).token;
  await gm.addInitScript((token) => localStorage.setItem('cpgm_gm_token', token), gmToken);
  await gm.goto('/gm/combat');
  const martial = gm.getByTestId('action-btn-martial_arts');
  await expect(martial).toBeDisabled();
  await expect(martial.getByTestId('action-disabled-reason')).toContainText('〈武術〉を 1 レベル以上');
  await gm.screenshot({ path: 'docs/agy/reports/img/phase6e-actions-1440.png', fullPage: true });

  await gm.getByTestId('action-btn-first_aid').click();
  await gm.getByRole('button', { name: '行動確認相手', exact: true }).click();
  await gm.getByRole('button', { name: '判定と反映内容を計算', exact: true }).click();
  const attackInput = gm.getByTestId('attack-roll-input');
  await expect(attackInput).toHaveCSS('border', /2px/);
  await gm.screenshot({ path: 'docs/agy/reports/img/phase6e-missing-input-1440.png', fullPage: true });
  await attackInput.fill('8');
  await gm.getByRole('button', { name: '判定と反映内容を計算', exact: true }).click();
  await expect(attackInput).toHaveCSS('border', /1px/);
  await expect(gm.getByTestId('defense-roll-input')).toHaveCount(0);
  await expect(gm.getByTestId('damage-dice-input')).toHaveCount(0);
  await attackInput.fill('10');
  await expect(gm.getByTestId('attack-extra-input')).toBeVisible();

  await gm.getByTestId('action-btn-death_save').click();
  await expect(gm.getByTestId('death-save-input')).toBeVisible();
  await expect(gm.getByTestId('attack-roll-input')).toHaveCount(0);
  await expect(gm.getByTestId('attack-extra-input')).toHaveCount(0);
  await gm.getByTestId('action-btn-brawl').click();
  await expect(gm.getByTestId('gm-damage-guide')).toContainText('d6');
  await gm.getByTestId('action-btn-ranged').click();
  await expect(gm.getByTestId('attack-roll-input')).toBeVisible();
  await expect(gm.getByTestId('gm-damage-guide')).toContainText('2d6');
  await expect(gm.getByTestId('defense-roll-input')).toHaveCount(0);
  await gm.getByTestId('action-btn-hazard').click();
  await gm.getByLabel('環境ダメージの種類').selectOption('electric');
  await expect(gm.getByTestId('damage-dice-input')).toBeVisible();
  await expect(gm.getByTestId('attack-roll-input')).toHaveCount(0);
  await gm.getByTestId('action-btn-vehicle').click();
  await expect(gm.getByTestId('action-btn-vehicle_board')).toBeEnabled();
  await expect(gm.getByTestId('action-btn-vehicle_start')).toBeDisabled();
  await expect(gm.getByTestId('action-btn-vehicle_start').getByTestId('action-disabled-reason')).toContainText('ヴィークルに乗っていません');
  await gm.screenshot({ path: 'docs/agy/reports/img/phase6e-vehicle-1440.png', fullPage: true });
  await gm.getByRole('button', { name: '← 戻る', exact: true }).click();

  const health = await (await gm.request.get('/api/health')).json();
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await phoneContext.newPage();
  await joinAsPlayer(phone, health.session, '行動確認PC', 'action-guard');
  await phone.getByTestId('player-tab-act').click();
  const mobileMartial = phone.getByTestId('martial-arts-button');
  await expect(mobileMartial).toBeDisabled();
  await expect(mobileMartial.getByTestId('action-disabled-reason')).toContainText('〈武術〉を 1 レベル以上');
  await phone.screenshot({ path: 'docs/agy/reports/img/phase6e-phone-actions-390.png', fullPage: true });

  await phone.getByTestId('player-action-first-aid').click();
  await expect(phone.getByText(/応急手当の判定/)).toBeVisible();
  await expect(phone.getByTestId('phone-pad-damage-guide')).toHaveCount(0);
  const padFirst = phone.getByText('数字をタップして出目を決定');
  await expect(padFirst.locator('..')).toHaveCSS('border', /2px/);
  await phone.getByRole('button', { name: '車両', exact: true }).click();
  await expect(phone.getByTestId('player-vehicle-actions')).toBeVisible();
  await phone.getByLabel('乗る車両').selectOption(JSON.stringify({ owner_id: pcId, vehicle_id: 'action-car' }));
  await expect(phone.getByTestId('player-vehicle-vehicle_board')).toBeEnabled();
  await expect(phone.getByTestId('player-vehicle-vehicle_start')).toBeDisabled();
  await phone.screenshot({ path: 'docs/agy/reports/img/phase6e-phone-vehicle-390.png', fullPage: true });
  sqlite.prepare('UPDATE characters SET skills = ? WHERE id = ?').run(JSON.stringify({ handgun: 4, evasion: 2, 'martial_arts:karate': 1 }), pcId);
  await gm.reload();
  await expect(gm.getByTestId('action-btn-martial_arts')).toBeEnabled();
  await phone.reload();
  await phone.getByTestId('player-tab-act').click();
  await expect(phone.getByTestId('martial-arts-button')).toBeEnabled();
  await phoneContext.close();
  await gmContext.close();
  sqlite.close();
});
