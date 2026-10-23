import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { requireAuth } from '../auth.js';
import { getCoreSourceDir } from '../source-data.js';
import { loadLoreData, searchLore } from '../services/lore.js';

export const loreRoutes = new Hono();
loreRoutes.get('/lore', requireAuth, (c) => {
  if (!fs.existsSync(path.join(getCoreSourceDir(), 'lore.json'))) return c.json({ entries: [], hasSource: false });
  const data = loadLoreData();
  const isGm = c.get('role') === 'gm';
  const entries = isGm ? data.entries : data.entries.filter((entry) => entry.category !== 'gm');
  const categories = Object.fromEntries(Object.entries(data.categories ?? {}).filter(([key]) => isGm || key !== 'gm'));
  return c.json({
    categories,
    entries: searchLore(entries, c.req.query('q'), c.req.query('category')),
    hasSource: true,
  });
});
