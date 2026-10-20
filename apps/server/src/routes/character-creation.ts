import { Hono } from 'hono';
import { db, getImagesDir } from '../db/client.js';
import {
  character_submissions,
  rule_constants,
  app_settings,
  characters,
  money_log,
  images,
} from '../db/schema.js';
import { eq, like, desc } from 'drizzle-orm';
import {
  generateUlid,
  CpgmCharacterFileSchema,
  CreationMethodConfigSchema,
  CharacterDraft,
  CreationMethodConfig,
} from '@cyberpgm/shared';
import { validateCharacterDraft } from '@cyberpgm/rules';
import { requireGm } from '../auth.js';
import { triggerAutoSave } from './saves.js';
import fs from 'node:fs';
import path from 'node:path';

export const characterCreationRoutes = new Hono();

// Helper to get active creation method and starting funds
export function getActiveCreationSettings() {
  const settingsRows = db.select().from(app_settings).all();
  let activeKey = 'complete_package';
  let startingFunds: number | null = null;

  for (const row of settingsRows) {
    if (row.key === 'creation_method_active') {
      try {
        activeKey = JSON.parse(row.value);
      } catch {
        activeKey = row.value;
      }
    } else if (row.key === 'starting_funds') {
      try {
        const parsed = JSON.parse(row.value);
        startingFunds = parsed !== null && parsed !== '' ? Number(parsed) : null;
      } catch {
        startingFunds = row.value ? Number(row.value) : null;
      }
    }
  }

  // Get active method config
  const methodRow = db
    .select()
    .from(rule_constants)
    .where(eq(rule_constants.key, `creation_method.${activeKey}`))
    .get();

  let activeMethodConfig: CreationMethodConfig | null = null;
  if (methodRow) {
    try {
      activeMethodConfig = JSON.parse(methodRow.value);
    } catch {
      activeMethodConfig = null;
    }
  }

  return { activeKey, activeMethodConfig, startingFunds };
}

/**
 * Helper to process image data:
 * If dataUrl, write to data/images/user/<ulid>.png and create image record.
 */
export function saveBase64Image(dataUrl: string): { imageId: string; imagePath: string } | null {
  try {
    const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
    if (!matches) return null;
    const extRaw = matches[1].toLowerCase();
    const ext = extRaw === 'jpeg' ? 'jpg' : extRaw;
    if (!['png', 'jpg', 'webp'].includes(ext)) return null;

    const buffer = Buffer.from(matches[2], 'base64');
    if (buffer.length > 10 * 1024 * 1024) return null; // 10MB limit

    const userDir = path.join(getImagesDir(), 'user');
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    const imageId = generateUlid();
    const fileName = `${imageId}.${ext}`;
    const filePath = path.join(userDir, fileName);
    fs.writeFileSync(filePath, buffer);

    const relativePath = path.join('user', fileName);
    db.insert(images)
      .values({
        id: imageId,
        path: relativePath,
        origin: 'user',
        license: 'user',
        visibility: 'players',
        is_primary: false,
      })
      .run();

    return { imageId, imagePath: `/api/images/${imageId}` };
  } catch (err) {
    console.error('Failed to save base64 image:', err);
    return null;
  }
}

// ==========================================
// 1. Creation Methods & Active Settings APIs
// ==========================================

// GET /api/creation-methods
characterCreationRoutes.get('/creation-methods', async (c) => {
  const rows = db
    .select()
    .from(rule_constants)
    .where(like(rule_constants.key, 'creation_method.%'))
    .all();

  const methods: CreationMethodConfig[] = [];
  for (const r of rows) {
    try {
      methods.push(JSON.parse(r.value));
    } catch {
      // ignore parse failure
    }
  }

  const { activeKey, startingFunds } = getActiveCreationSettings();
  return c.json({
    methods,
    active_method: activeKey,
    starting_funds: startingFunds,
  });
});

