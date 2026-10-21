import { Hono } from 'hono';
import { like, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { characters, clues, handouts, items, scenarios, scenes } from '../db/schema.js';
import { requireGm } from '../auth.js';

// 全文検索（GM。仕様 §5.0。Phase 5n）: キャラ・品目・シナリオ・シーン・手がかり・ハンドアウトをまとめて探す
export const searchRoutes = new Hono();

export interface SearchHit {
  kind: 'character' | 'item' | 'scenario' | 'scene' | 'clue' | 'handout';
  id: string;
  title: string;
  sub: string;
  scenario_id?: string;
}

const LIMIT = 8;

function snippet(text: string | null | undefined, q: string): string {
  if (!text) return '';
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, 40);
  const start = Math.max(0, i - 15);
  return `${start > 0 ? '…' : ''}${text.slice(start, i + q.length + 25)}…`;
}

searchRoutes.get('/search', requireGm, (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length === 0) return c.json({ hits: [] });
  const pat = `%${q}%`;
  const hits: SearchHit[] = [];

  for (const r of db.select().from(characters).where(or(like(characters.name, pat), like(characters.role, pat), like(characters.notes_gm, pat))).limit(LIMIT).all()) {
    hits.push({ kind: 'character', id: r.id, title: r.name, sub: `${r.kind === 'pc' ? 'PC' : r.kind === 'npc' ? 'NPC' : 'モブ'} · ${r.role}` });
  }
  for (const r of db
    .select()
    .from(items)
    .where(or(like(items.name_ja, pat), like(items.name_ja_override, pat), like(items.name_en, pat), like(items.summary_ja, pat)))
    .limit(LIMIT)
    .all()) {
    hits.push({ kind: 'item', id: r.id, title: r.name_ja_override || r.name_ja || r.name_en, sub: `${r.kind}${r.price_eb != null ? ` · ${r.price_eb.toLocaleString()} eb` : ''}` });
  }
  for (const r of db.select().from(scenarios).where(or(like(scenarios.title, pat), like(scenarios.summary, pat))).limit(LIMIT).all()) {
    hits.push({ kind: 'scenario', id: r.id, title: r.title, sub: snippet(r.summary, q), scenario_id: r.id });
  }
  for (const r of db
    .select()
    .from(scenes)
    .where(or(like(scenes.title, pat), like(scenes.read_aloud, pat), like(scenes.gm_notes, pat)))
    .limit(LIMIT)
    .all()) {
    hits.push({ kind: 'scene', id: r.id, title: r.title, sub: snippet(r.read_aloud || r.gm_notes, q), scenario_id: r.scenario_id });
  }
  for (const r of db.select().from(clues).where(or(like(clues.title, pat), like(clues.body, pat))).limit(LIMIT).all()) {
    hits.push({ kind: 'clue', id: r.id, title: r.title, sub: snippet(r.body, q), scenario_id: r.scenario_id });
  }
  for (const r of db.select().from(handouts).where(or(like(handouts.title, pat), like(handouts.body, pat))).limit(LIMIT).all()) {
    hits.push({ kind: 'handout', id: r.id, title: r.title, sub: snippet(r.body, q), scenario_id: r.scenario_id });
  }
  return c.json({ hits });
});
