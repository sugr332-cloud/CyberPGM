import { Hono } from 'hono';
import { requireGm } from '../auth.js';
import { sqlite } from '../db/client.js';
import { exportToCsv, parseCsv } from '@cyberpgm/shared';

export const dbAdminRoutes = new Hono();

export const DB_ENTITIES = [
  'items',
  'weapons',
  'armors',
  'cyberwares',
  'images',
  'rule_constants',
  'import_runs',
  'players',
  'characters',
  'devices',
  'money_log',
  'char_log',
  'saves',
  'app_settings',
  'shops',
  'shop_stock',
  'transactions',
  'purchase_requests',
  'character_submissions',
  'skill_notes',
  'boards',
  'board_objects',
  'board_tokens',
  'board_drops',
  'combats',
  'combat_participants',
  'combat_log',
  'scenarios',
  'scenario_versions',
  'scenes',
  'scene_links',
  'scene_choices',
  'clues',
  'handouts',
  'encounters',
  'random_tables',
  'scenario_sessions',
  'session_log',
  'story_checks',
  'audio',
] as const;

export type DbEntityName = typeof DB_ENTITIES[number];

export interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

export interface ForeignKeyInfo {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}

export function isValidEntity(name: string | undefined): name is DbEntityName {
  if (!name) return false;
  return (DB_ENTITIES as readonly string[]).includes(name);
}

export function getTableInfo(tableName: string): ColumnInfo[] {
  return sqlite.prepare(`PRAGMA table_info("${tableName}")`).all() as ColumnInfo[];
}

export function getForeignKeyList(tableName: string): ForeignKeyInfo[] {
  return sqlite.prepare(`PRAGMA foreign_key_list("${tableName}")`).all() as ForeignKeyInfo[];
}

/**
 * Validates a single row against table columns and foreign keys.
 * Returns error messages if invalid.
 */
export function validateRow(
  tableName: string,
  row: Record<string, unknown>,
  rowIndex: number,
  cols: ColumnInfo[],
  fks: ForeignKeyInfo[],
  existingKeysInBatch?: Map<string, Set<string>>,
): string[] {
  const errors: string[] = [];
  const rowDisplay = `行 ${rowIndex + 1}`;

  for (const col of cols) {
    const val = row[col.name];
    const isMissing = val === undefined || val === null || val === '';

    // Required check: notnull is 1, no default value
    if (col.notnull === 1 && col.dflt_value === null) {
      if (isMissing) {
        errors.push(`${rowDisplay}: 必須項目 "${col.name}" が指定されていないか空です。`);
        continue;
      }
    }

    if (val !== undefined && val !== null && val !== '') {
      const typeUpper = col.type.toUpperCase();
      if (typeUpper.includes('INT')) {
        const num = Number(val);
        if (!Number.isInteger(num)) {
          errors.push(`${rowDisplay}: カラム "${col.name}" は整数である必要があります (受取値: ${String(val)})。`);
        }
      } else if (typeUpper.includes('REAL') || typeUpper.includes('NUMERIC')) {
        const num = Number(val);
        if (Number.isNaN(num)) {
          errors.push(`${rowDisplay}: カラム "${col.name}" は数値である必要があります (受取値: ${String(val)})。`);
        }
      }
    }
  }

  // Foreign Key reference integrity check
  for (const fk of fks) {
    const val = row[fk.from];
    if (val !== undefined && val !== null && val !== '') {
      const valStr = String(val);

      // Check if reference is in batch
      if (existingKeysInBatch && existingKeysInBatch.has(fk.table)) {
        if (existingKeysInBatch.get(fk.table)!.has(valStr)) {
          continue;
        }
      }

      // Check against database
      const exists = sqlite
        .prepare(`SELECT 1 FROM "${fk.table}" WHERE "${fk.to}" = ? LIMIT 1`)
        .get(valStr);

      if (!exists) {
        errors.push(
          `${rowDisplay}: 参照整合性エラー。カラム "${fk.from}" の値 "${valStr}" は参照先 "${fk.table}.${fk.to}" に存在しません。`,
        );
      }
    }
  }

  return errors;
}