// PUT /api/creation-methods/:key (GM only)
characterCreationRoutes.put('/creation-methods/:key', requireGm, async (c) => {
  const key = c.req.param('key');
  const body = await c.req.json();
  const parsed = CreationMethodConfigSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: '無効な作成方法データです', details: parsed.error.issues }, 400);
  }

  const constantKey = `creation_method.${key}`;
  const existing = db
    .select()
    .from(rule_constants)
    .where(eq(rule_constants.key, constantKey))
    .get();

  if (existing) {
    db.update(rule_constants)
      .set({ value: JSON.stringify(parsed.data) })
      .where(eq(rule_constants.key, constantKey))
      .run();
  } else {
    db.insert(rule_constants)
      .values({
        key: constantKey,
        value: JSON.stringify(parsed.data),
        note: `Custom creation method (${parsed.data.label})`,
      })
      .run();
  }

  return c.json(parsed.data);
});

// PUT /api/creation-methods-active (GM only)
characterCreationRoutes.put('/creation-methods-active', requireGm, async (c) => {
  const body = await c.req.json();
  const activeMethod = body.active_method;
  if (!activeMethod || typeof activeMethod !== 'string') {
    return c.json({ error: 'active_method が必要です' }, 400);
  }

  db.insert(app_settings)
    .values({
      key: 'creation_method_active',
      value: JSON.stringify(activeMethod),
    })
    .onConflictDoUpdate({
      target: app_settings.key,
      set: { value: JSON.stringify(activeMethod) },
    })
    .run();

  return c.json({ active_method: activeMethod });
});

// ==========================================
// 2. Character Submissions (キャラ受付) APIs
// ==========================================

// POST /api/character-submissions/image (Upload character image)
characterCreationRoutes.post('/character-submissions/image', async (c) => {
  const body = await c.req.parseBody();
  const file = body['image'];
  if (!file || !(file instanceof File)) {
    return c.json({ error: '画像ファイル (image) が必要です' }, 400);
  }

  const MAX_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    return c.json({ error: 'ファイルサイズが上限 (10MB) を超えています' }, 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length < 4) {
    return c.json({ error: '無効な画像ファイルです' }, 400);
  }

  let ext: string | null = null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    ext = 'png';
  } else if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    ext = 'jpg';
  } else if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    ext = 'webp';
  }

  if (!ext) {
    return c.json({ error: '許可されていない形式です (PNG, JPEG, WebP のみ)' }, 400);
  }

  const userDir = path.join(getImagesDir(), 'user');
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }

  const imageId = generateUlid();
  const fileName = `${imageId}.${ext}`;
  const filePath = path.join(userDir, fileName);
  fs.writeFileSync(filePath, buffer);

  const relativePath = path.join('user', fileName);
  db.insert(images)
    .values({
      id: imageId,
      path: relativePath,
      origin: 'user',
      license: 'user',
      visibility: 'players',
      is_primary: false,
    })
    .run();

  return c.json({ image_id: imageId, image_path: `/api/images/${imageId}` }, 201);
});

// POST /api/character-submissions (Submit draft from phone or client)
characterCreationRoutes.post('/character-submissions', async (c) => {
  const body = await c.req.json();
  const draft: CharacterDraft = body.character;
  if (!draft || !draft.name || !draft.role || !draft.stats) {
    return c.json({ error: 'キャラクターの基本データ（名前・ロール・能力値）が不足しています' }, 400);
  }

  let imagePath = draft.image_path || null;
  if (imagePath && imagePath.startsWith('data:image/')) {
    const saved = saveBase64Image(imagePath);
    if (saved) {
      imagePath = saved.imagePath;
      draft.image_path = imagePath;
    }
  }

  const { activeKey, activeMethodConfig, startingFunds } = getActiveCreationSettings();
  const createdWith = body.created_with || {
    method: activeKey,
    starting_funds: startingFunds,
  };

  const validationResults = validateCharacterDraft(
    draft,
    activeMethodConfig,
    createdWith.starting_funds,
  );

  const submissionId = generateUlid();
  const now = Date.now();

  db.insert(character_submissions)
    .values({
      id: submissionId,
      source: body.source === 'file' ? 'file' : 'wifi',
      status: 'pending',
      name: draft.name.trim(),
      role: draft.role.trim(),
      image_path: imagePath,
      character_data: JSON.stringify(draft),
      created_with: JSON.stringify(createdWith),
      validation_results: JSON.stringify(validationResults),
      rejection_comment: null,
      accepted_character_id: null,
      created_at: now,
      updated_at: now,
    })
    .run();

  return c.json(
    {
      id: submissionId,
      status: 'pending',
      validation_results: validationResults,
    },
    201,
  );
});

