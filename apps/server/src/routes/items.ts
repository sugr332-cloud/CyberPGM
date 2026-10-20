import { Hono } from 'hono';
import { db } from '../db/client.js';
import { items } from '../db/schema.js';
import { eq, or, like, and, sql } from 'drizzle-orm';
import { ItemsQuerySchema } from '@cyberpgm/shared';

export const itemsRouter = new Hono();

// GET /api/items - list items with filtering and search
itemsRouter.get('/', async (c) => {
  const queryResult = ItemsQuerySchema.safeParse(c.req.query());
  if (!queryResult.success) {
    return c.json({ error: 'Invalid query parameters', details: queryResult.error }, 400);
  }

  const { kind, q, limit, offset } = queryResult.data;

  const conditions = [];
  if (kind) {
    conditions.push(eq(items.kind, kind));
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

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const totalResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(items)
    .where(whereClause);
  const total = Number(totalResult[0]?.count ?? 0);

  const itemList = await db.query.items.findMany({
    where: whereClause,
    limit,
    offset,
    orderBy: (items, { asc }) => [asc(items.name_en)],
    with: {
      images: {
        where: (img, { eq }) => eq(img.is_primary, true),
      },
    },
  });

  return c.json({
    total,
    limit,
    offset,
    items: itemList,
  });
});

// GET /api/items/:id - get item details including sub-tables and images
itemsRouter.get('/:id', async (c) => {
  const id = c.req.param('id');

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

  return c.json(item);
});
