import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/index.js';
import { db } from '../src/db/client.js';
import { characters, saves } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { runDemoSeed } from '../src/db/seed-demo.js';
import { SaveFileSchema } from '@cyberpgm/shared';

describe('Saves & Load operations (phase 2 §6 & §9)', () => {
  let gmToken: string;

  beforeAll(async () => {
    runDemoSeed();
    const gmLogin = await app.request('/api/auth/gm-token', {
      method: 'POST',
    });
    const data = await gmLogin.json();
    gmToken = data.token;
  });

  it('saves state -> modifies PC -> restores state via load, with auto-save created beforehand', async () => {
    // 1. Create a named save "Pre-Raid"
    const createRes = await app.request('/api/saves', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify({ name: '突入前' }),
    });
    expect(createRes.status).toBe(201);
    const { save } = await createRes.json();
    expect(save.name).toBe('突入前');

    // 2. Modify Viper: change HP and EB
    const viper = db.select().from(characters).where(eq(characters.name, 'ヴァイパー')).get()!;
    const originalEb = viper.eb;
    const originalHp = viper.hp;

    await app.request(`/api/characters/${viper.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify({ hp: 12, eb: 99999 }),
    });

    const modifiedViper = db.select().from(characters).where(eq(characters.id, viper.id)).get()!;
    expect(modifiedViper.hp).toBe(12);
    expect(modifiedViper.eb).toBe(99999);

    // 3. Load the "Pre-Raid" save
    const loadRes = await app.request(`/api/saves/${save.id}/load`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gmToken}` },
    });
    expect(loadRes.status).toBe(200);

    // 4. Verify Viper is restored to original state
    const restoredViper = db.select().from(characters).where(eq(characters.id, viper.id)).get()!;
    expect(restoredViper.hp).toBe(originalHp);
    expect(restoredViper.eb).toBe(originalEb);

    // 5. Verify pre-load auto-save was generated
    const autoSaves = db.select().from(saves).where(eq(saves.kind, 'auto')).all();
    expect(autoSaves.length).toBeGreaterThanOrEqual(1);
    const latestAuto = autoSaves[0];
    expect(latestAuto.name).toBe('自動保存');
  });

  it('validates downloaded save file format using SaveFileSchema', async () => {
    // Create a save
    const createRes = await app.request('/api/saves', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify({ name: 'エクスポート検証用' }),
    });
    const { save } = await createRes.json();

    // Download save file
    const fileRes = await app.request(`/api/saves/${save.id}/file`, {
      headers: { Authorization: `Bearer ${gmToken}` },
    });
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get('Content-Type')).toContain('application/json');

    const fileContent = await fileRes.json();
    const parsed = SaveFileSchema.safeParse(fileContent);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.format).toBe('cpgm-save');
      expect(parsed.data.version).toBeGreaterThanOrEqual(4);
      expect(parsed.data.characters.length).toBeGreaterThanOrEqual(4);
      expect(Array.isArray(parsed.data.combats)).toBe(true);
      expect(Array.isArray(parsed.data.combat_participants)).toBe(true);
      expect(Array.isArray(parsed.data.combat_log)).toBe(true);
      expect(Array.isArray(parsed.data.boards)).toBe(true);
      expect(Array.isArray(parsed.data.board_objects)).toBe(true);
      expect(Array.isArray(parsed.data.board_tokens)).toBe(true);
      expect(Array.isArray(parsed.data.board_drops)).toBe(true);
    }
  });

  it('supports version 4 save and load with board tables, and backwards compatibility for versions 1~3 (Phase 4b §1, §9)', async () => {
    // 1. Create a board and objects
    const boardRes = await app.request('/api/boards', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify({
        name: '倉庫街 (v4 テスト)',
        grid: { cols: 20, rows: 15, cell_m: 2 },
      }),
    });
    expect(boardRes.status).toBe(201);
    const { board } = await boardRes.json();

    const objRes = await app.request(`/api/boards/${board.id}/objects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify({
        kind: 'crate',
        label: '木箱A',
        x: 3,
        y: 4,
        w: 1,
        h: 1,
        blocks_los: 'partial',
        cover_hp: 15,
        cover_hp_max: 15,
      }),
    });
    expect(objRes.status).toBe(201);

    // Create v4 save
    const saveRes = await app.request('/api/saves', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify({ name: 'Version 4 Board Save' }),
    });
    expect(saveRes.status).toBe(201);
    const { save: v4Save } = await saveRes.json();

    // Verify file content has v4 and boards data
    const fileRes = await app.request(`/api/saves/${v4Save.id}/file`, {
      headers: { Authorization: `Bearer ${gmToken}` },
    });
    const fileData = await fileRes.json();
    expect(fileData.version).toBeGreaterThanOrEqual(4);
    expect(fileData.boards.some((b: any) => b.id === board.id)).toBe(true);
    expect(fileData.board_objects.some((o: any) => o.label === '木箱A')).toBe(true);

    // Load v4 save back
    const loadRes = await app.request(`/api/saves/${v4Save.id}/load`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gmToken}` },
    });
    expect(loadRes.status).toBe(200);

    // Verify restored board
    const getBoardRes = await app.request(`/api/boards/${board.id}`);
    expect(getBoardRes.status).toBe(200);
    const getBoardData = await getBoardRes.json();
    expect(getBoardData.board.objects).toHaveLength(1);
    expect(getBoardData.board.objects[0].label).toBe('木箱A');

    // 2. Backwards compatibility: load a mock version 3 save (without boards tables)
    const v3SaveContent = {
      format: 'cpgm-save',
      version: 3,
      savedAt: Date.now(),
      name: 'Legacy v3 Save',
      characters: fileData.characters,
      money_log: [],
      char_log: [],
      app_settings: {},
      shops: [],
      shop_stock: [],
      transactions: [],
      character_submissions: [],
      skill_notes: [],
      combats: [],
      combat_participants: [],
      combat_log: [],
      // boards fields omitted
    };

    const importV3Res = await app.request('/api/saves/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify(v3SaveContent),
    });
    expect(importV3Res.status).toBe(201);
    const { save: importedV3 } = await importV3Res.json();

    const loadV3Res = await app.request(`/api/saves/${importedV3.id}/load`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gmToken}` },
    });
    expect(loadV3Res.status).toBe(200);
  });

  it('saves and loads version 6 with scenario sessions, logs and story checks (Phase 5b §7)', async () => {
    const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` };
    const created = await (
      await app.request('/api/scenarios', { method: 'POST', headers: H, body: JSON.stringify({ title: '保存テスト', use_template: true }) })
    ).json();
    const start = await (
      await app.request('/api/scenario-sessions/start', { method: 'POST', headers: H, body: JSON.stringify({ scenario_id: created.scenario.id }) })
    ).json();
    await app.request(`/api/scenario-sessions/${start.sessionId}/logs/note`, { method: 'POST', headers: H, body: JSON.stringify({ text: '保存前のメモ' }) });

    const save = await (await app.request('/api/saves', { method: 'POST', headers: H, body: JSON.stringify({ name: 'v6' }) })).json();
    const file = await (await app.request(`/api/saves/${(save.save ?? save).id}/file`, { headers: H })).json();
    expect(file.version).toBe(6);
    expect(file.scenario_sessions.length).toBeGreaterThan(0);
    expect(file.session_log.some((l: { text: string }) => l.text === '保存前のメモ')).toBe(true);

    await app.request(`/api/scenario-sessions/${start.sessionId}/logs/note`, { method: 'POST', headers: H, body: JSON.stringify({ text: '保存後のメモ' }) });
    const load = await app.request(`/api/saves/${(save.save ?? save).id}/load`, { method: 'POST', headers: H });
    expect(load.status).toBe(200);
    const logs = await (await app.request(`/api/scenario-sessions/${start.sessionId}/logs`, { headers: H })).json();
    const texts = (logs.logs ?? logs).map((l: { text: string }) => l.text);
    expect(texts).toContain('保存前のメモ');
    expect(texts).not.toContain('保存後のメモ');
  });

  it('rejects corrupted or schema-invalid files during import', async () => {
    // 1. Invalid JSON
    const badJsonRes = await app.request('/api/saves/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: 'this is not valid json',
    });
    expect(badJsonRes.status).toBe(400);

    // 2. Schema invalid JSON
    const invalidSchemaRes = await app.request('/api/saves/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify({ format: 'wrong-format', foo: 'bar' }),
    });
    expect(invalidSchemaRes.status).toBe(400);
  });
});
