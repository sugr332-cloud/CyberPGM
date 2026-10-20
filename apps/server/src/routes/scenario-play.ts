import { Hono } from 'hono';
import { eq, desc, and, isNull } from 'drizzle-orm';
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
import { requireGm } from '../auth.js';
import { sessionManager } from '../session.js';
import {
  generateUlid,
  ScenarioSession,
  SessionLogEntry,
  StoryCheck,
  RevealedData,
  getSkillDef,
  formatSkillName,
} from '@cyberpgm/shared';
import {
  woundState,
  woundPenalty,
  neededRoll,
  formatNeeded,
  resolveCheck,
  resolveOpposed,
} from '@cyberpgm/rules';
import { getHydratedBoard } from './boards.js';

export const scenarioPlayRoutes = new Hono();

// In-memory reference for TV story display
let currentStoryScreen: {
  active: boolean;
  scenario_session_id?: string;
  board_id?: string | null;
  background_image_path?: string | null;
  tv_handout?: {
    id: string;
    title: string;
    body: string;
    image_path?: string | null;
  } | null;
} | null = null;

export function getCurrentStoryScreen() {
  return currentStoryScreen;
}

export function setCurrentStoryScreen(data: typeof currentStoryScreen) {
  currentStoryScreen = data;
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
) {
  const active = getActiveScenarioSession();
  if (!active) return;

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
}

// In-memory undo snapshots for applied checks
const checkUndoSnapshots = new Map<string, any>();

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

  // Setup screen provider
  let bgPath: string | null = null;
  if (scene?.background_image_id) {
    const img = db.select().from(images).where(eq(images.id, scene.background_image_id)).get();
    if (img && img.visibility !== 'gm') {
      bgPath = img.path;
    }
  }

  setCurrentStoryScreen({
    active: true,
    scenario_session_id: sessionId,
    board_id: scene?.board_id || null,
    background_image_path: bgPath,
    tv_handout: null,
  });

  sessionManager.broadcastScreenUpdate();

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

  let bgPath: string | null = null;
  if (targetScene.background_image_id) {
    const img = db.select().from(images).where(eq(images.id, targetScene.background_image_id)).get();
    if (img && img.visibility !== 'gm') {
      bgPath = img.path;
    }
  }

  setCurrentStoryScreen({
    active: true,
    scenario_session_id: sessionId,
    board_id: targetScene.board_id || null,
    background_image_path: bgPath,
    tv_handout: currentStoryScreen?.tv_handout || null,
  });

  sessionManager.broadcastScreenUpdate();

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

  setCurrentStoryScreen({
    active: true,
    scenario_session_id: sessionId,
    board_id: null,
    background_image_path: null,
    tv_handout: currentStoryScreen?.tv_handout || null,
  });

  sessionManager.broadcastScreenUpdate();

  return c.json({ success: true, sceneId: newSceneId, title }, 201);
});

