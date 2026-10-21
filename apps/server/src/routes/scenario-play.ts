import { Hono } from 'hono';
import { eq, desc, and, isNull, inArray, ne } from 'drizzle-orm';
import { db, sqlite } from '../db/client.js';
import {
  scenarios,
  scenes,
  scene_links,
  scene_choices,
  clues,
  handouts,
  encounters,
  scenario_sessions,
  session_log,
  story_checks,
  characters,
  boards,
  board_tokens,
  images,
  combats,
  combat_participants,
} from '../db/schema.js';
import { requireGm, requireAuth } from '../auth.js';
import { sessionManager } from '../session.js';
import {
  generateUlid,
  ScenarioSession,
  SessionLogEntry,
  StoryCheck,
  RevealedData,
  getSkillDef,
  formatSkillName,
  StagePortrait,
  SceneStageSchema,
  SceneBgmSchema,
} from '@cyberpgm/shared';
import { z } from 'zod';
import {
  woundState,
  woundPenalty,
  neededRoll,
  formatNeeded,
  resolveCheck,
  resolveOpposed,
} from '@cyberpgm/rules';
import { getHydratedBoard } from './boards.js';
import { addCombatParticipants, getHydratedCombat, pcsInPlay } from './combat.js';

export const scenarioPlayRoutes = new Hono();

// 表示ウィンドウ（/screen）のストーリーの状態（Phase 5e）。背景・立ち絵・BGM
export interface DisplayBgm {
  audio_id: string;
  loop: boolean;
  volume: number;
  playing: boolean;
}

export interface StoryScreenState {
  active: boolean;
  scenario_session_id?: string;
  scene_id?: string | null;
  board_id?: string | null;
  background_image_id?: string | null;
  portraits: StagePortrait[];
  bgm: DisplayBgm | null;
  /** BGM のないシーンに移っても前の曲を流し続ける（GM の設定） */
  keep_bgm_on_silent_scene: boolean;
  tv_handout?: {
    id: string;
    title: string;
    body: string;
    image_path?: string | null;
  } | null;
}

let currentStoryScreen: StoryScreenState | null = null;

export function getCurrentStoryScreen() {
  return currentStoryScreen;
}

export function setCurrentStoryScreen(data: StoryScreenState | null) {
  currentStoryScreen = data;
}

/** シーンを表示ウィンドウに出す: 背景・保存した立ち絵の配置・BGM（なければ止めるか流し続ける） */
export function showSceneOnDisplay(sessionId: string, scene: typeof scenes.$inferSelect | null | undefined) {
  const prev = currentStoryScreen;
  const sceneBgm = scene?.bgm ? (JSON.parse(scene.bgm) as { audio_id: string; loop: boolean; volume: number }) : null;
  const keep = prev?.keep_bgm_on_silent_scene ?? false;
  currentStoryScreen = {
    active: true,
    scenario_session_id: sessionId,
    scene_id: scene?.id ?? null,
    board_id: scene?.board_id || null,
    background_image_id: scene?.background_image_id ?? null,
    portraits: scene ? (JSON.parse(scene.stage || '{}').portraits ?? []) : [],
    bgm: sceneBgm ? { ...sceneBgm, playing: true } : keep ? (prev?.bgm ?? null) : null,
    keep_bgm_on_silent_scene: keep,
    tv_handout: prev?.tv_handout ?? null,
  };
  sessionManager.broadcastScreenUpdate();
}

export function getActiveScenarioSession() {
  const session = db
    .select()
    .from(scenario_sessions)
    .where(isNull(scenario_sessions.ended_at))
    .orderBy(desc(scenario_sessions.started_at))
    .get();

  if (!session) return null;

  const revealed: RevealedData = JSON.parse(
    session.revealed || '{"clue_ids":[],"handout_ids":[]}',
  );

  return {
    ...session,
    revealed,
  };
}

export function logToActiveSession(
  kind: 'note' | 'scene' | 'check' | 'combat' | 'transaction' | 'money' | 'reveal',
  text: string,
  ref?: Record<string, any>,
): string | null {
  const active = getActiveScenarioSession();
  if (!active) return null;

  const logId = generateUlid();
  const at = Date.now();
  db.insert(session_log)
    .values({
      id: logId,
      scenario_session_id: active.id,
      at,
      kind,
      text,
      ref: ref ? JSON.stringify(ref) : null,
    })
    .run();
  return logId;
}

// ==========================================
// 1. Session Lifecycle & Scene Navigation
// ==========================================

// GET /api/scenario-sessions/active: Get currently active session
scenarioPlayRoutes.get('/scenario-sessions/active', requireGm, async (c) => {
  const active = getActiveScenarioSession();
  if (!active) {
    return c.json({ session: null });
  }

  const scenario = db.select().from(scenarios).where(eq(scenarios.id, active.scenario_id)).get();
  const allScenes = db
    .select()
    .from(scenes)
    .where(eq(scenes.scenario_id, active.scenario_id))
    .orderBy(scenes.sort_index)
    .all()
    .map((s) => ({
      ...s,
      npc_ids: JSON.parse(s.npc_ids || '[]'),
      position: JSON.parse(s.position || '{"x":100,"y":100}'),
    }));

  let currentScene = null;
  let outgoingLinks: any[] = [];
  let sceneChoices: any[] = [];
  let sceneClues: any[] = [];
  let sceneHandouts: any[] = [];
  let sceneEncounters: any[] = [];
  let sceneBoard: any = null;
  let sceneBgPath: string | null = null;
  let sceneBgVisibility: string | null = null;

  if (active.current_scene_id) {
    const s = allScenes.find((sc) => sc.id === active.current_scene_id);
    if (s) {
      currentScene = s;
      outgoingLinks = db
        .select()
        .from(scene_links)
        .where(eq(scene_links.from_scene_id, s.id))
        .all();

      sceneChoices = db
        .select()
        .from(scene_choices)
        .where(eq(scene_choices.scene_id, s.id))
        .orderBy(scene_choices.sort_index)
        .all()
        .map((ch) => ({
          ...ch,
          on_success: JSON.parse(ch.on_success || '[]'),
          on_failure: JSON.parse(ch.on_failure || '[]'),
        }));

      sceneClues = db.select().from(clues).where(eq(clues.scene_id, s.id)).all();
      sceneHandouts = db.select().from(handouts).where(eq(handouts.scene_id, s.id)).all();
      sceneEncounters = db
        .select()
        .from(encounters)
        .where(eq(encounters.scene_id, s.id))
        .all()
        .map((e) => ({
          ...e,
          participants: JSON.parse(e.participants || '[]'),
        }));

      if (s.board_id) {
        sceneBoard = getHydratedBoard(s.board_id);
      }
      if (s.background_image_id) {
        const img = db.select().from(images).where(eq(images.id, s.background_image_id)).get();
        if (img) {
          sceneBgPath = img.path;
          sceneBgVisibility = img.visibility;
        }
      }
    }
  }

  // Load active checks
  const checks = db
    .select()
    .from(story_checks)
    .where(eq(story_checks.scenario_session_id, active.id))
    .all()
    .map((ch) => ({
      ...ch,
      rolls: JSON.parse(ch.rolls || '[]'),
      opposed: ch.opposed ? JSON.parse(ch.opposed) : null,
    }));

  return c.json({
    session: active,
    scenario,
    scenes: allScenes,
    currentScene,
    outgoingLinks,
    choices: sceneChoices,
    clues: sceneClues,
    handouts: sceneHandouts,
    encounters: sceneEncounters,
    board: sceneBoard,
    background_image_path: sceneBgPath,
    background_image_visibility: sceneBgVisibility,
    checks,
  });
});

// ==========================================
// 表示ウィンドウの舞台（背景・立ち絵・BGM。Phase 5e。GM のみ）
// ==========================================

// GET /api/display: 今の表示ウィンドウの状態
scenarioPlayRoutes.get('/display', requireGm, (c) => c.json({ display: currentStoryScreen }));

