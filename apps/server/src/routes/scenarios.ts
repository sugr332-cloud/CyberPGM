import { Hono } from 'hono';
import { db } from '../db/client.js';
import {
  scenarios,
  scenario_versions,
  scenes,
  scene_links,
  scene_choices,
  clues,
  handouts,
  encounters,
  random_tables,
} from '../db/schema.js';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { authMiddleware, requireGm } from '../auth.js';
import { z } from 'zod';
import {
  generateUlid,
  ScenarioFullSchema,
  ChoiceOutcomeSchema,
  ChoiceOutcomeKindEnum,
  RandomTableSchema,
  parseDiceExpression,
  rollDiceExpression,
  evaluateRandomTableRoll,
  validateRandomTableRanges,
  ScenarioFull,
} from '@cyberpgm/shared';

export const scenariosRouter = new Hono();

scenariosRouter.use('*', authMiddleware);

// --- Helpers ---
export async function getFullScenario(scenarioId: string): Promise<ScenarioFull | null> {
  const sc = await db.select().from(scenarios).where(eq(scenarios.id, scenarioId)).get();
  if (!sc) return null;

  const scScenes = await db
    .select()
    .from(scenes)
    .where(eq(scenes.scenario_id, scenarioId))
    .all();

  const scLinks = await db
    .select()
    .from(scene_links)
    .where(eq(scene_links.scenario_id, scenarioId))
    .all();

  const sceneIds = scScenes.map((s) => s.id);
  const scChoices =
    sceneIds.length > 0
      ? await db
          .select()
          .from(scene_choices)
          .where(inArray(scene_choices.scene_id, sceneIds))
          .all()
      : [];

  const scClues = await db
    .select()
    .from(clues)
    .where(eq(clues.scenario_id, scenarioId))
    .all();

  const scHandouts = await db
    .select()
    .from(handouts)
    .where(eq(handouts.scenario_id, scenarioId))
    .all();

  const scEncounters = await db
    .select()
    .from(encounters)
    .where(eq(encounters.scenario_id, scenarioId))
    .all();

  const scTables = await db
    .select()
    .from(random_tables)
    .where(eq(random_tables.scenario_id, scenarioId))
    .all();

  return {
    scenario: {
      ...sc,
      meta: JSON.parse(sc.meta || '{}'),
    },
    scenes: scScenes.map((s) => ({
      ...s,
      npc_ids: JSON.parse(s.npc_ids || '[]'),
      position: JSON.parse(s.position || '{"x":100,"y":100}'),
    })),
    links: scLinks,
    choices: scChoices.map((c) => ({
      ...c,
      on_success: JSON.parse(c.on_success || '[]'),
      on_failure: JSON.parse(c.on_failure || '[]'),
    })),
    clues: scClues,
    handouts: scHandouts,
    encounters: scEncounters.map((e) => ({
      ...e,
      participants: JSON.parse(e.participants || '[]'),
    })),
    random_tables: scTables.map((t) => ({
      ...t,
      rows: JSON.parse(t.rows || '[]'),
    })),
  };
}

export async function createScenarioVersionSnapshot(scenarioId: string, versionNumber?: number) {
  const full = await getFullScenario(scenarioId);
  if (!full) return null;

  const currentVersion = versionNumber ?? full.scenario.version;
  const versionId = generateUlid();

  db.insert(scenario_versions)
    .values({
      id: versionId,
      scenario_id: scenarioId,
      version: currentVersion,
      snapshot: JSON.stringify(full),
      saved_at: Date.now(),
    })
    .run();

  return versionId;
}

// ==========================================
// 1. Scenario CRUD & Actions
// ==========================================

// GET /api/scenarios - List scenarios
scenariosRouter.get('/', requireGm, async (c) => {
  const rows = await db
    .select()
    .from(scenarios)
    .orderBy(desc(scenarios.updated_at))
    .all();

  const parsed = rows.map((r) => ({
    ...r,
    meta: JSON.parse(r.meta || '{}'),
  }));

  return c.json({ scenarios: parsed });
});

// POST /api/scenarios - Create scenario (optional template)
const CreateScenarioSchema = z.object({
  title: z.string().min(1, 'タイトルを入力してください'),
  summary: z.string().optional().default(''),
  meta: z.record(z.any()).optional().default({}),
  use_template: z.boolean().optional().default(false),
});

