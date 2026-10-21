import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { app_settings, characters, items, purchase_requests, shop_stock, shops } from '../db/schema.js';
import { requireAuth, requireGm } from '../auth.js';
import { sessionManager } from '../session.js';
import { generateUlid } from '@cyberpgm/shared';
import { formatItemSummary } from './items.js';
import { executePurchase } from './commerce.js';

/**
 * プレイヤーのスマホの商店（Phase 5g、2026-10-21 ユーザー決定）:
 * - 出すのは GM が「スマホに出す」にした店の在庫だけ
 * - プレイヤーは購入を申請し、GM が承認すると購入として処理する（資金・在庫・所持品）
 * - 品目は性能だけ見せる（効果・フレーバー・GM 要約は出さない）
 */
export const playerShopRoutes = new Hono();

const PLAYER_SHOP_KEY = 'player_shop_id';

function getPlayerShopId(): string | null {
  const row = db.select().from(app_settings).where(eq(app_settings.key, PLAYER_SHOP_KEY)).get();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as string | null;
  } catch {
    return null;
  }
}

const itemName = (item: typeof items.$inferSelect) => item.name_ja_override || item.name_ja || item.name_en;

/** スマホに出す店と在庫（値段は店の倍率をかけた値） */
function buildPlayerShop() {
  const shopId = getPlayerShopId();
  const shop = shopId ? db.select().from(shops).where(eq(shops.id, shopId)).get() : undefined;
  if (!shop) return { shop: null, stock: [] };
  const rows = db.select().from(shop_stock).where(eq(shop_stock.shop_id, shop.id)).all();
  const stock = rows.flatMap((r) => {
    const item = db.query.items.findFirst({ where: eq(items.id, r.item_id), with: { weapon: true, armor: true, cyberware: true, images: true } }).sync();
    if (!item) return [];
    const { summary_ja: _s, notes: _n, raw_system: _r, description_en: _d, ...forPlayer } = formatItemSummary(item, false);
    return [
      {
        item_id: r.item_id,
        quantity: r.quantity,
        unit_price: item.price_eb === null ? null : Math.floor(item.price_eb * shop.price_multiplier),
        item: forPlayer,
      },
    ];
  });
  return { shop: { id: shop.id, name: shop.name }, stock };
}

// GET /api/player-shop: スマホに出している店（プレイヤーも GM も）
playerShopRoutes.get('/player-shop', requireAuth, (c) => c.json(buildPlayerShop()));

// PUT /api/player-shop: GM がスマホに出す店を決める（null で下げる）
playerShopRoutes.put('/player-shop', requireGm, async (c) => {
  const parsed = z.object({ shop_id: z.string().nullable() }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400);
  const { shop_id } = parsed.data;
  if (shop_id && !db.select().from(shops).where(eq(shops.id, shop_id)).get()) {
    return c.json({ error: '店が見つかりません' }, 404);
  }
  db.insert(app_settings)
    .values({ key: PLAYER_SHOP_KEY, value: JSON.stringify(shop_id) })
    .onConflictDoUpdate({ target: app_settings.key, set: { value: JSON.stringify(shop_id) } })
    .run();
  sessionManager.broadcastToPlayers({ type: 'player-shop:update', payload: {} });
  return c.json({ shop_id });
});

type RequestLine = { item_id: string; name: string; qty: number; unit_price: number };