// PUT /api/display/stage: 背景と立ち絵。立ち絵の配置は今のシーンに保存する
scenarioPlayRoutes.put('/display/stage', requireGm, async (c) => {
  if (!currentStoryScreen) return c.json({ error: '進行中のシナリオがありません' }, 409);
  const body = await c.req.json();
  if (body.background_image_id !== undefined) {
    currentStoryScreen.background_image_id = body.background_image_id || null;
  }
  if (body.portraits !== undefined) {
    const parsed = SceneStageSchema.safeParse({ portraits: body.portraits });
    if (!parsed.success) return c.json({ error: 'Invalid portraits', details: parsed.error.issues }, 400);
    currentStoryScreen.portraits = parsed.data.portraits;
    if (currentStoryScreen.scene_id) {
      db.update(scenes).set({ stage: JSON.stringify(parsed.data) }).where(eq(scenes.id, currentStoryScreen.scene_id)).run();
    }
  }
  sessionManager.broadcastScreenUpdate();
  return c.json({ display: currentStoryScreen });
});

// PUT /api/display/bgm: その場の曲・再生・停止・音量（シーンの設定は変えない）
scenarioPlayRoutes.put('/display/bgm', requireGm, async (c) => {
  if (!currentStoryScreen) return c.json({ error: '進行中のシナリオがありません' }, 409);
  const body = await c.req.json();
  if (body.audio_id === null) {
    currentStoryScreen.bgm = null;
  } else {
    const parsed = SceneBgmSchema.extend({ playing: z.boolean().default(true) }).safeParse({
      ...(currentStoryScreen.bgm ?? {}),
      ...body,
    });
    if (!parsed.success) return c.json({ error: 'Invalid bgm', details: parsed.error.issues }, 400);
    currentStoryScreen.bgm = parsed.data;
  }
  sessionManager.broadcastScreenUpdate();
  return c.json({ display: currentStoryScreen });
});

// PUT /api/display/settings: BGM のないシーンで前の曲を流し続けるか
scenarioPlayRoutes.put('/display/settings', requireGm, async (c) => {
  if (!currentStoryScreen) return c.json({ error: '進行中のシナリオがありません' }, 409);
  const body = await c.req.json();
  if (typeof body.keep_bgm_on_silent_scene === 'boolean') currentStoryScreen.keep_bgm_on_silent_scene = body.keep_bgm_on_silent_scene;
  return c.json({ display: currentStoryScreen });
});

// いまスマホでつながっている PC を、このシナリオに入れる（クリアするまで他のシナリオでは選べない。Phase 5i）
function lockConnectedCharacters(scenarioId: string) {
  const connected = sessionManager.getConnectedCharacterIds();
  if (connected.length === 0) return;
  db.update(characters)
    .set({ scenario_id: scenarioId })
    .where(and(inArray(characters.id, connected), isNull(characters.scenario_id)))
    .run();
}

// GET /api/scenario-sessions/resumable: 中断したまま（クリアしていない）のシナリオと、前回のシーン（Phase 5j）
scenarioPlayRoutes.get('/scenario-sessions/resumable', requireGm, async (c) => {
  const rows = db.select().from(scenario_sessions).orderBy(desc(scenario_sessions.started_at)).all();
  const latestByScenario = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latestByScenario.has(r.scenario_id)) latestByScenario.set(r.scenario_id, r);
  const resumable = [...latestByScenario.values()]
    .filter((r) => r.ended_at && !r.cleared_at)
    .map((r) => ({
      session_id: r.id,
      scenario_id: r.scenario_id,
      scene_title: r.current_scene_id
        ? db.select().from(scenes).where(eq(scenes.id, r.current_scene_id)).get()?.title ?? null
        : null,
      ended_at: r.ended_at,
    }));
  return c.json({ resumable });
});

// POST /api/scenario-sessions/:id/resume: 中断したシナリオを前回のシーンから再開する（公開済みの手がかり・ログもそのまま。Phase 5j）
scenarioPlayRoutes.post('/scenario-sessions/:id/resume', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const session = db.select().from(scenario_sessions).where(eq(scenario_sessions.id, sessionId)).get();
  if (!session) return c.json({ error: 'Session not found' }, 404);
  if (session.cleared_at) return c.json({ error: 'クリア済みのシナリオは再開できません' }, 409);

  db.update(scenario_sessions)
    .set({ ended_at: Date.now() })
    .where(and(isNull(scenario_sessions.ended_at), ne(scenario_sessions.id, sessionId)))
    .run();
  db.update(scenario_sessions).set({ ended_at: null }).where(eq(scenario_sessions.id, sessionId)).run();

  const scene = session.current_scene_id
    ? db.select().from(scenes).where(eq(scenes.id, session.current_scene_id)).get()
    : null;
  logToActiveSession('scene', `進行再開: ${scene ? scene.title : 'シーン未指定'}`, { scene_id: session.current_scene_id });
  lockConnectedCharacters(session.scenario_id);
  showSceneOnDisplay(sessionId, scene);

  return c.json({ success: true, sessionId, current_scene_id: session.current_scene_id });
});

// POST /api/scenario-sessions/start: Start play session
scenarioPlayRoutes.post('/scenario-sessions/start', requireGm, async (c) => {
  const body = await c.req.json();
  const { scenario_id, initial_scene_id } = body;

  if (!scenario_id) {
    return c.json({ error: 'scenario_id is required' }, 400);
  }

  const scenario = db.select().from(scenarios).where(eq(scenarios.id, scenario_id)).get();
  if (!scenario) {
    return c.json({ error: 'Scenario not found' }, 404);
  }

  // End any currently running sessions
  db.update(scenario_sessions)
    .set({ ended_at: Date.now() })
    .where(isNull(scenario_sessions.ended_at))
    .run();

  // Find target scene
  let sceneId = initial_scene_id;
  if (!sceneId) {
    const firstScene = db
      .select()
      .from(scenes)
      .where(eq(scenes.scenario_id, scenario_id))
      .orderBy(scenes.sort_index)
      .get();
    sceneId = firstScene?.id || null;
  }

  const sessionId = generateUlid();
  const now = Date.now();

  db.insert(scenario_sessions)
    .values({
      id: sessionId,
      scenario_id,
      current_scene_id: sceneId,
      started_at: now,
      ended_at: null,
      revealed: JSON.stringify({ clue_ids: [], handout_ids: [] }),
    })
    .run();

  const scene = sceneId
    ? db.select().from(scenes).where(eq(scenes.id, sceneId)).get()
    : null;

  // Log session start
  logToActiveSession('scene', `進行開始: ${scene ? scene.title : 'シーン未指定'}`, {
    scene_id: sceneId,
  });

  lockConnectedCharacters(scenario_id);
  showSceneOnDisplay(sessionId, scene);

  return c.json({
    success: true,
    sessionId,
    current_scene_id: sceneId,
  }, 201);
});

// POST /api/scenario-sessions/:id/move-scene: Navigate to another scene
scenarioPlayRoutes.post('/scenario-sessions/:id/move-scene', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const body = await c.req.json();
  const { scene_id } = body;

  const session = db.select().from(scenario_sessions).where(eq(scenario_sessions.id, sessionId)).get();
  if (!session || session.ended_at) {
    return c.json({ error: 'Active scenario session not found' }, 404);
  }

  const targetScene = db.select().from(scenes).where(eq(scenes.id, scene_id)).get();
  if (!targetScene) {
    return c.json({ error: 'Target scene not found' }, 404);
  }

  db.update(scenario_sessions)
    .set({ current_scene_id: scene_id })
    .where(eq(scenario_sessions.id, sessionId))
    .run();

  logToActiveSession('scene', `シーン移動: ${targetScene.title}`, { scene_id });

  showSceneOnDisplay(sessionId, targetScene);

  sessionManager.broadcastStoryChoices(null); // 前のシーンの選択肢を下げる
  return c.json({ success: true, current_scene_id: scene_id });
});