// GET /api/character-submissions (GM lists submissions)
characterCreationRoutes.get('/character-submissions', requireGm, async (c) => {
  const rows = db
    .select()
    .from(character_submissions)
    .orderBy(desc(character_submissions.created_at))
    .all();

  const submissions = rows.map((r) => ({
    id: r.id,
    source: r.source,
    status: r.status,
    name: r.name,
    role: r.role,
    image_path: r.image_path,
    character_data: JSON.parse(r.character_data),
    created_with: JSON.parse(r.created_with),
    validation_results: JSON.parse(r.validation_results),
    rejection_comment: r.rejection_comment,
    accepted_character_id: r.accepted_character_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  return c.json({ submissions });
});

// GET /api/character-submissions/:id (Single submission check)
characterCreationRoutes.get('/character-submissions/:id', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: '受付IDが必要です' }, 400);
  const r = db
    .select()
    .from(character_submissions)
    .where(eq(character_submissions.id, id))
    .get();

  if (!r) {
    return c.json({ error: '受付データが見つかりません' }, 404);
  }

  return c.json({
    id: r.id,
    source: r.source,
    status: r.status,
    name: r.name,
    role: r.role,
    image_path: r.image_path,
    character_data: JSON.parse(r.character_data),
    created_with: JSON.parse(r.created_with),
    validation_results: JSON.parse(r.validation_results),
    rejection_comment: r.rejection_comment,
    accepted_character_id: r.accepted_character_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
  });
});

// POST /api/character-submissions/:id/accept (GM accepts submission -> creates character)
characterCreationRoutes.post('/character-submissions/:id/accept', requireGm, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: '受付IDが必要です' }, 400);
  const sub = db
    .select()
    .from(character_submissions)
    .where(eq(character_submissions.id, id))
    .get();

  if (!sub) {
    return c.json({ error: '受付データが見つかりません' }, 404);
  }

  const draft: CharacterDraft = JSON.parse(sub.character_data);
  const createdWith = JSON.parse(sub.created_with);
  const valResult = validateCharacterDraft(
    draft,
    null,
    createdWith.starting_funds,
  );

  const charId = generateUlid();
  const now = Date.now();

  // Calculate HP, Humanity, EMP
  const bodyStat = draft.stats.body ?? 6;
  const willStat = draft.stats.will ?? 6;
  const hpMax = 10 + 5 * Math.ceil((bodyStat + willStat) / 2);

  const humanity = valResult.humanity.currentHumanity;
  const empMax = valResult.humanity.currentEmp;

  // Initial funds calculation
  const totalSpent = valResult.funds.totalSpent;
  let remainingEb = 0;
  if (createdWith.starting_funds !== null && createdWith.starting_funds !== undefined) {
    remainingEb = Math.max(0, createdWith.starting_funds - totalSpent);
  }

  // Find image_id if image_path is /api/images/:id
  let imageId: string | null = null;
  if (sub.image_path) {
    const match = sub.image_path.match(/\/api\/images\/([a-zA-Z0-9_-]+)/);
    if (match) {
      imageId = match[1];
    }
  }

  // Format inventory with entry_ids
  const formattedInventory = (draft.inventory || []).map((item) => ({
    entry_id: generateUlid(),
    item_id: item.item_id,
    name: item.name,
    qty: item.qty ?? 1,
    equipped: true,
  }));

  // Format cyberware
  const formattedCyberware = (draft.cyberware || []).map((cw) => ({
    item_id: cw.item_id,
    name: cw.name,
    type: cw.type,
    static_loss: cw.static_loss ?? 0,
  }));

  // Insert character
  db.insert(characters)
    .values({
      id: charId,
      kind: 'pc',
      name: draft.name.trim(),
      role: draft.role.trim(),
      image_id: imageId,
      stats: JSON.stringify(draft.stats),
      skills: JSON.stringify(draft.skills || {}),
      hp: hpMax,
      hp_max: hpMax,
      sp_head: 0,
      sp_body: 0,
      humanity,
      emp_max: empMax,
      cyberware: JSON.stringify(formattedCyberware),
      weapons: JSON.stringify([]),
      inventory: JSON.stringify(formattedInventory),
      status: JSON.stringify([]),
      crit_injuries: JSON.stringify([]),
      eb: remainingEb,
      notes_gm: null,
      created_at: now,
      updated_at: now,
    })
    .run();

  // Log starting funds
  if (createdWith.starting_funds !== null && createdWith.starting_funds !== undefined) {
    db.insert(money_log)
      .values({
        id: generateUlid(),
        character_id: charId,
        amount: remainingEb,
        reason: '開始資金',
        balance_after: remainingEb,
        at: now,
      })
      .run();
  }

  // Update submission status
  db.update(character_submissions)
    .set({
      status: 'accepted',
      accepted_character_id: charId,
      updated_at: now,
    })
    .where(eq(character_submissions.id, id))
    .run();

  triggerAutoSave('Character submission accepted');

  return c.json({ ok: true, character_id: charId });
});