// 1. GET /api/db/entities - list all tables with count and schema info
dbAdminRoutes.get('/entities', requireGm, (c) => {
  const result = DB_ENTITIES.map((name) => {
    const countRow = sqlite.prepare(`SELECT count(*) as count FROM "${name}"`).get() as { count: number };
    const cols = getTableInfo(name);
    const fks = getForeignKeyList(name);
    return {
      name,
      count: countRow ? Number(countRow.count) : 0,
      columns: cols.map((col) => ({
        name: col.name,
        type: col.type,
        required: col.notnull === 1 && col.dflt_value === null,
        isPk: col.pk > 0,
      })),
      foreignKeys: fks.map((fk) => ({
        from: fk.from,
        targetTable: fk.table,
        targetColumn: fk.to,
      })),
    };
  });

  return c.json({ entities: result });
});

// 2. GET /api/db/export/:entity - export single table as JSON or CSV
dbAdminRoutes.get('/export/:entity', requireGm, (c) => {
  const entity = c.req.param('entity');
  if (!isValidEntity(entity)) {
    return c.json({ error: `無効なエンティティ名です: ${entity}` }, 400);
  }

  const format = (c.req.query('format') || 'json').toLowerCase();
  const rows = sqlite.prepare(`SELECT * FROM "${entity}"`).all() as Record<string, unknown>[];
  const cols = getTableInfo(entity).map((col) => col.name);

  if (format === 'csv') {
    const csvData = exportToCsv(rows, cols);
    return c.text(csvData, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${entity}.csv"`,
    });
  }

  return c.json({
    entity,
    total: rows.length,
    data: rows,
  });
});

// 3. GET /api/db/export-all - export entire database as structured JSON
dbAdminRoutes.get('/export-all', requireGm, (c) => {
  const allData: Record<string, unknown[]> = {};
  for (const entity of DB_ENTITIES) {
    const rows = sqlite.prepare(`SELECT * FROM "${entity}"`).all() as Record<string, unknown>[];
    allData[entity] = rows;
  }

  return c.json({
    format: 'cyberpgm-db-dump',
    exported_at: Date.now(),
    entities: allData,
  });
});

// 4. POST /api/db/import/:entity - import rows with validation and atomic transaction
dbAdminRoutes.post('/import/:entity', requireGm, async (c) => {
  const entity = c.req.param('entity');
  if (!isValidEntity(entity)) {
    return c.json({ error: `無効なエンティティ名です: ${entity}` }, 400);
  }

  const contentType = c.req.header('content-type') || '';
  let rawRows: Record<string, unknown>[] = [];

  try {
    if (contentType.includes('text/csv') || contentType.includes('application/csv')) {
      const text = await c.req.text();
      rawRows = parseCsv(text);
    } else {
      const body = await c.req.json();
      if (Array.isArray(body)) {
        rawRows = body;
      } else if (body && Array.isArray(body.data)) {
        rawRows = body.data;
      } else if (body && typeof body.csv === 'string') {
        rawRows = parseCsv(body.csv);
      } else {
        return c.json({ error: '入力データは配列形式、または { data: [...] }、または CSV テキストである必要があります。' }, 400);
      }
    }
  } catch (err: any) {
    return c.json({ error: `データのパースに失敗しました: ${err?.message || '不正な形式です'}` }, 400);
  }

  if (rawRows.length === 0) {
    return c.json({ message: 'インポートするデータがありません（0件）。', imported: 0 });
  }

  const cols = getTableInfo(entity);
  const fks = getForeignKeyList(entity);
  const colMap = new Map(cols.map((col) => [col.name, col]));

  // Pre-validate all rows
  const allErrors: string[] = [];
  for (let idx = 0; idx < rawRows.length; idx++) {
    const rowErrors = validateRow(entity, rawRows[idx], idx, cols, fks);
    allErrors.push(...rowErrors);
  }

  if (allErrors.length > 0) {
    return c.json({
      error: '検証エラーが発生したため、インポートを中止しました。データは更新されていません。',
      details: allErrors,
    }, 400);
  }

  // Atomic insert / upsert inside transaction
  try {
    const insertTransaction = sqlite.transaction((rows: Record<string, unknown>[]) => {
      for (const row of rows) {
        const rowCols: string[] = [];
        const placeholders: string[] = [];
        const values: unknown[] = [];

        for (const [key, val] of Object.entries(row)) {
          const col = colMap.get(key);
          if (!col) continue; // Skip columns not in schema

          rowCols.push(`"${col.name}"`);
          placeholders.push('?');

          if (val === '' && col.notnull === 0) {
            values.push(null);
          } else if (col.type.toUpperCase().includes('INT') && val !== null && val !== '') {
            values.push(Number(val));
          } else if ((col.type.toUpperCase().includes('REAL') || col.type.toUpperCase().includes('NUM')) && val !== null && val !== '') {
            values.push(Number(val));
          } else if (typeof val === 'object' && val !== null) {
            values.push(JSON.stringify(val));
          } else {
            values.push(val);
          }
        }

        if (rowCols.length === 0) continue;

        const sql = `INSERT OR REPLACE INTO "${entity}" (${rowCols.join(', ')}) VALUES (${placeholders.join(', ')})`;
        sqlite.prepare(sql).run(...values);
      }
    });

    insertTransaction(rawRows);
  } catch (err: any) {
    return c.json({
      error: `DB書き込み中にエラーが発生したため、ロールバックしました: ${err?.message || String(err)}`,
    }, 500);
  }

  return c.json({
    message: `${entity} へ ${rawRows.length} 件のデータを正常にインポートしました。`,
    imported: rawRows.length,
  });
});

