import { Hono } from 'hono';
import { db } from '../db/client.js';
import { images } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getProjectRoot } from '@cyberpgm/shared';
import { authMiddleware } from '../auth.js';

export const imagesRouter = new Hono();

imagesRouter.use('*', authMiddleware);

// GET /api/images/:id - serve image file by image ID
imagesRouter.get('/:id', async (c) => {
  const id = c.req.param('id');

  const imageRecord = await db.query.images.findFirst({
    where: eq(images.id, id),
  });

  if (!imageRecord) {
    return c.json({ error: 'Image not found' }, 404);
  }

  // Phase 2 visibility permission check:
  // if imageRecord.visibility === 'gm', verify user has GM permission.
  if (imageRecord.visibility === 'gm') {
    const role = c.get('role');
    if (role !== 'gm') {
      return c.json({ error: 'Forbidden: Image is GM-only' }, 403);
    }
  }

  const baseDir = path.resolve(getProjectRoot(), 'data/images');
  const filePath = path.resolve(baseDir, imageRecord.path);

  // Prevent path traversal
  if (!filePath.startsWith(baseDir + path.sep)) {
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
  c.header('X-Content-Type-Options', 'nosniff');
  if (ext === '.svg') {
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  }
  return c.body(fileBuffer);
});