scenariosRouter.post('/', requireGm, async (c) => {
  const body = await c.req.json();
  const parsed = CreateScenarioSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid scenario data', details: parsed.error.issues }, 400);
  }

  const now = Date.now();
  const scenarioId = generateUlid();

  db.insert(scenarios)
    .values({
      id: scenarioId,
      title: parsed.data.title,
      summary: parsed.data.summary,
      meta: JSON.stringify(parsed.data.meta),
      version: 1,
      created_at: now,
      updated_at: now,
    })
    .run();

  // If use_template is true:
  // "「依頼 → 調査 → 潜入 → 戦闘 → 報酬」の 5 シーンと 4 本の分岐を作るだけの雛形を 1 つ用意する。シーンの中身（読み上げ文など）は空にする（文章を作らない）"
  if (parsed.data.use_template) {
    const templateScenes = [
      { id: generateUlid(), title: '依頼', x: 80, y: 150 },
      { id: generateUlid(), title: '調査', x: 280, y: 150 },
      { id: generateUlid(), title: '潜入', x: 480, y: 150 },
      { id: generateUlid(), title: '戦闘', x: 680, y: 150 },
      { id: generateUlid(), title: '報酬', x: 880, y: 150 },
    ];

    for (let i = 0; i < templateScenes.length; i++) {
      const ts = templateScenes[i];
      db.insert(scenes)
        .values({
          id: ts.id,
          scenario_id: scenarioId,
          title: ts.title,
          read_aloud: '',
          gm_notes: '',
          location: '',
          npc_ids: '[]',
          position: JSON.stringify({ x: ts.x, y: ts.y }),
          sort_index: i,
        })
        .run();
    }

    for (let i = 0; i < templateScenes.length - 1; i++) {
      db.insert(scene_links)
        .values({
          id: generateUlid(),
          scenario_id: scenarioId,
          from_scene_id: templateScenes[i].id,
          to_scene_id: templateScenes[i + 1].id,
          condition: '',
        })
        .run();
    }
  }

  // Create initial version snapshot (v1)
  await createScenarioVersionSnapshot(scenarioId, 1);

  const full = await getFullScenario(scenarioId);
  return c.json(full, 201);
});

// GET /api/scenarios/:id - Get full scenario
scenariosRouter.get('/:id', requireGm, async (c) => {
  const id = c.req.param('id')!;
  const full = await getFullScenario(id);
  if (!full) return c.json({ error: 'Scenario not found' }, 404);
  return c.json(full);
});

// PATCH /api/scenarios/:id - Update scenario info & save snapshot
const PatchScenarioSchema = z.object({
  title: z.string().min(1).optional(),
  summary: z.string().optional(),
  meta: z.record(z.any()).optional(),
  save_version: z.boolean().optional().default(false),
});

scenariosRouter.patch('/:id', requireGm, async (c) => {
  const id = c.req.param('id')!;
  const existing = await db.select().from(scenarios).where(eq(scenarios.id, id)).get();
  if (!existing) return c.json({ error: 'Scenario not found' }, 404);

  const body = await c.req.json();
  const parsed = PatchScenarioSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid update data', details: parsed.error.issues }, 400);
  }

  const updates: Record<string, any> = { updated_at: Date.now() };
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.summary !== undefined) updates.summary = parsed.data.summary;
  if (parsed.data.meta !== undefined) updates.meta = JSON.stringify(parsed.data.meta);

  let newVersion = existing.version;
  if (parsed.data.save_version) {
    newVersion = existing.version + 1;
    updates.version = newVersion;
  }

  db.update(scenarios).set(updates).where(eq(scenarios.id, id)).run();

  if (parsed.data.save_version) {
    await createScenarioVersionSnapshot(id, newVersion);
  }

  const full = await getFullScenario(id);
  return c.json(full);
});

// DELETE /api/scenarios/:id - Delete scenario
scenariosRouter.delete('/:id', requireGm, async (c) => {
  const id = c.req.param('id')!;
  const existing = await db.select().from(scenarios).where(eq(scenarios.id, id)).get();
  if (!existing) return c.json({ error: 'Scenario not found' }, 404);

  db.delete(scenarios).where(eq(scenarios.id, id)).run();
  return c.json({ success: true, deleted: id });
});

