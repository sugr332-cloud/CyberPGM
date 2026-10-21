import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { characters, players, scenarios } from '../db/schema.js';
import { requireGm } from '../auth.js';
import { sessionManager } from '../session.js';
import { PlayerCreateInputSchema, generateUlid } from '@cyberpgm/shared';
import { endScenarioSession, getActiveScenarioSession } from './scenario-play.js';
import { triggerAutoSave } from './saves.js';

// Phase 5i: プレイヤー（人）と、キャラのシナリオの縛り
export const playersRoutes = new Hono();

export interface CharacterLock {
  scenario_title: string | null;
  locked: boolean;
  lock_reason: string | null;
}

/**
 * 未クリアのシナリオに入っているキャラは、そのシナリオ以外では選べない。
 * 進行中のシナリオがないとき（キャラ作成や買い物）は選べる。
 */
export function characterLock(scenarioId: string | null, activeScenarioId: string | null): CharacterLock {
  if (!scenarioId) return { scenario_title: null, locked: false, lock_reason: null };
  const title = db.select({ title: scenarios.title }).from(scenarios).where(eq(scenarios.id, scenarioId)).get()?.title ?? '不明なシナリオ';
  const locked = activeScenarioId !== null && activeScenarioId !== scenarioId;
  return {
    scenario_title: title,
    locked,
    lock_reason: locked ? `「${title}」が未クリアのため、「${title}」以外では選べません` : null,
  };
}

export function activeScenarioId(): string | null {
  return getActiveScenarioSession()?.scenario_id ?? null;
}

function codeOk(code: string | undefined): boolean {
  return !!code && code.toUpperCase() === sessionManager.getSessionCode().toUpperCase();
}

// GET /api/players?code=XXXXXX: 参加画面の「あなたは？」の一覧（GM はコードなしで見られる）
playersRoutes.get('/players', async (c) => {
  if (c.get('role') !== 'gm' && !codeOk(c.req.query('code'))) {
    return c.json({ error: 'Invalid session code' }, 400);
  }
  const rows = db.select().from(players).orderBy(players.name).all();
  return c.json({ players: rows.map((p) => ({ id: p.id, name: p.name })) });
});

// POST /api/players: 初めての人が名前を登録する。同じ名前がもうあれば、その人を返す
playersRoutes.post('/players', async (c) => {
  const parsed = PlayerCreateInputSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: '名前を入れてください' }, 400);
  if (!codeOk(parsed.data.code)) return c.json({ error: 'Invalid session code' }, 400);

  const name = parsed.data.name;
  const existing = db.select().from(players).where(sql`lower(${players.name}) = lower(${name})`).get();
  if (existing) return c.json({ id: existing.id, name: existing.name });

  const now = Date.now();
  const id = generateUlid();
  db.insert(players).values({ id, name, created_at: now, updated_at: now }).run();
  triggerAutoSave(`プレイヤー登録: ${name}`);
  return c.json({ id, name }, 201);
});

// PATCH /api/players/:id: GM が名前を直す
playersRoutes.patch('/players/:id', requireGm, async (c) => {
  const id = c.req.param('id')!;
  const body = await c.req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return c.json({ error: '名前を入れてください' }, 400);
  const res = db.update(players).set({ name, updated_at: Date.now() }).where(eq(players.id, id)).run();
  if (res.changes === 0) return c.json({ error: 'Player not found' }, 404);
  return c.json({ id, name });
});

// DELETE /api/players/:id: GM が消す。その人のキャラは持ち主なしになる（キャラは消さない）
playersRoutes.delete('/players/:id', requireGm, async (c) => {
  const id = c.req.param('id')!;
  db.update(characters).set({ player_id: null }).where(eq(characters.player_id, id)).run();
  const res = db.delete(players).where(eq(players.id, id)).run();
  if (res.changes === 0) return c.json({ error: 'Player not found' }, 404);
  return c.json({ success: true });
});

// POST /api/scenario-sessions/:id/clear: シナリオをクリアして進行を終え、参加キャラの縛りを外す
playersRoutes.post('/scenario-sessions/:id/clear', requireGm, async (c) => {
  const active = getActiveScenarioSession();
  const sessionId = c.req.param('id')!;
  if (!active || active.id !== sessionId) return c.json({ error: '進行中のシナリオではありません' }, 404);

  const released = db
    .update(characters)
    .set({ scenario_id: null, updated_at: Date.now() })
    .where(eq(characters.scenario_id, active.scenario_id))
    .returning({ id: characters.id, name: characters.name })
    .all();
  endScenarioSession(active.id, `シナリオクリア: ${released.map((r) => r.name).join('、') || '参加キャラなし'}`);
  for (const r of released) sessionManager.updateCharacterSheet(r.id);
  triggerAutoSave('シナリオクリア');
  return c.json({ success: true, released });
});