// POST /api/scenario-sessions/:id/adhoc-scene: Add adhoc scene on the fly
scenarioPlayRoutes.post('/scenario-sessions/:id/adhoc-scene', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const body = await c.req.json();
  const title = (body.title || '臨時シーン').trim();

  const session = db.select().from(scenario_sessions).where(eq(scenario_sessions.id, sessionId)).get();
  if (!session || session.ended_at) {
    return c.json({ error: 'Active scenario session not found' }, 404);
  }

  const lastScene = db
    .select()
    .from(scenes)
    .where(eq(scenes.scenario_id, session.scenario_id))
    .orderBy(desc(scenes.sort_index))
    .get();

  const newSceneId = generateUlid();
  const sortIndex = (lastScene?.sort_index ?? 0) + 1;

  db.insert(scenes)
    .values({
      id: newSceneId,
      scenario_id: session.scenario_id,
      title,
      read_aloud: body.read_aloud || '',
      gm_notes: body.gm_notes || '',
      location: body.location || '',
      npc_ids: '[]',
      position: JSON.stringify({ x: 100, y: 100 }),
      background_image_id: null,
      board_id: null,
      sort_index: sortIndex,
      is_adhoc: true,
    })
    .run();

  // Move session to the newly created adhoc scene
  db.update(scenario_sessions)
    .set({ current_scene_id: newSceneId })
    .where(eq(scenario_sessions.id, sessionId))
    .run();

  logToActiveSession('scene', `臨時シーン追加: ${title}`, { scene_id: newSceneId });

  showSceneOnDisplay(sessionId, db.select().from(scenes).where(eq(scenes.id, newSceneId)).get());

  return c.json({ success: true, sceneId: newSceneId, title }, 201);
});

// POST /api/scenario-sessions/:id/end: End play session
// 進行を終える。キャラのシナリオの縛りはそのまま（中断。クリアは /clear）
export function endScenarioSession(sessionId: string, logText = 'シナリオ進行終了', cleared = false): number {
  logToActiveSession('scene', logText);

  const now = Date.now();
  db.update(scenario_sessions)
    .set({ ended_at: now, cleared_at: cleared ? now : null })
    .where(eq(scenario_sessions.id, sessionId))
    .run();

  setCurrentStoryScreen(null);
  sessionManager.broadcastScreenUpdate();

  sessionManager.broadcastStoryChoices(null);
  return now;
}

scenarioPlayRoutes.post('/scenario-sessions/:id/end', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const session = db.select().from(scenario_sessions).where(eq(scenario_sessions.id, sessionId)).get();
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const ended_at = endScenarioSession(sessionId);
  return c.json({ success: true, ended_at });
});

// ==========================================
// 2. Clues & Handouts Reveal / TV Projection
// ==========================================

// POST /api/scenario-sessions/:id/reveal: Reveal clue or handout
scenarioPlayRoutes.post('/scenario-sessions/:id/reveal', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const body = await c.req.json();
  const { kind, itemId, show_on_tv } = body;

  const session = db.select().from(scenario_sessions).where(eq(scenario_sessions.id, sessionId)).get();
  if (!session || session.ended_at) {
    return c.json({ error: 'Active scenario session not found' }, 404);
  }

  let itemTitle = '';
  let itemBody = '';
  let imageId: string | null = null;
  let imagePath: string | null = null;

  if (kind === 'clue') {
    const cl = db.select().from(clues).where(eq(clues.id, itemId)).get();
    if (!cl) return c.json({ error: 'Clue not found' }, 404);
    itemTitle = cl.title;
    itemBody = cl.body;
    imageId = cl.image_id;
  } else if (kind === 'handout') {
    const h = db.select().from(handouts).where(eq(handouts.id, itemId)).get();
    if (!h) return c.json({ error: 'Handout not found' }, 404);
    itemTitle = h.title;
    itemBody = h.body;
    imageId = h.image_id;
  } else {
    return c.json({ error: 'Invalid kind' }, 400);
  }

  if (imageId) {
    const img = db.select().from(images).where(eq(images.id, imageId)).get();
    if (img) {
      if (img.visibility === 'gm') {
        return c.json({ error: '本のスキャン画像（GM専用）は公開できません' }, 400);
      }
      imagePath = img.path;
    }
  }

  const revealed: RevealedData = JSON.parse(
    session.revealed || '{"clue_ids":[],"handout_ids":[]}',
  );

  if (kind === 'clue') {
    if (!revealed.clue_ids.includes(itemId)) {
      revealed.clue_ids.push(itemId);
    }
  } else {
    if (!revealed.handout_ids.includes(itemId)) {
      revealed.handout_ids.push(itemId);
    }
  }

  db.update(scenario_sessions)
    .set({ revealed: JSON.stringify(revealed) })
    .where(eq(scenario_sessions.id, sessionId))
    .run();

  logToActiveSession('reveal', `公開: ${itemTitle}`, { kind, itemId });

  // Update TV handout if requested
  if (show_on_tv && currentStoryScreen) {
    currentStoryScreen.tv_handout = {
      id: itemId,
      title: itemTitle,
      body: itemBody,
      image_path: imagePath,
    };
    sessionManager.broadcastScreenUpdate();
  }

  // Broadcast to players
  broadcastRevealedHandoutsToPlayers(revealed);

  return c.json({ success: true, revealed });
});

// POST /api/scenario-sessions/:id/unreveal: Hide clue or handout
scenarioPlayRoutes.post('/scenario-sessions/:id/unreveal', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const body = await c.req.json();
  const { kind, itemId } = body;

  const session = db.select().from(scenario_sessions).where(eq(scenario_sessions.id, sessionId)).get();
  if (!session || session.ended_at) {
    return c.json({ error: 'Active scenario session not found' }, 404);
  }

  const revealed: RevealedData = JSON.parse(
    session.revealed || '{"clue_ids":[],"handout_ids":[]}',
  );

  if (kind === 'clue') {
    revealed.clue_ids = revealed.clue_ids.filter((id) => id !== itemId);
  } else {
    revealed.handout_ids = revealed.handout_ids.filter((id) => id !== itemId);
  }

  db.update(scenario_sessions)
    .set({ revealed: JSON.stringify(revealed) })
    .where(eq(scenario_sessions.id, sessionId))
    .run();

  if (currentStoryScreen && currentStoryScreen.tv_handout?.id === itemId) {
    currentStoryScreen.tv_handout = null;
    sessionManager.broadcastScreenUpdate();
  }

  broadcastRevealedHandoutsToPlayers(revealed);

  return c.json({ success: true, revealed });
});

// 公開済みの手がかり・ハンドアウト（プレイヤーに送る形）。GM のみの画像のパスは入れない
function buildRevealedPayload(revealed: RevealedData) {
  const cluesList = revealed.clue_ids.length > 0
    ? db.select().from(clues).all().filter((cl) => revealed.clue_ids.includes(cl.id))
    : [];
  const handoutsList = revealed.handout_ids.length > 0
    ? db.select().from(handouts).all().filter((h) => revealed.handout_ids.includes(h.id))
    : [];
  const imagesMap = new Map<string, string>();
  for (const img of db.select().from(images).all()) {
    if (img.visibility !== 'gm') imagesMap.set(img.id, img.path);
  }
  const strip = <T extends { image_id: string | null }>(x: T) => ({
    ...x,
    image_id: x.image_id && imagesMap.has(x.image_id) ? x.image_id : null,
    image_path: x.image_id ? imagesMap.get(x.image_id) || null : null,
  });
  return { clues: cluesList.map(strip), handouts: handoutsList.map(strip) };
}

// GET /api/scenario-sessions/current/revealed: 進行中のセッションで公開済みのもの（プレイヤーも可）
scenarioPlayRoutes.get('/scenario-sessions/current/revealed', requireAuth, async (c) => {
  const active = getActiveScenarioSession();
  if (!active) return c.json({ clues: [], handouts: [] });
  return c.json(buildRevealedPayload(active.revealed));
});

// GET /api/scenario-sessions/:id/revealed
scenarioPlayRoutes.get('/scenario-sessions/:id/revealed', requireAuth, async (c) => {
  const session = db.select().from(scenario_sessions).where(eq(scenario_sessions.id, c.req.param('id')!)).get();
  if (!session) return c.json({ error: 'Session not found' }, 404);
  return c.json(buildRevealedPayload(JSON.parse(session.revealed || '{"clue_ids":[],"handout_ids":[]}')));
});

