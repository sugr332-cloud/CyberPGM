import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/index.js';
import { db } from '../src/db/client.js';
import { items, characters } from '../src/db/schema.js';
import { eq, isNotNull } from 'drizzle-orm';
import { runDemoSeed } from '../src/db/seed-demo.js';
import { initPhase5cData, loadItemNotes } from '../src/db/init-phase5c.js';

// Phase 5c: 品目の効果とフレーバー（docs/agy/phase5c-item-info.md §5）
describe('Item effect and flavor notes (Phase 5c)', () => {
  let gm: string;
  let heavyPistolId: string;
  const H = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${gm}` });

  beforeAll(async () => {
    runDemoSeed();
    initPhase5cData(db);
    gm = (await (await app.request('/api/auth/gm-token', { method: 'POST' })).json()).token;
    heavyPistolId = db.select().from(items).where(eq(items.name_en, 'Heavy Pistol')).get()!.id;
  });

  it('seeds every item from the drafts and marks them as drafts', () => {
    const notes = loadItemNotes();
    expect(Object.keys(notes).length).toBe(518);
    const all = db.select().from(items).all();
    const withNotes = all.filter((i) => i.fvtt_id && notes[i.fvtt_id]);
    expect(withNotes.length).toBe(all.filter((i) => i.fvtt_id).length);
    expect(withNotes.every((i) => i.flavor_ja && i.effect_is_draft && i.flavor_is_draft)).toBe(true);
    const hp = db.select().from(items).where(eq(items.id, heavyPistolId)).get()!;
    expect(hp.effect_ja).toBe(notes[hp.fvtt_id!].effect);
  });

  it('keeps a GM edit across a re-seed and clears the draft flag; reset brings the draft back', async () => {
    const res = await app.request(`/api/items/${heavyPistolId}`, {
      method: 'PATCH',
      headers: H(),
      body: JSON.stringify({ effect_ja: 'GM の効果', flavor_ja: 'GM のフレーバー' }),
    });
    expect(res.status).toBe(200);
    initPhase5cData(db); // 起動し直しても上書きしない
    let hp = db.select().from(items).where(eq(items.id, heavyPistolId)).get()!;
    expect(hp.effect_ja).toBe('GM の効果');
    expect(hp.effect_is_draft).toBe(false);
    expect(hp.flavor_is_draft).toBe(false);

    const reset = await app.request(`/api/items/${heavyPistolId}/reset-notes`, { method: 'POST', headers: H() });
    expect(reset.status).toBe(200);
    hp = db.select().from(items).where(eq(items.id, heavyPistolId)).get()!;
    expect(hp.effect_ja).toBe(loadItemNotes()[hp.fvtt_id!].effect);
    expect(hp.effect_is_draft).toBe(true);
  });

  it('sends the notes to the GM only', async () => {
    const gmItem = await (await app.request(`/api/items/${heavyPistolId}`, { headers: H() })).json();
    expect(gmItem.flavor_ja).toBeTruthy();

    const session = await (await app.request('/api/session', { headers: H() })).json();
    const nyx = db.select().from(characters).where(eq(characters.name, 'ニクス')).get()!;
    const claim = await (
      await app.request('/api/auth/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: session.code, character_id: nyx.id }) })
    ).json();
    const ph = { Authorization: `Bearer ${claim.token}` };
    const playerItem = await (await app.request(`/api/items/${heavyPistolId}`, { headers: ph })).json();
    expect(playerItem.name_en).toBe('Heavy Pistol');
    expect(playerItem).not.toHaveProperty('effect_ja');
    expect(playerItem).not.toHaveProperty('flavor_ja');
    const list = await (await app.request('/api/items?q=Heavy%20Pistol', { headers: ph })).json();
    expect(list.items.every((i: Record<string, unknown>) => !('flavor_ja' in i))).toBe(true);
    // 認証なし（スマホのキャラ作成前など）にも出さない
    const anon = await (await app.request(`/api/items/${heavyPistolId}`)).json();
    expect(anon).not.toHaveProperty('effect_ja');
  });

  it('keeps GM edits through save and load', async () => {
    await app.request(`/api/items/${heavyPistolId}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ flavor_ja: '保存前の文' }) });
    const save = await (await app.request('/api/saves', { method: 'POST', headers: H(), body: JSON.stringify({ name: '5c' }) })).json();
    const file = await (await app.request(`/api/saves/${save.save.id}/file`, { headers: H() })).json();
    expect(file.item_notes.some((n: { flavor_ja: string }) => n.flavor_ja === '保存前の文')).toBe(true);

    await app.request(`/api/items/${heavyPistolId}/reset-notes`, { method: 'POST', headers: H() });
    await app.request(`/api/saves/${save.save.id}/load`, { method: 'POST', headers: H() });
    const hp = db.select().from(items).where(eq(items.id, heavyPistolId)).get()!;
    expect(hp.flavor_ja).toBe('保存前の文');
    expect(hp.flavor_is_draft).toBe(false);
  });

  it('only GM-edited notes go into the save file', async () => {
    const save = await (await app.request('/api/saves', { method: 'POST', headers: H(), body: JSON.stringify({ name: '5c-2' }) })).json();
    const file = await (await app.request(`/api/saves/${save.save.id}/file`, { headers: H() })).json();
    const drafted = db.select().from(items).where(isNotNull(items.effect_ja)).all().filter((i) => i.effect_is_draft && i.flavor_is_draft);
    expect(file.item_notes.length).toBeLessThan(drafted.length);
  });
});
