import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/index.js';
import { db } from '../src/db/client.js';
import { characters, images, combat_participants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { runDemoSeed } from '../src/db/seed-demo.js';
import { generateUlid } from '@cyberpgm/shared';
import { evaluateStoryCheck } from '../src/routes/scenario-play.js';

// Phase 5b: シナリオの進行モード（docs/agy/phase5b-scenario-play.md §8）
describe('Scenario play (Phase 5b)', () => {
  let gm: string;
  let viperId: string;
  let nyxId: string;
  let scenarioId: string;
  let sessionId: string;
  const sceneIds: string[] = [];
  let choiceId: string;
  let clueId: string;
  let gmImageId: string;

  const H = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${gm}` });
  const post = (path: string, body: unknown, headers = H()) =>
    app.request(path, { method: 'POST', headers, body: JSON.stringify(body) });

  beforeAll(async () => {
    runDemoSeed();
    gm = (await (await app.request('/api/auth/gm-token', { method: 'POST' })).json()).token;
    viperId = db.select().from(characters).where(eq(characters.name, 'ヴァイパー')).get()!.id;
    nyxId = db.select().from(characters).where(eq(characters.name, 'ニクス')).get()!.id;
    db.update(characters).set({ hp: 35, status: '[]' }).where(eq(characters.id, viperId)).run();

    // GM のみの画像（本のスキャン）
    gmImageId = generateUlid();
    db.insert(images).values({ id: gmImageId, path: 'book_scan/test.png', origin: 'book_scan', visibility: 'gm' }).run();

    // 2 シーン・手がかり・選択肢（成功で手がかり公開 + 次のシーン、失敗で HP −3 と状態）
    const created = await (await post('/api/scenarios', { title: '進行テスト', use_template: false })).json();
    scenarioId = created.scenario.id;
    for (const title of ['裏口', '倉庫']) {
      const sc = await (await post(`/api/scenarios/${scenarioId}/scenes`, { title })).json();
      sceneIds.push((sc.scene ?? sc).id);
    }
    await post(`/api/scenarios/${scenarioId}/links`, { from_scene_id: sceneIds[0], to_scene_id: sceneIds[1], condition: '' });
    const cl = await (await post(`/api/scenarios/${scenarioId}/clues`, { scene_id: sceneIds[0], title: '裏口の鍵', body: '鍵は壊れている' })).json();
    clueId = (cl.clue ?? cl).id;
    const ch = await (
      await post(`/api/scenarios/scenes/${sceneIds[0]}/choices`, {
        label: '裏口を探す',
        skill_key: 'perception',
        dv: 13,
        on_success: [{ kind: 'reveal_clue', clue_id: clueId }, { kind: 'next_scene', scene_id: sceneIds[1] }],
        on_failure: [{ kind: 'hp_change', amount: -3 }, { kind: 'add_status', status: '見つかった' }],
      })
    ).json();
    choiceId = (ch.choice ?? ch).id;
  });

  it('starts a session, moves scenes, adds an ad-hoc scene, and logs each step', async () => {
    const res = await post('/api/scenario-sessions/start', { scenario_id: scenarioId, initial_scene_id: sceneIds[0] });
    expect(res.status).toBe(201);
    sessionId = (await res.json()).sessionId;

    expect((await post(`/api/scenario-sessions/${sessionId}/move-scene`, { scene_id: sceneIds[1] })).status).toBe(200);
    expect((await post(`/api/scenario-sessions/${sessionId}/move-scene`, { scene_id: sceneIds[0] })).status).toBe(200);
    const adhoc = await post(`/api/scenario-sessions/${sessionId}/adhoc-scene`, { title: '予定外の追跡' });
    expect(adhoc.status).toBe(201);
    await post(`/api/scenario-sessions/${sessionId}/move-scene`, { scene_id: sceneIds[0] });

    const logs = await (await app.request(`/api/scenario-sessions/${sessionId}/logs`, { headers: H() })).json();
    const kinds = (logs.logs ?? logs).map((l: { kind: string }) => l.kind);
    expect(kinds.filter((k: string) => k === 'scene').length).toBeGreaterThanOrEqual(2);
  });

  it('evaluates a check from real stats: Viper INT 4 + perception 5 = 9 vs DV 13 needs 5+', () => {
    const check = { actor_character_id: viperId, skill_key: 'perception', dv: 13, opposed: null };
    const pending = evaluateStoryCheck(check, []);
    expect(pending.result).toBeNull();
    expect(pending.formula).toContain('INT 4');
    expect(pending.formula).toContain('= 9');
    expect(pending.needed).toBe('5 以上で成功');
    expect(evaluateStoryCheck(check, [5]).result).toBe('success'); // 9 + 5 = 14 > 13
    expect(evaluateStoryCheck(check, [4]).result).toBe('failure'); // 9 + 4 = 13 (同値は失敗)
  });

  it('asks for the extra roll on 10 and 1 instead of guessing', () => {
    const check = { actor_character_id: viperId, skill_key: 'perception', dv: 13, opposed: null };
    expect(evaluateStoryCheck(check, [10]).missing_inputs[0]).toContain('追加の出目');
    expect(evaluateStoryCheck(check, [10, 3]).total).toBe(9 + 13);
    expect(evaluateStoryCheck(check, [1, 4]).total).toBe(9 + 1 - 4);
  });

  it('does not invent a difficulty or a skill', () => {
    expect(evaluateStoryCheck({ actor_character_id: viperId, skill_key: 'perception', dv: null }, [5]).missing_inputs).toContain('難易度を決めてください');
    expect(evaluateStoryCheck({ actor_character_id: viperId, skill_key: null, dv: 13 }, [5]).missing_inputs).toContain('技能を選んでください');
  });

  it('includes the seriously wounded penalty in the formula', () => {
    db.update(characters).set({ hp: 10 }).where(eq(characters.id, viperId)).run();
    const ev = evaluateStoryCheck({ actor_character_id: viperId, skill_key: 'perception', dv: 13 }, [6]);
    expect(ev.formula).toContain('-2（重傷）');
    expect(ev.total).toBe(7 + 6);
    db.update(characters).set({ hp: 35 }).where(eq(characters.id, viperId)).run();
  });

  it('resolves opposed checks with ties going to the passive side', () => {
    // ヴァイパー 隠密 DEX 7 + 4 = 11、ニクスの知覚を相手にする
    const nyx = db.select().from(characters).where(eq(characters.id, nyxId)).get()!;
    const nyxPerception = JSON.parse(nyx.stats).int + (JSON.parse(nyx.skills).perception ?? 0);
    const opposed = (myRoll: number, theirRoll: number) =>
      evaluateStoryCheck(
        { actor_character_id: viperId, skill_key: 'stealth', dv: null, opposed: { target_character_id: nyxId, skill_key: 'perception', rolls: [theirRoll] } },
        [myRoll],
      );
    const tieRoll = nyxPerception + 5 - 11; // 合計を同じにする出目
    if (tieRoll >= 2 && tieRoll <= 9) expect(opposed(tieRoll, 5).result).toBe('failure');
    expect(opposed(9, 2).result).toBe(11 + 9 > nyxPerception + 2 ? 'success' : 'failure');
    expect(evaluateStoryCheck({ actor_character_id: viperId, skill_key: 'stealth', opposed: { target_character_id: nyxId, skill_key: 'perception' } }, [5]).missing_inputs[0]).toContain('相手の出目');
  });

  it('applies success outcomes (clue + next scene) and undo restores them', async () => {
    const c = await (await post(`/api/scenario-sessions/${sessionId}/checks`, { actor_character_ids: [viperId], choice_id: choiceId })).json();
    const checkId = c.checks[0].id;
    expect(c.checks[0].skill_key).toBe('perception'); // 選択肢から引き継ぐ
    expect(c.checks[0].dv).toBe(13);
    const rolled = await (await post(`/api/scenario-sessions/${sessionId}/checks/${checkId}/roll`, { rolls: [8] })).json();
    expect(rolled.result).toBe('success');

    const applied = await post(`/api/scenario-sessions/${sessionId}/checks/${checkId}/apply`, {});
    expect(applied.status).toBe(200);
    let active = await (await app.request('/api/scenario-sessions/active', { headers: H() })).json();
    expect(active.session.current_scene_id).toBe(sceneIds[1]);
    expect(active.session.revealed.clue_ids).toContain(clueId);

    // 二重の反映はできない
    expect((await post(`/api/scenario-sessions/${sessionId}/checks/${checkId}/apply`, {})).status).toBe(409);

    expect((await post(`/api/scenario-sessions/${sessionId}/checks/${checkId}/undo`, {})).status).toBe(200);
    active = await (await app.request('/api/scenario-sessions/active', { headers: H() })).json();
    expect(active.session.current_scene_id).toBe(sceneIds[0]);
    expect(active.session.revealed.clue_ids).not.toContain(clueId);
  });

  it('applies failure outcomes (HP −3 and a status) and undo restores them', async () => {
    const c = await (await post(`/api/scenario-sessions/${sessionId}/checks`, { actor_character_ids: [viperId], choice_id: choiceId })).json();
    const checkId = c.checks[0].id;
    await post(`/api/scenario-sessions/${sessionId}/checks/${checkId}/roll`, { rolls: [2] });
    await post(`/api/scenario-sessions/${sessionId}/checks/${checkId}/apply`, {});
    let v = db.select().from(characters).where(eq(characters.id, viperId)).get()!;
    expect(v.hp).toBe(32);
    expect(JSON.parse(v.status)).toContain('見つかった');
    await post(`/api/scenario-sessions/${sessionId}/checks/${checkId}/undo`, {});
    v = db.select().from(characters).where(eq(characters.id, viperId)).get()!;
    expect(v.hp).toBe(35);
    expect(JSON.parse(v.status)).not.toContain('見つかった');
  });

  it('creates one row per member for a group check', async () => {
    const c = await (await post(`/api/scenario-sessions/${sessionId}/checks`, { actor_character_ids: [viperId, nyxId], skill_key: 'athletics', dv: 15 })).json();
    expect(c.checks.length).toBe(2);
    expect(c.checks.every((x: { dv: number }) => x.dv === 15)).toBe(true);
  });

  it('refuses to reveal a handout whose image is GM-only, and to project a GM-only image', async () => {
    const h = await (await post(`/api/scenarios/${scenarioId}/handouts`, { title: '本の地図', body: '', image_id: gmImageId })).json();
    const res = await post(`/api/scenario-sessions/${sessionId}/reveal`, { kind: 'handout', itemId: (h.handout ?? h).id });
    expect(res.status).toBe(400);
    const proj = await post(`/api/scenario-sessions/${sessionId}/project-image`, { image_id: gmImageId, target: 'all' });
    expect(proj.status).toBe(400);
    // パスを直接渡しても出ない
    const byPath = await (await post(`/api/scenario-sessions/${sessionId}/project-image`, { image_path: 'book_scan/test.png', target: 'all' })).json();
    expect(byPath.image_path).toBeNull();
  });

  it('lets a player read revealed items but not GM-only routes', async () => {
    const session = await (await app.request('/api/session', { headers: H() })).json();
    const claim = await (await post('/api/auth/claim', { code: session.code, character_id: nyxId }, { 'Content-Type': 'application/json' } as never)).json();
    expect(claim.token, JSON.stringify(claim)).toBeTruthy();
    const ph = { Authorization: `Bearer ${claim.token}` };
    expect((await app.request('/api/scenario-sessions/current/revealed', { headers: ph })).status).toBe(200);
    expect((await app.request(`/api/scenario-sessions/${sessionId}/checks`, { headers: ph })).status).toBe(403);
  });

  it('starts combat from an encounter with independent copies of mooks', async () => {
    const mookId = generateUlid();
    const base = db.select().from(characters).where(eq(characters.id, nyxId)).get()!;
    db.insert(characters).values({ ...base, id: mookId, kind: 'mook', name: 'ガンガー' }).run();
    const enc = await (
      await post(`/api/scenarios/${scenarioId}/encounters`, { title: '倉庫の戦闘', scene_id: sceneIds[1], participants: [{ character_id: mookId, side: 'enemy', count: 3 }] })
    ).json();
    const res = await (await post(`/api/scenarios/encounters/${(enc.encounter ?? enc).id}/start-combat`, {})).json();
    const parts = db.select().from(combat_participants).where(eq(combat_participants.combat_id, res.combat_id)).all();
    const mooks = parts.filter((p) => p.name.startsWith('ガンガー'));
    expect(mooks.map((m) => m.name).sort()).toEqual(['ガンガー #1', 'ガンガー #2', 'ガンガー #3']);
    expect(new Set(mooks.map((m) => m.character_id)).size).toBe(3); // HP を別々に持つ
    expect(mooks.every((m) => m.character_id !== mookId)).toBe(true);
  });
});