function broadcastRevealedHandoutsToPlayers(revealed: RevealedData) {
  sessionManager.broadcastHandouts(buildRevealedPayload(revealed));
}

// POST /api/scenario-sessions/:id/project-image: Project scene background or art to TV/players
scenarioPlayRoutes.post('/scenario-sessions/:id/project-image', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const body = await c.req.json();
  const { image_id, target } = body; // target: 'tv' | 'players' | 'all'

  // 出す画像は ID で受け取り、visibility を必ず確かめる（パスを直接受け取らない）
  let targetPath: string | null = null;
  if (image_id) {
    const img = db.select().from(images).where(eq(images.id, image_id)).get();
    if (!img) return c.json({ error: 'Image not found' }, 404);
    if (img.visibility === 'gm') {
      return c.json({ error: '本のスキャン画像（GM専用）はTVやプレイヤーに表示できません' }, 400);
    }
    targetPath = img.path;
  }

  if (target === 'tv' || target === 'all') {
    if (currentStoryScreen) {
      currentStoryScreen.background_image_id = image_id ?? null;
      sessionManager.broadcastScreenUpdate();
    }
  }

  if (target === 'players' || target === 'all') {
    sessionManager.broadcastDisplayUpdate(targetPath);
  }

  return c.json({ success: true, image_path: targetPath });
});

// ==========================================
// 3. Choices & Story Checks (判定ボード)
// ==========================================

// POST /api/scenario-sessions/:id/choices/publish: Publish choices to player mobile
scenarioPlayRoutes.post('/scenario-sessions/:id/choices/publish', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const body = await c.req.json();
  const { choice_ids, scene_id } = body;

  const session = db.select().from(scenario_sessions).where(eq(scenario_sessions.id, sessionId)).get();
  if (!session || session.ended_at) {
    return c.json({ error: 'Active scenario session not found' }, 404);
  }

  const currentSceneId = scene_id || session.current_scene_id;
  if (!currentSceneId) {
    return c.json({ error: 'No scene selected' }, 400);
  }

  let choices = db
    .select()
    .from(scene_choices)
    .where(eq(scene_choices.scene_id, currentSceneId))
    .all()
    .map((ch) => ({
      ...ch,
      on_success: JSON.parse(ch.on_success || '[]'),
      on_failure: JSON.parse(ch.on_failure || '[]'),
    }));

  if (choice_ids && Array.isArray(choice_ids) && choice_ids.length > 0) {
    choices = choices.filter((ch) => choice_ids.includes(ch.id));
  }

  sessionManager.broadcastStoryChoices({
    scenario_session_id: sessionId,
    scene_id: currentSceneId,
    choices,
    generalActions: [
      { key: 'investigate', label: '調べる' },
      { key: 'talk', label: '話す' },
      { key: 'negotiate', label: '交渉' },
      { key: 'threaten', label: '脅す' },
      { key: 'hide', label: '隠れる' },
    ],
  });

  return c.json({ success: true, count: choices.length });
});

// POST /api/scenario-sessions/:id/choices/adhoc: Add a choice on the fly
scenarioPlayRoutes.post('/scenario-sessions/:id/choices/adhoc', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const body = await c.req.json();
  const { label, skill_key, dv, who } = body;

  const session = db.select().from(scenario_sessions).where(eq(scenario_sessions.id, sessionId)).get();
  if (!session || !session.current_scene_id) {
    return c.json({ error: 'Active scenario session not found' }, 404);
  }

  const choiceId = generateUlid();
  db.insert(scene_choices)
    .values({
      id: choiceId,
      scene_id: session.current_scene_id,
      label: label.trim(),
      skill_key: skill_key || null,
      dv: dv !== undefined ? Number(dv) : null,
      who: who || '全員',
      on_success: JSON.stringify(body.on_success || []),
      on_failure: JSON.stringify(body.on_failure || []),
      sort_index: 99,
    })
    .run();

  const created = db.select().from(scene_choices).where(eq(scene_choices.id, choiceId)).get();

  return c.json({
    choice: {
      ...created,
      on_success: JSON.parse(created?.on_success || '[]'),
      on_failure: JSON.parse(created?.on_failure || '[]'),
    },
  }, 201);
});

// 選択肢の結果を、GM に見せる文に直す（「反映する内容」）
function describeOutcomes(effects: any[], actorId: string): string[] {
  const nameOf = (id?: string) => db.select().from(characters).where(eq(characters.id, id || actorId)).get()?.name ?? '—';
  return effects.map((e) => {
    switch (e.kind) {
      case 'next_scene':
        return `次のシーン: ${db.select().from(scenes).where(eq(scenes.id, e.scene_id)).get()?.title ?? '—'}`;
      case 'reveal_clue':
        return `手がかりを公開: ${db.select().from(clues).where(eq(clues.id, e.clue_id)).get()?.title ?? '—'}`;
      case 'reveal_handout':
        return `ハンドアウトを公開: ${db.select().from(handouts).where(eq(handouts.id, e.handout_id)).get()?.title ?? '—'}`;
      case 'hp_change': {
        const ch = db.select().from(characters).where(eq(characters.id, e.target || actorId)).get();
        if (!ch) return 'HP の増減: —';
        const next = Math.max(0, Math.min(ch.hp_max, ch.hp + (Number(e.amount) || 0)));
        return `${ch.name} HP ${ch.hp} → ${next}`;
      }
      case 'add_status':
        return `${nameOf(e.target)} に状態「${e.status}」`;
      case 'get_item':
        return `${nameOf(e.target)} が「${e.item_name}」を${e.qty && e.qty > 1 ? ` ${e.qty} 個` : ''}入手`;
      case 'memo':
        return `メモ: ${e.text}`;
      default:
        return String(e.kind);
    }
  });
}

function hydrateCheck(ch: typeof story_checks.$inferSelect) {
  const rolls = JSON.parse(ch.rolls || '[]');
  const opposed = ch.opposed ? JSON.parse(ch.opposed) : null;
  const choice = ch.choice_id ? db.select().from(scene_choices).where(eq(scene_choices.id, ch.choice_id)).get() : null;
  const evaluation = evaluateStoryCheck({ ...ch, opposed }, rolls);
  const effects = choice ? JSON.parse((evaluation.result === 'failure' ? choice.on_failure : choice.on_success) || '[]') : [];
  return {
    ...ch,
    rolls,
    opposed,
    choice_label: choice?.label ?? null,
    evaluation,
    // 結果が出るまでは成功時の内容を見せ、出たらその結果の内容を見せる
    preview: describeOutcomes(effects, ch.actor_character_id),
  };
}

// GET /api/scenario-sessions/:id/checks: List checks
scenarioPlayRoutes.get('/scenario-sessions/:id/checks', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const rows = db
    .select()
    .from(story_checks)
    .where(eq(story_checks.scenario_session_id, sessionId))
    .all()
    .map(hydrateCheck);

  return c.json({ checks: rows });
});

