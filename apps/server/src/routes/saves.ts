import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db, sqlite } from '../db/client.js';
import {
  saves,
  characters,
  players,
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
  boards,
  board_objects,
  board_tokens,
  board_drops,
  scenarios,
  scenario_versions,
  scenes,
  scene_links,
  scene_choices,
  clues,
  handouts,
  encounters,
  random_tables,
  scenario_sessions,
  session_log,
  story_checks,
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
  // テストと E2E は SAVES_DIR で一時フォルダを使う（本番の data/saves に書かない）
  const dir = process.env.SAVES_DIR ? path.resolve(process.env.SAVES_DIR) : path.join(getProjectRoot(), 'data', 'saves');
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

  const boardRows = db.select().from(boards).all().map((b) => ({
    ...b,
    grid: JSON.parse(b.grid || '{}'),
  }));
  const objectRows = db.select().from(board_objects).all();
  const tokenRows = db.select().from(board_tokens).all();
  const dropRows = db.select().from(board_drops).all().map((d) => ({
    ...d,
    inventory_entry: JSON.parse(d.inventory_entry || '{}'),
  }));

  const scenarioRows = db.select().from(scenarios).all();
  const versionRows = db.select().from(scenario_versions).all();
  const sceneRows = db.select().from(scenes).all();
  const linkRows = db.select().from(scene_links).all();
  const choiceRows = db.select().from(scene_choices).all();
  const clueRows = db.select().from(clues).all();
  const handoutRows = db.select().from(handouts).all();
  const encounterRows = db.select().from(encounters).all();
  const randomTableRows = db.select().from(random_tables).all();
  const sessionRows = db.select().from(scenario_sessions).all();
  const logRowsSession = db.select().from(session_log).all();
  const checkRows = db.select().from(story_checks).all();

  return {
    format: 'cpgm-save',
    version: 6,
    savedAt: Date.now(),
    name,
    characters: chars,
    players: db.select().from(players).all(),
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
    boards: boardRows,
    board_objects: objectRows,
    board_tokens: tokenRows,
    board_drops: dropRows,
    scenarios: scenarioRows,
    scenario_versions: versionRows,
    scenes: sceneRows,
    scene_links: linkRows,
    scene_choices: choiceRows,
    clues: clueRows,
    handouts: handoutRows,
    encounters: encounterRows,
    random_tables: randomTableRows,
    scenario_sessions: sessionRows,
    session_log: logRowsSession,
    story_checks: checkRows,
    item_notes: sqlite
      .prepare(
        'SELECT fvtt_id, effect_ja, flavor_ja FROM items WHERE fvtt_id IS NOT NULL AND (effect_is_draft = 0 OR flavor_is_draft = 0) AND (effect_ja IS NOT NULL OR flavor_ja IS NOT NULL)',
      )
      .all() as Array<{ fvtt_id: string; effect_ja: string | null; flavor_ja: string | null }>,
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
    // GM が書き換えた品目の効果とフレーバー（品目そのものは保存ファイルに入れない）
    const restoreNote = sqlite.prepare(
      'UPDATE items SET effect_ja = ?, flavor_ja = ?, effect_is_draft = 0, flavor_is_draft = 0 WHERE fvtt_id = ?',
    );
    for (const n of (data.item_notes ?? []) as Array<{ fvtt_id: string; effect_ja: string | null; flavor_ja: string | null }>) {
      restoreNote.run(n.effect_ja, n.flavor_ja, n.fvtt_id);
    }

    // Clear existing characters and logs
    sqlite.prepare('DELETE FROM money_log').run();
    sqlite.prepare('DELETE FROM char_log').run();
    sqlite.prepare('DELETE FROM characters').run();
    sqlite.prepare('DELETE FROM players').run();
    const insertPlayer = sqlite.prepare('INSERT INTO players (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)');
    for (const pl of data.players ?? []) {
      insertPlayer.run(pl.id, pl.name, pl.created_at, pl.updated_at);
    }

    // Insert restored characters
    const insertChar = sqlite.prepare(`
      INSERT INTO characters (
        id, kind, name, role, image_id, stats, skills, hp, hp_max,
        sp_head, sp_body, humanity, emp_max, cyberware, weapons,
        inventory, status, crit_injuries, eb, notes_gm, created_at, updated_at, portrait_image_id,
        player_id, scenario_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        (ch as { portrait_image_id?: string | null }).portrait_image_id ?? null,
        ch.player_id ?? null,
        null, // scenario_id はシナリオを戻したあとで入れる（下）
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

    // Restore board and combat tables (version 4)
    sqlite.prepare('DELETE FROM combat_log').run();
    sqlite.prepare('DELETE FROM combat_participants').run();
    sqlite.prepare('DELETE FROM combats').run();
    sqlite.prepare('DELETE FROM board_drops').run();
    sqlite.prepare('DELETE FROM board_tokens').run();
    sqlite.prepare('DELETE FROM board_objects').run();
    sqlite.prepare('DELETE FROM boards').run();

    if (data.boards && (data.boards as any[]).length > 0) {
      const insertBoard = sqlite.prepare(`
        INSERT INTO boards (id, name, background_image_id, grid, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const b of data.boards as any[]) {
        insertBoard.run(
          b.id,
          b.name,
          b.background_image_id ?? null,
          typeof b.grid === 'string' ? b.grid : JSON.stringify(b.grid || {}),
          b.created_at,
          b.updated_at,
        );
      }
    }

    if (data.board_objects && (data.board_objects as any[]).length > 0) {
      const insertObj = sqlite.prepare(`
        INSERT INTO board_objects (
          id, board_id, kind, label, x, y, w, h, rotation, passable, blocks_los, cover_hp, cover_hp_max
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const o of data.board_objects as any[]) {
        insertObj.run(
          o.id,
          o.board_id,
          o.kind,
          o.label,
          o.x,
          o.y,
          o.w,
          o.h,
          o.rotation ?? 0,
          o.passable ? 1 : 0,
          o.blocks_los || 'none',
          o.cover_hp ?? null,
          o.cover_hp_max ?? null,
        );
      }
    }

    if (data.board_tokens && (data.board_tokens as any[]).length > 0) {
      const insertToken = sqlite.prepare(`
        INSERT INTO board_tokens (id, board_id, character_id, x, y, gm_only)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const t of data.board_tokens as any[]) {
        insertToken.run(
          t.id,
          t.board_id,
          t.character_id ?? null,
          t.x,
          t.y,
          t.gm_only ? 1 : 0,
        );
      }
    }

    if (data.board_drops && (data.board_drops as any[]).length > 0) {
      const insertDrop = sqlite.prepare(`
        INSERT INTO board_drops (id, board_id, x, y, inventory_entry, from_character_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const d of data.board_drops as any[]) {
        insertDrop.run(
          d.id,
          d.board_id,
          d.x,
          d.y,
          typeof d.inventory_entry === 'string' ? d.inventory_entry : JSON.stringify(d.inventory_entry || {}),
          d.from_character_id ?? null,
        );
      }
    }

    if (data.combats && data.combats.length > 0) {
      const insertCombat = sqlite.prepare(`
        INSERT INTO combats (id, board_id, status, round, turn_index, settings, created_at, ended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const cb of data.combats as any[]) {
        insertCombat.run(
          cb.id,
          cb.board_id ?? null,
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

    // Restore scenario tables (version 5 & 6)
    sqlite.prepare('DELETE FROM story_checks').run();
    sqlite.prepare('DELETE FROM session_log').run();
    sqlite.prepare('DELETE FROM scenario_sessions').run();
    sqlite.prepare('DELETE FROM random_tables').run();
    sqlite.prepare('DELETE FROM encounters').run();
    sqlite.prepare('DELETE FROM handouts').run();
    sqlite.prepare('DELETE FROM clues').run();
    sqlite.prepare('DELETE FROM scene_choices').run();
    sqlite.prepare('DELETE FROM scene_links').run();
    sqlite.prepare('DELETE FROM scenes').run();
    sqlite.prepare('DELETE FROM scenario_versions').run();
    sqlite.prepare('DELETE FROM scenarios').run();

    if (data.scenarios && (data.scenarios as any[]).length > 0) {
      const insertScenario = sqlite.prepare(`
        INSERT INTO scenarios (id, title, summary, meta, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const sc of data.scenarios as any[]) {
        insertScenario.run(
          sc.id,
          sc.title,
          sc.summary ?? '',
          typeof sc.meta === 'string' ? sc.meta : JSON.stringify(sc.meta || {}),
          sc.version ?? 1,
          sc.created_at,
          sc.updated_at,
        );
      }
    }

    if (data.scenario_versions && (data.scenario_versions as any[]).length > 0) {
      const insertVer = sqlite.prepare(`
        INSERT INTO scenario_versions (id, scenario_id, version, snapshot, saved_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const sv of data.scenario_versions as any[]) {
        insertVer.run(
          sv.id,
          sv.scenario_id,
          sv.version,
          typeof sv.snapshot === 'string' ? sv.snapshot : JSON.stringify(sv.snapshot || {}),
          sv.saved_at,
        );
      }
    }

    if (data.scenes && (data.scenes as any[]).length > 0) {
      const insertScene = sqlite.prepare(`
        INSERT INTO scenes (id, scenario_id, title, read_aloud, gm_notes, location, npc_ids, position, background_image_id, board_id, sort_index, is_adhoc, stage, bgm)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const s of data.scenes as any[]) {
        insertScene.run(
          s.id,
          s.scenario_id,
          s.title,
          s.read_aloud ?? '',
          s.gm_notes ?? '',
          s.location ?? '',
          typeof s.npc_ids === 'string' ? s.npc_ids : JSON.stringify(s.npc_ids || []),
          typeof s.position === 'string' ? s.position : JSON.stringify(s.position || { x: 100, y: 100 }),
          s.background_image_id ?? null,
          s.board_id ?? null,
          s.sort_index ?? 0,
          s.is_adhoc ? 1 : 0,
          typeof s.stage === 'string' ? s.stage : JSON.stringify(s.stage ?? {}),
          s.bgm == null ? null : typeof s.bgm === 'string' ? s.bgm : JSON.stringify(s.bgm),
        );
      }
    }

    if (data.scene_links && (data.scene_links as any[]).length > 0) {
      const insertLink = sqlite.prepare(`
        INSERT INTO scene_links (id, scenario_id, from_scene_id, to_scene_id, condition)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const l of data.scene_links as any[]) {
        insertLink.run(
          l.id,
          l.scenario_id,
          l.from_scene_id,
          l.to_scene_id,
          l.condition ?? '',
        );
      }
    }

    if (data.scene_choices && (data.scene_choices as any[]).length > 0) {
      const insertChoice = sqlite.prepare(`
        INSERT INTO scene_choices (id, scene_id, label, skill_key, dv, who, on_success, on_failure, sort_index)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const c of data.scene_choices as any[]) {
        insertChoice.run(
          c.id,
          c.scene_id,
          c.label,
          c.skill_key ?? null,
          c.dv ?? null,
          c.who ?? '全員',
          typeof c.on_success === 'string' ? c.on_success : JSON.stringify(c.on_success || []),
          typeof c.on_failure === 'string' ? c.on_failure : JSON.stringify(c.on_failure || []),
          c.sort_index ?? 0,
        );
      }
    }

    if (data.clues && (data.clues as any[]).length > 0) {
      const insertClue = sqlite.prepare(`
        INSERT INTO clues (id, scenario_id, scene_id, title, body, image_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const cl of data.clues as any[]) {
        insertClue.run(
          cl.id,
          cl.scenario_id,
          cl.scene_id ?? null,
          cl.title,
          cl.body ?? '',
          cl.image_id ?? null,
        );
      }
    }

    if (data.handouts && (data.handouts as any[]).length > 0) {
      const insertHandout = sqlite.prepare(`
        INSERT INTO handouts (id, scenario_id, scene_id, title, body, image_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const h of data.handouts as any[]) {
        insertHandout.run(
          h.id,
          h.scenario_id,
          h.scene_id ?? null,
          h.title,
          h.body ?? '',
          h.image_id ?? null,
        );
      }
    }

    if (data.encounters && (data.encounters as any[]).length > 0) {
      const insertEncounter = sqlite.prepare(`
        INSERT INTO encounters (id, scenario_id, scene_id, title, participants, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const e of data.encounters as any[]) {
        insertEncounter.run(
          e.id,
          e.scenario_id,
          e.scene_id ?? null,
          e.title,
          typeof e.participants === 'string' ? e.participants : JSON.stringify(e.participants || []),
          e.notes ?? '',
        );
      }
    }

    if (data.random_tables && (data.random_tables as any[]).length > 0) {
      const insertTable = sqlite.prepare(`
        INSERT INTO random_tables (id, scenario_id, title, dice, rows)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const rt of data.random_tables as any[]) {
        insertTable.run(
          rt.id,
          rt.scenario_id ?? null,
          rt.title,
          rt.dice,
          typeof rt.rows === 'string' ? rt.rows : JSON.stringify(rt.rows || []),
        );
      }
    }

    if (data.scenario_sessions && (data.scenario_sessions as any[]).length > 0) {
      const insertSession = sqlite.prepare(`
        INSERT INTO scenario_sessions (id, scenario_id, current_scene_id, started_at, ended_at, revealed)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const ss of data.scenario_sessions as any[]) {
        insertSession.run(
          ss.id,
          ss.scenario_id,
          ss.current_scene_id ?? null,
          ss.started_at,
          ss.ended_at ?? null,
          typeof ss.revealed === 'string' ? ss.revealed : JSON.stringify(ss.revealed || { clue_ids: [], handout_ids: [] }),
        );
      }
    }

    // キャラのシナリオの縛り（Phase 5i）。シナリオを入れ直したあとでないと外部キーに引っかかる
    const setCharScenario = sqlite.prepare('UPDATE characters SET scenario_id = ? WHERE id = ? AND EXISTS (SELECT 1 FROM scenarios WHERE id = ?)');
    for (const ch of data.characters) {
      if (ch.scenario_id) setCharScenario.run(ch.scenario_id, ch.id, ch.scenario_id);
    }

    if (data.session_log && (data.session_log as any[]).length > 0) {
      const insertSLog = sqlite.prepare(`
        INSERT INTO session_log (id, scenario_session_id, at, kind, text, ref)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const sl of data.session_log as any[]) {
        insertSLog.run(
          sl.id,
          sl.scenario_session_id,
          sl.at,
          sl.kind,
          sl.text,
          typeof sl.ref === 'string' ? sl.ref : sl.ref ? JSON.stringify(sl.ref) : null,
        );
      }
    }

    if (data.story_checks && (data.story_checks as any[]).length > 0) {
      const insertCheck = sqlite.prepare(`
        INSERT INTO story_checks (id, scenario_session_id, scene_id, choice_id, actor_character_id, skill_key, dv, opposed, rolls, result, applied_log_id, action_label)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const sc of data.story_checks as any[]) {
        insertCheck.run(
          sc.id,
          sc.scenario_session_id,
          sc.scene_id ?? null,
          sc.choice_id ?? null,
          sc.actor_character_id,
          sc.skill_key ?? null,
          sc.dv ?? null,
          typeof sc.opposed === 'string' ? sc.opposed : sc.opposed ? JSON.stringify(sc.opposed) : null,
          typeof sc.rolls === 'string' ? sc.rolls : JSON.stringify(sc.rolls || []),
          sc.result ?? null,
          sc.applied_log_id ?? null,
          sc.action_label ?? null,
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
