import { Hono } from 'hono';
import { db, getImagesDir } from '../db/client.js';
import { items, weapons, armors, images } from '../db/schema.js';
import { eq, or, like, and, sql, asc, desc } from 'drizzle-orm';
import {
  ItemsQuerySchema,
  ItemPatchInputSchema,
  generateUlid,
} from '@cyberpgm/shared';
import { requireGm } from '../auth.js';
import fs from 'node:fs';
import path from 'node:path';

export const itemsRouter = new Hono();

// GET /api/items - list items with rich filtering, search, and sorting (public catalog)
itemsRouter.get('/', async (c) => {
  const queryResult = ItemsQuerySchema.safeParse(c.req.query());
  if (!queryResult.success) {
    return c.json({ error: 'Invalid query parameters', details: queryResult.error }, 400);
  }

  const {
    kind,
    price_category,
    weapon_type,
    concealable,
    quality,
    verify_status,
    sort,
    q,
    limit,
    offset,
  } = queryResult.data;

  // 1. Calculate overall counts by kind across all items
  const kindCountsRows = db
    .select({
      kind: items.kind,
      count: sql<number>`count(*)`,
    })
    .from(items)
    .groupBy(items.kind)
    .all();

  const categoryCounts: Record<string, number> = {};
  for (const row of kindCountsRows) {
    categoryCounts[row.kind] = Number(row.count);
  }

  // 2. Build filters
  const conditions = [];

  if (kind) {
    conditions.push(eq(items.kind, kind));
  }
  if (price_category) {
    conditions.push(eq(items.price_category, price_category));
  }
  if (verify_status) {
    conditions.push(eq(items.verify_status, verify_status));
  }
  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    conditions.push(
      or(
        like(items.name_en, term),
        like(items.name_ja, term),
        like(items.name_ja_override, term),
      ),
    );
  }

  // Weapons table sub-filters
  if (weapon_type) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${weapons} WHERE ${weapons.item_id} = ${items.id} AND ${weapons.weapon_type} = ${weapon_type})`,
    );
  }
  if (concealable !== undefined) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${weapons} WHERE ${weapons.item_id} = ${items.id} AND ${weapons.concealable} = ${concealable ? 1 : 0})`,
    );
  }
  if (quality) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${weapons} WHERE ${weapons.item_id} = ${items.id} AND ${weapons.quality} = ${quality})`,
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Total count matching query
  const totalResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(items)
    .where(whereClause);
  const total = Number(totalResult[0]?.count ?? 0);

  // Sorting
  let orderClause = [asc(items.name_en)];
  if (sort === 'price_asc') {
    orderClause = [asc(sql`COALESCE(${items.price_eb}, 99999999)`)];
  } else if (sort === 'price_desc') {
    orderClause = [desc(sql`COALESCE(${items.price_eb}, -1)`)];
  } else if (sort === 'name_asc') {
    orderClause = [asc(sql`COALESCE(${items.name_ja_override}, ${items.name_ja}, ${items.name_en})`)];
  } else if (sort === 'name_desc') {
    orderClause = [desc(sql`COALESCE(${items.name_ja_override}, ${items.name_ja}, ${items.name_en})`)];
  } else if (sort === 'damage_desc') {
    orderClause = [
      desc(
        sql`(SELECT ${weapons.damage} FROM ${weapons} WHERE ${weapons.item_id} = ${items.id})`,
      ),
      asc(items.name_en),
    ];
  } else if (sort === 'sp_desc') {
    orderClause = [
      desc(
        sql`(SELECT MAX(COALESCE(${armors.sp_body}, 0), COALESCE(${armors.sp_head}, 0)) FROM ${armors} WHERE ${armors.item_id} = ${items.id})`,
      ),
      asc(items.name_en),
    ];
  }

  const itemList = await db.query.items.findMany({
    where: whereClause,
    limit,
    offset,
    orderBy: orderClause,
    with: {
      weapon: true,
      armor: true,
      cyberware: true,
      images: true,
    },
  });

  const formattedItems = itemList.map((item) => formatItemSummary(item));

  return c.json({
    total,
    limit,
    offset,
    category_counts: categoryCounts,
    items: formattedItems,
  });
});

function formatItemSummary(item: any) {
  const imgs: Array<typeof images.$inferSelect> = item.images || [];
  let primaryImgId: string | null = null;
  if (imgs.length > 0) {
    const primary = imgs.find((img) => img.is_primary);
    if (primary) {
      primaryImgId = primary.id;
    } else {
      const bookScan = imgs.find((img) => img.origin === 'book_scan');
      const user = imgs.find((img) => img.origin === 'user');
      const fvtt = imgs.find((img) => img.origin === 'fvtt');
      primaryImgId = (bookScan || user || fvtt || imgs[0])?.id ?? null;
    }
  }

  return {
    ...item,
    image_id: primaryImgId ?? item.image_id ?? null,
    // Weapon fields (§10 Review 02)
    damage: item.weapon?.damage ?? null,
    rof: item.weapon?.rof ?? null,
    magazine_max: item.weapon?.magazine_max ?? null,
    weapon_type: item.weapon?.weapon_type ?? null,
    // Armor fields (§10 Review 02)
    sp_head: item.armor?.sp_head ?? null,
    sp_body: item.armor?.sp_body ?? null,
    is_shield: item.armor?.is_shield ? Boolean(item.armor.is_shield) : false,
    shield_hp: item.armor?.shield_hp ?? null,
    // Cyberware fields (§10 Review 02)
    humanity_loss_static: item.cyberware?.humanity_loss_static ?? null,
    humanity_loss_roll: item.cyberware?.humanity_loss_roll ?? null,
  };
}

// GET /api/items/:id - get item details including sub-tables and images
itemsRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Item id is required' }, 400);

  const item = await db.query.items.findFirst({
    where: eq(items.id, id),
    with: {
      weapon: true,
      armor: true,
      cyberware: true,
      images: true,
    },
  });

  if (!item) {
    return c.json({ error: 'Item not found' }, 404);
  }

  return c.json(formatItemSummary(item));
});

// PATCH /api/items/:id - update GM-editable fields of an item (GM only)
itemsRouter.patch('/:id', requireGm, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Item id is required' }, 400);
  const existing = await db.select().from(items).where(eq(items.id, id)).get();
  if (!existing) {
    return c.json({ error: 'Item not found' }, 404);
  }

  const body = await c.req.json();
  const parsed = ItemPatchInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid update data', details: parsed.error.issues }, 400);
  }

  const updates: Partial<typeof items.$inferInsert> = {
    updated_at: Date.now(),
  };

  if (parsed.data.name_ja_override !== undefined) updates.name_ja_override = parsed.data.name_ja_override;
  if (parsed.data.summary_ja !== undefined) updates.summary_ja = parsed.data.summary_ja;
  if (parsed.data.source_page_ja !== undefined) updates.source_page_ja = parsed.data.source_page_ja;
  if (parsed.data.verify_status !== undefined) updates.verify_status = parsed.data.verify_status;
  if (parsed.data.tags !== undefined) updates.tags = JSON.stringify(parsed.data.tags);
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;

  db.update(items).set(updates).where(eq(items.id, id)).run();

  const updatedItem = await db.query.items.findFirst({
    where: eq(items.id, id),
    with: {
      weapon: true,
      armor: true,
      cyberware: true,
      images: true,
    },
  });

  return c.json(formatItemSummary(updatedItem));
});

// POST /api/items/:id/images - upload item image (GM only)
itemsRouter.post('/:id/images', requireGm, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Item id is required' }, 400);
  const existingItem = await db.select().from(items).where(eq(items.id, id)).get();
  if (!existingItem) {
    return c.json({ error: 'Item not found' }, 404);
  }

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
      {
        error: '許可されていない画像形式です。PNG, JPEG, WebP のみ受け付けます（SVGは不可）。',
      },
      400,
    );
  }

  // Save to data/images/user/<ulid>.<ext>
  const userImagesDir = path.join(getImagesDir(), 'user');
  if (!fs.existsSync(userImagesDir)) {
    fs.mkdirSync(userImagesDir, { recursive: true });
  }

  const imageId = generateUlid();
  const fileName = `${imageId}.${ext}`;
  const filePath = path.join(userImagesDir, fileName);
  fs.writeFileSync(filePath, buffer);

  const originInput = String(body['origin'] || 'user');
  const origin: 'book_scan' | 'user' = originInput === 'book_scan' ? 'book_scan' : 'user';
  // Rule: book_scan is gm-only by default; user is players by default (SPEC §3)
  const visibility = origin === 'book_scan' ? 'gm' : 'players';
  const sourceBook = body['source_book'] ? String(body['source_book']) : null;
  const sourcePage = body['source_page'] ? Number(body['source_page']) : null;

  // Insert image record
  const relativePath = path.join('user', fileName);
  const newImageRecord = {
    id: imageId,
    item_id: id,
    path: relativePath,
    origin,
    license: origin === 'user' ? 'user' : null,
    attribution: null,
    source_book: sourceBook,
    source_page: sourcePage,
    visibility,
    is_primary: false,
  };

  db.insert(images).values(newImageRecord).run();

  return c.json(newImageRecord, 201);
});
