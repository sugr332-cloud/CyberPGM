import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/index.js';
import { getOrCreateGmPin } from '../src/config.js';
import { db } from '../src/db/client.js';
import { characters, saves } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { runDemoSeed } from '../src/db/seed-demo.js';
import { SaveFileSchema } from '@cyberpgm/shared';

describe('Saves & Load operations (phase 2 §6 & §9)', () => {
  let gmToken: string;

  beforeAll(async () => {
    runDemoSeed();
    const { pin } = getOrCreateGmPin();
    const gmLogin = await app.request('/api/auth/gm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
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
      expect(parsed.data.version).toBe(1);
      expect(parsed.data.characters.length).toBeGreaterThanOrEqual(4);
    }
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