// POST /api/scenarios/:id/duplicate - Duplicate scenario
scenariosRouter.post('/:id/duplicate', requireGm, async (c) => {
  const id = c.req.param('id')!;
  const full = await getFullScenario(id);
  if (!full) return c.json({ error: 'Scenario not found' }, 404);

  const newScenarioId = generateUlid();
  const now = Date.now();

  // Create mapping of old scene IDs to new scene IDs
  const sceneIdMap = new Map<string, string>();
  for (const sc of full.scenes) {
    sceneIdMap.set(sc.id, generateUlid());
  }

  // Insert duplicated scenario
  db.insert(scenarios)
    .values({
      id: newScenarioId,
      title: `${full.scenario.title} (コピー)`,
      summary: full.scenario.summary,
      meta: JSON.stringify(full.scenario.meta),
      version: 1,
      created_at: now,
      updated_at: now,
    })
    .run();

  // Insert scenes
  for (const sc of full.scenes) {
    const newSceneId = sceneIdMap.get(sc.id)!;
    db.insert(scenes)
      .values({
        id: newSceneId,
        scenario_id: newScenarioId,
        title: sc.title,
        read_aloud: sc.read_aloud,
        gm_notes: sc.gm_notes,
        location: sc.location,
        npc_ids: JSON.stringify(sc.npc_ids),
        position: JSON.stringify(sc.position),
        background_image_id: sc.background_image_id || null,
        board_id: sc.board_id || null,
        sort_index: sc.sort_index,
      })
      .run();
  }

  // Insert links
  for (const l of full.links) {
    const fromId = sceneIdMap.get(l.from_scene_id);
    const toId = sceneIdMap.get(l.to_scene_id);
    if (fromId && toId) {
      db.insert(scene_links)
        .values({
          id: generateUlid(),
          scenario_id: newScenarioId,
          from_scene_id: fromId,
          to_scene_id: toId,
          condition: l.condition,
        })
        .run();
    }
  }

  // Insert choices (re-mapping next_scene outcome)
  for (const ch of full.choices) {
    const newSceneId = sceneIdMap.get(ch.scene_id);
    if (!newSceneId) continue;

    const remappedSuccess = ch.on_success.map((o) => {
      if (o.kind === 'next_scene' && o.scene_id && sceneIdMap.has(o.scene_id)) {
        return { ...o, scene_id: sceneIdMap.get(o.scene_id) };
      }
      return o;
    });
    const remappedFailure = ch.on_failure.map((o) => {
      if (o.kind === 'next_scene' && o.scene_id && sceneIdMap.has(o.scene_id)) {
        return { ...o, scene_id: sceneIdMap.get(o.scene_id) };
      }
      return o;
    });

    db.insert(scene_choices)
      .values({
        id: generateUlid(),
        scene_id: newSceneId,
        label: ch.label,
        skill_key: ch.skill_key || null,
        dv: ch.dv ?? null,
        who: ch.who,
        on_success: JSON.stringify(remappedSuccess),
        on_failure: JSON.stringify(remappedFailure),
        sort_index: ch.sort_index,
      })
      .run();
  }

  // Insert clues
  for (const cl of full.clues) {
    db.insert(clues)
      .values({
        id: generateUlid(),
        scenario_id: newScenarioId,
        scene_id: cl.scene_id ? sceneIdMap.get(cl.scene_id) || null : null,
        title: cl.title,
        body: cl.body,
        image_id: cl.image_id || null,
      })
      .run();
  }

  // Insert handouts
  for (const ho of full.handouts) {
    db.insert(handouts)
      .values({
        id: generateUlid(),
        scenario_id: newScenarioId,
        scene_id: ho.scene_id ? sceneIdMap.get(ho.scene_id) || null : null,
        title: ho.title,
        body: ho.body,
        image_id: ho.image_id || null,
      })
      .run();
  }

  // Insert encounters
  for (const enc of full.encounters) {
    db.insert(encounters)
      .values({
        id: generateUlid(),
        scenario_id: newScenarioId,
        scene_id: enc.scene_id ? sceneIdMap.get(enc.scene_id) || null : null,
        title: enc.title,
        participants: JSON.stringify(enc.participants),
        notes: enc.notes,
      })
      .run();
  }

  // Insert random tables
  for (const rt of full.random_tables) {
    db.insert(random_tables)
      .values({
        id: generateUlid(),
        scenario_id: newScenarioId,
        title: rt.title,
        dice: rt.dice,
        rows: JSON.stringify(rt.rows),
      })
      .run();
  }

  // Create initial version snapshot
  await createScenarioVersionSnapshot(newScenarioId, 1);

  const duplicatedFull = await getFullScenario(newScenarioId);
  return c.json(duplicatedFull, 201);
});

// GET /api/scenarios/:id/export - Export full scenario JSON
scenariosRouter.get('/:id/export', requireGm, async (c) => {
  const id = c.req.param('id')!;
  const full = await getFullScenario(id);
  if (!full) return c.json({ error: 'Scenario not found' }, 404);
  return c.json(full);
});

// POST /api/scenarios/import - Import scenario from JSON (re-keying IDs)
scenariosRouter.post('/import', requireGm, async (c) => {
  const body = await c.req.json();
  const parsed = ScenarioFullSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid scenario import format', details: parsed.error.issues }, 400);
  }

  const data = parsed.data;
  const newScenarioId = generateUlid();
  const now = Date.now();

  const sceneIdMap = new Map<string, string>();
  for (const sc of data.scenes) {
    sceneIdMap.set(sc.id, generateUlid());
  }

  db.insert(scenarios)
    .values({
      id: newScenarioId,
      title: data.scenario.title,
      summary: data.scenario.summary,
      meta: JSON.stringify(data.scenario.meta),
      version: 1,
      created_at: now,
      updated_at: now,
    })
    .run();

  for (const sc of data.scenes) {
    const newSceneId = sceneIdMap.get(sc.id)!;
    db.insert(scenes)
      .values({
        id: newSceneId,
        scenario_id: newScenarioId,
        title: sc.title,
        read_aloud: sc.read_aloud,
        gm_notes: sc.gm_notes,
        location: sc.location,
        npc_ids: JSON.stringify(sc.npc_ids),
        position: JSON.stringify(sc.position),
        background_image_id: sc.background_image_id || null,
        board_id: sc.board_id || null,
        sort_index: sc.sort_index,
      })
      .run();
  }

  for (const l of data.links) {
    const fromId = sceneIdMap.get(l.from_scene_id);
    const toId = sceneIdMap.get(l.to_scene_id);
    if (fromId && toId) {
      db.insert(scene_links)
        .values({
          id: generateUlid(),
          scenario_id: newScenarioId,
          from_scene_id: fromId,
          to_scene_id: toId,
          condition: l.condition,
        })
        .run();
    }
  }

  for (const ch of data.choices) {
    const newSceneId = sceneIdMap.get(ch.scene_id);
    if (!newSceneId) continue;

    const remappedSuccess = ch.on_success.map((o) => {
      if (o.kind === 'next_scene' && o.scene_id && sceneIdMap.has(o.scene_id)) {
        return { ...o, scene_id: sceneIdMap.get(o.scene_id) };
      }
      return o;
    });
    const remappedFailure = ch.on_failure.map((o) => {
      if (o.kind === 'next_scene' && o.scene_id && sceneIdMap.has(o.scene_id)) {
        return { ...o, scene_id: sceneIdMap.get(o.scene_id) };
      }
      return o;
    });

    db.insert(scene_choices)
      .values({
        id: generateUlid(),
        scene_id: newSceneId,
        label: ch.label,
        skill_key: ch.skill_key || null,
        dv: ch.dv ?? null,
        who: ch.who,
        on_success: JSON.stringify(remappedSuccess),
        on_failure: JSON.stringify(remappedFailure),
        sort_index: ch.sort_index,
      })
      .run();
  }

  for (const cl of data.clues) {
    db.insert(clues)
      .values({
        id: generateUlid(),
        scenario_id: newScenarioId,
        scene_id: cl.scene_id ? sceneIdMap.get(cl.scene_id) || null : null,
        title: cl.title,
        body: cl.body,
        image_id: cl.image_id || null,
      })
      .run();
  }

  for (const ho of data.handouts) {
    db.insert(handouts)
      .values({
        id: generateUlid(),
        scenario_id: newScenarioId,
        scene_id: ho.scene_id ? sceneIdMap.get(ho.scene_id) || null : null,
        title: ho.title,
        body: ho.body,
        image_id: ho.image_id || null,
      })
      .run();
  }

  for (const enc of data.encounters) {
    db.insert(encounters)
      .values({
        id: generateUlid(),
        scenario_id: newScenarioId,
        scene_id: enc.scene_id ? sceneIdMap.get(enc.scene_id) || null : null,
        title: enc.title,
        participants: JSON.stringify(enc.participants),
        notes: enc.notes,
      })
      .run();
  }

  for (const rt of data.random_tables) {
    db.insert(random_tables)
      .values({
        id: generateUlid(),
        scenario_id: newScenarioId,
        title: rt.title,
        dice: rt.dice,
        rows: JSON.stringify(rt.rows),
      })
      .run();
  }

  await createScenarioVersionSnapshot(newScenarioId, 1);

  const importedFull = await getFullScenario(newScenarioId);
  return c.json(importedFull, 201);
});