// POST /api/scenario-sessions/:id/checks: Create check line(s) (supports group check)
scenarioPlayRoutes.post('/scenario-sessions/:id/checks', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const body = await c.req.json();
  const { actor_character_ids, choice_id, skill_key, dv, opposed, action_label } = body;

  const session = db.select().from(scenario_sessions).where(eq(scenario_sessions.id, sessionId)).get();
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const charIds = Array.isArray(actor_character_ids) ? actor_character_ids : [body.actor_character_id];
  const createdChecks: any[] = [];
  // 選択肢から作るときは、技能と難易度を選択肢から引き継ぐ（指定があればそちらを優先）
  const choice = choice_id ? db.select().from(scene_choices).where(eq(scene_choices.id, choice_id)).get() : null;
  const skillKey = skill_key ?? choice?.skill_key ?? null;
  const dvValue = dv !== undefined && dv !== null && dv !== '' ? Number(dv) : (choice?.dv ?? null);

  for (const charId of charIds) {
    if (!charId) continue;
    const checkId = generateUlid();
    db.insert(story_checks)
      .values({
        id: checkId,
        scenario_session_id: sessionId,
        scene_id: session.current_scene_id,
        choice_id: choice_id || null,
        actor_character_id: charId,
        skill_key: skillKey,
        dv: dvValue,
        opposed: opposed ? JSON.stringify(opposed) : null,
        action_label: action_label ?? choice?.label ?? null,
        rolls: '[]',
        result: null,
        applied_log_id: null,
      })
      .run();

    const row = db.select().from(story_checks).where(eq(story_checks.id, checkId)).get();
    if (row) {
      createdChecks.push({
        ...row,
        rolls: [],
        opposed: opposed || null,
      });

      const evaluated = evaluateStoryCheck(row, []);
      sessionManager.sendToCharacter(row.actor_character_id, {
        type: 'story:check_assigned',
        payload: {
          check_id: row.id,
          skill_key: row.skill_key,
          dv: row.dv,
          formula: evaluated.formula,
        },
      });
    }
  }

  sessionManager.broadcastStoryCheckUpdate(sessionId);

  return c.json({ checks: createdChecks }, 201);
});

// PATCH /api/scenario-sessions/:id/checks/:checkId: Update check line (skill, dv, opposed)
scenarioPlayRoutes.patch('/scenario-sessions/:id/checks/:checkId', requireGm, async (c) => {
  const checkId = c.req.param('checkId')!;
  const body = await c.req.json();

  const existing = db.select().from(story_checks).where(eq(story_checks.id, checkId)).get();
  if (!existing) {
    return c.json({ error: 'Check not found' }, 404);
  }
  if (existing.applied_log_id) {
    return c.json({ error: 'Check has already been applied. Undo first.' }, 409);
  }

  const updates: Record<string, any> = {};
  if (body.skill_key !== undefined) updates.skill_key = body.skill_key || null;
  if (body.dv !== undefined) updates.dv = body.dv !== null && body.dv !== '' ? Number(body.dv) : null;
  if (body.opposed !== undefined) {
    updates.opposed = body.opposed ? JSON.stringify(body.opposed) : null;
  }
  // 技能・難易度・相手を変えたら、入っている出目で結果を出し直す
  const merged = { ...existing, ...updates };
  updates.result = evaluateStoryCheck(merged, JSON.parse(existing.rolls || '[]')).result;

  db.update(story_checks).set(updates).where(eq(story_checks.id, checkId)).run();

  const updated = db.select().from(story_checks).where(eq(story_checks.id, checkId)).get();
  if (updated) {
    const evaluated = evaluateStoryCheck(updated, []);
    sessionManager.sendToCharacter(updated.actor_character_id, {
      type: 'story:check_assigned',
      payload: {
        check_id: updated.id,
        skill_key: updated.skill_key,
        dv: updated.dv,
        formula: evaluated.formula,
      },
    });
  }
  sessionManager.broadcastStoryCheckUpdate(existing.scenario_session_id);

  return c.json({
    check: {
      ...updated,
      rolls: JSON.parse(updated?.rolls || '[]'),
      opposed: updated?.opposed ? JSON.parse(updated.opposed) : null,
    },
  });
});

// POST /api/scenario-sessions/:id/checks/:checkId/roll: Enter dice and evaluate check
scenarioPlayRoutes.post('/scenario-sessions/:id/checks/:checkId/roll', requireGm, async (c) => {
  const checkId = c.req.param('checkId')!;
  const body = await c.req.json();
  const { rolls } = body;

  const check = db.select().from(story_checks).where(eq(story_checks.id, checkId)).get();
  if (!check) {
    return c.json({ error: 'Check not found' }, 404);
  }

  if (check.applied_log_id) {
    return c.json({ error: 'Check has already been applied. Undo first.' }, 409);
  }
  // 対抗判定では、相手の出目も一緒に受け取る
  if (check.opposed && Array.isArray(body.opposed_rolls)) {
    const opp = { ...JSON.parse(check.opposed), rolls: body.opposed_rolls };
    check.opposed = JSON.stringify(opp);
    db.update(story_checks).set({ opposed: check.opposed }).where(eq(story_checks.id, checkId)).run();
  }
  const evaluated = evaluateStoryCheck(check, Array.isArray(rolls) ? rolls : []);

  db.update(story_checks)
    .set({
      rolls: JSON.stringify(Array.isArray(rolls) ? rolls : []),
      result: evaluated.result,
    })
    .where(eq(story_checks.id, checkId))
    .run();

  if (evaluated.result) {
    const char = db.select().from(characters).where(eq(characters.id, check.actor_character_id)).get();
    logToActiveSession(
      'check',
      `判定結果: ${char?.name || 'PC'} [${evaluated.formula}]`,
      { check_id: check.id, rolls, result: evaluated.result, total: evaluated.total },
    );
    sessionManager.sendStoryResult(check.actor_character_id, {
      check_id: check.id,
      formula: evaluated.formula,
      rolls,
      total: evaluated.total,
      result: evaluated.result,
    });
  }

  sessionManager.broadcastStoryCheckUpdate(check.scenario_session_id);

  return c.json({
    check: {
      ...check,
      rolls,
      result: evaluated.result,
    },
    ...evaluated,
  });
});

