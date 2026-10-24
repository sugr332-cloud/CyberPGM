import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/index.js';
import { db, sqlite } from '../src/db/client.js';
import { items, weapons, characters } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { exportToCsv } from '@cyberpgm/shared';

describe('DB Admin API (Issue #36)', () => {
  let gmToken: string;
  const H = (contentType = 'application/json') => ({
    'Content-Type': contentType,
    Authorization: `Bearer ${gmToken}`,
  });

  beforeAll(async () => {
    const res = await app.request('/api/auth/gm-token', { method: 'POST' });
    const data = await res.json();
    gmToken = data.token;
  });

  it('GET /api/db/entities requires GM role and returns all 40 entities', async () => {
    const unauthorizedRes = await app.request('/api/db/entities');
    expect(unauthorizedRes.status).toBe(403);

    const res = await app.request('/api/db/entities', { headers: H() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entities).toBeDefined();
    expect(body.entities.length).toBe(40);

    const itemsEntity = body.entities.find((e: any) => e.name === 'items');
    expect(itemsEntity).toBeDefined();
    expect(itemsEntity.columns.some((c: any) => c.name === 'name_ja')).toBe(true);

    const weaponsEntity = body.entities.find((e: any) => e.name === 'weapons');
    expect(weaponsEntity).toBeDefined();
    expect(weaponsEntity.foreignKeys.some((fk: any) => fk.from === 'item_id' && fk.targetTable === 'items')).toBe(true);
  });

  it('GET /api/db/export/:entity exports JSON and CSV', async () => {
    // Insert a test item
    const testId = 'test-export-item-01';
    db.insert(items).values({
      id: testId,
      kind: 'gear',
      name_en: 'Export Test Item',
      name_ja: 'エクスポート試験品',
      origin: 'homebrew',
      verify_status: 'unverified',
      created_at: 1000,
      updated_at: 1000,
    }).run();

    // Export JSON
    const jsonRes = await app.request('/api/db/export/items?format=json', { headers: H() });
    expect(jsonRes.status).toBe(200);
    const jsonBody = await jsonRes.json();
    expect(jsonBody.entity).toBe('items');
    expect(jsonBody.data.some((row: any) => row.id === testId)).toBe(true);

    // Export CSV
    const csvRes = await app.request('/api/db/export/items?format=csv', { headers: H() });
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get('content-type')).toContain('text/csv');
    const csvText = await csvRes.text();
    expect(csvText).toContain('Export Test Item');
    expect(csvText).toContain('エクスポート試験品');

    // Invalid entity
    const invalidRes = await app.request('/api/db/export/non_existent_table', { headers: H() });
    expect(invalidRes.status).toBe(400);
  });

  it('POST /api/db/import/:entity imports valid JSON and CSV records', async () => {
    const importItemId1 = 'test-import-json-01';
    const importItemId2 = 'test-import-csv-02';

    // JSON import
    const jsonRes = await app.request('/api/db/import/items', {
      method: 'POST',
      headers: H('application/json'),
      body: JSON.stringify([
        {
          id: importItemId1,
          kind: 'gear',
          name_en: 'JSON Import Item',
          name_ja: 'JSONインポート品',
          origin: 'homebrew',
          verify_status: 'unverified',
          created_at: 2000,
          updated_at: 2000,
        },
      ]),
    });
    expect(jsonRes.status).toBe(200);
    const row1 = db.select().from(items).where(eq(items.id, importItemId1)).get();
    expect(row1).toBeDefined();
    expect(row1?.name_ja).toBe('JSONインポート品');

    // CSV import
    const csvData = exportToCsv([
      {
        id: importItemId2,
        kind: 'gear',
        name_en: 'CSV Import Item',
        name_ja: 'CSVインポート品',
        origin: 'homebrew',
        verify_status: 'unverified',
        created_at: 3000,
        updated_at: 3000,
      },
    ]);

    const csvRes = await app.request('/api/db/import/items', {
      method: 'POST',
      headers: H('text/csv'),
      body: csvData,
    });
    expect(csvRes.status).toBe(200);
    const row2 = db.select().from(items).where(eq(items.id, importItemId2)).get();
    expect(row2).toBeDefined();
    expect(row2?.name_ja).toBe('CSVインポート品');
  });

  it('POST /api/db/import/:entity validates required fields and does NOT partially update on failure', async () => {
    const goodId = 'test-partial-good-01';
    const badId = 'test-partial-bad-02';

    // Missing required field 'kind' in second row
    const res = await app.request('/api/db/import/items', {
      method: 'POST',
      headers: H('application/json'),
      body: JSON.stringify([
        {
          id: goodId,
          kind: 'gear',
          name_en: 'Should Not Be Inserted',
          name_ja: '挿入されないべき品',
          origin: 'homebrew',
          verify_status: 'unverified',
          created_at: 4000,
          updated_at: 4000,
        },
        {
          id: badId,
          // kind missing!
          name_en: 'Bad Missing Kind Item',
          name_ja: '種類欠損品',
          origin: 'homebrew',
          verify_status: 'unverified',
          created_at: 4000,
          updated_at: 4000,
        },
      ]),
    });

    expect(res.status).toBe(400);
    const errBody = await res.json();
    expect(errBody.error).toContain('検証エラー');
    expect(errBody.details.some((d: string) => d.includes('kind'))).toBe(true);

    // Verify atomic rollback: neither goodId nor badId should exist
    const goodRow = db.select().from(items).where(eq(items.id, goodId)).get();
    const badRow = db.select().from(items).where(eq(items.id, badId)).get();
    expect(goodRow).toBeUndefined();
    expect(badRow).toBeUndefined();
  });

  it('POST /api/db/import/:entity validates foreign key references and rejects dangling pointers', async () => {
    // weapons requires existing items.id in item_id
    const danglingItemId = 'non-existent-item-fk-999';

    const res = await app.request('/api/db/import/weapons', {
      method: 'POST',
      headers: H('application/json'),
      body: JSON.stringify([
        {
          item_id: danglingItemId,
          weapon_type: 'pistol',
          skill: 'handgun',
          damage: '2d6',
          rof: 2,
          magazine_max: 12,
          hands: 1,
          concealable: 1,
          quality: 'standard',
          autofire: 0,
          is_ranged: 1,
        },
      ]),
    });

    expect(res.status).toBe(400);
    const errBody = await res.json();
    expect(errBody.error).toContain('検証エラー');
    expect(errBody.details.some((d: string) => d.includes('参照整合性エラー'))).toBe(true);

    const danglingWeapon = db.select().from(weapons).where(eq(weapons.item_id, danglingItemId)).get();
    expect(danglingWeapon).toBeUndefined();
  });

  it('GET /api/db/unverified-items returns only unverified items and supports filtering', async () => {
    const unverifiedId = 'test-unverified-item-01';
    const verifiedId = 'test-verified-item-02';

    db.insert(items).values({
      id: unverifiedId,
      kind: 'cyberware',
      name_en: 'Unverified Cyber Test',
      name_ja: '未確認サイバー試験',
      origin: 'homebrew',
      verify_status: 'unverified',
      created_at: 5000,
      updated_at: 5000,
    }).run();

    db.insert(items).values({
      id: verifiedId,
      kind: 'cyberware',
      name_en: 'Verified Cyber Test',
      name_ja: '確認済みサイバー試験',
      origin: 'official_verified',
      verify_status: 'official_verified',
      created_at: 5000,
      updated_at: 5000,
    }).run();

    const res = await app.request('/api/db/unverified-items', { headers: H() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.some((i: any) => i.id === unverifiedId)).toBe(true);
    expect(body.items.some((i: any) => i.id === verifiedId)).toBe(false);

    // Filter by kind
    const filterRes = await app.request('/api/db/unverified-items?kind=cyberware', { headers: H() });
    const filterBody = await filterRes.json();
    expect(filterBody.items.every((i: any) => i.kind === 'cyberware')).toBe(true);

    // Search query
    const searchRes = await app.request('/api/db/unverified-items?q=未確認サイバー試験', { headers: H() });
    const searchBody = await searchRes.json();
    expect(searchBody.items.length).toBe(1);
    expect(searchBody.items[0].id).toBe(unverifiedId);
  });

  it('POST /api/db/items/bulk-verify updates verify_status in bulk and reflects in unverified list', async () => {
    const idA = 'test-bulk-a-01';
    const idB = 'test-bulk-b-02';

    db.insert(items).values({
      id: idA,
      kind: 'weapon',
      name_en: 'Bulk Test Weapon A',
      name_ja: '一括試験武器A',
      origin: 'homebrew',
      verify_status: 'unverified',
      created_at: 6000,
      updated_at: 6000,
    }).run();

    db.insert(items).values({
      id: idB,
      kind: 'weapon',
      name_en: 'Bulk Test Weapon B',
      name_ja: '一括試験武器B',
      origin: 'homebrew',
      verify_status: 'unverified',
      created_at: 6000,
      updated_at: 6000,
    }).run();

    // Bulk verify to 'official_verified'
    const bulkRes = await app.request('/api/db/items/bulk-verify', {
      method: 'POST',
      headers: H('application/json'),
      body: JSON.stringify({
        item_ids: [idA, idB],
        verify_status: 'official_verified',
      }),
    });

    expect(bulkRes.status).toBe(200);
    const bulkBody = await bulkRes.json();
    expect(bulkBody.updated_count).toBe(2);

    const rowA = db.select().from(items).where(eq(items.id, idA)).get();
    const rowB = db.select().from(items).where(eq(items.id, idB)).get();
    expect(rowA?.verify_status).toBe('official_verified');
    expect(rowB?.verify_status).toBe('official_verified');

    // Should no longer appear in unverified list
    const unverifiedRes = await app.request('/api/db/unverified-items?q=一括試験武器', { headers: H() });
    const unverifiedBody = await unverifiedRes.json();
    expect(unverifiedBody.items.length).toBe(0);

    // Invalid verify_status returns 400
    const invalidStatusRes = await app.request('/api/db/items/bulk-verify', {
      method: 'POST',
      headers: H('application/json'),
      body: JSON.stringify({
        item_ids: [idA],
        verify_status: 'invalid_status_value',
      }),
    });
    expect(invalidStatusRes.status).toBe(400);
  });

  it('GET /api/db/export-all exports full database dump and POST /api/db/import-all works atomically', async () => {
    const res = await app.request('/api/db/export-all', { headers: H() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.format).toBe('cyberpgm-db-dump');
    expect(body.entities).toBeDefined();
    expect(body.entities.items).toBeDefined();

    // Import-all with valid structure
    const importAllRes = await app.request('/api/db/import-all', {
      method: 'POST',
      headers: H('application/json'),
      body: JSON.stringify({
        entities: {
          items: [
            {
              id: 'test-dump-item-01',
              kind: 'gear',
              name_en: 'Dump Test Item',
              name_ja: 'ダンプ試験品',
              origin: 'homebrew',
              verify_status: 'unverified',
              created_at: 7000,
              updated_at: 7000,
            },
          ],
        },
      }),
    });
    expect(importAllRes.status).toBe(200);
    const row = db.select().from(items).where(eq(items.id, 'test-dump-item-01')).get();
    expect(row).toBeDefined();
  });
});