// ==========================================
// 2. Versioning
// ==========================================

// GET /api/scenarios/:id/versions - List versions
scenariosRouter.get('/:id/versions', requireGm, async (c) => {
  const id = c.req.param('id')!;
  const rows = await db
    .select({
      id: scenario_versions.id,
      scenario_id: scenario_versions.scenario_id,
      version: scenario_versions.version,
      saved_at: scenario_versions.saved_at,
    })
    .from(scenario_versions)
    .where(eq(scenario_versions.scenario_id, id))
    .orderBy(desc(scenario_versions.version))
    .all();

  return c.json({ versions: rows });
});

// POST /api/scenarios/:id/versions/:vid/restore - Restore a version
scenariosRouter.post('/:id/versions/:vid/restore', requireGm, async (c) => {
  const scenarioId = c.req.param('id')!;
  const vid = c.req.param('vid')!;

  const targetVer = await db
    .select()
    .from(scenario_versions)
    .where(and(eq(scenario_versions.id, vid), eq(scenario_versions.scenario_id, scenarioId)))
    .get();

  if (!targetVer) {
    return c.json({ error: 'Version not found' }, 404);
  }

  const current = await getFullScenario(scenarioId);
  if (!current) {
    return c.json({ error: 'Scenario not found' }, 404);
  }

  // Requirement: "戻す前の状態も 1 つの版として残す"
  // Save current state as new version
  const nextVerNum = current.scenario.version + 1;
  await createScenarioVersionSnapshot(scenarioId, nextVerNum);

  // Restore snapshot data
  const snapshotData: ScenarioFull = JSON.parse(targetVer.snapshot);

  // Delete current scenario children
  const curScenes = await db.select({ id: scenes.id }).from(scenes).where(eq(scenes.scenario_id, scenarioId)).all();
  const curSceneIds = curScenes.map((s) => s.id);
  if (curSceneIds.length > 0) {
    db.delete(scene_choices).where(inArray(scene_choices.scene_id, curSceneIds)).run();
  }
  db.delete(scene_links).where(eq(scene_links.scenario_id, scenarioId)).run();
  db.delete(clues).where(eq(clues.scenario_id, scenarioId)).run();
  db.delete(handouts).where(eq(handouts.scenario_id, scenarioId)).run();
  db.delete(encounters).where(eq(encounters.scenario_id, scenarioId)).run();
  db.delete(random_tables).where(eq(random_tables.scenario_id, scenarioId)).run();
  db.delete(scenes).where(eq(scenes.scenario_id, scenarioId)).run();

  // Restore scenario header
  db.update(scenarios)
    .set({
      title: snapshotData.scenario.title,
      summary: snapshotData.scenario.summary,
      meta: JSON.stringify(snapshotData.scenario.meta),
      version: nextVerNum + 1,
      updated_at: Date.now(),
    })
    .where(eq(scenarios.id, scenarioId))
    .run();

  // Restore scenes
  for (const sc of snapshotData.scenes) {
    db.insert(scenes)
      .values({
        id: sc.id,
        scenario_id: scenarioId,
        title: sc.title,
        read_aloud: sc.read_aloud,
        gm_notes: sc.gm_notes,
        location: sc.location,
        npc_ids: JSON.stringify(sc.npc_ids),
        position: JSON.stringify(sc.position),
        background_image_id: sc.background_image_id || null,
        board_id: sc.board_id || null,
        sort_index: sc.sort_index,
      })
      .run();
  }

  // Restore links
  for (const l of snapshotData.links) {
    db.insert(scene_links)
      .values({
        id: l.id,
        scenario_id: scenarioId,
        from_scene_id: l.from_scene_id,
        to_scene_id: l.to_scene_id,
        condition: l.condition,
      })
      .run();
  }

  // Restore choices
  for (const ch of snapshotData.choices) {
    db.insert(scene_choices)
      .values({
        id: ch.id,
        scene_id: ch.scene_id,
        label: ch.label,
        skill_key: ch.skill_key || null,
        dv: ch.dv ?? null,
        who: ch.who,
        on_success: JSON.stringify(ch.on_success),
        on_failure: JSON.stringify(ch.on_failure),
        sort_index: ch.sort_index,
      })
      .run();
  }

  // Restore clues
  for (const cl of snapshotData.clues) {
    db.insert(clues)
      .values({
        id: cl.id,
        scenario_id: scenarioId,
        scene_id: cl.scene_id || null,
        title: cl.title,
        body: cl.body,
        image_id: cl.image_id || null,
      })
      .run();
  }

  // Restore handouts
  for (const ho of snapshotData.handouts) {
    db.insert(handouts)
      .values({
        id: ho.id,
        scenario_id: scenarioId,
        scene_id: ho.scene_id || null,
        title: ho.title,
        body: ho.body,
        image_id: ho.image_id || null,
      })
      .run();
  }

  // Restore encounters
  for (const enc of snapshotData.encounters) {
    db.insert(encounters)
      .values({
        id: enc.id,
        scenario_id: scenarioId,
        scene_id: enc.scene_id || null,
        title: enc.title,
        participants: JSON.stringify(enc.participants),
        notes: enc.notes,
      })
      .run();
  }

  // Restore random tables
  for (const rt of snapshotData.random_tables) {
    db.insert(random_tables)
      .values({
        id: rt.id,
        scenario_id: scenarioId,
        title: rt.title,
        dice: rt.dice,
        rows: JSON.stringify(rt.rows),
      })
      .run();
  }

  const restoredFull = await getFullScenario(scenarioId);
  return c.json(restoredFull);
});

