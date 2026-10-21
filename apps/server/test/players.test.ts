import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/index.js';
import { db } from '../src/db/client.js';
import { characters, scenario_sessions } from '../src/db/schema.js';
import { eq, isNull } from 'drizzle-orm';
import { runDemoSeed } from '../src/db/seed-demo.js';
import { sessionManager } from '../src/session.js';

// Phase 5i: プレイヤー（人）・複数キャラ・シナリオの縛り・シナリオごとの開始資金
describe('Players and scenario locks (Phase 5i)', () => {
  let gm: string;
  let viperId: string;
  let nyxId: string;
  const code = () => sessionManager.getSessionCode();
  const H = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${gm}` });
  const J = { 'Content-Type': 'application/json' };
  const post = (path: string, body: unknown, headers: Record<string, string> = J) =>
    app.request(path, { method: 'POST', headers, body: JSON.stringify(body) });
  const join = async (player_id?: string) => (await (await post('/api/auth/join', { code: code(), player_id })).json()).characters;
  const newScenario = async (title: string, starting_funds?: number) => {
    const s = await (await post('/api/scenarios', { title, use_template: false }, H())).json();
    if (starting_funds !== undefined) {
      await app.request(`/api/scenarios/${s.scenario.id}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ meta: { starting_funds } }) });
    }
    return s.scenario.id as string;
  };
  const start = async (scenario_id: string) => (await (await post('/api/scenario-sessions/start', { scenario_id }, H())).json()).sessionId as string;

  beforeAll(async () => {
    runDemoSeed();
    gm = (await (await app.request('/api/auth/gm-token', { method: 'POST' })).json()).token;
    viperId = db.select().from(characters).where(eq(characters.name, 'ヴァイパー')).get()!.id;
    nyxId = db.select().from(characters).where(eq(characters.name, 'ニクス')).get()!.id;
    db.update(scenario_sessions).set({ ended_at: Date.now() }).where(isNull(scenario_sessions.ended_at)).run();
  });

  it('registers a player once per name and needs the session code', async () => {
    const a = await (await post('/api/players', { code: code(), name: 'たろう' })).json();
    const again = await (await post('/api/players', { code: code(), name: 'たろう' })).json();
    expect(again.id).toBe(a.id);
    expect((await post('/api/players', { code: 'WRONG1', name: 'x' })).status).toBe(400);
    const list = await (await app.request(`/api/players?code=${code()}`)).json();
    expect(list.players.map((p: { name: string }) => p.name)).toContain('たろう');
    expect((await app.request('/api/players?code=WRONG1')).status).toBe(400);
  });

  it('gives an unowned PC to the player who claims it, and hides it from others', async () => {
    const taro = (await (await post('/api/players', { code: code(), name: 'たろう' })).json()).id;
    const hana = (await (await post('/api/players', { code: code(), name: 'はなこ' })).json()).id;
    const claim = await (await post('/api/auth/claim', { code: code(), character_id: viperId, player_id: taro })).json();
    expect(claim.player_id).toBe(taro);
    expect(db.select().from(characters).where(eq(characters.id, viperId)).get()!.player_id).toBe(taro);

    const forHana = await join(hana);
    expect(forHana.some((c: { id: string }) => c.id === viperId)).toBe(false);
    expect(forHana.some((c: { id: string }) => c.id === nyxId)).toBe(true); // 持ち主なしは見える
    const forTaro = await join(taro);
    expect(forTaro.find((c: { id: string }) => c.id === viperId).player_id).toBe(taro);
  });

  it('locks a PC to an unfinished scenario and releases it on clear', async () => {
    const a = await newScenario('シナリオA');
    const b = await newScenario('シナリオB');
    const sessionA = await start(a);
    // 進行中に選んだキャラは、そのシナリオに入る
    await post('/api/auth/claim', { code: code(), character_id: nyxId });
    expect(db.select().from(characters).where(eq(characters.id, nyxId)).get()!.scenario_id).toBe(a);

    // 中断して B を始めると、ニクスは選べない
    await post(`/api/scenario-sessions/${sessionA}/end`, {}, H());
    const sessionB = await start(b);
    const nyx = (await join()).find((c: { id: string }) => c.id === nyxId);
    expect(nyx.locked).toBe(true);
    expect(nyx.lock_reason).toBe('「シナリオA」が未クリアのため、「シナリオA」以外では選べません');
    const denied = await post('/api/auth/claim', { code: code(), character_id: nyxId });
    expect(denied.status).toBe(409);

    // A に戻ればまた選べる。クリアで縛りが外れる
    await post(`/api/scenario-sessions/${sessionB}/end`, {}, H());
    const sessionA2 = await start(a);
    expect((await join()).find((c: { id: string }) => c.id === nyxId).locked).toBe(false);
    const cleared = await (await post(`/api/scenario-sessions/${sessionA2}/clear`, {}, H())).json();
    expect(cleared.released.map((r: { id: string }) => r.id)).toContain(nyxId);
    expect(db.select().from(characters).where(eq(characters.id, nyxId)).get()!.scenario_id).toBeNull();
    expect(db.select().from(scenario_sessions).where(eq(scenario_sessions.id, sessionA2)).get()!.ended_at).not.toBeNull();
  });

  it('lets the GM release a PC from its scenario by hand', async () => {
    const c = await newScenario('シナリオC');
    db.update(characters).set({ scenario_id: c }).where(eq(characters.id, viperId)).run();
    const res = await app.request(`/api/characters/${viperId}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ scenario_id: null }) });
    expect(res.status).toBe(200);
    expect(db.select().from(characters).where(eq(characters.id, viperId)).get()!.scenario_id).toBeNull();
  });

  it("uses the running scenario's starting funds and gives the new PC to its creator", async () => {
    const d = await newScenario('シナリオD', 3000);
    const sessionD = await start(d);
    const methods = await (await app.request('/api/creation-methods')).json();
    expect(methods.starting_funds).toBe(3000);
    expect(methods.scenario_title).toBe('シナリオD');

    const jiro = (await (await post('/api/players', { code: code(), name: 'じろう' })).json()).id;
    const draft = {
      name: 'テスト太郎',
      role: 'Solo',
      stats: { int: 6, ref: 7, dex: 7, tech: 5, cool: 6, will: 6, luck: 6, move: 6, body: 6, emp: 6 },
      skills: {},
      inventory: [],
      cyberware: [],
    };
    const sub = await (await post('/api/character-submissions', { character: draft, source: 'wifi', player_id: jiro })).json();
    const acc = await (await post(`/api/character-submissions/${sub.id}/accept`, {}, H())).json();
    const pc = db.select().from(characters).where(eq(characters.id, acc.character_id)).get()!;
    expect(pc.player_id).toBe(jiro);
    expect(pc.scenario_id).toBe(d);
    expect(pc.eb).toBe(3000);
    await post(`/api/scenario-sessions/${sessionD}/end`, {}, H());
  });

  it('keeps players, owners and locks through save and load', async () => {
    const e = await newScenario('シナリオE');
    db.update(characters).set({ scenario_id: e }).where(eq(characters.id, nyxId)).run();
    const owner = db.select().from(characters).where(eq(characters.id, viperId)).get()!.player_id;
    const save = await (await app.request('/api/saves', { method: 'POST', headers: H(), body: JSON.stringify({ name: '5i' }) })).json();

    db.update(characters).set({ scenario_id: null, player_id: null }).run();
    const load = await app.request(`/api/saves/${(save.save ?? save).id}/load`, { method: 'POST', headers: H() });
    expect(load.status).toBe(200);
    expect(db.select().from(characters).where(eq(characters.id, nyxId)).get()!.scenario_id).toBe(e);
    expect(db.select().from(characters).where(eq(characters.id, viperId)).get()!.player_id).toBe(owner);
    const list = await (await app.request('/api/players', { headers: H() })).json();
    expect(list.players.length).toBeGreaterThanOrEqual(3);
  });
});
