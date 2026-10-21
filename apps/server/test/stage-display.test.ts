import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/index.js';
import { db } from '../src/db/client.js';
import { characters, images, scenes, combat_participants, combats } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { runDemoSeed } from '../src/db/seed-demo.js';
import { sessionManager } from '../src/session.js';
import { generateUlid } from '@cyberpgm/shared';
import { matchesAudioSignature } from '../src/routes/audio.js';

// Phase 5e: 表示ウィンドウの背景・立ち絵・BGM と、戦闘の途中参加（docs/agy/phase5e-stage-display.md §4）
describe('Stage display, BGM and joining a combat (Phase 5e)', () => {
  let gm: string;
  let viperId: string;
  let nyxId: string;
  let bgId: string;
  let gmOnlyPortraitId: string;
  let portraitId: string;
  let audioA: string;
  let audioB: string;
  let scenarioId: string;
  const sceneIds: string[] = [];
  const H = () => ({ Authorization: `Bearer ${gm}` });
  const J = () => ({ 'Content-Type': 'application/json', ...H() });
  const req = (method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: J(), body: body === undefined ? undefined : JSON.stringify(body) });
  const mp3 = () => new File([Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)])], 'theme.mp3', { type: 'audio/mpeg' });
  const upload = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return app.request('/api/audio', { method: 'POST', headers: H(), body: fd });
  };

  beforeAll(async () => {
    runDemoSeed();
    gm = (await (await app.request('/api/auth/gm-token', { method: 'POST' })).json()).token;
    viperId = db.select().from(characters).where(eq(characters.name, 'ヴァイパー')).get()!.id;
    nyxId = db.select().from(characters).where(eq(characters.name, 'ニクス')).get()!.id;
    bgId = generateUlid();
    portraitId = generateUlid();
    gmOnlyPortraitId = generateUlid();
    db.insert(images).values({ id: bgId, path: 'user/bg.png', origin: 'user', visibility: 'players' }).run();
    db.insert(images).values({ id: portraitId, path: 'user/viper.png', origin: 'user', visibility: 'players' }).run();
    db.insert(images).values({ id: gmOnlyPortraitId, path: 'book_scan/nyx.png', origin: 'book_scan', visibility: 'gm' }).run();
    db.update(characters).set({ portrait_image_id: portraitId }).where(eq(characters.id, viperId)).run();
    db.update(characters).set({ portrait_image_id: gmOnlyPortraitId }).where(eq(characters.id, nyxId)).run();
  });

  it('accepts mp3 / ogg / m4a / wav only when the content matches the extension', async () => {
    expect(matchesAudioSignature('.mp3', Buffer.from('ID3....'))).toBe(true);
    expect(matchesAudioSignature('.ogg', Buffer.from('OggS....'))).toBe(true);
    expect(matchesAudioSignature('.wav', Buffer.from('RIFF\0\0\0\0WAVE'))).toBe(true);
    expect(matchesAudioSignature('.m4a', Buffer.from('\0\0\0\x20ftypM4A '))).toBe(true);
    expect(matchesAudioSignature('.mp3', Buffer.from('<html>'))).toBe(false);

    const ok = await upload(mp3());
    expect(ok.status).toBe(201);
    audioA = (await ok.json()).audio.id;
    audioB = (await (await upload(mp3())).json()).audio.id;
    expect((await upload(new File(['<svg></svg>'], 'x.mp3'))).status).toBe(400); // 中身が違う
    expect((await upload(new File(['ID3'], 'x.flac'))).status).toBe(400); // 拡張子が違う
    const file = await app.request(`/api/audio/${audioA}/file`);
    expect(file.headers.get('Content-Type')).toBe('audio/mpeg');
    expect((await app.request('/api/audio')).status).toBe(403); // 一覧と登録は GM だけ
  });

  it('clicking a scene shows its background, saved portraits and BGM on the display window', async () => {
    scenarioId = (await (await req('POST', '/api/scenarios', { title: '舞台テスト', use_template: false })).json()).scenario.id;
    for (const title of ['バー', '路地']) {
      const sc = await (await req('POST', `/api/scenarios/${scenarioId}/scenes`, { title })).json();
      sceneIds.push((sc.scene ?? sc).id);
    }
    await req('PATCH', `/api/scenarios/scenes/${sceneIds[0]}`, {
      background_image_id: bgId,
      bgm: { audio_id: audioA, loop: true, volume: 60 },
      stage: { portraits: [{ character_id: viperId, x: 0.2, y: 1, scale: 1, flip: false, z: 0, show_name: true }] },
    });
    const start = await (await req('POST', '/api/scenario-sessions/start', { scenario_id: scenarioId, initial_scene_id: sceneIds[0] })).json();
    const payload = sessionManager.buildScreenPayload() as any;
    expect(payload.mode).toBe('story');
    expect(payload.background_image_id).toBe(bgId);
    expect(payload.portraits).toEqual([expect.objectContaining({ character_id: viperId, name: 'ヴァイパー', image_id: portraitId, x: 0.2 })]);
    expect(payload.bgm).toEqual({ audio_id: audioA, loop: true, volume: 60, playing: true });
    expect(start.sessionId).toBeTruthy();
  });

  it('saves portrait moves to the scene and restores them when coming back', async () => {
    const res = await req('PUT', '/api/display/stage', {
      portraits: [
        { character_id: viperId, x: 0.7, y: 0.9, scale: 1.3, flip: true, z: 2, show_name: false },
        { character_id: nyxId, x: 0.3, y: 1, scale: 1, flip: false, z: 1, show_name: true },
      ],
    });
    expect(res.status).toBe(200);
    const session = await (await app.request('/api/scenario-sessions/active', { headers: H() })).json();
    await req('POST', `/api/scenario-sessions/${session.session.id}/move-scene`, { scene_id: sceneIds[1] });
    expect((sessionManager.buildScreenPayload() as any).portraits).toEqual([]);
    await req('POST', `/api/scenario-sessions/${session.session.id}/move-scene`, { scene_id: sceneIds[0] });
    const back = sessionManager.buildScreenPayload() as any;
    expect(back.portraits[0]).toEqual(expect.objectContaining({ character_id: viperId, x: 0.7, scale: 1.3, flip: true, show_name: false }));
    const stored = JSON.parse(db.select().from(scenes).where(eq(scenes.id, sceneIds[0])).get()!.stage);
    expect(stored.portraits.length).toBe(2);
  });

  it('does not send GM-only portraits until the GM lets players see the image', async () => {
    let payload = sessionManager.buildScreenPayload() as any;
    expect(payload.portraits.map((p: { character_id: string }) => p.character_id)).toEqual([viperId]);
    await req('PATCH', `/api/images/${gmOnlyPortraitId}`, { visibility: 'players' });
    payload = sessionManager.buildScreenPayload() as any;
    expect(payload.portraits.map((p: { character_id: string }) => p.character_id).sort()).toEqual([nyxId, viperId].sort());
  });

  it('stops the BGM on a scene without one, unless the GM keeps it playing', async () => {
    const session = await (await app.request('/api/scenario-sessions/active', { headers: H() })).json();
    await req('POST', `/api/scenario-sessions/${session.session.id}/move-scene`, { scene_id: sceneIds[1] });
    expect((sessionManager.buildScreenPayload() as any).bgm).toBeNull();

    await req('POST', `/api/scenario-sessions/${session.session.id}/move-scene`, { scene_id: sceneIds[0] });
    await req('PUT', '/api/display/settings', { keep_bgm_on_silent_scene: true });
    await req('POST', `/api/scenario-sessions/${session.session.id}/move-scene`, { scene_id: sceneIds[1] });
    expect((sessionManager.buildScreenPayload() as any).bgm?.audio_id).toBe(audioA);

    // その場の曲の差し替え・停止（シーンの設定は変えない）
    await req('PUT', '/api/display/bgm', { audio_id: audioB, volume: 30 });
    expect((sessionManager.buildScreenPayload() as any).bgm).toEqual(expect.objectContaining({ audio_id: audioB, volume: 30, playing: true }));
    await req('PUT', '/api/display/bgm', { playing: false });
    expect((sessionManager.buildScreenPayload() as any).bgm.playing).toBe(false);
    expect(JSON.parse(db.select().from(scenes).where(eq(scenes.id, sceneIds[0])).get()!.bgm!).audio_id).toBe(audioA);
  });

  it('joins mooks mid-combat into the order without changing whose turn it is, and undo removes them', async () => {
    const combat = (await (await req('POST', '/api/combats', {})).json()).combat;
    const parts = combat.participants as Array<{ id: string; name: string }>;
    await req('POST', `/api/combats/${combat.id}/initiative`, {
      participants: parts.map((p, i) => ({ id: p.id, initiative: 20 - i, order_index: i })),
    });
    await req('PATCH', `/api/combats/${combat.id}`, { status: 'active', turn_index: 1 });
    const cbBefore = db.select().from(combats).where(eq(combats.id, combat.id)).get()!;
    const orderBefore = db.select().from(combat_participants).where(eq(combat_participants.combat_id, combat.id)).all().sort((a, b) => a.order_index - b.order_index);
    const actorBefore = orderBefore[cbBefore.turn_index].id;

    const mook = generateUlid();
    const base = db.select().from(characters).where(eq(characters.id, nyxId)).get()!;
    db.insert(characters).values({ ...base, id: mook, kind: 'mook', name: 'ガンガー' }).run();
    const join = await req('POST', `/api/combats/${combat.id}/join`, { character_id: mook, side: 'enemy', count: 2 });
    expect(join.status).toBe(201);
    const joined = await join.json();
    expect(joined.added_participant_ids.length).toBe(2);
    const ordered = db.select().from(combat_participants).where(eq(combat_participants.combat_id, combat.id)).all().sort((a, b) => a.order_index - b.order_index);
    expect(ordered.map((p) => p.name)).toEqual(expect.arrayContaining(['ガンガー #1', 'ガンガー #2']));
    for (let i = 1; i < ordered.length; i++) expect(ordered[i - 1].initiative).toBeGreaterThanOrEqual(ordered[i].initiative);
    const cb = db.select().from(combats).where(eq(combats.id, combat.id)).get()!;
    expect(ordered[cb.turn_index].id).toBe(actorBefore); // 手番の人は変わらない

    await req('POST', `/api/combats/${combat.id}/undo`);
    const afterUndo = db.select().from(combat_participants).where(eq(combat_participants.combat_id, combat.id)).all();
    expect(afterUndo.some((p) => p.name.startsWith('ガンガー #'))).toBe(false);
    expect(db.select().from(characters).all().some((c) => c.name.startsWith('ガンガー #'))).toBe(false);
    const cbAfter = db.select().from(combats).where(eq(combats.id, combat.id)).get()!;
    expect(cbAfter.turn_index).toBe(cbBefore.turn_index);
  });

  it('asks for the extra die when a given initiative roll is 10 or 1', async () => {
    const combat = (await (await app.request('/api/combats/current', { headers: H() })).json()).combat;
    const res = await req('POST', `/api/combats/${combat.id}/join`, { character_id: nyxId, side: 'ally', rolls: [{ first: 10 }] });
    expect(res.status).toBe(400);
  });

  it('marks a participant as left and undo brings them back', async () => {
    const combat = (await (await app.request('/api/combats/current', { headers: H() })).json()).combat;
    const pid = combat.participants[0].id;
    await req('POST', `/api/combats/${combat.id}/participants/${pid}/leave`);
    expect(db.select().from(combat_participants).where(eq(combat_participants.id, pid)).get()!.out).toBe(true);
    await req('POST', `/api/combats/${combat.id}/undo`);
    expect(db.select().from(combat_participants).where(eq(combat_participants.id, pid)).get()!.out).toBe(false);
  });
});