// ==========================================
// 3. Child Resources CRUD
// ==========================================

// Scene CRUD
scenariosRouter.post('/:id/scenes', requireGm, async (c) => {
  const scenarioId = c.req.param('id')!;
  const body = await c.req.json();
  const sceneId = generateUlid();

  const title = body.title?.trim() || '新しいシーン';
  const position = body.position || { x: 100, y: 100 };

  db.insert(scenes)
    .values({
      id: sceneId,
      scenario_id: scenarioId,
      title,
      read_aloud: body.read_aloud || '',
      gm_notes: body.gm_notes || '',
      location: body.location || '',
      npc_ids: JSON.stringify(body.npc_ids || []),
      position: JSON.stringify(position),
      background_image_id: body.background_image_id || null,
      board_id: body.board_id || null,
      sort_index: body.sort_index ?? 0,
    })
    .run();

  db.update(scenarios).set({ updated_at: Date.now() }).where(eq(scenarios.id, scenarioId)).run();

  const created = await db.select().from(scenes).where(eq(scenes.id, sceneId)).get();
  return c.json({
    ...created,
    npc_ids: JSON.parse(created?.npc_ids || '[]'),
    position: JSON.parse(created?.position || '{"x":100,"y":100}'),
  }, 201);
});

scenariosRouter.patch('/scenes/:sceneId', requireGm, async (c) => {
  const sceneId = c.req.param('sceneId')!;
  const existing = await db.select().from(scenes).where(eq(scenes.id, sceneId)).get();
  if (!existing) return c.json({ error: 'Scene not found' }, 404);

  const body = await c.req.json();
  const updates: Record<string, any> = {};

  if (body.title !== undefined) updates.title = body.title;
  if (body.read_aloud !== undefined) updates.read_aloud = body.read_aloud;
  if (body.gm_notes !== undefined) updates.gm_notes = body.gm_notes;
  if (body.location !== undefined) updates.location = body.location;
  if (body.npc_ids !== undefined) updates.npc_ids = JSON.stringify(body.npc_ids);
  if (body.position !== undefined) updates.position = JSON.stringify(body.position);
  if (body.background_image_id !== undefined) updates.background_image_id = body.background_image_id;
  if (body.board_id !== undefined) updates.board_id = body.board_id;
  if (body.sort_index !== undefined) updates.sort_index = body.sort_index;

  db.update(scenes).set(updates).where(eq(scenes.id, sceneId)).run();
  db.update(scenarios).set({ updated_at: Date.now() }).where(eq(scenarios.id, existing.scenario_id)).run();

  const updated = await db.select().from(scenes).where(eq(scenes.id, sceneId)).get();
  return c.json({
    ...updated,
    npc_ids: JSON.parse(updated?.npc_ids || '[]'),
    position: JSON.parse(updated?.position || '{"x":100,"y":100}'),
  });
});

scenariosRouter.delete('/scenes/:sceneId', requireGm, async (c) => {
  const sceneId = c.req.param('sceneId')!;
  const existing = await db.select().from(scenes).where(eq(scenes.id, sceneId)).get();
  if (!existing) return c.json({ error: 'Scene not found' }, 404);

  db.delete(scenes).where(eq(scenes.id, sceneId)).run();
  db.update(scenarios).set({ updated_at: Date.now() }).where(eq(scenarios.id, existing.scenario_id)).run();

  return c.json({ success: true, deleted: sceneId });
});

