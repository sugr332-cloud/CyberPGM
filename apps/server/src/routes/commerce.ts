import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  characters,
  shops,
  shop_stock,
  items,
  cyberwares,
  transactions,
  money_log,
  char_log,
} from '../db/schema.js';
import { requireGm } from '../auth.js';
import { sessionManager } from '../session.js';
import { getCharacterSheetById } from '../character-helper.js';
import {
  PurchaseInputSchema,
  SellInputSchema,
  generateUlid,
  type InventoryEntry,
  type CyberwareEntry,
} from '@cyberpgm/shared';

export const commerceRoutes = new Hono();

// POST /api/purchase - Purchase items and/or install cyberware (GM only)
commerceRoutes.post('/purchase', requireGm, async (c) => {
  const body = await c.req.json();
  const parsed = PurchaseInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid purchase data', details: parsed.error.issues }, 400);
  }

  const { character_id, shop_id, lines, install_cyberware } = parsed.data;

  // 1. Fetch character
  const charRow = db.select().from(characters).where(eq(characters.id, character_id)).get();
  if (!charRow) {
    return c.json({ error: 'Character not found' }, 404);
  }

  // 2. Fetch shop if specified
  let shopRow: typeof shops.$inferSelect | undefined;
  if (shop_id) {
    shopRow = db.select().from(shops).where(eq(shops.id, shop_id)).get();
    if (!shopRow) {
      return c.json({ error: 'Shop not found' }, 404);
    }
  }

  // 3. Resolve each line, calculate prices & check stock
  const resolvedLines: Array<{
    item_id: string;
    item: typeof items.$inferSelect;
    qty: number;
    unit_price: number;
    line_total: number;
    overridden: boolean;
    isInstallCyberware: boolean;
    humanityLoss: number;
  }> = [];

  let totalEb = 0;

  for (const line of lines) {
    const item = db.select().from(items).where(eq(items.id, line.item_id)).get();
    if (!item) {
      return c.json({ error: `Item not found: ${line.item_id}` }, 404);
    }

    const overridden = line.unit_price_override !== undefined;
    let unitPrice = 0;
    if (overridden) {
      unitPrice = line.unit_price_override!;
    } else if (shopRow) {
      unitPrice = Math.floor((item.price_eb ?? 0) * shopRow.price_multiplier);
    } else {
      unitPrice = item.price_eb ?? 0;
    }

    const lineTotal = unitPrice * line.qty;
    totalEb += lineTotal;

    // Check if installing cyberware
    const installOpt = install_cyberware?.find((ic) => ic.item_id === item.id);
    let isInstall = false;
    let humanityLoss = 0;

    if (item.kind === 'cyberware' && installOpt) {
      isInstall = true;
      const cwRow = db.select().from(cyberwares).where(eq(cyberwares.item_id, item.id)).get();
      humanityLoss = installOpt.humanity_loss ?? cwRow?.humanity_loss_static ?? 2;
    }

    resolvedLines.push({
      item_id: item.id,
      item,
      qty: line.qty,
      unit_price: unitPrice,
      line_total: lineTotal,
      overridden,
      isInstallCyberware: isInstall,
      humanityLoss,
    });
  }

  // 4. Check character funds
  if (charRow.eb < totalEb) {
    return c.json(
      {
        error: '所持金が不足しています',
        required: totalEb,
        current: charRow.eb,
        missing: totalEb - charRow.eb,
      },
      400,
    );
  }

  // 5. Check stock in shop
  if (shopRow) {
    for (const r of resolvedLines) {
      const stockItem = db
        .select()
        .from(shop_stock)
        .where(eq(shop_stock.shop_id, shopRow.id))
        .all()
        .find((s) => s.item_id === r.item_id);

      if (stockItem && stockItem.quantity !== null && stockItem.quantity < r.qty) {
        return c.json(
          {
            error: `在庫が不足しています: ${r.item.name_ja_override || r.item.name_ja || r.item.name_en} (在庫: ${stockItem.quantity})`,
          },
          400,
        );
      }
    }
  }

  const now = Date.now();
  const txLines = resolvedLines.map((r) => ({
    item_id: r.item_id,
    name: r.item.name_ja_override || r.item.name_ja || r.item.name_en,
    qty: r.qty,
    unit_price: r.unit_price,
    overridden: r.overridden,
  }));

  const itemNamesSummary = txLines.map((l) => `${l.name} ×${l.qty}`).join(', ');

  // 6. Execute in transaction
  try {
    db.transaction((tx) => {
      // A. Reduce shop stock
      if (shopRow) {
        for (const r of resolvedLines) {
          const stockItem = tx
            .select()
            .from(shop_stock)
            .where(eq(shop_stock.shop_id, shopRow!.id))
            .all()
            .find((s) => s.item_id === r.item_id);

          if (stockItem && stockItem.quantity !== null) {
            tx.update(shop_stock)
              .set({ quantity: stockItem.quantity - r.qty })
              .where(eq(shop_stock.id, stockItem.id))
              .run();
          }
        }
      }

      // B. Update character inventory & cyberware
      const inventory: InventoryEntry[] = JSON.parse(charRow.inventory || '[]');
      const cyberware: CyberwareEntry[] = JSON.parse(charRow.cyberware || '[]');
      let updatedHumanity = charRow.humanity;

      for (const r of resolvedLines) {
        if (r.isInstallCyberware) {
          // Install cyberware
          const cwRow = tx.select().from(cyberwares).where(eq(cyberwares.item_id, r.item_id)).get();
          cyberware.push({
            item_id: r.item_id,
            name: r.item.name_ja_override || r.item.name_ja || r.item.name_en,
            type: cwRow?.cw_type || 'other',
            static_loss: r.humanityLoss,
          });
          updatedHumanity = Math.max(0, updatedHumanity - r.humanityLoss * r.qty);
        } else {
          // Add to inventory
          const existingInv = inventory.find((inv) => inv.item_id === r.item_id);
          if (existingInv) {
            existingInv.qty += r.qty;
          } else {
            inventory.push({
              entry_id: generateUlid(),
              item_id: r.item_id,
              name: r.item.name_ja_override || r.item.name_ja || r.item.name_en,
              qty: r.qty,
              equipped: false,
            });
          }
        }
      }

      const balanceAfter = charRow.eb - totalEb;

      tx.update(characters)
        .set({
          eb: balanceAfter,
          humanity: updatedHumanity,
          inventory: JSON.stringify(inventory),
          cyberware: JSON.stringify(cyberware),
          updated_at: now,
        })
        .where(eq(characters.id, character_id))
        .run();

      // C. Insert transaction record
      tx.insert(transactions)
        .values({
          id: generateUlid(),
          character_id,
          shop_id: shopRow ? shopRow.id : null,
          kind: 'buy',
          lines: JSON.stringify(txLines),
          total_eb: totalEb,
          at: now,
        })
        .run();

      // D. Insert money log
      tx.insert(money_log)
        .values({
          id: generateUlid(),
          character_id,
          amount: -totalEb,
          reason: `購入: ${itemNamesSummary}`,
          balance_after: balanceAfter,
          at: now,
        })
        .run();

      // E. Insert char log
      tx.insert(char_log)
        .values({
          id: generateUlid(),
          character_id,
          text: `購入: ${itemNamesSummary} −${totalEb} eb`,
          at: now,
        })
        .run();
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `購入処理中にエラーが発生しました: ${msg}` }, 500);
  }

  // 7. Realtime Broadcast & notify
  const updatedSheet = getCharacterSheetById(character_id);
  if (updatedSheet) {
    sessionManager.updateCharacterSheet(character_id);
    sessionManager.notifyCharacter(
      character_id,
      'money',
      '購入完了',
      `購入: ${itemNamesSummary} −${totalEb} eb`,
    );
  }

  return c.json({
    success: true,
    total_eb: totalEb,
    character: updatedSheet,
  });
});

