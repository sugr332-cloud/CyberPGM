import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { shops, shop_stock, items } from '../db/schema.js';
import { sessionManager } from '../session.js';
import { requireGm } from '../auth.js';
import {
  ShopCreateInputSchema,
  ShopUpdateInputSchema,
  ShopStockSetInputSchema,
  generateUlid,
} from '@cyberpgm/shared';

export const shopsRoutes = new Hono();

// GET /api/shops - list all shops
shopsRoutes.get('/', async (c) => {
  const allShops = await db.select().from(shops).all();

  const result = allShops.map((s) => ({
    ...s,
    categories: JSON.parse(s.categories || '[]') as string[],
  }));

  return c.json({ shops: result });
});

// POST /api/shops - create a new shop (GM only)
shopsRoutes.post('/', requireGm, async (c) => {
  const body = await c.req.json();
  const parsed = ShopCreateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid shop data', details: parsed.error.issues }, 400);
  }

  const id = generateUlid();
  const now = Date.now();
  const newShop = {
    id,
    name: parsed.data.name.trim(),
    price_multiplier: parsed.data.price_multiplier,
    buyback_rate: parsed.data.buyback_rate,
    categories: JSON.stringify(parsed.data.categories ?? []),
    created_at: now,
    updated_at: now,
  };

  db.insert(shops).values(newShop).run();

  return c.json(
    {
      ...newShop,
      categories: parsed.data.categories ?? [],
    },
    201,
  );
});

// GET /api/shops/:id - get shop details
shopsRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Shop id is required' }, 400);
  const shop = await db.select().from(shops).where(eq(shops.id, id)).get();
  if (!shop) {
    return c.json({ error: 'Shop not found' }, 404);
  }

  return c.json({
    ...shop,
    categories: JSON.parse(shop.categories || '[]') as string[],
  });
});

// PATCH /api/shops/:id - update shop (GM only)
shopsRoutes.patch('/:id', requireGm, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Shop id is required' }, 400);
  const shop = await db.select().from(shops).where(eq(shops.id, id)).get();
  if (!shop) {
    return c.json({ error: 'Shop not found' }, 404);
  }

  const body = await c.req.json();
  const parsed = ShopUpdateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid update data', details: parsed.error.issues }, 400);
  }

  const updateValues: Partial<typeof shops.$inferInsert> = {
    updated_at: Date.now(),
  };

  if (parsed.data.name !== undefined) updateValues.name = parsed.data.name.trim();
  if (parsed.data.price_multiplier !== undefined) updateValues.price_multiplier = parsed.data.price_multiplier;
  if (parsed.data.buyback_rate !== undefined) updateValues.buyback_rate = parsed.data.buyback_rate;
  if (parsed.data.categories !== undefined) {
    updateValues.categories = JSON.stringify(parsed.data.categories);
  }

  db.update(shops).set(updateValues).where(eq(shops.id, id)).run();

  const updated = await db.select().from(shops).where(eq(shops.id, id)).get();
  return c.json({
    ...updated!,
    categories: JSON.parse(updated!.categories || '[]') as string[],
  });
});

// DELETE /api/shops/:id - delete shop (GM only)
shopsRoutes.delete('/:id', requireGm, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Shop id is required' }, 400);
  const shop = await db.select().from(shops).where(eq(shops.id, id)).get();
  if (!shop) {
    return c.json({ error: 'Shop not found' }, 404);
  }

  db.delete(shops).where(eq(shops.id, id)).run();
  return c.json({ success: true, deleted: id });
});

// GET /api/shops/:id/stock - list shop stock with item details
shopsRoutes.get('/:id/stock', async (c) => {
  const shopId = c.req.param('id');
  if (!shopId) return c.json({ error: 'Shop id is required' }, 400);
  const shop = await db.select().from(shops).where(eq(shops.id, shopId)).get();
  if (!shop) {
    return c.json({ error: 'Shop not found' }, 404);
  }

  const stockRows = db
    .select({
      id: shop_stock.id,
      shop_id: shop_stock.shop_id,
      item_id: shop_stock.item_id,
      quantity: shop_stock.quantity,
      item: items,
    })
    .from(shop_stock)
    .innerJoin(items, eq(shop_stock.item_id, items.id))
    .where(eq(shop_stock.shop_id, shopId))
    .all();

  // 効果とフレーバー（Phase 5c）は GM だけに送る
  if (c.get('role') === 'gm') return c.json({ stock: stockRows });
  return c.json({
    stock: stockRows.map((r) => {
      const { effect_ja: _e, flavor_ja: _f, effect_is_draft: _ed, flavor_is_draft: _fd, ...item } = r.item;
      return { ...r, item };
    }),
  });
});

// POST /api/shops/:id/stock - add or update stock item in shop (GM only)
shopsRoutes.post('/:id/stock', requireGm, async (c) => {
  const shopId = c.req.param('id');
  if (!shopId) return c.json({ error: 'Shop id is required' }, 400);
  const shop = await db.select().from(shops).where(eq(shops.id, shopId)).get();
  if (!shop) {
    return c.json({ error: 'Shop not found' }, 404);
  }

  const body = await c.req.json();
  const parsed = ShopStockSetInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid stock data', details: parsed.error.issues }, 400);
  }

  const item = await db.select().from(items).where(eq(items.id, parsed.data.item_id)).get();
  if (!item) {
    return c.json({ error: 'Item not found' }, 404);
  }

  const existing = db
    .select()
    .from(shop_stock)
    .where(and(eq(shop_stock.shop_id, shopId), eq(shop_stock.item_id, parsed.data.item_id)))
    .get();

  if (existing) {
    db.update(shop_stock)
      .set({ quantity: parsed.data.quantity })
      .where(eq(shop_stock.id, existing.id))
      .run();
    sessionManager.broadcastToPlayers({ type: 'player-shop:update', payload: {} });

    return c.json({
      id: existing.id,
      shop_id: shopId,
      item_id: parsed.data.item_id,
      quantity: parsed.data.quantity,
    });
  } else {
    const id = generateUlid();
    const newStock: typeof shop_stock.$inferInsert = {
      id,
      shop_id: shopId,
      item_id: parsed.data.item_id,
      quantity: parsed.data.quantity,
    };
    db.insert(shop_stock).values(newStock).run();
    sessionManager.broadcastToPlayers({ type: 'player-shop:update', payload: {} });
    return c.json(newStock, 201);
  }
});

// DELETE /api/shops/:id/stock/:item_id - remove item from shop stock (GM only)
shopsRoutes.delete('/:id/stock/:item_id', requireGm, async (c) => {
  const shopId = c.req.param('id');
  const itemId = c.req.param('item_id');
  if (!shopId || !itemId) return c.json({ error: 'Shop id and item id are required' }, 400);

  const existing = db
    .select()
    .from(shop_stock)
    .where(and(eq(shop_stock.shop_id, shopId), eq(shop_stock.item_id, itemId)))
    .get();

  if (!existing) {
    return c.json({ error: 'Stock item not found' }, 404);
  }

  db.delete(shop_stock).where(eq(shop_stock.id, existing.id)).run();
  sessionManager.broadcastToPlayers({ type: 'player-shop:update', payload: {} });
  return c.json({ success: true, deleted: existing.id });
});