// POST /api/scenario-sessions/:id/checks/:checkId/apply: Apply consequences
scenarioPlayRoutes.post('/scenario-sessions/:id/checks/:checkId/apply', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const checkId = c.req.param('checkId')!;

  const check = db.select().from(story_checks).where(eq(story_checks.id, checkId)).get();
  if (!check) {
    return c.json({ error: 'Check not found' }, 404);
  }
  if (!check.result) {
    return c.json({ error: 'Check has not been rolled/evaluated' }, 400);
  }
  if (check.applied_log_id) {
    return c.json({ error: 'Check has already been applied' }, 409);
  }

  const session = db.select().from(scenario_sessions).where(eq(scenario_sessions.id, sessionId)).get();
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const choice = check.choice_id
    ? db.select().from(scene_choices).where(eq(scene_choices.id, check.choice_id)).get()
    : null;

  const on_success = JSON.parse(choice?.on_success || '[]');
  const on_failure = JSON.parse(choice?.on_failure || '[]');
  const effects = check.result === 'success' ? on_success : on_failure;

  const undoSnapshot: any = {
    check_id: checkId,
    previous_scene_id: session.current_scene_id,
    reverted_reveals: [],
    character_hp_changes: [],
    character_status_changes: [],
    character_item_changes: [],
  };

  const appliedSummary: string[] = [];

  const applyTx = sqlite.transaction(() => {
  for (const eff of effects) {
    if (eff.kind === 'next_scene' && eff.scene_id) {
      db.update(scenario_sessions)
        .set({ current_scene_id: eff.scene_id })
        .where(eq(scenario_sessions.id, sessionId))
        .run();
      const targetSc = db.select().from(scenes).where(eq(scenes.id, eff.scene_id)).get();
      appliedSummary.push(`シーン移動: ${targetSc?.title || eff.scene_id}`);
      sessionManager.broadcastStoryChoices(null);
      logToActiveSession('scene', `シーン移動: ${targetSc?.title || eff.scene_id}`, { scene_id: eff.scene_id });
    } else if (eff.kind === 'reveal_clue' && eff.clue_id) {
      const revealed: RevealedData = JSON.parse(session.revealed || '{"clue_ids":[],"handout_ids":[]}');
      if (!revealed.clue_ids.includes(eff.clue_id)) {
        revealed.clue_ids.push(eff.clue_id);
        db.update(scenario_sessions).set({ revealed: JSON.stringify(revealed) }).where(eq(scenario_sessions.id, sessionId)).run();
        undoSnapshot.reverted_reveals.push({ kind: 'clue', id: eff.clue_id });
        broadcastRevealedHandoutsToPlayers(revealed);
        const cl = db.select().from(clues).where(eq(clues.id, eff.clue_id)).get();
        appliedSummary.push(`手がかり公開: ${cl?.title || eff.clue_id}`);
      }
    } else if (eff.kind === 'reveal_handout' && eff.handout_id) {
      const revealed: RevealedData = JSON.parse(session.revealed || '{"clue_ids":[],"handout_ids":[]}');
      if (!revealed.handout_ids.includes(eff.handout_id)) {
        revealed.handout_ids.push(eff.handout_id);
        db.update(scenario_sessions).set({ revealed: JSON.stringify(revealed) }).where(eq(scenario_sessions.id, sessionId)).run();
        undoSnapshot.reverted_reveals.push({ kind: 'handout', id: eff.handout_id });
        broadcastRevealedHandoutsToPlayers(revealed);
        const h = db.select().from(handouts).where(eq(handouts.id, eff.handout_id)).get();
        appliedSummary.push(`ハンドアウト公開: ${h?.title || eff.handout_id}`);
      }
    } else if (eff.kind === 'hp_change') {
      const targetCharId = eff.target || check.actor_character_id;
      const char = db.select().from(characters).where(eq(characters.id, targetCharId)).get();
      if (char) {
        const prevHp = char.hp;
        const newHp = Math.max(0, Math.min(char.hp_max, char.hp + (Number(eff.amount) || 0)));
        undoSnapshot.character_hp_changes.push({ character_id: targetCharId, prevHp });

        // Update wounds and status conditions
        const prevWound = woundState(prevHp, char.hp_max);
        const newWound = woundState(newHp, char.hp_max);
        let statusList: string[] = JSON.parse(char.status || '[]');

        if (newWound === 'seriously' && !statusList.includes('seriously')) {
          statusList.push('seriously');
        } else if (newWound !== 'seriously' && statusList.includes('seriously')) {
          statusList = statusList.filter((s) => s !== 'seriously');
        }

        if (newWound === 'mortally' && !statusList.includes('mortally')) {
          statusList.push('mortally');
        } else if (newWound !== 'mortally' && statusList.includes('mortally')) {
          statusList = statusList.filter((s) => s !== 'mortally');
        }

        db.update(characters)
          .set({ hp: newHp, status: JSON.stringify(statusList) })
          .where(eq(characters.id, targetCharId))
          .run();

        appliedSummary.push(`${char.name} HP ${prevHp} → ${newHp}`);
      }
    } else if (eff.kind === 'add_status' && eff.status) {
      const targetCharId = eff.target || check.actor_character_id;
      const char = db.select().from(characters).where(eq(characters.id, targetCharId)).get();
      if (char) {
        const statusList: string[] = JSON.parse(char.status || '[]');
        if (!statusList.includes(eff.status)) {
          statusList.push(eff.status);
          db.update(characters).set({ status: JSON.stringify(statusList) }).where(eq(characters.id, targetCharId)).run();
          undoSnapshot.character_status_changes.push({ character_id: targetCharId, status: eff.status });
          appliedSummary.push(`${char.name} に状態付与: ${eff.status}`);
        }
      }
    } else if (eff.kind === 'get_item' && eff.item_name) {
      const targetCharId = eff.target || check.actor_character_id;
      const char = db.select().from(characters).where(eq(characters.id, targetCharId)).get();
      if (char) {
        const inventory: any[] = JSON.parse(char.inventory || '[]');
        const newEntryId = generateUlid();
        const newItem = {
          entry_id: newEntryId,
          item_id: null,
          name: eff.item_name,
          qty: eff.qty || 1,
          equipped: false,
        };
        inventory.push(newItem);
        db.update(characters).set({ inventory: JSON.stringify(inventory) }).where(eq(characters.id, targetCharId)).run();
        undoSnapshot.character_item_changes.push({ character_id: targetCharId, item_id: newEntryId });
        appliedSummary.push(`${char.name} がアイテム入手: ${eff.item_name}`);
      }
    } else if (eff.kind === 'memo' && eff.text) {
      logToActiveSession('note', eff.text);
      appliedSummary.push(`メモ記録: ${eff.text}`);
    }
  }

  // 取り消し用の変更前の値は、反映のログ（session_log.ref.undo）に持たせる（サーバを起動し直しても取り消せる）
  const logId = logToActiveSession('check', `結果反映: ${appliedSummary.join(' / ') || '変化なし'}`, {
    check_id: checkId,
    undo: undoSnapshot,
  });
  db.update(story_checks)
    .set({ applied_log_id: logId })
    .where(eq(story_checks.id, checkId))
    .run();
  return logId;
  });
  const logId = applyTx();
  sessionManager.updateAllCharacterSheets();

  return c.json({
    success: true,
    applied_log_id: logId,
    summary: appliedSummary,
  });
});

// POST /api/scenario-sessions/:id/checks/:checkId/undo: Undo consequences
scenarioPlayRoutes.post('/scenario-sessions/:id/checks/:checkId/undo', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const checkId = c.req.param('checkId')!;

  const check = db.select().from(story_checks).where(eq(story_checks.id, checkId)).get();
  if (!check || !check.applied_log_id) {
    return c.json({ error: 'No applied state to undo' }, 400);
  }

  const appliedLog = db.select().from(session_log).where(eq(session_log.id, check.applied_log_id)).get();
  const snapshot = appliedLog?.ref ? JSON.parse(appliedLog.ref).undo : null;
  if (!snapshot) {
    return c.json({ error: 'Undo snapshot not found' }, 404);
  }

  // 1. Revert scene navigation
  if (snapshot.previous_scene_id) {
    db.update(scenario_sessions)
      .set({ current_scene_id: snapshot.previous_scene_id })
      .where(eq(scenario_sessions.id, sessionId))
      .run();
  }

  // 2. Revert reveals
  if (snapshot.reverted_reveals && snapshot.reverted_reveals.length > 0) {
    const session = db.select().from(scenario_sessions).where(eq(scenario_sessions.id, sessionId)).get();
    if (session) {
      const revealed: RevealedData = JSON.parse(session.revealed || '{"clue_ids":[],"handout_ids":[]}');
      for (const rev of snapshot.reverted_reveals) {
        if (rev.kind === 'clue') {
          revealed.clue_ids = revealed.clue_ids.filter((id) => id !== rev.id);
        } else {
          revealed.handout_ids = revealed.handout_ids.filter((id) => id !== rev.id);
        }
      }
      db.update(scenario_sessions).set({ revealed: JSON.stringify(revealed) }).where(eq(scenario_sessions.id, sessionId)).run();
      broadcastRevealedHandoutsToPlayers(revealed);
    }
  }

  // 3. Revert HP changes
  if (snapshot.character_hp_changes) {
    for (const hpc of snapshot.character_hp_changes) {
      const char = db.select().from(characters).where(eq(characters.id, hpc.character_id)).get();
      if (char) {
        const wound = woundState(hpc.prevHp, char.hp_max);
        let statusList: string[] = JSON.parse(char.status || '[]');
        if (wound === 'seriously' && !statusList.includes('seriously')) statusList.push('seriously');
        if (wound !== 'seriously') statusList = statusList.filter((s) => s !== 'seriously');
        if (wound === 'mortally' && !statusList.includes('mortally')) statusList.push('mortally');
        if (wound !== 'mortally') statusList = statusList.filter((s) => s !== 'mortally');

        db.update(characters)
          .set({ hp: hpc.prevHp, status: JSON.stringify(statusList) })
          .where(eq(characters.id, hpc.character_id))
          .run();
      }
    }
  }

  // 4. Revert status changes
  if (snapshot.character_status_changes) {
    for (const stc of snapshot.character_status_changes) {
      const char = db.select().from(characters).where(eq(characters.id, stc.character_id)).get();
      if (char) {
        let statusList: string[] = JSON.parse(char.status || '[]');
        statusList = statusList.filter((s) => s !== stc.status);
        db.update(characters).set({ status: JSON.stringify(statusList) }).where(eq(characters.id, stc.character_id)).run();
      }
    }
  }

  // 5. Revert item changes
  if (snapshot.character_item_changes) {
    for (const itc of snapshot.character_item_changes) {
      const char = db.select().from(characters).where(eq(characters.id, itc.character_id)).get();
      if (char) {
        let inventory: any[] = JSON.parse(char.inventory || '[]');
        inventory = inventory.filter((i) => i.entry_id !== itc.item_id);
        db.update(characters).set({ inventory: JSON.stringify(inventory) }).where(eq(characters.id, itc.character_id)).run();
      }
    }
  }

  db.update(story_checks)
    .set({ applied_log_id: null })
    .where(eq(story_checks.id, checkId))
    .run();

  logToActiveSession('check', '判定の反映を取り消しました', { check_id: checkId });
  sessionManager.updateAllCharacterSheets();

  return c.json({ success: true });
});