// Scene Links CRUD
scenariosRouter.post('/:id/links', requireGm, async (c) => {
  const scenarioId = c.req.param('id')!;
  const body = await c.req.json();
  if (!body.from_scene_id || !body.to_scene_id) {
    return c.json({ error: 'from_scene_id and to_scene_id are required' }, 400);
  }

  const linkId = generateUlid();
  db.insert(scene_links)
    .values({
      id: linkId,
      scenario_id: scenarioId,
      from_scene_id: body.from_scene_id,
      to_scene_id: body.to_scene_id,
      condition: body.condition || '',
    })
    .run();

  db.update(scenarios).set({ updated_at: Date.now() }).where(eq(scenarios.id, scenarioId)).run();
  const created = await db.select().from(scene_links).where(eq(scene_links.id, linkId)).get();
  return c.json(created, 201);
});

scenariosRouter.patch('/links/:linkId', requireGm, async (c) => {
  const linkId = c.req.param('linkId')!;
  const existing = await db.select().from(scene_links).where(eq(scene_links.id, linkId)).get();
  if (!existing) return c.json({ error: 'Link not found' }, 404);

  const body = await c.req.json();
  const updates: Record<string, any> = {};
  if (body.condition !== undefined) updates.condition = body.condition;
  if (body.from_scene_id !== undefined) updates.from_scene_id = body.from_scene_id;
  if (body.to_scene_id !== undefined) updates.to_scene_id = body.to_scene_id;

  db.update(scene_links).set(updates).where(eq(scene_links.id, linkId)).run();
  db.update(scenarios).set({ updated_at: Date.now() }).where(eq(scenarios.id, existing.scenario_id)).run();

  const updated = await db.select().from(scene_links).where(eq(scene_links.id, linkId)).get();
  return c.json(updated);
});

scenariosRouter.delete('/links/:linkId', requireGm, async (c) => {
  const linkId = c.req.param('linkId')!;
  const existing = await db.select().from(scene_links).where(eq(scene_links.id, linkId)).get();
  if (!existing) return c.json({ error: 'Link not found' }, 404);

  db.delete(scene_links).where(eq(scene_links.id, linkId)).run();
  db.update(scenarios).set({ updated_at: Date.now() }).where(eq(scenarios.id, existing.scenario_id)).run();

  return c.json({ success: true, deleted: linkId });
});

// Scene Choices CRUD (strictly validates on_success and on_failure outcome types)
const ChoiceBodySchema = z.object({
  label: z.string().min(1, 'ラベルを入力してください'),
  skill_key: z.string().nullable().optional(),
  dv: z.number().int().nullable().optional(),
  who: z.string().default('全員'),
  on_success: z.array(ChoiceOutcomeSchema).default([]),
  on_failure: z.array(ChoiceOutcomeSchema).default([]),
  sort_index: z.number().int().optional().default(0),
});

scenariosRouter.post('/scenes/:sceneId/choices', requireGm, async (c) => {
  const sceneId = c.req.param('sceneId')!;
  const sceneRecord = await db.select().from(scenes).where(eq(scenes.id, sceneId)).get();
  if (!sceneRecord) return c.json({ error: 'Scene not found' }, 404);

  const body = await c.req.json();
  const parsed = ChoiceBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid choice data', details: parsed.error.issues }, 400);
  }

  const choiceId = generateUlid();
  db.insert(scene_choices)
    .values({
      id: choiceId,
      scene_id: sceneId,
      label: parsed.data.label,
      skill_key: parsed.data.skill_key || null,
      dv: parsed.data.dv ?? null,
      who: parsed.data.who,
      on_success: JSON.stringify(parsed.data.on_success),
      on_failure: JSON.stringify(parsed.data.on_failure),
      sort_index: parsed.data.sort_index,
    })
    .run();

  db.update(scenarios).set({ updated_at: Date.now() }).where(eq(scenarios.id, sceneRecord.scenario_id)).run();

  const created = await db.select().from(scene_choices).where(eq(scene_choices.id, choiceId)).get();
  return c.json({
    ...created,
    on_success: JSON.parse(created?.on_success || '[]'),
    on_failure: JSON.parse(created?.on_failure || '[]'),
  }, 201);
});

scenariosRouter.patch('/choices/:choiceId', requireGm, async (c) => {
  const choiceId = c.req.param('choiceId')!;
  const existing = await db.select().from(scene_choices).where(eq(scene_choices.id, choiceId)).get();
  if (!existing) return c.json({ error: 'Choice not found' }, 404);

  const body = await c.req.json();
  const parsed = ChoiceBodySchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid choice data', details: parsed.error.issues }, 400);
  }

  const updates: Record<string, any> = {};
  if (parsed.data.label !== undefined) updates.label = parsed.data.label;
  if (parsed.data.skill_key !== undefined) updates.skill_key = parsed.data.skill_key;
  if (parsed.data.dv !== undefined) updates.dv = parsed.data.dv;
  if (parsed.data.who !== undefined) updates.who = parsed.data.who;
  if (parsed.data.on_success !== undefined) updates.on_success = JSON.stringify(parsed.data.on_success);
  if (parsed.data.on_failure !== undefined) updates.on_failure = JSON.stringify(parsed.data.on_failure);
  if (parsed.data.sort_index !== undefined) updates.sort_index = parsed.data.sort_index;

  db.update(scene_choices).set(updates).where(eq(scene_choices.id, choiceId)).run();

  const updated = await db.select().from(scene_choices).where(eq(scene_choices.id, choiceId)).get();
  return c.json({
    ...updated,
    on_success: JSON.parse(updated?.on_success || '[]'),
    on_failure: JSON.parse(updated?.on_failure || '[]'),
  });
});