// POST /api/scenario-sessions/:id/end: End play session
scenarioPlayRoutes.post('/scenario-sessions/:id/end', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const session = db.select().from(scenario_sessions).where(eq(scenario_sessions.id, sessionId)).get();
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const now = Date.now();
  db.update(scenario_sessions)
    .set({ ended_at: now })
    .where(eq(scenario_sessions.id, sessionId))
    .run();

  logToActiveSession('scene', 'シナリオ進行終了');

  setCurrentStoryScreen(null);
  sessionManager.broadcastScreenUpdate();

  return c.json({ success: true, ended_at: now });
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

// GET /api/scenario-sessions/:id/revealed: Player endpoint to fetch revealed handouts
scenarioPlayRoutes.get('/scenario-sessions/:id/revealed', async (c) => {
  const sessionId = c.req.param('id')!;
  const session = db.select().from(scenario_sessions).where(eq(scenario_sessions.id, sessionId)).get();
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const revealed: RevealedData = JSON.parse(
    session.revealed || '{"clue_ids":[],"handout_ids":[]}',
  );

  const cluesList = revealed.clue_ids.length > 0
    ? db.select().from(clues).all().filter((cl) => revealed.clue_ids.includes(cl.id))
    : [];

  const handoutsList = revealed.handout_ids.length > 0
    ? db.select().from(handouts).all().filter((h) => revealed.handout_ids.includes(h.id))
    : [];

  return c.json({
    clues: cluesList,
    handouts: handoutsList,
  });
});

function broadcastRevealedHandoutsToPlayers(revealed: RevealedData) {
  const cluesList = revealed.clue_ids.length > 0
    ? db.select().from(clues).all().filter((cl) => revealed.clue_ids.includes(cl.id))
    : [];

  const handoutsList = revealed.handout_ids.length > 0
    ? db.select().from(handouts).all().filter((h) => revealed.handout_ids.includes(h.id))
    : [];

  // Enrich with images
  const allImageIds = [...cluesList.map((c) => c.image_id), ...handoutsList.map((h) => h.image_id)].filter(Boolean) as string[];
  const imagesMap = new Map<string, string>();
  if (allImageIds.length > 0) {
    const imgRows = db.select().from(images).all();
    for (const img of imgRows) {
      if (img.visibility !== 'gm') {
        imagesMap.set(img.id, img.path);
      }
    }
  }

  const payload = {
    clues: cluesList.map((c) => ({
      ...c,
      image_path: c.image_id ? imagesMap.get(c.image_id) || null : null,
    })),
    handouts: handoutsList.map((h) => ({
      ...h,
      image_path: h.image_id ? imagesMap.get(h.image_id) || null : null,
    })),
  };

  sessionManager.broadcastHandouts(payload);
}

// POST /api/scenario-sessions/:id/project-image: Project scene background or art to TV/players
scenarioPlayRoutes.post('/scenario-sessions/:id/project-image', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const body = await c.req.json();
  const { image_id, image_path, target } = body; // target: 'tv' | 'players' | 'all'

  let targetPath = image_path;
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
      currentStoryScreen.background_image_path = targetPath;
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

// GET /api/scenario-sessions/:id/checks: List checks
scenarioPlayRoutes.get('/scenario-sessions/:id/checks', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const rows = db
    .select()
    .from(story_checks)
    .where(eq(story_checks.scenario_session_id, sessionId))
    .all()
    .map((ch) => ({
      ...ch,
      rolls: JSON.parse(ch.rolls || '[]'),
      opposed: ch.opposed ? JSON.parse(ch.opposed) : null,
    }));

  return c.json({ checks: rows });
});

// POST /api/scenario-sessions/:id/checks: Create check line(s) (supports group check)
scenarioPlayRoutes.post('/scenario-sessions/:id/checks', requireGm, async (c) => {
  const sessionId = c.req.param('id')!;
  const body = await c.req.json();
  const { actor_character_ids, choice_id, skill_key, dv, opposed } = body;

  const session = db.select().from(scenario_sessions).where(eq(scenario_sessions.id, sessionId)).get();
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const charIds = Array.isArray(actor_character_ids) ? actor_character_ids : [body.actor_character_id];
  const createdChecks: any[] = [];

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
        skill_key: skill_key || null,
        dv: dv !== undefined ? Number(dv) : null,
        opposed: opposed ? JSON.stringify(opposed) : null,
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

  const updates: Record<string, any> = {};
  if (body.skill_key !== undefined) updates.skill_key = body.skill_key;
  if (body.dv !== undefined) updates.dv = body.dv !== null ? Number(body.dv) : null;
  if (body.opposed !== undefined) {
    updates.opposed = body.opposed ? JSON.stringify(body.opposed) : null;
  }

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

  const evaluated = evaluateStoryCheck(check, rolls);

  db.update(story_checks)
    .set({
      rolls: JSON.stringify(rolls),
      result: evaluated.result,
    })
    .where(eq(story_checks.id, checkId))
    .run();

  // Log to session
  const char = db.select().from(characters).where(eq(characters.id, check.actor_character_id)).get();
  logToActiveSession(
    'check',
    `判定結果: ${char?.name || 'PC'} [${evaluated.formula}] → ${evaluated.result === 'success' ? '成功' : evaluated.result === 'draw' ? '引き分け' : '失敗'}`,
    {
      check_id: check.id,
      rolls,
      result: evaluated.result,
      total: evaluated.total,
    },
  );

  // Send result to specific player
  sessionManager.sendStoryResult(check.actor_character_id, {
    check_id: check.id,
    formula: evaluated.formula,
    rolls,
    total: evaluated.total,
    result: evaluated.result,
  });

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

  for (const eff of effects) {
    if (eff.kind === 'next_scene' && eff.scene_id) {
      db.update(scenario_sessions)
        .set({ current_scene_id: eff.scene_id })
        .where(eq(scenario_sessions.id, sessionId))
        .run();
      const targetSc = db.select().from(scenes).where(eq(scenes.id, eff.scene_id)).get();
      appliedSummary.push(`シーン移動: ${targetSc?.title || eff.scene_id}`);
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

        if (newWound === 'seriously' && !statusList.includes('重傷')) {
          statusList.push('重傷');
        } else if (newWound !== 'seriously' && statusList.includes('重傷')) {
          statusList = statusList.filter((s) => s !== '重傷');
        }

        if (newWound === 'mortally' && !statusList.includes('瀕死')) {
          statusList.push('瀕死');
        } else if (newWound !== 'mortally' && statusList.includes('瀕死')) {
          statusList = statusList.filter((s) => s !== '瀕死');
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

  const logId = generateUlid();
  checkUndoSnapshots.set(logId, undoSnapshot);

  db.update(story_checks)
    .set({ applied_log_id: logId })
    .where(eq(story_checks.id, checkId))
    .run();

  logToActiveSession('check', `結果反映: ${appliedSummary.join(' / ')}`, { check_id: checkId });
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

  const snapshot = checkUndoSnapshots.get(check.applied_log_id);
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
        if (wound === 'seriously' && !statusList.includes('重傷')) statusList.push('重傷');
        if (wound !== 'seriously') statusList = statusList.filter((s) => s !== '重傷');
        if (wound === 'mortally' && !statusList.includes('瀕死')) statusList.push('瀕死');
        if (wound !== 'mortally') statusList = statusList.filter((s) => s !== '瀕死');

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

  checkUndoSnapshots.delete(check.applied_log_id);
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

  // Add all active PCs as participants
  const pcRows = db.select().from(characters).where(eq(characters.kind, 'pc')).all();
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
        active: true,
        out: false,
        move_used: false,
        action_used: false,
        state: '{}',
      })
      .run();
  }

  // Add encounter participants (replicate mooks with #1, #2, #3...)
  for (const ep of participantsConfig) {
    const char = db.select().from(characters).where(eq(characters.id, ep.character_id)).get();
    if (!char) continue;

    const count = Math.max(1, ep.count || 1);
    for (let i = 1; i <= count; i++) {
      const pName = count > 1 ? `${char.name} #${i}` : char.name;
      const partId = generateUlid();

      db.insert(combat_participants)
        .values({
          id: partId,
          combat_id: combatId,
          character_id: char.id,
          side: ep.side || 'enemy',
          name: pName,
          initiative: 0,
          initiative_roll: '{}',
          order_index: order++,
          active: true,
          out: false,
          move_used: false,
          action_used: false,
          state: '{}',
        })
        .run();

      // If scene has board and position is specified, place token
      if (boardId && ep.x !== undefined && ep.y !== undefined) {
        db.insert(board_tokens)
          .values({
            id: generateUlid(),
            board_id: boardId,
            character_id: char.id,
            x: ep.x + (i - 1),
            y: ep.y,
            gm_only: false,
          })
          .run();
      }
    }
  }

  logToActiveSession('combat', `戦闘投入: ${encounter.title}`, {
    combat_id: combatId,
    encounter_id: encounterId,
  });

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

export function evaluateStoryCheck(check: any, rolls: number[]) {
  const char = db.select().from(characters).where(eq(characters.id, check.actor_character_id)).get();
  if (!char) {
    return {
      success: false,
      result: 'failure',
      total: 0,
      formula: 'キャラ未取得',
    };
  }

  const statVal: number = (() => {
    if (!check.skill_key) return 5;
    const def = getSkillDef(check.skill_key);
    if (!def) return 5;
    const key = def.stat.toLowerCase();
    return (char as any)[key] ?? 5;
  })();

  const skillLvl: number = (() => {
    if (!check.skill_key) return 0;
    const charSkills: any[] = JSON.parse(char.skills || '[]');
    const s = charSkills.find((sk: any) => sk.key?.toLowerCase() === check.skill_key?.toLowerCase());
    return s?.level ?? 0;
  })();

  const hpState = woundState(char.hp, char.hp_max);
  const wPenalty = woundPenalty(hpState);
  const base = statVal + skillLvl + wPenalty;

  const firstRoll = rolls[0] ?? 0;
  const extraRoll = rolls.length > 1 ? rolls[1] : undefined;

  const opposed = check.opposed ? (typeof check.opposed === 'string' ? JSON.parse(check.opposed) : check.opposed) : null;

  if (opposed && opposed.target_character_id) {
    // Opposed check
    const targetChar = db.select().from(characters).where(eq(characters.id, opposed.target_character_id)).get();
    const targetStatVal = 5;
    const targetSkillLvl = 0;
    const targetBase = targetStatVal + targetSkillLvl;
    const targetRoll = opposed.roll ?? 5;
    const defenderTotal = targetBase + targetRoll;

    const attackerResult = resolveCheck({
      base,
      first: firstRoll,
      extra: extraRoll,
      target: defenderTotal,
      mode: 'defend',
    });

    const winner = resolveOpposed({
      attackerTotal: attackerResult.total,
      defenderTotal,
    });

    const formula = `${formatSkillName(check.skill_key)} 基底 ${base} + 出目 ${firstRoll}${extraRoll ? `(+${extraRoll})` : ''} = ${attackerResult.total} vs 対抗 ${defenderTotal}`;

    return {
      success: winner === 'attacker',
      result: winner === 'attacker' ? 'success' : winner === 'defender' ? 'failure' : 'draw',
      total: attackerResult.total,
      formula,
    };
  } else {
    // Standard DV check
    const dv = check.dv ?? 13;
    const needed = neededRoll(base, dv, 'dv');
    const neededText = formatNeeded(needed);

    const checkRes = resolveCheck({
      base,
      first: firstRoll,
      extra: extraRoll,
      target: dv,
      mode: 'dv',
    });

    const skillName = check.skill_key ? formatSkillName(check.skill_key) : '判定';
    const formula = `${skillName} 基底 ${base} + 出目 ${firstRoll}${extraRoll ? `(+${extraRoll})` : ''} = ${checkRes.total} vs 難易度 ${dv} (${neededText})`;

    return {
      success: checkRes.success,
      result: checkRes.success ? 'success' : 'failure',
      total: checkRes.total,
      formula,
    };
  }
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

  if (payload.choice_id) {
    const ch = db.select().from(scene_choices).where(eq(scene_choices.id, payload.choice_id)).get();
    if (ch) {
      skillKey = ch.skill_key || null;
      dv = ch.dv ?? null;
    }
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
    })
    .run();

  const char = db.select().from(characters).where(eq(characters.id, payload.characterId)).get();
  const actionName = payload.action_label || payload.free_text || '行動選択';
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

  const evaluated = evaluateStoryCheck(check, payload.rolls);

  db.update(story_checks)
    .set({
      rolls: JSON.stringify(payload.rolls),
      result: evaluated.result,
    })
    .where(eq(story_checks.id, payload.check_id))
    .run();

  const char = db.select().from(characters).where(eq(characters.id, payload.characterId)).get();
  logToActiveSession(
    'check',
    `プレイヤー出目送信: ${char?.name || 'PC'} [${evaluated.formula}] → ${evaluated.result === 'success' ? '成功' : evaluated.result === 'draw' ? '引き分け' : '失敗'}`,
    {
      check_id: check.id,
      rolls: payload.rolls,
      result: evaluated.result,
    },
  );

  sessionManager.sendStoryResult(payload.characterId, {
    check_id: check.id,
    formula: evaluated.formula,
    rolls: payload.rolls,
    total: evaluated.total,
    result: evaluated.result,
  });

  sessionManager.broadcastStoryCheckUpdate(check.scenario_session_id);
}
