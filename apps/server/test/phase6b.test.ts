import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { app } from '../src/index.js';
import { db, sqlite } from '../src/db/client.js';
import { characters, items, weapons, armors } from '../src/db/schema.js';
import { registerDevice } from '../src/auth.js';
import { loadLoreData } from '../src/services/lore.js';
import { loadNpcTemplates } from '../src/routes/npc-templates.js';
import { loreFixture, npcFixture } from '../../../test-fixtures/phase6b.js';

describe('Phase 6b: GM lore and NPC templates', () => {
  let dir: string;
  let originalSourceDir: string | undefined;
  let headers: Record<string, string>;
  beforeAll(() => {
    originalSourceDir = process.env.CORE_SOURCE_DIR;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cyberpgm-6b-'));
    process.env.CORE_SOURCE_DIR = dir;
  });
  afterAll(() => {
    if (originalSourceDir) process.env.CORE_SOURCE_DIR = originalSourceDir;
    else delete process.env.CORE_SOURCE_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    for (const table of ['combat_log', 'combat_participants', 'combats', 'characters', 'devices', 'weapons', 'armors', 'cyberwares', 'items']) sqlite.prepare(`DELETE FROM ${table}`).run();
    fs.writeFileSync(path.join(dir, 'lore.json'), JSON.stringify(loreFixture));
    fs.writeFileSync(path.join(dir, 'npcs.json'), JSON.stringify(npcFixture));
    headers = { Authorization: `Bearer ${registerDevice({ role: 'gm' }).token}` };
    db.insert(items).values([
      { id: '6b-pistol', kind: 'weapon', name_en: 'Test pistol', name_ja: '大型拳銃', origin: 'homebrew', verify_status: 'unverified', created_at: 1, updated_at: 1 },
      { id: '6b-armor', kind: 'armor', name_en: 'Test armor', name_ja: '試験用防具6b', origin: 'homebrew', verify_status: 'unverified', created_at: 1, updated_at: 1 },
      { id: '6b-gear', kind: 'gear', name_en: 'Test gear', name_ja: '試験用装備6b', origin: 'homebrew', verify_status: 'unverified', created_at: 1, updated_at: 1 },
      { id: '6b-program', kind: 'program', name_en: 'Test program', name_ja: '試験用プログラム6b', origin: 'homebrew', verify_status: 'unverified', created_at: 1, updated_at: 1 },
    ]).run();
    db.insert(weapons).values({ item_id: '6b-pistol', damage: '3d6', magazine_max: 8, skill: 'Handgun' }).run();
    db.insert(armors).values({ item_id: '6b-armor', sp_head: 7, sp_body: 7, penalty: 2 }).run();
  });
  const get = async (url: string) => (await app.request(url, { headers })).json();
  const register = () => app.request('/api/npc-templates/test-guard/register', { method: 'POST', headers });

  it('allows players to read lore while keeping NPC and global search endpoints GM-only', async () => {
    const player = { Authorization: `Bearer ${registerDevice({ role: 'player' }).token}` };
    for (const auth of [{}, player]) {
      for (const url of ['/api/lore', '/api/npc-templates', '/api/search?q=NEO', '/api/npc-templates/test-guard/register']) {
        const r = await app.request(url, { method: url.endsWith('register') ? 'POST' : 'GET', headers: auth });
        if (auth === player && url === '/api/lore') {
          expect(r.status).toBe(200);
        } else {
          expect([401, 403]).toContain(r.status);
        }
      }
    }
  });

  it('returns source status, category filters, timeline order and page order', async () => {
    const all = await get('/api/lore');
    expect(all.hasSource).toBe(true);
    expect(all.categories).toEqual(loreFixture.categories);
    expect(all.entries.map((e: { id: string }) => e.id)).toEqual(['test-early', 'test-width', 'test-late', 'test-corp', 'test-world']);
    expect((await get('/api/lore?category=timeline')).entries).toHaveLength(3);
    expect((await get('/api/lore?category=world')).entries.map((e: { id: string }) => e.id)).toEqual(['test-world']);
    fs.unlinkSync(path.join(dir, 'lore.json'));
    expect(loadLoreData()).toEqual({ entries: [] });
    expect(await get('/api/lore')).toMatchObject({ entries: [], hasSource: false });
  });

  it.each([
    ['neo　港', ['test-late']], ['ＮｅＯ 再開発 2045', ['test-late']], ['開発', ['test-late']],
    ['物資', ['test-late']], ['２００２', ['test-width']], ['存在しない語', []],
  ])('finds AND terms, body, tags and years with width/case normalization: %s', async (query, ids) => {
    const result = await get(`/api/lore?q=${encodeURIComponent(query)}`);
    expect(result.entries.map((e: { id: string }) => e.id)).toEqual(ids);
  });

  it('includes lore in global search with category and year', async () => {
    expect((await get('/api/search?q=neo%202045')).hits).toContainEqual({ kind: 'lore', id: 'test-late', title: 'テスト都市の再開発', sub: '年表 · 2045' });
  });

  it('lists NPC templates and handles absent sources and unknown keys', async () => {
    expect(await get('/api/npc-templates')).toEqual(npcFixture);
    expect((await app.request('/api/npc-templates/missing/register', { method: 'POST', headers })).status).toBe(404);
    fs.unlinkSync(path.join(dir, 'npcs.json'));
    expect(loadNpcTemplates()).toEqual({ npcs: [], tiers: {} });
    expect(await get('/api/npc-templates')).toEqual({ npcs: [], tiers: {} });
  });

  it('registers stats, HP, armor, levels, specialized skills, equipment and warnings; numbers duplicate names', async () => {
    const response = await register();
    expect(response.status).toBe(201);
    const { character, warnings } = await response.json();
    expect(character).toMatchObject({ kind: 'npc', name: 'テスト護衛6b', stats: npcFixture.npcs[0].stats, hp: 35, hp_max: 35, sp_head: 7, sp_body: 7, armor_penalty: 2, extra: { npc_template: 'test-guard' } });
    expect(character.skills).toEqual({ handgun: 4, 'language:母語': 2, local_expert_your_home: 3, 'science:化学': 4, perception: 0 });
    expect(character.skillsList.find((s: { key: string }) => s.key === 'handgun').base).toBe(8); // 6 + 4 − 2、防具の二重控除をしない
    expect(character.inventory).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '低品質のヘビー・ピストル', item_id: '6b-pistol', quality: 'poor', ammo: 8 }),
      expect.objectContaining({ name: '未知の試験武器6b', damage: '2d6' }),
      expect.objectContaining({ name: '試験用防具6b', item_id: '6b-armor' }),
      expect.objectContaining({ item_id: '6b-gear', qty: 2 }),
      expect.objectContaining({ item_id: '6b-program' }),
    ]));
    expect(character.notes_gm).toContain('未知の装備6b');
    expect(character.notes_gm).toContain('未知のプログラム6b');
    expect(warnings.join('\n')).toMatch(/知覚.*0 未満/);
    expect(warnings.join('\n')).toContain('未知の技能6b');
    expect(warnings.join('\n')).toContain('未知の試験武器6b');
    expect((await (await register()).json()).character.name).toBe('テスト護衛6b 2');
    expect((await (await register()).json()).character.name).toBe('テスト護衛6b 3');
    const stored = db.select().from(characters).where(eq(characters.id, character.id)).get()!;
    expect(JSON.parse(stored.skills).handgun).toBe(4);
  });

  it.each([['test-net', 'Netrunner'], ['test-nomad', 'Nomad'], ['test-solo', 'Solo']])('stores role ability ranks separately: %s', async (key, role) => {
    const r = await app.request(`/api/npc-templates/${key}/register`, { method: 'POST', headers });
    const { character, warnings } = await r.json();
    expect(character.role).toBe(role);
    expect(character.extra.role_ranks).toEqual({ [role]: 3 });
    expect(character.skills).toEqual({ handgun: 4 });
    expect(warnings).toEqual([]);
  });

  it('links weapons present in items even without a separate weapons row', async () => {
    db.insert(items).values({ id: '6b-cyberweapon', kind: 'cyberware', name_en: 'Test cyberweapon', name_ja: '試験用サイバー武器6b', origin: 'homebrew', verify_status: 'unverified', created_at: 1, updated_at: 1 }).run();
    const template = { ...npcFixture.npcs[0], weapons: [{ name: '試験用サイバー武器6b', damage: '2d6' }] };
    fs.writeFileSync(path.join(dir, 'npcs.json'), JSON.stringify({ tiers: {}, npcs: [template] }));
    const { character, warnings } = await (await register()).json();
    expect(character.inventory).toContainEqual(expect.objectContaining({ item_id: '6b-cyberweapon', name: '試験用サイバー武器6b', damage: '2d6' }));
    expect(warnings.join('\n')).not.toContain('試験用サイバー武器6b');
  });

  it('keeps raw stats/skills despite armor-adjusted source fields and preserves fallback armor penalty', async () => {
    const template = { ...npcFixture.npcs[0], stats_with_armor: { ref: 4 }, skills_with_armor: { ハンドガン: 8 } };
    fs.writeFileSync(path.join(dir, 'npcs.json'), JSON.stringify({ tiers: {}, npcs: [template] }));
    db.delete(armors).run();
    db.delete(items).where(eq(items.id, '6b-armor')).run();
    const { character } = await (await register()).json();
    expect(character.stats.ref).toBe(6);
    expect(character.skills.handgun).toBe(4);
    expect(character.armor_penalty).toBe(2);
  });
});