scenariosRouter.delete('/choices/:choiceId', requireGm, async (c) => {
  const choiceId = c.req.param('choiceId')!;
  const existing = await db.select().from(scene_choices).where(eq(scene_choices.id, choiceId)).get();
  if (!existing) return c.json({ error: 'Choice not found' }, 404);

  db.delete(scene_choices).where(eq(scene_choices.id, choiceId)).run();
  return c.json({ success: true, deleted: choiceId });
});

// Clues CRUD
scenariosRouter.post('/:id/clues', requireGm, async (c) => {
  const scenarioId = c.req.param('id')!;
  const body = await c.req.json();
  const clueId = generateUlid();

  db.insert(clues)
    .values({
      id: clueId,
      scenario_id: scenarioId,
      scene_id: body.scene_id || null,
      title: body.title?.trim() || '手がかり',
      body: body.body || '',
      image_id: body.image_id || null,
    })
    .run();

  db.update(scenarios).set({ updated_at: Date.now() }).where(eq(scenarios.id, scenarioId)).run();
  const created = await db.select().from(clues).where(eq(clues.id, clueId)).get();
  return c.json(created, 201);
});

scenariosRouter.patch('/clues/:clueId', requireGm, async (c) => {
  const clueId = c.req.param('clueId')!;
  const existing = await db.select().from(clues).where(eq(clues.id, clueId)).get();
  if (!existing) return c.json({ error: 'Clue not found' }, 404);

  const body = await c.req.json();
  const updates: Record<string, any> = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.body !== undefined) updates.body = body.body;
  if (body.scene_id !== undefined) updates.scene_id = body.scene_id;
  if (body.image_id !== undefined) updates.image_id = body.image_id;

  db.update(clues).set(updates).where(eq(clues.id, clueId)).run();
  const updated = await db.select().from(clues).where(eq(clues.id, clueId)).get();
  return c.json(updated);
});

scenariosRouter.delete('/clues/:clueId', requireGm, async (c) => {
  const clueId = c.req.param('clueId')!;
  const existing = await db.select().from(clues).where(eq(clues.id, clueId)).get();
  if (!existing) return c.json({ error: 'Clue not found' }, 404);

  db.delete(clues).where(eq(clues.id, clueId)).run();
  return c.json({ success: true, deleted: clueId });
});

// Handouts CRUD
scenariosRouter.post('/:id/handouts', requireGm, async (c) => {
  const scenarioId = c.req.param('id')!;
  const body = await c.req.json();
  const handoutId = generateUlid();

  db.insert(handouts)
    .values({
      id: handoutId,
      scenario_id: scenarioId,
      scene_id: body.scene_id || null,
      title: body.title?.trim() || 'ハンドアウト',
      body: body.body || '',
      image_id: body.image_id || null,
    })
    .run();

  db.update(scenarios).set({ updated_at: Date.now() }).where(eq(scenarios.id, scenarioId)).run();
  const created = await db.select().from(handouts).where(eq(handouts.id, handoutId)).get();
  return c.json(created, 201);
});

scenariosRouter.patch('/handouts/:handoutId', requireGm, async (c) => {
  const handoutId = c.req.param('handoutId')!;
  const existing = await db.select().from(handouts).where(eq(handouts.id, handoutId)).get();
  if (!existing) return c.json({ error: 'Handout not found' }, 404);

  const body = await c.req.json();
  const updates: Record<string, any> = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.body !== undefined) updates.body = body.body;
  if (body.scene_id !== undefined) updates.scene_id = body.scene_id;
  if (body.image_id !== undefined) updates.image_id = body.image_id;

  db.update(handouts).set(updates).where(eq(handouts.id, handoutId)).run();
  const updated = await db.select().from(handouts).where(eq(handouts.id, handoutId)).get();
  return c.json(updated);
});

scenariosRouter.delete('/handouts/:handoutId', requireGm, async (c) => {
  const handoutId = c.req.param('handoutId')!;
  const existing = await db.select().from(handouts).where(eq(handouts.id, handoutId)).get();
  if (!existing) return c.json({ error: 'Handout not found' }, 404);

  db.delete(handouts).where(eq(handouts.id, handoutId)).run();
  return c.json({ success: true, deleted: handoutId });
});

// Encounters CRUD
scenariosRouter.post('/:id/encounters', requireGm, async (c) => {
  const scenarioId = c.req.param('id')!;
  const body = await c.req.json();
  const encounterId = generateUlid();

  db.insert(encounters)
    .values({
      id: encounterId,
      scenario_id: scenarioId,
      scene_id: body.scene_id || null,
      title: body.title?.trim() || 'エンカウンター',
      participants: JSON.stringify(body.participants || []),
      notes: body.notes || '',
    })
    .run();

  db.update(scenarios).set({ updated_at: Date.now() }).where(eq(scenarios.id, scenarioId)).run();
  const created = await db.select().from(encounters).where(eq(encounters.id, encounterId)).get();
  return c.json({
    ...created,
    participants: JSON.parse(created?.participants || '[]'),
  }, 201);
});

