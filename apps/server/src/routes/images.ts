import { Hono } from 'hono';
import { db, getImagesDir } from '../db/client.js';
import { images } from '../db/schema.js';
import { eq, and, like } from 'drizzle-orm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { authMiddleware, requireGm } from '../auth.js';
import { z } from 'zod';
import { generateUlid } from '@cyberpgm/shared';

export const imagesRouter = new Hono();

imagesRouter.use('*', authMiddleware);

// GET /api/images - list images with filters (GM only)
imagesRouter.get('/', requireGm, async (c) => {
  const origin = c.req.query('origin');
  const source_book = c.req.query('source_book');
  const visibility = c.req.query('visibility');
  const q = c.req.query('q') || c.req.query('title');

  let rows = await db.select().from(images).all();

  if (origin) {
    rows = rows.filter((img) => img.origin === origin);
  }
  if (source_book) {
    rows = rows.filter((img) => img.source_book === source_book);
  }
  if (visibility) {
    rows = rows.filter((img) => img.visibility === visibility);
  }
  if (q) {
    const queryLower = q.toLowerCase();
    rows = rows.filter(
      (img) =>
        (img.title && img.title.toLowerCase().includes(queryLower)) ||
        (img.path && img.path.toLowerCase().includes(queryLower)) ||
        (img.source_book && img.source_book.toLowerCase().includes(queryLower))
    );
  }

  return c.json({ images: rows });
});

// POST /api/images - upload general image (GM only)
imagesRouter.post('/', requireGm, async (c) => {
  const body = await c.req.parseBody();
  const file = body['image'];
  if (!file || !(file instanceof File)) {
    return c.json({ error: '画像ファイル (image) が必要です' }, 400);
  }

  // Check file size (max 10MB)
  const MAX_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    return c.json({ error: 'ファイルサイズが上限 (10MB) を超えています' }, 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length < 4) {
    return c.json({ error: '無効な画像ファイルです' }, 400);
  }

  // Detect image type by magic bytes
  let ext: string | null = null;
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    ext = 'png';
  }
  // JPEG: FF D8 FF
  else if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    ext = 'jpg';
  }
  // WebP: RIFF ... WEBP
  else if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    ext = 'webp';
  }

  if (!ext) {
    return c.json(
      { error: '対応していない画像形式です (PNG, JPEG, WebP のみ対応)' },
      400
    );
  }

  const baseDir = getImagesDir();
  const userDir = path.join(baseDir, 'user');
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }

  const imageId = generateUlid();
  const filename = `${imageId}.${ext}`;
  const relativePath = path.join('user', filename);
  const fullPath = path.join(baseDir, relativePath);

  fs.writeFileSync(fullPath, buffer);

  const title = typeof body['title'] === 'string' && body['title'].trim() ? body['title'].trim() : file.name;
  const visibility = body['visibility'] === 'players' ? 'players' : 'gm';
  const source_book = typeof body['source_book'] === 'string' ? body['source_book'].trim() : null;
  const source_page = body['source_page'] ? Number(body['source_page']) : null;

  db.insert(images)
    .values({
      id: imageId,
      path: relativePath,
      origin: 'user',
      title,
      visibility,
      source_book,
      source_page,
      is_primary: false,
    })
    .run();

  const created = await db.select().from(images).where(eq(images.id, imageId)).get();
  return c.json({ image: created }, 201);
});

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
  let filePath: string;
  if (path.isAbsolute(imageRecord.path)) {
    filePath = imageRecord.path;
  } else {
    filePath = path.resolve(baseDir, imageRecord.path);
    // Prevent path traversal
    if (!filePath.startsWith(baseDir + path.sep)) {
      return c.json({ error: 'Forbidden' }, 403);
    }
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
