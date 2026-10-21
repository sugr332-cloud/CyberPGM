import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/index.js';
import { db } from '../src/db/client.js';
import { characters } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { runDemoSeed } from '../src/db/seed-demo.js';
import { sessionManager } from '../src/session.js';
import { generateUlid } from '@cyberpgm/shared';

// Phase 5d: キャラごとの再開 QR と、シナリオ取り込みの ID 付け替え（docs/agy/phase5d-resume-qr.md §3）
describe('Resume QR and scenario import re-keying (Phase 5d)', () => {
  let gm: string;
  const H = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${gm}` });
  const claim = (code: string, character_id: string) =>
    app.request('/api/auth/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, character_id }) });

  beforeAll(async () => {
    runDemoSeed();
    gm = (await (await app.request('/api/auth/gm-token', { method: 'POST' })).json()).token;
  });

  it('lists one resume URL per PC with the current session code, and a new code after a restart', async () => {
    const res = await (await app.request('/api/session/pc-qr', { headers: { ...H(), Host: '192.168.0.10:8787' } })).json();
    const pcs = db.select().from(characters).where(eq(characters.kind, 'pc')).all();
    expect(res.pcs.length).toBe(pcs.length);
    const code = sessionManager.getSessionCode();
    for (const p of res.pcs) {
      expect(p.url).toBe(`http://192.168.0.10:8787/player?join=${code}&pc=${p.id}`);
      expect(p.qrSvg).toContain('<svg');
    }
    sessionManager.resetSessionCode(); // サーバの起動し直しと同じ
    const again = await (await app.request('/api/session/pc-qr', { headers: H() })).json();
    expect(again.pcs[0].url).toContain(`join=${sessionManager.getSessionCode()}`);
    expect(again.pcs[0].url).not.toContain(`join=${code}&`);
  });

  it('is GM only', async () => {
    expect((await app.request('/api/session/pc-qr')).status).toBe(403);
  });

  it('claims the PC from the QR URL without the character list', async () => {
    const viper = db.select().from(characters).where(eq(characters.name, 'ヴァイパー')).get()!;
    const res = await claim(sessionManager.getSessionCode(), viper.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.character_id).toBe(viper.id);
    const me = await (await app.request('/api/me', { headers: { Authorization: `Bearer ${body.token}` } })).json();
    expect(me.sheet.name).toBe('ヴァイパー');
  });

  it('refuses NPCs and unknown characters (the phone falls back to the list)', async () => {
    const npcId = generateUlid();
    const viper = db.select().from(characters).where(eq(characters.name, 'ヴァイパー')).get()!;
    db.insert(characters).values({ ...viper, id: npcId, kind: 'npc', name: 'テスト NPC' }).run();
    expect((await claim(sessionManager.getSessionCode(), npcId)).status).toBe(400);
    expect((await claim(sessionManager.getSessionCode(), 'no-such-id')).status).toBe(404);
  });

  it('re-keys clue and handout references when a scenario is exported and imported', async () => {
    const created = await (await app.request('/api/scenarios', { method: 'POST', headers: H(), body: JSON.stringify({ title: '取り込みテスト', use_template: false }) })).json();
    const sid = created.scenario.id;
    const scene = await (await app.request(`/api/scenarios/${sid}/scenes`, { method: 'POST', headers: H(), body: JSON.stringify({ title: 'A' }) })).json();
    const sceneId = (scene.scene ?? scene).id;
    const clue = await (await app.request(`/api/scenarios/${sid}/clues`, { method: 'POST', headers: H(), body: JSON.stringify({ scene_id: sceneId, title: '鍵' }) })).json();
    const ho = await (await app.request(`/api/scenarios/${sid}/handouts`, { method: 'POST', headers: H(), body: JSON.stringify({ scene_id: sceneId, title: '地図' }) })).json();
    await app.request(`/api/scenarios/scenes/${sceneId}/choices`, {
      method: 'POST',
      headers: H(),
      body: JSON.stringify({
        label: '探す',
        on_success: [{ kind: 'reveal_clue', clue_id: (clue.clue ?? clue).id }, { kind: 'reveal_handout', handout_id: (ho.handout ?? ho).id }],
      }),
    });
    const exported = await (await app.request(`/api/scenarios/${sid}/export`, { headers: H() })).json();
    for (const imported of [
      await (await app.request('/api/scenarios/import', { method: 'POST', headers: H(), body: JSON.stringify(exported) })).json(),
      await (await app.request(`/api/scenarios/${sid}/duplicate`, { method: 'POST', headers: H() })).json(),
    ]) {
      const choice = imported.choices[0];
      expect(choice.on_success[0].clue_id).toBe(imported.clues[0].id);
      expect(choice.on_success[1].handout_id).toBe(imported.handouts[0].id);
      expect(imported.clues[0].id).not.toBe((clue.clue ?? clue).id);
    }
  });
});
