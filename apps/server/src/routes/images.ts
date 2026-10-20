import { Hono } from 'hono';
import { db, getImagesDir } from '../db/client.js';
import { images } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { authMiddleware, requireGm } from '../auth.js';
import { z } from 'zod';

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

  const baseDir = getImagesDir();
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

const ImagePatchSchema = z.object({
  visibility: z.enum(['gm', 'players']).optional(),
  is_primary: z.boolean().optional(),
});

// PATCH /api/images/:id - update visibility or is_primary status (GM only)
imagesRouter.patch('/:id', requireGm, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Image id is required' }, 400);
  const existing = await db.select().from(images).where(eq(images.id, id)).get();
  if (!existing) {
    return c.json({ error: 'Image not found' }, 404);
  }

  const body = await c.req.json();
  const parsed = ImagePatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid update data', details: parsed.error.issues }, 400);
  }

  if (parsed.data.is_primary && existing.item_id) {
    // Clear other primary images for this item
    db.update(images)
      .set({ is_primary: false })
      .where(and(eq(images.item_id, existing.item_id), eq(images.is_primary, true)))
      .run();
  }

  const updates: Partial<typeof images.$inferInsert> = {};
  if (parsed.data.visibility !== undefined) updates.visibility = parsed.data.visibility;
  if (parsed.data.is_primary !== undefined) updates.is_primary = parsed.data.is_primary;

  db.update(images).set(updates).where(eq(images.id, id)).run();

  const updated = await db.select().from(images).where(eq(images.id, id)).get();
  return c.json(updated);
});

// DELETE /api/images/:id - delete image (GM only)
imagesRouter.delete('/:id', requireGm, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Image id is required' }, 400);
  const existing = await db.select().from(images).where(eq(images.id, id)).get();
  if (!existing) {
    return c.json({ error: 'Image not found' }, 404);
  }

  db.delete(images).where(eq(images.id, id)).run();

  // If file is in user uploads, remove physical file
  if (existing.path.startsWith('user/')) {
    const baseDir = getImagesDir();
    const fullPath = path.resolve(baseDir, existing.path);
    if (fullPath.startsWith(baseDir) && fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
      } catch {
        // ignore disk removal failure
      }
    }
  }

  return c.json({ success: true, deleted: id });
});
