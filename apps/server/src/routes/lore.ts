import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { requireGm } from '../auth.js';
import { getCoreSourceDir } from '../source-data.js';
import { loadLoreData, searchLore } from '../services/lore.js';

export const loreRoutes = new Hono();
loreRoutes.get('/lore', requireGm, (c) => {
  if (!fs.existsSync(path.join(getCoreSourceDir(), 'lore.json'))) return c.json({ entries: [], hasSource: false });
  const data = loadLoreData();
  return c.json({
    categories: data.categories ?? {},
    entries: searchLore(data.entries, c.req.query('q'), c.req.query('category')),
    hasSource: true,
  });
});
