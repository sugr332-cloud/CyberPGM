import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { characters, images, money_log, char_log } from '../db/schema.js';
import { requireAuth, requireGm } from '../auth.js';
import { sessionManager } from '../session.js';
import {
  formatCharacterRow,
  calculateCharacterSheet,
  getCharacterSheetById,
} from '../character-helper.js';
import {
  CharacterCreateInputSchema,
  CharacterUpdateInputSchema,
  MoneyUpdateInputSchema,
  generateUlid,
} from '@cyberpgm/shared';
import { triggerAutoSave } from './saves.js';

export const charactersRoutes = new Hono();

/**
 * GET /api/me: Returns current player's character sheet and logs.
 */
charactersRoutes.get('/me', requireAuth, async (c) => {
  const role = c.get('role');
  let charId = c.get('characterId');

  // Allow GM to inspect a character via query
  if (role === 'gm') {
    const queryCharId = c.req.query('character_id');
    if (queryCharId) {
      charId = queryCharId;
    }
  }

  if (!charId) {
    return c.json({ error: 'No character associated with this session' }, 403);
  }

  const sheet = getCharacterSheetById(charId);
  if (!sheet) {
    return c.json({ error: 'Character not found' }, 404);
  }

  // Get recent char logs (last 50)
  const logs = db
    .select()
    .from(char_log)
    .where(eq(char_log.character_id, charId))
    .orderBy(desc(char_log.at))
    .limit(50)
    .all();

  return c.json({
    sheet,
    logs,
  });
});

/**
 * GET /api/characters: List all characters (GM only).
 */
charactersRoutes.get('/characters', requireGm, async (c) => {
  const rows = db.select().from(characters).all();
  const allImages = db.select().from(images).all();
  const imageMap = new Map<string, string>();
  for (const img of allImages) {
    imageMap.set(img.id, img.path);
  }

  const list = rows.map((r) => {
    const imgPath = r.image_id ? imageMap.get(r.image_id) ?? null : null;
    const char = formatCharacterRow(r, imgPath);
    return calculateCharacterSheet(char);
  });

  return c.json({ characters: list });
});

/**
 * POST /api/characters: Create a new character (GM only).
 */
charactersRoutes.post('/characters', requireGm, async (c) => {
  const body = await c.req.json();
  const parsed = CharacterCreateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const id = generateUlid();
  const now = Date.now();
  const d = parsed.data;

  db.insert(characters)
    .values({
      id,
      kind: d.kind ?? 'pc',
      name: d.name,
      role: d.role,
      image_id: d.image_id ?? null,
      stats: JSON.stringify(d.stats),
      skills: JSON.stringify(d.skills ?? {}),
      hp: d.hp,
      hp_max: d.hp_max,
      sp_head: d.sp_head ?? 0,
      sp_body: d.sp_body ?? 0,
      humanity: d.humanity,
      emp_max: d.emp_max,
      cyberware: JSON.stringify(d.cyberware ?? []),
      weapons: JSON.stringify(d.weapons ?? []),
      inventory: JSON.stringify(d.inventory ?? []),
      status: JSON.stringify(d.status ?? []),
      crit_injuries: JSON.stringify(d.crit_injuries ?? []),
      eb: d.eb ?? 0,
      notes_gm: d.notes_gm ?? null,
      created_at: now,
      updated_at: now,
    })
    .run();

  const created = getCharacterSheetById(id);
  triggerAutoSave('Character created: ' + d.name);

  return c.json({ character: created }, 201);
});

/**
 * PATCH /api/characters/:id: Update a character (GM only).
 */