// POST /api/character-submissions/:id/reject (GM rejects submission with comment)
characterCreationRoutes.post('/character-submissions/:id/reject', requireGm, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: '受付IDが必要です' }, 400);
  const body = await c.req.json();
  const comment = String(body.comment || '').trim();

  const sub = db
    .select()
    .from(character_submissions)
    .where(eq(character_submissions.id, id))
    .get();

  if (!sub) {
    return c.json({ error: '受付データが見つかりません' }, 404);
  }

  const now = Date.now();
  db.update(character_submissions)
    .set({
      status: 'rejected',
      rejection_comment: comment || 'GMにより差し戻されました',
      updated_at: now,
    })
    .where(eq(character_submissions.id, id))
    .run();

  return c.json({ ok: true });
});

// POST /api/character-submissions/import (GM imports .cpgm file)
characterCreationRoutes.post('/character-submissions/import', requireGm, async (c) => {
  const body = await c.req.json();
  const parsed = CpgmCharacterFileSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: '無効な .cpgm キャラクターファイルです', details: parsed.error.issues }, 400);
  }

  const fileData = parsed.data;
  const draft = fileData.character;

  let imagePath = draft.image_path || null;
  if (imagePath && imagePath.startsWith('data:image/')) {
    const saved = saveBase64Image(imagePath);
    if (saved) {
      imagePath = saved.imagePath;
      draft.image_path = imagePath;
    }
  }

  const { activeMethodConfig } = getActiveCreationSettings();
  const validationResults = validateCharacterDraft(
    draft,
    activeMethodConfig,
    fileData.created_with.starting_funds,
  );

  const submissionId = generateUlid();
  const now = Date.now();

  db.insert(character_submissions)
    .values({
      id: submissionId,
      source: 'file',
      status: 'pending',
      name: draft.name.trim(),
      role: draft.role.trim(),
      image_path: imagePath,
      character_data: JSON.stringify(draft),
      created_with: JSON.stringify(fileData.created_with),
      validation_results: JSON.stringify(validationResults),
      rejection_comment: null,
      accepted_character_id: null,
      created_at: now,
      updated_at: now,
    })
    .run();

  const created = db
    .select()
    .from(character_submissions)
    .where(eq(character_submissions.id, submissionId))
    .get();

  return c.json(
    {
      ...created,
      character_data: JSON.parse(created!.character_data),
      created_with: JSON.parse(created!.created_with),
      validation_results: JSON.parse(created!.validation_results),
    },
    201,
  );
});
