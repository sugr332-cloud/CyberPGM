import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db, sqlite } from '../db/client.js';
import {
  saves,
  characters,
  money_log,
  char_log,
  app_settings,
  shops,
  shop_stock,
  transactions,
  character_submissions,
  skill_notes,
  combats,
  combat_participants,
  combat_log,
} from '../db/schema.js';
import { requireGm } from '../auth.js';
import { sessionManager } from '../session.js';
import {
  SaveCreateInputSchema,
  SaveUpdateInputSchema,
  SaveFileSchema,
  generateUlid,
  getProjectRoot,
  SaveFile,
} from '@cyberpgm/shared';
import { formatCharacterRow } from '../character-helper.js';

export const savesRoutes = new Hono();

export function getSavesDir(): string {
  const root = getProjectRoot();
  const dir = path.join(root, 'data', 'saves');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Collects current snapshot data to construct a SaveFile object.
 */
export function buildSaveData(name: string): SaveFile {
  const charRows = db.select().from(characters).all();
  const chars = charRows.map((r) => formatCharacterRow(r, null));

  const moneyLogs = db.select().from(money_log).all();
  const charLogs = db.select().from(char_log).all();

  const settingsRows = db.select().from(app_settings).all();
  const settingsObj: Record<string, unknown> = {};
  for (const s of settingsRows) {
    try {
      settingsObj[s.key] = JSON.parse(s.value);
    } catch {
      settingsObj[s.key] = s.value;
    }
  }

  const shopsRows = db.select().from(shops).all().map((s) => ({
    ...s,
    categories: JSON.parse(s.categories || '[]') as string[],
  }));
  const stockRows = db.select().from(shop_stock).all();
  const txRows = db.select().from(transactions).all().map((t) => ({
    ...t,
    lines: JSON.parse(t.lines || '[]'),
  }));
  const subRows = db.select().from(character_submissions).all();
  const notesRows = db.select().from(skill_notes).all();
  const combatRows = db.select().from(combats).all();
  const participantRows = db.select().from(combat_participants).all();
  const logRows = db.select().from(combat_log).all();

  return {
    format: 'cpgm-save',
    version: 3,
    savedAt: Date.now(),
    name,
    characters: chars,
    money_log: moneyLogs,
    char_log: charLogs,
    app_settings: settingsObj,
    shops: shopsRows,
    shop_stock: stockRows,
    transactions: txRows.map((t) => ({ ...t, kind: t.kind as 'buy' | 'sell' })),
    character_submissions: subRows,
    skill_notes: notesRows,
    combats: combatRows,
    combat_participants: participantRows,
    combat_log: logRows,
  };
}

/**
 * Triggers an auto-save (kind = 'auto'). Overwrites existing auto-save entry.
 */
export function triggerAutoSave(summaryReason?: string): void {
  try {
    const savesDir = getSavesDir();
    const fileName = 'auto.cpgm-save';
    const filePath = path.join(savesDir, fileName);

    const saveData = buildSaveData('自動保存');
    fs.writeFileSync(filePath, JSON.stringify(saveData, null, 2), 'utf-8');

    const now = Date.now();
    const summary = summaryReason || `PC ${saveData.characters.length} 人, ログ ${saveData.money_log.length} 件`;

    const existingAuto = db
      .select()
      .from(saves)
      .where(eq(saves.kind, 'auto'))
      .get();

    if (existingAuto) {
      db.update(saves)
        .set({
          name: '自動保存',
          summary,
          file: fileName,
          updated_at: now,
        })
        .where(eq(saves.id, existingAuto.id))
        .run();
    } else {
      db.insert(saves)
        .values({
          id: generateUlid(),
          name: '自動保存',
          kind: 'auto',
          summary,
          file: fileName,
          created_at: now,
          updated_at: now,
        })
        .run();
    }
  } catch (err) {
    console.error('[saves] Auto-save failed:', err);
  }
}

// Start 5-minute periodic auto-save
setInterval(() => {
  triggerAutoSave('定期自動保存 (5分)');
}, 5 * 60 * 1000);

/**
 * GET /api/saves: List all saves.
 */
savesRoutes.get('/', requireGm, async (c) => {
  const rows = db.select().from(saves).orderBy(desc(saves.updated_at)).all();
  return c.json({ saves: rows });
});

/**
 * POST /api/saves: Create a named save.
 */
savesRoutes.post('/', requireGm, async (c) => {
  const body = await c.req.json();
  const parsed = SaveCreateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const id = generateUlid();
  const fileName = `${id}.cpgm-save`;
  const filePath = path.join(getSavesDir(), fileName);

  const saveData = buildSaveData(parsed.data.name);
  fs.writeFileSync(filePath, JSON.stringify(saveData, null, 2), 'utf-8');

  const now = Date.now();
  const summary = `PC ${saveData.characters.length} 人, 資金ログ ${saveData.money_log.length} 件`;

  db.insert(saves)
    .values({
      id,
      name: parsed.data.name,
      kind: 'manual',
      summary,
      file: fileName,
      created_at: now,
      updated_at: now,
    })
    .run();

  const created = db.select().from(saves).where(eq(saves.id, id)).get();
  return c.json({ save: created }, 201);
});

/**
 * PUT /api/saves/:id: Overwrite an existing save with current state.
 */
savesRoutes.put('/:id', requireGm, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing save ID' }, 400);
  const existing = db.select().from(saves).where(eq(saves.id, id)).get();
  if (!existing) {
    return c.json({ error: 'Save not found' }, 404);
  }

  const filePath = path.join(getSavesDir(), existing.file);
  const saveData = buildSaveData(existing.name);
  fs.writeFileSync(filePath, JSON.stringify(saveData, null, 2), 'utf-8');

  const now = Date.now();
  const summary = `PC ${saveData.characters.length} 人, 資金ログ ${saveData.money_log.length} 件`;

  db.update(saves)
    .set({
      summary,
      updated_at: now,
    })
    .where(eq(saves.id, id))
    .run();

  const updated = db.select().from(saves).where(eq(saves.id, id)).get();
  return c.json({ save: updated });
});