// ==========================================
// 4. Session Logs & Text Export
// ==========================================

// GET /api/scenario-sessions/:id/logs: List logs
scenarioPlayRoutes.get('/scenario-sessions/:id/logs', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const rows = db
    .select()
    .from(session_log)
    .where(eq(session_log.scenario_session_id, sessionId))
    .orderBy(desc(session_log.at))
    .all()
    .map((l) => ({
      ...l,
      ref: l.ref ? JSON.parse(l.ref) : null,
    }));

  return c.json({ logs: rows });
});

// POST /api/scenario-sessions/:id/logs/note: Add GM note
scenarioPlayRoutes.post('/scenario-sessions/:id/logs/note', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const body = await c.req.json();
  const text = (body.text || '').trim();
  if (!text) return c.json({ error: 'Text required' }, 400);

  const logId = generateUlid();
  const at = Date.now();
  db.insert(session_log)
    .values({
      id: logId,
      scenario_session_id: sessionId,
      at,
      kind: 'note',
      text,
      ref: null,
    })
    .run();

  return c.json({
    log: {
      id: logId,
      scenario_session_id: sessionId,
      at,
      kind: 'note',
      text,
      ref: null,
    },
  }, 201);
});

// GET /api/scenario-sessions/:id/logs/export: Export formatted plain text log
scenarioPlayRoutes.get('/scenario-sessions/:id/logs/export', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const session = db.select().from(scenario_sessions).where(eq(scenario_sessions.id, sessionId)).get();
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const scenario = db.select().from(scenarios).where(eq(scenarios.id, session.scenario_id)).get();
  const rows = db
    .select()
    .from(session_log)
    .where(eq(session_log.scenario_session_id, sessionId))
    .orderBy(session_log.at)
    .all();

  const lines: string[] = [];
  lines.push(`【セッションログ】${scenario?.title || 'シナリオ'}`);
  lines.push(`開始日時: ${new Date(session.started_at).toLocaleString('ja-JP')}`);
  if (session.ended_at) {
    lines.push(`終了日時: ${new Date(session.ended_at).toLocaleString('ja-JP')}`);
  }
  lines.push('----------------------------------------');

  for (const r of rows) {
    const timeStr = new Date(r.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const kindJa = {
      note: 'GMメモ',
      scene: 'シーン',
      check: '判定',
      combat: '戦闘',
      transaction: '取引',
      money: '資金',
      reveal: '公開',
    }[r.kind] || r.kind;

    lines.push(`[${timeStr}] [${kindJa}] ${r.text}`);
  }

  lines.push('----------------------------------------');

  return c.text(lines.join('\n'), 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': `attachment; filename="session-log-${sessionId}.txt"`,
  });
});

// ==========================================
// 5. Encounter to Combat Transition
// ==========================================

// POST /api/scenarios/encounters/:encounterId/start-combat
scenarioPlayRoutes.post('/scenarios/encounters/:encounterId/start-combat', requireGm, async (c) => {
  const encounterId = c.req.param('encounterId')!;
  const encounter = db.select().from(encounters).where(eq(encounters.id, encounterId)).get();
  if (!encounter) {
    return c.json({ error: 'Encounter not found' }, 404);
  }

  const participantsConfig = JSON.parse(encounter.participants || '[]');

  // Check scene and board
  let boardId: string | null = null;
  if (encounter.scene_id) {
    const sc = db.select().from(scenes).where(eq(scenes.id, encounter.scene_id)).get();
    if (sc?.board_id) {
      boardId = sc.board_id;
    }
  }

  // Create combat in setup mode
  const combatId = generateUlid();
  const now = Date.now();
  db.insert(combats)
    .values({
      id: combatId,
      board_id: boardId,
      status: 'setup',
      round: 1,
      turn_index: 0,
      settings: JSON.stringify({
        tieBreak: 'ref',
        autoRollNpc: true,
        autoRollPc: false,
        hideEnemyStats: true,
      }),
      created_at: now,
    })
    .run();

  let order = 0;

  // PC は全員入れ、シナリオに入っている・つながっている PC だけ最初からチェックする（Phase 5l）
  const pcRows = db.select().from(characters).where(eq(characters.kind, 'pc')).all();
  const inPlay = pcsInPlay(pcRows);
  for (const pc of pcRows) {
    db.insert(combat_participants)
      .values({
        id: generateUlid(),
        combat_id: combatId,
        character_id: pc.id,
        side: 'ally',
        name: pc.name,
        initiative: 0,
        initiative_roll: '{}',
        order_index: order++,
        active: inPlay.has(pc.id),
        out: false,
        move_used: false,
        action_used: false,
        state: '{}',
      })
      .run();
  }

  // エンカウンターの参加者。モブは 4a と同じく 1 体ずつ別のキャラに複製する（HP を別々に持つ）
  for (const ep of participantsConfig) {
    const char = db.select().from(characters).where(eq(characters.id, ep.character_id)).get();
    if (!char) continue;
    const count = Math.max(1, ep.count || 1);
    const createdIds = addCombatParticipants(combatId, {
      character_id: char.id,
      name: char.name,
      side: ep.side || 'enemy',
      count,
    });
    order += createdIds.length;

    // シーンに盤面があり、位置が決まっていればコマを置く（2 体目以降は右へずらす）
    if (boardId && ep.x !== undefined && ep.y !== undefined) {
      createdIds.forEach((cid, i) => {
        if (!cid) return;
        db.insert(board_tokens)
          .values({ id: generateUlid(), board_id: boardId!, character_id: cid, x: ep.x + i, y: ep.y, gm_only: false })
          .run();
      });
    }
  }

  logToActiveSession('combat', `戦闘投入: ${encounter.title}`, {
    combat_id: combatId,
    encounter_id: encounterId,
  });

  sessionManager.broadcastCombatUpdate(getHydratedCombat(combatId)); // スマホにも戦闘準備中を知らせる（Phase 5l）

  return c.json({
    success: true,
    combat_id: combatId,
    encounter_title: encounter.title,
    participant_count: order,
  }, 201);
});

// ==========================================
// 6. Evaluation Helper for Checks
// ==========================================

interface CheckActorBase {
  base: number;
  parts: string;
}

const STAT_LABEL: Record<string, string> = {
  int: 'INT', ref: 'REF', dex: 'DEX', tech: 'TECH', cool: 'COOL', will: 'WILL', luck: 'LUCK', move: 'MOVE', body: 'BODY', emp: 'EMP',
};

/** 能力値 + 技能レベル + 負傷の修正。技能がない・キャラがないときは null */
function checkActorBase(characterId: string | null | undefined, skillKey: string | null | undefined): CheckActorBase | null {
  if (!characterId || !skillKey) return null;
  const char = db.select().from(characters).where(eq(characters.id, characterId)).get();
  const def = getSkillDef(skillKey);
  if (!char || !def) return null;
  const stats: Record<string, number> = JSON.parse(char.stats || '{}');
  const skills: Record<string, number> = JSON.parse(char.skills || '{}');
  const stat = stats[def.stat];
  if (typeof stat !== 'number') return null;
  const level = skills[skillKey] ?? 0; // 取っていない技能はレベル 0（ルールどおり）
  const pen = woundPenalty(woundState(char.hp, char.hp_max));
  const base = stat + level + pen;
  const penText = pen ? ` ${pen}（${pen === -2 ? '重傷' : '瀕死'}）` : '';
  return { base, parts: `${STAT_LABEL[def.stat] ?? def.stat} ${stat} + ${formatSkillName(skillKey)} ${level}${penText} = ${base}` };
}