scenariosRouter.patch('/encounters/:encounterId', requireGm, async (c) => {
  const encounterId = c.req.param('encounterId')!;
  const existing = await db.select().from(encounters).where(eq(encounters.id, encounterId)).get();
  if (!existing) return c.json({ error: 'Encounter not found' }, 404);

  const body = await c.req.json();
  const updates: Record<string, any> = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.scene_id !== undefined) updates.scene_id = body.scene_id;
  if (body.participants !== undefined) updates.participants = JSON.stringify(body.participants);
  if (body.notes !== undefined) updates.notes = body.notes;

  db.update(encounters).set(updates).where(eq(encounters.id, encounterId)).run();
  const updated = await db.select().from(encounters).where(eq(encounters.id, encounterId)).get();
  return c.json({
    ...updated,
    participants: JSON.parse(updated?.participants || '[]'),
  });
});

scenariosRouter.delete('/encounters/:encounterId', requireGm, async (c) => {
  const encounterId = c.req.param('encounterId')!;
  const existing = await db.select().from(encounters).where(eq(encounters.id, encounterId)).get();
  if (!existing) return c.json({ error: 'Encounter not found' }, 404);

  db.delete(encounters).where(eq(encounters.id, encounterId)).run();
  return c.json({ success: true, deleted: encounterId });
});

// ==========================================
// 4. Random Tables CRUD & Roll
// ==========================================

// GET /api/random-tables - List random tables (can filter by scenario_id)
scenariosRouter.get('/random-tables/list', requireGm, async (c) => {
  const scenarioId = c.req.query('scenario_id');

  let rows = await db.select().from(random_tables).all();
  if (scenarioId) {
    rows = rows.filter((r) => r.scenario_id === scenarioId || r.scenario_id === null);
  }

  const parsed = rows.map((r) => ({
    ...r,
    rows: JSON.parse(r.rows || '[]'),
  }));

  return c.json({ tables: parsed });
});

// POST /api/random-tables - Create random table
const CreateRandomTableSchema = z.object({
  scenario_id: z.string().nullable().optional(),
  title: z.string().min(1, 'タイトルを入力してください'),
  dice: z.string().min(1, 'ダイスを指定してください'),
  rows: z.array(z.object({
    from: z.number().int(),
    to: z.number().int(),
    text: z.string(),
  })).default([]),
});

scenariosRouter.post('/random-tables', requireGm, async (c) => {
  const body = await c.req.json();
  const parsed = CreateRandomTableSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid random table data', details: parsed.error.issues }, 400);
  }

  const tableId = generateUlid();
  db.insert(random_tables)
    .values({
      id: tableId,
      scenario_id: parsed.data.scenario_id || null,
      title: parsed.data.title,
      dice: parsed.data.dice,
      rows: JSON.stringify(parsed.data.rows),
    })
    .run();

  const created = await db.select().from(random_tables).where(eq(random_tables.id, tableId)).get();
  return c.json({
    ...created,
    rows: JSON.parse(created?.rows || '[]'),
  }, 201);
});

// PATCH /api/random-tables/:id - Update random table
scenariosRouter.patch('/random-tables/:id', requireGm, async (c) => {
  const id = c.req.param('id')!;
  const existing = await db.select().from(random_tables).where(eq(random_tables.id, id)).get();
  if (!existing) return c.json({ error: 'Random table not found' }, 404);

  const body = await c.req.json();
  const parsed = CreateRandomTableSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid random table update', details: parsed.error.issues }, 400);
  }

  const updates: Record<string, any> = {};
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.dice !== undefined) updates.dice = parsed.data.dice;
  if (parsed.data.rows !== undefined) updates.rows = JSON.stringify(parsed.data.rows);
  if (parsed.data.scenario_id !== undefined) updates.scenario_id = parsed.data.scenario_id;

  db.update(random_tables).set(updates).where(eq(random_tables.id, id)).run();
  const updated = await db.select().from(random_tables).where(eq(random_tables.id, id)).get();
  return c.json({
    ...updated,
    rows: JSON.parse(updated?.rows || '[]'),
  });
});

// DELETE /api/random-tables/:id - Delete random table
scenariosRouter.delete('/random-tables/:id', requireGm, async (c) => {
  const id = c.req.param('id')!;
  const existing = await db.select().from(random_tables).where(eq(random_tables.id, id)).get();
  if (!existing) return c.json({ error: 'Random table not found' }, 404);

  db.delete(random_tables).where(eq(random_tables.id, id)).run();
  return c.json({ success: true, deleted: id });
});

// POST /api/random-tables/:id/roll - Roll random table (or evaluate manual dice roll)
scenariosRouter.post('/random-tables/:id/roll', requireGm, async (c) => {
  const id = c.req.param('id')!;
  const existing = await db.select().from(random_tables).where(eq(random_tables.id, id)).get();
  if (!existing) return c.json({ error: 'Random table not found' }, 404);

  const body = await c.req.json().catch(() => ({}));
  let roll: number;
  if (typeof body.roll === 'number' && !isNaN(body.roll)) {
    roll = body.roll;
  } else {
    roll = rollDiceExpression(existing.dice);
  }

  const rows = JSON.parse(existing.rows || '[]');
  const matchedRow = evaluateRandomTableRoll(rows, roll);

  return c.json({
    table_id: existing.id,
    title: existing.title,
    dice: existing.dice,
    roll,
    row: matchedRow,
    matched_row: matchedRow,
  });
});