/**
 * POST /api/saves/:id/load: Loads a save file.
 */
savesRoutes.post('/:id/load', requireGm, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing save ID' }, 400);
  const existing = db.select().from(saves).where(eq(saves.id, id)).get();
  if (!existing) {
    return c.json({ error: 'Save not found' }, 404);
  }

  const filePath = path.join(getSavesDir(), existing.file);
  if (!fs.existsSync(filePath)) {
    return c.json({ error: 'Save file missing on disk' }, 404);
  }

  let rawJson: unknown;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    rawJson = JSON.parse(content);
  } catch {
    return c.json({ error: 'Corrupted save file JSON' }, 400);
  }

  const parsed = SaveFileSchema.safeParse(rawJson);
  if (!parsed.success) {
    return c.json({ error: 'Invalid save file format', details: parsed.error.issues }, 400);
  }

  const data = parsed.data;

  // 1. Auto-save current state before loading!
  triggerAutoSave(`読み込み前の退避 (${existing.name} の前)`);

  // 2. Perform restore inside a single SQLite transaction
  const restoreTransaction = sqlite.transaction(() => {
    // Clear existing characters and logs
    sqlite.prepare('DELETE FROM money_log').run();
    sqlite.prepare('DELETE FROM char_log').run();
    sqlite.prepare('DELETE FROM characters').run();

    // Insert restored characters
    const insertChar = sqlite.prepare(`
      INSERT INTO characters (
        id, kind, name, role, image_id, stats, skills, hp, hp_max,
        sp_head, sp_body, humanity, emp_max, cyberware, weapons,
        inventory, status, crit_injuries, eb, notes_gm, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const ch of data.characters) {
      insertChar.run(
        ch.id,
        ch.kind,
        ch.name,
        ch.role,
        ch.image_id ?? null,
        JSON.stringify(ch.stats),
        JSON.stringify(ch.skills),
        ch.hp,
        ch.hp_max,
        ch.sp_head,
        ch.sp_body,
        ch.humanity,
        ch.emp_max,
        JSON.stringify(ch.cyberware),
        JSON.stringify(ch.weapons),
        JSON.stringify(ch.inventory),
        JSON.stringify(ch.status),
        JSON.stringify(ch.crit_injuries),
        ch.eb,
        ch.notes_gm ?? null,
        ch.created_at,
        ch.updated_at,
      );
    }

    // Insert restored money logs
    const insertMoney = sqlite.prepare(`
      INSERT INTO money_log (id, character_id, amount, reason, balance_after, at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const m of data.money_log) {
      insertMoney.run(m.id, m.character_id, m.amount, m.reason, m.balance_after, m.at);
    }

    // Insert restored char logs
    const insertCharLog = sqlite.prepare(`
      INSERT INTO char_log (id, character_id, text, at)
      VALUES (?, ?, ?, ?)
    `);
    for (const cl of data.char_log) {
      insertCharLog.run(cl.id, cl.character_id, cl.text, cl.at);
    }

    // Restore app settings if present
    const insertSetting = sqlite.prepare(`
      INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)
    `);
    for (const [k, v] of Object.entries(data.app_settings)) {
      insertSetting.run(k, JSON.stringify(v));
    }

    // Clear and restore shops, shop_stock, and transactions
    sqlite.prepare('DELETE FROM shop_stock').run();
    sqlite.prepare('DELETE FROM transactions').run();
    sqlite.prepare('DELETE FROM shops').run();

    if (data.shops && data.shops.length > 0) {
      const insertShop = sqlite.prepare(`
        INSERT INTO shops (id, name, price_multiplier, buyback_rate, categories, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const s of data.shops) {
        insertShop.run(
          s.id,
          s.name,
          s.price_multiplier,
          s.buyback_rate,
          JSON.stringify(s.categories || []),
          s.created_at,
          s.updated_at,
        );
      }
    }

    if (data.shop_stock && data.shop_stock.length > 0) {
      const insertStock = sqlite.prepare(`
        INSERT INTO shop_stock (id, shop_id, item_id, quantity)
        VALUES (?, ?, ?, ?)
      `);
      for (const st of data.shop_stock) {
        insertStock.run(st.id, st.shop_id, st.item_id, st.quantity ?? null);
      }
    }

    if (data.transactions && data.transactions.length > 0) {
      const insertTx = sqlite.prepare(`
        INSERT INTO transactions (id, character_id, shop_id, kind, lines, total_eb, at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const t of data.transactions) {
        insertTx.run(
          t.id,
          t.character_id,
          t.shop_id ?? null,
          t.kind,
          JSON.stringify(t.lines || []),
          t.total_eb,
          t.at,
        );
      }
    }

    // Restore character submissions
    sqlite.prepare('DELETE FROM character_submissions').run();
    if (data.character_submissions && data.character_submissions.length > 0) {
      const insertSub = sqlite.prepare(`
        INSERT INTO character_submissions (
          id, source, status, name, role, image_path, character_data,
          created_with, validation_results, rejection_comment, accepted_character_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const cs of data.character_submissions as any[]) {
        insertSub.run(
          cs.id,
          cs.source,
          cs.status,
          cs.name,
          cs.role,
          cs.image_path ?? null,
          typeof cs.character_data === 'string' ? cs.character_data : JSON.stringify(cs.character_data),
          typeof cs.created_with === 'string' ? cs.created_with : JSON.stringify(cs.created_with),
          typeof cs.validation_results === 'string' ? cs.validation_results : JSON.stringify(cs.validation_results),
          cs.rejection_comment ?? null,
          cs.accepted_character_id ?? null,
          cs.created_at,
          cs.updated_at,
        );
      }
    }

    // Restore skill notes
    if (data.skill_notes && data.skill_notes.length > 0) {
      const insertNote = sqlite.prepare(`
        INSERT OR REPLACE INTO skill_notes (key, text, updated_at) VALUES (?, ?, ?)
      `);
      for (const sn of data.skill_notes as any[]) {
        insertNote.run(sn.key, sn.text, sn.updated_at);
      }
    }

    // Restore combat tables (version 3)
    sqlite.prepare('DELETE FROM combat_log').run();
    sqlite.prepare('DELETE FROM combat_participants').run();
    sqlite.prepare('DELETE FROM combats').run();

    if (data.combats && data.combats.length > 0) {
      const insertCombat = sqlite.prepare(`
        INSERT INTO combats (id, status, round, turn_index, settings, created_at, ended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const cb of data.combats as any[]) {
        insertCombat.run(
          cb.id,
          cb.status,
          cb.round,
          cb.turn_index,
          typeof cb.settings === 'string' ? cb.settings : JSON.stringify(cb.settings || {}),
          cb.created_at,
          cb.ended_at ?? null,
        );
      }
    }

    if (data.combat_participants && data.combat_participants.length > 0) {
      const insertPart = sqlite.prepare(`
        INSERT INTO combat_participants (
          id, combat_id, character_id, side, name, initiative, initiative_roll,
          order_index, active, out, move_used, action_used, state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const cp of data.combat_participants as any[]) {
        insertPart.run(
          cp.id,
          cp.combat_id,
          cp.character_id ?? null,
          cp.side,
          cp.name,
          cp.initiative,
          typeof cp.initiative_roll === 'string' ? cp.initiative_roll : JSON.stringify(cp.initiative_roll || {}),
          cp.order_index,
          cp.active ? 1 : 0,
          cp.out ? 1 : 0,
          cp.move_used ? 1 : 0,
          cp.action_used ? 1 : 0,
          typeof cp.state === 'string' ? cp.state : JSON.stringify(cp.state || {}),
        );
      }
    }

    if (data.combat_log && data.combat_log.length > 0) {
      const insertLog = sqlite.prepare(`
        INSERT INTO combat_log (
          id, combat_id, round, actor_id, action_key, input, breakdown, changes, undone, at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const cl of data.combat_log as any[]) {
        insertLog.run(
          cl.id,
          cl.combat_id,
          cl.round,
          cl.actor_id,
          cl.action_key,
          typeof cl.input === 'string' ? cl.input : JSON.stringify(cl.input || {}),
          typeof cl.breakdown === 'string' ? cl.breakdown : JSON.stringify(cl.breakdown || {}),
          typeof cl.changes === 'string' ? cl.changes : JSON.stringify(cl.changes || []),
          cl.undone ? 1 : 0,
          cl.at,
        );
      }
    }
  });

  restoreTransaction();

  // 3. Notify all connected players
  sessionManager.updateAllCharacterSheets();

  return c.json({ success: true, loadedSave: existing.name });
});

/**
 * PATCH /api/saves/:id: Rename a save.
 */
savesRoutes.patch('/:id', requireGm, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing save ID' }, 400);
  const body = await c.req.json();
  const parsed = SaveUpdateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const existing = db.select().from(saves).where(eq(saves.id, id)).get();
  if (!existing) {
    return c.json({ error: 'Save not found' }, 404);
  }

  db.update(saves)
    .set({
      name: parsed.data.name,
      updated_at: Date.now(),
    })
    .where(eq(saves.id, id))
    .run();

  const updated = db.select().from(saves).where(eq(saves.id, id)).get();
  return c.json({ save: updated });
});

/**
 * DELETE /api/saves/:id: Delete a save.
 */
savesRoutes.delete('/:id', requireGm, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing save ID' }, 400);
  const existing = db.select().from(saves).where(eq(saves.id, id)).get();
  if (!existing) {
    return c.json({ error: 'Save not found' }, 404);
  }

  const filePath = path.join(getSavesDir(), existing.file);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }

  db.delete(saves).where(eq(saves.id, id)).run();
  return c.json({ success: true });
});