function formatRequest(r: typeof purchase_requests.$inferSelect) {
  const ch = db.select({ name: characters.name }).from(characters).where(eq(characters.id, r.character_id)).get();
  return {
    id: r.id,
    character_id: r.character_id,
    character_name: ch?.name ?? null,
    shop_id: r.shop_id,
    lines: JSON.parse(r.lines) as RequestLine[],
    total_eb: r.total_eb,
    status: r.status,
    comment: r.comment,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const RequestInputSchema = z.object({
  lines: z.array(z.object({ item_id: z.string(), qty: z.number().int().positive() })).min(1),
});

// POST /api/purchase-requests: プレイヤーが購入を申請する
playerShopRoutes.post('/purchase-requests', requireAuth, async (c) => {
  const characterId = c.get('characterId');
  if (c.get('role') !== 'player' || !characterId) return c.json({ error: 'キャラを選んでから申請してください' }, 403);
  const parsed = RequestInputSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);

  const { shop, stock } = buildPlayerShop();
  if (!shop) return c.json({ error: '今は店が開いていません' }, 400);
  const lines: RequestLine[] = [];
  for (const line of parsed.data.lines) {
    const s = stock.find((st) => st.item_id === line.item_id);
    if (!s) return c.json({ error: 'この店にない品目です' }, 400);
    if (s.unit_price === null) return c.json({ error: `${s.item.name_ja_override || s.item.name_ja || s.item.name_en} は値段が決まっていません（GM に相談してください）` }, 400);
    if (s.quantity !== null && s.quantity < line.qty) return c.json({ error: `在庫が足りません（在庫 ${s.quantity}）` }, 400);
    lines.push({ item_id: line.item_id, name: s.item.name_ja_override || s.item.name_ja || s.item.name_en, qty: line.qty, unit_price: s.unit_price });
  }
  const total = lines.reduce((sum, l) => sum + l.unit_price * l.qty, 0);
  const ch = db.select().from(characters).where(eq(characters.id, characterId)).get();
  if (!ch) return c.json({ error: 'Character not found' }, 404);
  if (ch.eb < total) return c.json({ error: `所持金が足りません（必要 ${total} eb / 所持 ${ch.eb} eb）` }, 400);

  const now = Date.now();
  const row = {
    id: generateUlid(),
    character_id: characterId,
    shop_id: shop.id,
    lines: JSON.stringify(lines),
    total_eb: total,
    status: 'pending',
    comment: null,
    created_at: now,
    updated_at: now,
  };
  db.insert(purchase_requests).values(row).run();
  const request = formatRequest(row);
  sessionManager.sendToGm({ type: 'gm:purchase-request', payload: request });
  return c.json({ request }, 201);
});

// GET /api/purchase-requests/mine: 自分の申請（新しい順）
playerShopRoutes.get('/purchase-requests/mine', requireAuth, (c) => {
  const characterId = c.get('characterId');
  if (!characterId) return c.json({ requests: [] });
  const rows = db
    .select()
    .from(purchase_requests)
    .where(eq(purchase_requests.character_id, characterId))
    .orderBy(desc(purchase_requests.created_at))
    .limit(20)
    .all();
  return c.json({ requests: rows.map(formatRequest) });
});

// GET /api/purchase-requests: GM が見る申請（待っているものを先に）
playerShopRoutes.get('/purchase-requests', requireGm, (c) => {
  const pending = db.select().from(purchase_requests).where(eq(purchase_requests.status, 'pending')).orderBy(purchase_requests.created_at).all();
  return c.json({ requests: pending.map(formatRequest) });
});

const ApproveInputSchema = z.object({
  // サイバーウェアを取り付けるか（取り付けるときの人間性の減少は空欄なら品目の決まった値）
  install_cyberware: z.array(z.object({ item_id: z.string(), humanity_loss: z.number().int().nonnegative().optional() })).optional(),
});

// POST /api/purchase-requests/:id/approve: GM が承認する（購入として処理する）
playerShopRoutes.post('/purchase-requests/:id/approve', requireGm, async (c) => {
  const id = c.req.param('id') ?? '';
  const parsed = ApproveInputSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400);
  const req = db.select().from(purchase_requests).where(and(eq(purchase_requests.id, id), eq(purchase_requests.status, 'pending'))).get();
  if (!req) return c.json({ error: '待っている申請が見つかりません' }, 404);
  const lines = JSON.parse(req.lines) as RequestLine[];
  const result = executePurchase({
    character_id: req.character_id,
    shop_id: req.shop_id,
    lines: lines.map((l) => ({ item_id: l.item_id, qty: l.qty, unit_price_override: l.unit_price })),
    install_cyberware: parsed.data.install_cyberware,
  });
  if (!result.ok) return c.json(result.body, result.status);
  db.update(purchase_requests).set({ status: 'approved', updated_at: Date.now() }).where(eq(purchase_requests.id, id)).run();
  sessionManager.sendToCharacter(req.character_id, { type: 'purchase-request:update', payload: {} });
  return c.json({ request: formatRequest(db.select().from(purchase_requests).where(eq(purchase_requests.id, id)).get()!), character: result.character });
});

// POST /api/purchase-requests/:id/reject: GM が見送る（ひとことを添えられる）
playerShopRoutes.post('/purchase-requests/:id/reject', requireGm, async (c) => {
  const id = c.req.param('id') ?? '';
  const parsed = z.object({ comment: z.string().max(200).optional() }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400);
  const req = db.select().from(purchase_requests).where(and(eq(purchase_requests.id, id), eq(purchase_requests.status, 'pending'))).get();
  if (!req) return c.json({ error: '待っている申請が見つかりません' }, 404);
  const comment = parsed.data.comment?.trim() || null;
  db.update(purchase_requests).set({ status: 'rejected', comment, updated_at: Date.now() }).where(eq(purchase_requests.id, id)).run();
  const names = (JSON.parse(req.lines) as RequestLine[]).map((l) => `${l.name} ×${l.qty}`).join(', ');
  sessionManager.notifyCharacter(req.character_id, 'info', '購入の申請が見送られました', comment ? `${names} — ${comment}` : names);
  sessionManager.sendToCharacter(req.character_id, { type: 'purchase-request:update', payload: {} });
  return c.json({ request: formatRequest(db.select().from(purchase_requests).where(eq(purchase_requests.id, id)).get()!) });
});
