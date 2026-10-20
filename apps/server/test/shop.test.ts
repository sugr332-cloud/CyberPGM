import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../src/index.js';
import { db } from '../src/db/client.js';
import { characters, shops, shop_stock, transactions, items } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { runDemoSeed } from '../src/db/seed-demo.js';
import { SaveFileSchema } from '@cyberpgm/shared';
import { maxHumanity, currentEmp } from '@cyberpgm/rules';

describe('Phase 3a: Shop & Commerce System', () => {
  let gmToken: string;
  let playerToken: string;
  let viperId: string;
  let heavyPistolId: string;
  let cyberOpticId: string;
  let testShopId: string;

  afterAll(() => {
    db.delete(characters).where(eq(characters.id, 'legacy-char-1')).run();
    if (testShopId) {
      db.delete(shops).where(eq(shops.id, testShopId)).run();
    }
  });

  beforeAll(async () => {
    db.delete(characters).where(eq(characters.id, 'legacy-char-1')).run();
    runDemoSeed();

    // 1. GM Token
    const gmLogin = await app.request('/api/auth/gm-token', { method: 'POST' });
    const gmData = await gmLogin.json();
    gmToken = gmData.token;

    // 2. Find Viper (PC)
    const viper = db.select().from(characters).where(eq(characters.name, 'ヴァイパー')).get()!;
    viperId = viper.id;

    // Set initial Viper EB to 1000
    await app.request(`/api/characters/${viperId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify({ eb: 1000, inventory: [] }),
    });

    // 3. Player Claim for Viper
    const sessionRes = await app.request('/api/session', {
      headers: { Authorization: `Bearer ${gmToken}` },
    });
    const sessionData = await sessionRes.json();
    const joinCode = sessionData.sessionCode;

    const claimRes = await app.request('/api/auth/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: joinCode, character_id: viperId }),
    });
    const claimData = await claimRes.json();
    playerToken = claimData.token;

    // 4. Find Items (Heavy Pistol & Cybereye / Cyberware)
    const hpItem = db.select().from(items).where(eq(items.name_en, 'Heavy Pistol')).get();
    if (hpItem) {
      heavyPistolId = hpItem.id;
    } else {
      // fallback to any weapon
      const anyWp = db.select().from(items).where(eq(items.kind, 'weapon')).get()!;
      heavyPistolId = anyWp.id;
    }

    const cwItem = db.select().from(items).where(eq(items.kind, 'cyberware')).get()!;
    cyberOpticId = cwItem.id;

    // 5. Create a Test Shop with 1.2x price and 0.5 buyback
    const shopRes = await app.request('/api/shops', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify({
        name: 'ワカコズ・ガンズ',
        price_multiplier: 1.2,
        buyback_rate: 0.5,
        categories: ['weapon', 'cyberware'],
      }),
    });
    const shopData = await shopRes.json();
    testShopId = shopData.id;

    // Set 5 Heavy Pistols in stock
    await app.request(`/api/shops/${testShopId}/stock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify({
        item_id: heavyPistolId,
        quantity: 5,
      }),
    });
  });

  describe('1. Purchase operations (§3, §7)', () => {
    it('successfully purchases an item applying shop multiplier and updates balance, inventory, and stock', async () => {
      const itemRow = db.select().from(items).where(eq(items.id, heavyPistolId)).get()!;
      const basePrice = itemRow.price_eb ?? 100;
      const expectedUnitPrice = Math.floor(basePrice * 1.2); // 120 eb

      const res = await app.request('/api/purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({
          character_id: viperId,
          shop_id: testShopId,
          lines: [{ item_id: heavyPistolId, qty: 1 }],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.total_eb).toBe(expectedUnitPrice);
      expect(data.character.eb).toBe(1000 - expectedUnitPrice);

      // Verify DB state
      const updatedViper = db.select().from(characters).where(eq(characters.id, viperId)).get()!;
      expect(updatedViper.eb).toBe(1000 - expectedUnitPrice);

      const inv = JSON.parse(updatedViper.inventory);
      expect(inv.length).toBe(1);
      expect(inv[0].item_id).toBe(heavyPistolId);
      expect(inv[0].qty).toBe(1);

      // Verify stock decreased from 5 to 4
      const stock = db
        .select()
        .from(shop_stock)
        .where(eq(shop_stock.shop_id, testShopId))
        .get()!;
      expect(stock.quantity).toBe(4);

      // Verify transaction recorded
      const tx = db.select().from(transactions).where(eq(transactions.character_id, viperId)).get()!;
      expect(tx.kind).toBe('buy');
      expect(tx.total_eb).toBe(expectedUnitPrice);
    });

    it('supports GM price override (manual discount)', async () => {
      const discountedPrice = 50;

      const res = await app.request('/api/purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({
          character_id: viperId,
          shop_id: testShopId,
          lines: [{ item_id: heavyPistolId, qty: 1, unit_price_override: discountedPrice }],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.total_eb).toBe(discountedPrice);
    });

    it('rejects purchase when PC has insufficient funds', async () => {
      const viper = db.select().from(characters).where(eq(characters.id, viperId)).get()!;
      const currentEb = viper.eb;

      const res = await app.request('/api/purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({
          character_id: viperId,
          lines: [{ item_id: heavyPistolId, qty: 1, unit_price_override: currentEb + 500 }],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('所持金が不足');
    });
  });

  describe('2. Cyberware installation & Humanity calculation (§3, §7)', () => {
    it('installs cyberware directly, updates humanity, maxHumanity, and currentEmp', async () => {
      const viperBefore = db.select().from(characters).where(eq(characters.id, viperId)).get()!;
      const initialHumanity = viperBefore.humanity; // e.g. 50
      const empStat = JSON.parse(viperBefore.stats).emp; // e.g. 5
      const specifiedHl = 4;

      const res = await app.request('/api/purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({
          character_id: viperId,
          lines: [{ item_id: cyberOpticId, qty: 1, unit_price_override: 100 }],
          install_cyberware: [{ item_id: cyberOpticId, humanity_loss: specifiedHl }],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      const updatedSheet = data.character;

      expect(updatedSheet.humanity).toBe(initialHumanity - specifiedHl);
      const cwForRules = updatedSheet.cyberware.map((cw: any) => ({
        type: cw.type,
        staticLoss: cw.static_loss ?? 0,
      }));
      expect(updatedSheet.maxHumanity).toBe(maxHumanity(empStat, cwForRules));
      expect(updatedSheet.currentEmp).toBe(currentEmp(updatedSheet.humanity, updatedSheet.maxHumanity));

      // Verify it was added to cyberware, not inventory
      const viperAfter = db.select().from(characters).where(eq(characters.id, viperId)).get()!;
      const cwList = JSON.parse(viperAfter.cyberware);
      expect(cwList.some((c: any) => c.item_id === cyberOpticId)).toBe(true);
    });
  });

  describe('3. Sell operations (§3, §7)', () => {
    it('sells an item from inventory at shop buyback rate and refunds EB', async () => {
      const viperBefore = db.select().from(characters).where(eq(characters.id, viperId)).get()!;
      const invBefore = JSON.parse(viperBefore.inventory);
      const entryToSell = invBefore[0];
      const ebBefore = viperBefore.eb;

      // Item base price
      const itemRow = db.select().from(items).where(eq(items.id, entryToSell.item_id)).get()!;
      const expectedRefund = Math.floor((itemRow.price_eb ?? 100) * 0.5); // 50% buyback

      const res = await app.request('/api/sell', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({
          character_id: viperId,
          shop_id: testShopId,
          entries: [{ entry_id: entryToSell.entry_id, qty: 1 }],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.total_refund).toBe(expectedRefund);
      expect(data.character.eb).toBe(ebBefore + expectedRefund);

      // Verify item quantity decreased or removed from inventory
      const viperAfter = db.select().from(characters).where(eq(characters.id, viperId)).get()!;
      const invAfter = JSON.parse(viperAfter.inventory);
      if (entryToSell.qty > 1) {
        const found = invAfter.find((i: any) => i.entry_id === entryToSell.entry_id);
        expect(found.qty).toBe(entryToSell.qty - 1);
      } else {
        expect(invAfter.length).toBe(invBefore.length - 1);
      }
    });
  });

  describe('4. Save file compatibility v1 & v2 (§5, §7)', () => {
    it('exports save file with version 2 including shops, stock, and transactions', async () => {
      const saveRes = await app.request('/api/saves', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({ name: '商店テスト保存' }),
      });
      expect(saveRes.status).toBe(201);
      const { save } = await saveRes.json();

      const fileRes = await app.request(`/api/saves/${save.id}/file`, {
        headers: { Authorization: `Bearer ${gmToken}` },
      });
      const fileData = await fileRes.json();
      const parsed = SaveFileSchema.safeParse(fileData);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.version).toBe(2);
        expect(parsed.data.shops.length).toBeGreaterThanOrEqual(1);
        expect(parsed.data.transactions.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('safely imports a legacy version 1 save file without shops', async () => {
      const v1Save = {
        format: 'cpgm-save',
        version: 1,
        savedAt: Date.now(),
        name: '旧形式v1保存',
        characters: [
          {
            id: 'legacy-char-1',
            kind: 'pc',
            name: 'レガシーキャラ',
            role: 'ソロ',
            stats: { int: 5, ref: 6, dex: 6, tech: 4, cool: 5, will: 5, luck: 5, move: 5, body: 6, emp: 6 },
            skills: {},
            hp: 35,
            hp_max: 35,
            sp_head: 7,
            sp_body: 7,
            humanity: 60,
            emp_max: 6,
            cyberware: [],
            weapons: [],
            inventory: ['旧形式アイテム1', '旧形式アイテム2'],
            status: [],
            crit_injuries: [],
            eb: 500,
            notes_gm: null,
            created_at: Date.now(),
            updated_at: Date.now(),
          },
        ],
        money_log: [],
        char_log: [],
        app_settings: {},
      };

      const importRes = await app.request('/api/saves/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify(v1Save),
      });

      expect(importRes.status).toBe(201);
      const { save } = await importRes.json();
      expect(save.name).toBe('旧形式v1保存');

      // Load it
      const loadRes = await app.request(`/api/saves/${save.id}/load`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gmToken}` },
      });
      expect(loadRes.status).toBe(200);

      // Verify character restored and string inventory migrated to InventoryEntry[]
      const restoredChar = db.select().from(characters).where(eq(characters.id, 'legacy-char-1')).get()!;
      expect(restoredChar.name).toBe('レガシーキャラ');
      const inv = JSON.parse(restoredChar.inventory);
      expect(inv.length).toBe(2);
      expect(inv[0].name).toBe('旧形式アイテム1');
      expect(inv[0].qty).toBe(1);
    });
  });

  describe('5. Image upload validation & permission (§4, §7)', () => {
    it('accepts valid PNG image upload', async () => {
      // 1x1 valid PNG buffer
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
        0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
        0x42, 0x60, 0x82,
      ]);

      const formData = new FormData();
      const blob = new Blob([pngBuffer], { type: 'image/png' });
      formData.append('image', blob, 'test.png');
      formData.append('origin', 'user');

      const res = await app.request(`/api/items/${heavyPistolId}/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gmToken}` },
        body: formData,
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.item_id).toBe(heavyPistolId);
      expect(data.visibility).toBe('players'); // user origin defaults to players
    });

    it('rejects SVG and disguised files with invalid magic bytes', async () => {
      // 1. Disguised file: .png extension but plain text content
      const fakeFormData = new FormData();
      const fakeBlob = new Blob(['<svg></svg>'], { type: 'image/png' });
      fakeFormData.append('image', fakeBlob, 'fake.png');

      const res1 = await app.request(`/api/items/${heavyPistolId}/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gmToken}` },
        body: fakeFormData,
      });

      expect(res1.status).toBe(400);
      const data1 = await res1.json();
      expect(data1.error).toContain('PNG, JPEG, WebP');
    });

    it('prevents player from accessing GM-only images', async () => {
      // Create a gm-only image
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const formData = new FormData();
      const blob = new Blob([pngBuffer], { type: 'image/png' });
      formData.append('image', blob, 'scan.png');
      formData.append('origin', 'book_scan'); // book_scan defaults to gm

      const uploadRes = await app.request(`/api/items/${heavyPistolId}/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gmToken}` },
        body: formData,
      });
      const imgData = await uploadRes.json();

      // Request as player
      const imgRes = await app.request(`/api/images/${imgData.id}`, {
        headers: { Authorization: `Bearer ${playerToken}` },
      });
      expect(imgRes.status).toBe(403);
    });
  });
});
