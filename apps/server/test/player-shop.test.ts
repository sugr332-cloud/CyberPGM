import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/index.js';
import { db } from '../src/db/client.js';
import { characters, items, shop_stock } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { runDemoSeed } from '../src/db/seed-demo.js';

// Phase 5g: スマホの商店（GM が出した店の在庫だけ、購入は GM に申請して承認で処理）
describe('Player shop and purchase requests (Phase 5g)', () => {
  let gm: string;
  let player: string;
  let shopId: string;
  let pistolId: string;
  let viperId: string;
  const G = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${gm}` });
  const P = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${player}` });

  beforeAll(async () => {
    runDemoSeed();
    gm = (await (await app.request('/api/auth/gm-token', { method: 'POST' })).json()).token;
    pistolId = db.select().from(items).where(eq(items.name_en, 'Heavy Pistol')).get()!.id;
    const viper = db.select().from(characters).where(eq(characters.name, 'ヴァイパー')).get()!;
    viperId = viper.id;
    db.update(characters).set({ eb: 1000 }).where(eq(characters.id, viperId)).run();
    const session = await (await app.request('/api/session', { headers: G() })).json();
    player = (
      await (
        await app.request('/api/auth/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: session.code, character_id: viperId }) })
      ).json()
    ).token;
    shopId = (await (await app.request('/api/shops', { method: 'POST', headers: G(), body: JSON.stringify({ name: 'スマホの店', price_multiplier: 1.5, buyback_rate: 0.5, categories: ['weapon'] }) })).json()).id;
    await app.request(`/api/shops/${shopId}/stock`, { method: 'POST', headers: G(), body: JSON.stringify({ item_id: pistolId, quantity: 2 }) });
  });

  it('shows nothing until the GM opens a shop, then only its stock with stats and no GM notes', async () => {
    await app.request('/api/player-shop', { method: 'PUT', headers: G(), body: JSON.stringify({ shop_id: null }) });
    expect((await (await app.request('/api/player-shop', { headers: P() })).json()).shop).toBeNull();

    await app.request('/api/player-shop', { method: 'PUT', headers: G(), body: JSON.stringify({ shop_id: shopId }) });
    const res = await (await app.request('/api/player-shop', { headers: P() })).json();
    expect(res.shop.name).toBe('スマホの店');
    expect(res.stock).toHaveLength(1);
    const line = res.stock[0];
    const base = db.select().from(items).where(eq(items.id, pistolId)).get()!.price_eb!;
    expect(line.unit_price).toBe(Math.floor(base * 1.5));
    expect(line.item.weapon.damage).toBe('3d6');
    expect(line.item).not.toHaveProperty('effect_ja');
    expect(line.item).not.toHaveProperty('flavor_ja');
    expect(line.item).not.toHaveProperty('summary_ja');

    // GM 用の在庫の一覧も、GM 以外には効果とフレーバーを出さない
    const stock = await (await app.request(`/api/shops/${shopId}/stock`, { headers: P() })).json();
    expect(stock.stock[0].item).not.toHaveProperty('effect_ja');
  });

  it('does not buy on request; the GM approves and the purchase goes through', async () => {
    const before = db.select().from(characters).where(eq(characters.id, viperId)).get()!;
    const res = await app.request('/api/purchase-requests', { method: 'POST', headers: P(), body: JSON.stringify({ lines: [{ item_id: pistolId, qty: 1 }] }) });
    expect(res.status).toBe(201);
    const { request } = await res.json();
    expect(request.status).toBe('pending');
    expect(db.select().from(characters).where(eq(characters.id, viperId)).get()!.eb).toBe(before.eb);

    const pending = await (await app.request('/api/purchase-requests', { headers: G() })).json();
    expect(pending.requests.map((r: { id: string }) => r.id)).toContain(request.id);

    const ok = await app.request(`/api/purchase-requests/${request.id}/approve`, { method: 'POST', headers: G(), body: '{}' });
    expect(ok.status).toBe(200);
    const after = db.select().from(characters).where(eq(characters.id, viperId)).get()!;
    expect(after.eb).toBe(before.eb - request.total_eb);
    expect(JSON.parse(after.inventory).some((i: { item_id: string; kind?: string }) => i.item_id === pistolId && i.kind === 'weapon')).toBe(true);
    expect(db.select().from(shop_stock).where(eq(shop_stock.shop_id, shopId)).get()!.quantity).toBe(1);

    const twice = await app.request(`/api/purchase-requests/${request.id}/approve`, { method: 'POST', headers: G(), body: '{}' });
    expect(twice.status).toBe(404);
    const mine = await (await app.request('/api/purchase-requests/mine', { headers: P() })).json();
    expect(mine.requests[0].status).toBe('approved');
  });

  it('rejects with a comment and refuses requests over stock or funds', async () => {
    const over = await app.request('/api/purchase-requests', { method: 'POST', headers: P(), body: JSON.stringify({ lines: [{ item_id: pistolId, qty: 5 }] }) });
    expect(over.status).toBe(400);

    db.update(characters).set({ eb: 0 }).where(eq(characters.id, viperId)).run();
    const poor = await app.request('/api/purchase-requests', { method: 'POST', headers: P(), body: JSON.stringify({ lines: [{ item_id: pistolId, qty: 1 }] }) });
    expect(poor.status).toBe(400);
    db.update(characters).set({ eb: 1000 }).where(eq(characters.id, viperId)).run();

    const { request } = await (await app.request('/api/purchase-requests', { method: 'POST', headers: P(), body: JSON.stringify({ lines: [{ item_id: pistolId, qty: 1 }] }) })).json();
    const no = await app.request(`/api/purchase-requests/${request.id}/reject`, { method: 'POST', headers: G(), body: JSON.stringify({ comment: '今日は品切れ' }) });
    expect(no.status).toBe(200);
    expect((await no.json()).request).toMatchObject({ status: 'rejected', comment: '今日は品切れ' });
    expect(db.select().from(characters).where(eq(characters.id, viperId)).get()!.eb).toBe(1000);

    // プレイヤーは承認できない
    const { request: r2 } = await (await app.request('/api/purchase-requests', { method: 'POST', headers: P(), body: JSON.stringify({ lines: [{ item_id: pistolId, qty: 1 }] }) })).json();
    expect((await app.request(`/api/purchase-requests/${r2.id}/approve`, { method: 'POST', headers: P(), body: '{}' })).status).toBe(403);
  });
});