// POST /api/sell - Sell items from PC inventory (GM only)
commerceRoutes.post('/sell', requireGm, async (c) => {
  const body = await c.req.json();
  const parsed = SellInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid sell data', details: parsed.error.issues }, 400);
  }

  const { character_id, shop_id, entries } = parsed.data;

  // 1. Fetch character
  const charRow = db.select().from(characters).where(eq(characters.id, character_id)).get();
  if (!charRow) {
    return c.json({ error: 'Character not found' }, 404);
  }

  // 2. Fetch shop if specified
  let buybackRate = 0.5;
  let shopRow: typeof shops.$inferSelect | undefined;
  if (shop_id) {
    shopRow = db.select().from(shops).where(eq(shops.id, shop_id)).get();
    if (!shopRow) {
      return c.json({ error: 'Shop not found' }, 404);
    }
    buybackRate = shopRow.buyback_rate;
  }

  const inventory: InventoryEntry[] = JSON.parse(charRow.inventory || '[]');
  const resolvedLines: Array<{
    entry_id: string;
    item_id?: string;
    name: string;
    qty: number;
    unit_refund: number;
    line_total: number;
  }> = [];

  let totalRefund = 0;

  for (const entry of entries) {
    const invItem = inventory.find((i) => i.entry_id === entry.entry_id);
    if (!invItem) {
      return c.json({ error: `所持品エントリが見つかりません: ${entry.entry_id}` }, 404);
    }
    if (invItem.qty < entry.qty) {
      return c.json(
        {
          error: `売却数量が所持数を超えています: ${invItem.name} (所持: ${invItem.qty}, 売却: ${entry.qty})`,
        },
        400,
      );
    }

    let basePrice = 0;
    if (invItem.item_id) {
      const itemRow = db.select().from(items).where(eq(items.id, invItem.item_id)).get();
      basePrice = itemRow?.price_eb ?? 0;
    }

    const unitRefund = Math.floor(basePrice * buybackRate);
    const lineTotal = unitRefund * entry.qty;
    totalRefund += lineTotal;

    resolvedLines.push({
      entry_id: entry.entry_id,
      item_id: invItem.item_id,
      name: invItem.name,
      qty: entry.qty,
      unit_refund: unitRefund,
      line_total: lineTotal,
    });
  }

  const now = Date.now();
  const txLines = resolvedLines.map((r) => ({
    item_id: r.item_id || '',
    name: r.name,
    qty: r.qty,
    unit_price: r.unit_refund,
    overridden: false,
  }));

  const itemNamesSummary = txLines.map((l) => `${l.name} ×${l.qty}`).join(', ');

  // 3. Execute in transaction
  try {
    db.transaction((tx) => {
      // A. Update inventory
      for (const r of resolvedLines) {
        const idx = inventory.findIndex((i) => i.entry_id === r.entry_id);
        if (idx !== -1) {
          inventory[idx].qty -= r.qty;
          if (inventory[idx].qty <= 0) {
            inventory.splice(idx, 1);
          }
        }
      }

      const balanceAfter = charRow.eb + totalRefund;

      tx.update(characters)
        .set({
          eb: balanceAfter,
          inventory: JSON.stringify(inventory),
          updated_at: now,
        })
        .where(eq(characters.id, character_id))
        .run();

      // B. Insert transaction
      tx.insert(transactions)
        .values({
          id: generateUlid(),
          character_id,
          shop_id: shopRow ? shopRow.id : null,
          kind: 'sell',
          lines: JSON.stringify(txLines),
          total_eb: totalRefund,
          at: now,
        })
        .run();

      // C. Insert money log
      tx.insert(money_log)
        .values({
          id: generateUlid(),
          character_id,
          amount: totalRefund,
          reason: `売却: ${itemNamesSummary}`,
          balance_after: balanceAfter,
          at: now,
        })
        .run();

      // D. Insert char log
      tx.insert(char_log)
        .values({
          id: generateUlid(),
          character_id,
          text: `売却: ${itemNamesSummary} +${totalRefund} eb`,
          at: now,
        })
        .run();
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `売却処理中にエラーが発生しました: ${msg}` }, 500);
  }

  // 4. Broadcast
  const updatedSheet = getCharacterSheetById(character_id);
  if (updatedSheet) {
    sessionManager.updateCharacterSheet(character_id);
    sessionManager.notifyCharacter(
      character_id,
      'money',
      '売却完了',
      `売却: ${itemNamesSummary} +${totalRefund} eb`,
    );
  }

  return c.json({
    success: true,
    total_refund: totalRefund,
    character: updatedSheet,
  });
});

// GET /api/transactions - List transactions (GM only)
commerceRoutes.get('/transactions', requireGm, async (c) => {
  const characterId = c.req.query('character_id');

  const baseQuery = db
    .select({
      id: transactions.id,
      character_id: transactions.character_id,
      character_name: characters.name,
      shop_id: transactions.shop_id,
      shop_name: shops.name,
      kind: transactions.kind,
      lines: transactions.lines,
      total_eb: transactions.total_eb,
      at: transactions.at,
    })
    .from(transactions)
    .innerJoin(characters, eq(transactions.character_id, characters.id))
    .leftJoin(shops, eq(transactions.shop_id, shops.id))
    .orderBy(desc(transactions.at));

  let rows;
  if (characterId) {
    rows = baseQuery.where(eq(transactions.character_id, characterId)).all();
  } else {
    rows = baseQuery.all();
  }

  const result = rows.map((r) => ({
    ...r,
    lines: JSON.parse(r.lines) as Array<{
      item_id: string;
      name: string;
      qty: number;
      unit_price: number;
      overridden?: boolean;
    }>,
  }));

  return c.json({ transactions: result });
});