/**
 * GET /api/saves/:id/file: Download save file.
 */
savesRoutes.get('/:id/file', requireGm, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing save ID' }, 400);
  const existing = db.select().from(saves).where(eq(saves.id, id)).get();
  if (!existing) {
    return c.json({ error: 'Save not found' }, 404);
  }

  const filePath = path.join(getSavesDir(), existing.file);
  if (!fs.existsSync(filePath)) {
    return c.json({ error: 'File missing on disk' }, 404);
  }

  const content = fs.readFileSync(filePath);
  const safeAsciiName = `save-${existing.id}.cpgm-save`;
  const encodedName = encodeURIComponent(`${existing.name}.cpgm-save`);

  return new Response(content, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodedName}`,
    },
  });
});

/**
 * POST /api/saves/import: Import a save file from uploaded JSON.
 */
savesRoutes.post('/import', requireGm, async (c) => {
  let rawJson: unknown;
  try {
    const bodyText = await c.req.text();
    rawJson = JSON.parse(bodyText);
  } catch {
    return c.json({ error: 'Invalid JSON upload' }, 400);
  }

  const parsed = SaveFileSchema.safeParse(rawJson);
  if (!parsed.success) {
    return c.json({ error: 'Corrupted or invalid save file', details: parsed.error.issues }, 400);
  }

  const data = parsed.data;
  const id = generateUlid();
  const fileName = `${id}.cpgm-save`;
  const filePath = path.join(getSavesDir(), fileName);

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

  const now = Date.now();
  const summary = `PC ${data.characters.length} 人, 資金ログ ${data.money_log.length} 件 (インポート)`;

  db.insert(saves)
    .values({
      id,
      name: data.name || 'インポートしたセーブ',
      kind: 'manual',
      summary,
      file: fileName,
      created_at: now,
      updated_at: now,
    })
    .run();

  const created = db.select().from(saves).where(eq(saves.id, id)).get();
  return c.json({ save: created }, 201);
});