charactersRoutes.patch('/characters/:id', requireGm, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing character ID' }, 400);
  const body = await c.req.json();
  const parsed = CharacterUpdateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const existing = db.select().from(characters).where(eq(characters.id, id)).get();
  if (!existing) {
    return c.json({ error: 'Character not found' }, 404);
  }

  const now = Date.now();
  const d = parsed.data;
  const updateValues: Record<string, unknown> = {
    updated_at: now,
  };

  if (d.name !== undefined) updateValues.name = d.name;
  if (d.role !== undefined) updateValues.role = d.role;
  if (d.image_id !== undefined) updateValues.image_id = d.image_id;
  if (d.stats !== undefined) updateValues.stats = JSON.stringify(d.stats);
  if (d.skills !== undefined) updateValues.skills = JSON.stringify(d.skills);
  if (d.hp !== undefined) updateValues.hp = d.hp;
  if (d.hp_max !== undefined) updateValues.hp_max = d.hp_max;
  if (d.sp_head !== undefined) updateValues.sp_head = d.sp_head;
  if (d.sp_body !== undefined) updateValues.sp_body = d.sp_body;
  if (d.humanity !== undefined) updateValues.humanity = d.humanity;
  if (d.emp_max !== undefined) updateValues.emp_max = d.emp_max;
  if (d.cyberware !== undefined) updateValues.cyberware = JSON.stringify(d.cyberware);
  if (d.weapons !== undefined) updateValues.weapons = JSON.stringify(d.weapons);
  if (d.inventory !== undefined) updateValues.inventory = JSON.stringify(d.inventory);
  if (d.status !== undefined) updateValues.status = JSON.stringify(d.status);
  if (d.crit_injuries !== undefined) updateValues.crit_injuries = JSON.stringify(d.crit_injuries);
  if (d.eb !== undefined) updateValues.eb = d.eb;
  if (d.notes_gm !== undefined) updateValues.notes_gm = d.notes_gm;

  db.update(characters)
    .set(updateValues)
    .where(eq(characters.id, id))
    .run();

  sessionManager.updateCharacterSheet(id);
  triggerAutoSave('Character updated: ' + (d.name ?? existing.name));

  const updated = getCharacterSheetById(id);
  return c.json({ character: updated });
});

/**
 * DELETE /api/characters/:id: Delete a character (GM only).
 */
charactersRoutes.delete('/characters/:id', requireGm, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing character ID' }, 400);
  const existing = db.select().from(characters).where(eq(characters.id, id)).get();
  if (!existing) {
    return c.json({ error: 'Character not found' }, 404);
  }

  db.delete(characters).where(eq(characters.id, id)).run();
  triggerAutoSave('Character deleted: ' + existing.name);

  return c.json({ success: true });
});

/**
 * POST /api/characters/:id/money: Give or deduct funds for a character (GM only).
 */
charactersRoutes.post('/characters/:id/money', requireGm, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing character ID' }, 400);
  const body = await c.req.json();
  const parsed = MoneyUpdateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const char = db.select().from(characters).where(eq(characters.id, id)).get();
  if (!char) {
    return c.json({ error: 'Character not found' }, 404);
  }

  const { amount, reason } = parsed.data;
  const newBalance = char.eb + amount;
  const now = Date.now();

  // Update balance
  db.update(characters)
    .set({ eb: newBalance, updated_at: now })
    .where(eq(characters.id, id))
    .run();

  // Log in money_log
  const moneyLogId = generateUlid();
  db.insert(money_log)
    .values({
      id: moneyLogId,
      character_id: id,
      amount,
      reason,
      balance_after: newBalance,
      at: now,
    })
    .run();

  // Log in char_log
  const sign = amount >= 0 ? '+' : '';
  const logText = `GM から ${sign}${amount} eb — ${reason}`;
  const charLogId = generateUlid();
  db.insert(char_log)
    .values({
      id: charLogId,
      character_id: id,
      text: logText,
      at: now,
    })
    .run();

  // Notify player via WebSocket
  sessionManager.updateCharacterSheet(id);
  sessionManager.notifyCharacter(
    id,
    'money',
    `GM から ${sign}${amount} eb`,
    reason,
  );

  triggerAutoSave(`Money transaction: ${sign}${amount} eb to ${char.name}`);

  return c.json({
    balance_after: newBalance,
    amount,
    reason,
  });
});