// 5. POST /api/db/import-all - import all entities from structured JSON
dbAdminRoutes.post('/import-all', requireGm, async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: '不正な JSON データです。' }, 400);
  }

  const entitiesData: Record<string, Record<string, unknown>[]> = body.entities || body;
  if (!entitiesData || typeof entitiesData !== 'object') {
    return c.json({ error: 'entities オブジェクトが含まれていません。' }, 400);
  }

  // Pre-validate all tables in batch
  const allErrors: string[] = [];
  const batchKeys = new Map<string, Set<string>>();

  // First pass: collect PKs present in the batch
  for (const [entityName, rows] of Object.entries(entitiesData)) {
    if (!isValidEntity(entityName) || !Array.isArray(rows)) continue;
    const cols = getTableInfo(entityName);
    const pkCol = cols.find((c) => c.pk > 0);
    if (pkCol) {
      const keys = new Set<string>();
      for (const row of rows) {
        if (row[pkCol.name] !== undefined && row[pkCol.name] !== null) {
          keys.add(String(row[pkCol.name]));
        }
      }
      batchKeys.set(entityName, keys);
    }
  }

  // Second pass: validate each row
  for (const [entityName, rows] of Object.entries(entitiesData)) {
    if (!isValidEntity(entityName)) continue;
    if (!Array.isArray(rows)) continue;

    const cols = getTableInfo(entityName);
    const fks = getForeignKeyList(entityName);

    for (let idx = 0; idx < rows.length; idx++) {
      const errs = validateRow(entityName, rows[idx], idx, cols, fks, batchKeys);
      for (const err of errs) {
        allErrors.push(`[${entityName}] ${err}`);
      }
    }
  }

  if (allErrors.length > 0) {
    return c.json({
      error: '一括インポート前の検証エラーが発生しました。データは一切更新されていません。',
      details: allErrors,
    }, 400);
  }

  let totalImported = 0;
  try {
    const importAllTransaction = sqlite.transaction(() => {
      for (const entityName of DB_ENTITIES) {
        const rows = entitiesData[entityName];
        if (!Array.isArray(rows) || rows.length === 0) continue;

        const cols = getTableInfo(entityName);
        const colMap = new Map(cols.map((col) => [col.name, col]));

        for (const row of rows) {
          const rowCols: string[] = [];
          const placeholders: string[] = [];
          const values: unknown[] = [];

          for (const [key, val] of Object.entries(row)) {
            const col = colMap.get(key);
            if (!col) continue;

            rowCols.push(`"${col.name}"`);
            placeholders.push('?');

            if (val === '' && col.notnull === 0) {
              values.push(null);
            } else if (col.type.toUpperCase().includes('INT') && val !== null && val !== '') {
              values.push(Number(val));
            } else if ((col.type.toUpperCase().includes('REAL') || col.type.toUpperCase().includes('NUM')) && val !== null && val !== '') {
              values.push(Number(val));
            } else if (typeof val === 'object' && val !== null) {
              values.push(JSON.stringify(val));
            } else {
              values.push(val);
            }
          }

          if (rowCols.length === 0) continue;

          sqlite.prepare(`INSERT OR REPLACE INTO "${entityName}" (${rowCols.join(', ')}) VALUES (${placeholders.join(', ')})`).run(...values);
          totalImported++;
        }
      }
    });

    importAllTransaction();
  } catch (err: any) {
    return c.json({
      error: `一括インポート中にエラーが発生したため、ロールバックしました: ${err?.message || String(err)}`,
    }, 500);
  }

  return c.json({
    message: `全エンティティの一括インポートが正常に完了しました（計 ${totalImported} レコード）。`,
    total_imported: totalImported,
  });
});

