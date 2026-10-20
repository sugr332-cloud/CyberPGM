import { Hono } from 'hono';
import { db } from '../db/client.js';
import { skill_notes } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireGm } from '../auth.js';

export const skillNotesRoutes = new Hono();

// GET /api/skill-notes
skillNotesRoutes.get('/skill-notes', async (c) => {
  const rows = db.select().from(skill_notes).all();
  const notes: Record<string, string> = {};
  for (const r of rows) {
    notes[r.key] = r.text;
  }
  return c.json({ notes });
});

// PATCH /api/skill-notes/:key (GM edits note)
skillNotesRoutes.patch('/skill-notes/:key', requireGm, async (c) => {
  const key = c.req.param('key');
  if (!key) return c.json({ error: '技能キーが必要です' }, 400);
  const body = await c.req.json();
  const text = String(body.text || '');

  const now = Date.now();
  const existing = db
    .select()
    .from(skill_notes)
    .where(eq(skill_notes.key, key))
    .get();

  if (existing) {
    db.update(skill_notes)
      .set({ text, updated_at: now })
      .where(eq(skill_notes.key, key))
      .run();
  } else {
    db.insert(skill_notes)
      .values({ key, text, updated_at: now })
      .run();
  }

  return c.json({ ok: true, key, text, updated_at: now });
});
