import { Hono } from 'hono';
import { db } from '../db/client.js';
import { images } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { getProjectRoot } from '@cyberpgm/shared';

export const imagesRouter = new Hono();

// GET /api/images/:id - serve image file by image ID
imagesRouter.get('/:id', async (c) => {
  const id = c.req.param('id');

  const imageRecord = await db.query.images.findFirst({
    where: eq(images.id, id),
  });

  if (!imageRecord) {
    return c.json({ error: 'Image not found' }, 404);
  }

  // TODO: Phase 1 authentication check - if imageRecord.visibility === 'gm',
  // verify user has GM permission. For Phase 0, return the image for development/debug purposes.

  const baseDir = path.resolve(getProjectRoot(), 'data/images');
  const filePath = path.resolve(baseDir, imageRecord.path);

  // Prevent path traversal
  if (!filePath.startsWith(baseDir)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  if (!fs.existsSync(filePath)) {
    return c.json({ error: 'Image file not found on disk' }, 404);
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  const fileBuffer = fs.readFileSync(filePath);

  c.header('Content-Type', contentType);
  c.header('Cache-Control', 'public, max-age=86400');
  return c.body(fileBuffer);
});