function rollText(rolls: number[]): string {
  if (rolls.length === 0) return '';
  return rolls.length > 1 ? `${rolls[0]}（追加 ${rolls[1]}）` : `${rolls[0]}`;
}

/** 出目がそろっていないときの不足。10 と 1 は追加の出目が要る */
function missingRoll(rolls: number[] | undefined, who: string): string | null {
  if (!rolls || rolls.length === 0 || typeof rolls[0] !== 'number') return `${who}出目を入力してください`;
  if ((rolls[0] === 10 || rolls[0] === 1) && typeof rolls[1] !== 'number') return `${who}追加の出目を入力してください（出目 ${rolls[0]}）`;
  return null;
}

export interface StoryCheckEvaluation {
  result: 'success' | 'failure' | null;
  total: number | null;
  formula: string;
  needed: string | null;
  missing_inputs: string[];
}

/**
 * 判定ボードの 1 行を評価する（packages/rules の関数だけを使う）。
 * 値が足りなければ計算せず、何が足りないかを返す（数値を推測で埋めない）。
 */
export function evaluateStoryCheck(check: any, rolls: number[]): StoryCheckEvaluation {
  const missing: string[] = [];
  const actor = checkActorBase(check.actor_character_id, check.skill_key);
  if (!check.skill_key) missing.push('技能を選んでください');
  else if (!actor) missing.push('キャラの能力値か技能のデータがありません');

  const opposed = check.opposed ? (typeof check.opposed === 'string' ? JSON.parse(check.opposed) : check.opposed) : null;

  if (opposed && opposed.target_character_id) {
    const target = checkActorBase(opposed.target_character_id, opposed.skill_key);
    if (!opposed.skill_key) missing.push('相手の技能を選んでください');
    else if (!target) missing.push('相手の能力値か技能のデータがありません');
    const formulaBase = `${actor?.parts ?? '—'} vs 相手 ${target?.parts ?? '—'}`;
    if (missing.length === 0) {
      const mine = missingRoll(rolls, '');
      const theirs = missingRoll(opposed.rolls, '相手の');
      if (mine) missing.push(mine);
      if (theirs) missing.push(theirs);
    }
    if (missing.length > 0 || !actor || !target) {
      return { result: null, total: null, formula: `${formulaBase}（相手の合計を超えれば成功。同じ値は受ける側の勝ち）`, needed: null, missing_inputs: missing };
    }
    const mine = resolveCheck({ base: actor.base, first: rolls[0], extra: rolls[1], target: 0, mode: 'dv' });
    const theirs = resolveCheck({ base: target.base, first: opposed.rolls[0], extra: opposed.rolls[1], target: 0, mode: 'dv' });
    const winner = resolveOpposed({ attackerTotal: mine.total, defenderTotal: theirs.total });
    return {
      result: winner === 'attacker' ? 'success' : 'failure',
      total: mine.total,
      formula: `${actor.parts} + 出目 ${rollText(rolls)} = ${mine.total} vs 相手 ${target.base} + 出目 ${rollText(opposed.rolls)} = ${theirs.total}`,
      needed: null,
      missing_inputs: [],
    };
  }

  if (check.dv === null || check.dv === undefined) missing.push('難易度を決めてください');
  if (missing.length > 0 || !actor) {
    return { result: null, total: null, formula: actor ? `${actor.parts} vs 難易度 —` : '—', needed: null, missing_inputs: missing };
  }
  const needed = formatNeeded(neededRoll(actor.base, check.dv, 'dv'));
  const rollMissing = missingRoll(rolls, '');
  if (rollMissing) {
    return { result: null, total: null, formula: `${actor.parts} vs 難易度 ${check.dv} → ${needed}`, needed, missing_inputs: [rollMissing] };
  }
  const res = resolveCheck({ base: actor.base, first: rolls[0], extra: rolls[1], target: check.dv, mode: 'dv' });
  return {
    result: res.success ? 'success' : 'failure',
    total: res.total,
    formula: `${actor.parts} + 出目 ${rollText(rolls)} = ${res.total} vs 難易度 ${check.dv} → ${res.success ? '成功' : '失敗'}`,
    needed,
    missing_inputs: [],
  };
}

// ==========================================
// 7. WebSocket Handlers (Player Choose & Roll)
// ==========================================

export async function handleStoryChoose(payload: {
  characterId: string;
  choice_id?: string;
  action_type?: 'general' | 'free' | 'choice';
  action_label?: string;
  free_text?: string;
}) {
  const active = getActiveScenarioSession();
  if (!active || !active.current_scene_id) return;

  let skillKey: string | null = null;
  let dv: number | null = null;

  let actionLabel: string | null = payload.action_label || payload.free_text || null;
  if (payload.choice_id) {
    const ch = db.select().from(scene_choices).where(eq(scene_choices.id, payload.choice_id)).get();
    // 今のシーンの選択肢だけ選べる
    if (!ch || ch.scene_id !== active.current_scene_id) return;
    skillKey = ch.skill_key || null;
    dv = ch.dv ?? null;
    actionLabel = ch.label;
  }

  const checkId = generateUlid();
  db.insert(story_checks)
    .values({
      id: checkId,
      scenario_session_id: active.id,
      scene_id: active.current_scene_id,
      choice_id: payload.choice_id || null,
      actor_character_id: payload.characterId,
      skill_key: skillKey,
      dv: dv,
      opposed: null,
      rolls: '[]',
      result: null,
      applied_log_id: null,
      action_label: actionLabel,
    })
    .run();

  const char = db.select().from(characters).where(eq(characters.id, payload.characterId)).get();
  const actionName = actionLabel || '行動選択';
  logToActiveSession('check', `${char?.name || 'プレイヤー'} が選択: ${actionName}`, {
    check_id: checkId,
    choice_id: payload.choice_id,
  });

  sessionManager.broadcastStoryCheckUpdate(active.id);

  const inserted = db.select().from(story_checks).where(eq(story_checks.id, checkId)).get();
  if (inserted) {
    const evaluated = evaluateStoryCheck(inserted, []);
    sessionManager.sendToCharacter(payload.characterId, {
      type: 'story:check_assigned',
      payload: {
        check_id: checkId,
        skill_key: skillKey,
        dv: dv,
        formula: evaluated.formula,
      },
    });
  }
}

export async function handleStoryRoll(
  payload: {
    characterId: string;
    check_id: string;
    rolls: number[];
  },
  ws?: any,
) {
  const check = db.select().from(story_checks).where(eq(story_checks.id, payload.check_id)).get();
  if (!check) {
    ws?.send(JSON.stringify({ type: 'error', error: 'Check not found' }));
    return;
  }

  // Authorization check: player can only roll for their own check!
  if (check.actor_character_id !== payload.characterId) {
    ws?.send(JSON.stringify({ type: 'error', error: 'Forbidden: Cannot roll for other players' }));
    return;
  }

  if (check.applied_log_id) {
    ws?.send(JSON.stringify({ type: 'error', error: 'Check has already been applied' }));
    return;
  }
  const rolls = Array.isArray(payload.rolls) ? payload.rolls : [];
  const evaluated = evaluateStoryCheck(check, rolls);

  db.update(story_checks)
    .set({ rolls: JSON.stringify(rolls), result: evaluated.result })
    .where(eq(story_checks.id, payload.check_id))
    .run();

  if (evaluated.result) {
    const char = db.select().from(characters).where(eq(characters.id, payload.characterId)).get();
    logToActiveSession('check', `プレイヤー出目送信: ${char?.name || 'PC'} [${evaluated.formula}]`, {
      check_id: check.id,
      rolls,
      result: evaluated.result,
    });
  }

  sessionManager.sendStoryResult(payload.characterId, {
    check_id: check.id,
    formula: evaluated.formula,
    rolls,
    total: evaluated.total,
    result: evaluated.result,
    missing_inputs: evaluated.missing_inputs,
  });

  sessionManager.broadcastStoryCheckUpdate(check.scenario_session_id);
}