// 6. GET /api/db/unverified-items - list unverified items
dbAdminRoutes.get('/unverified-items', requireGm, (c) => {
  const kind = c.req.query('kind');
  const q = c.req.query('q');
  const limit = Math.min(Number(c.req.query('limit')) || 100, 500);
  const offset = Number(c.req.query('offset')) || 0;

  let sqlQuery = `SELECT * FROM items WHERE verify_status = 'unverified'`;
  const params: unknown[] = [];

  if (kind) {
    sqlQuery += ` AND kind = ?`;
    params.push(kind);
  }

  if (q && q.trim()) {
    sqlQuery += ` AND (name_en LIKE ? OR name_ja LIKE ? OR name_ja_override LIKE ?)`;
    const term = `%${q.trim()}%`;
    params.push(term, term, term);
  }

  // Total unverified count with current filters
  const countRow = sqlite.prepare(`SELECT count(*) as count FROM (${sqlQuery})`).get(...params) as { count: number };
  const total = countRow ? Number(countRow.count) : 0;

  // Counts by kind across ALL unverified items
  const countsByKindRows = sqlite
    .prepare(`SELECT kind, count(*) as count FROM items WHERE verify_status = 'unverified' GROUP BY kind`)
    .all() as Array<{ kind: string; count: number }>;
  const countsByKind: Record<string, number> = {};
  for (const r of countsByKindRows) {
    countsByKind[r.kind] = Number(r.count);
  }

  // Total unverified overall
  const overallRow = sqlite.prepare(`SELECT count(*) as count FROM items WHERE verify_status = 'unverified'`).get() as { count: number };
  const overallTotal = overallRow ? Number(overallRow.count) : 0;

  sqlQuery += ` ORDER BY kind ASC, name_ja ASC, name_en ASC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const itemsList = sqlite.prepare(sqlQuery).all(...params) as Record<string, unknown>[];

  return c.json({
    items: itemsList,
    total,
    overall_total: overallTotal,
    counts_by_kind: countsByKind,
    limit,
    offset,
  });
});

// 7. POST /api/db/items/bulk-verify - bulk update verify_status of items
dbAdminRoutes.post('/items/bulk-verify', requireGm, async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: '不正な JSON データです。' }, 400);
  }

  const { item_ids, verify_status } = body;
  const ALLOWED_STATUS = ['official_verified', 'unofficial', 'unverified', 'homebrew'];

  if (!ALLOWED_STATUS.includes(verify_status)) {
    return c.json({
      error: `無効な確認状態です: "${verify_status}"。許容値: ${ALLOWED_STATUS.join(', ')}`,
    }, 400);
  }

  if (!Array.isArray(item_ids) || item_ids.length === 0) {
    return c.json({ error: 'item_ids は 1 件以上の配列である必要があります。' }, 400);
  }

  const now = Date.now();
  let updatedCount = 0;

  try {
    const updateTx = sqlite.transaction((ids: string[], status: string) => {
      const stmt = sqlite.prepare(`UPDATE items SET verify_status = ?, updated_at = ? WHERE id = ?`);
      for (const id of ids) {
        const info = stmt.run(status, now, id);
        updatedCount += info.changes;
      }
    });

    updateTx(item_ids, verify_status);
  } catch (err: any) {
    return c.json({
      error: `一括変更中にエラーが発生しました: ${err?.message || String(err)}`,
    }, 500);
  }

  return c.json({
    message: `${updatedCount} 件のアイテムの確認状態を "${verify_status}" に一括変更しました。`,
    updated_count: updatedCount,
    verify_status,
  });
});
