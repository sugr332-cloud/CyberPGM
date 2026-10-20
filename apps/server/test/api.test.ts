import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { app } from '../src/index.js';
import { sessionManager } from '../src/session.js';
import { db } from '../src/db/client.js';
import { characters, devices, images } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { runDemoSeed } from '../src/db/seed-demo.js';

describe('API routes (phase 2 §4 & §9)', () => {
  beforeAll(() => {
    runDemoSeed();
  });

  beforeEach(() => {
    // Reset devices before each test to ensure clean state
    db.delete(devices).run();
  });

  it('automatically issues GM token via /api/auth/gm-token without PIN', async () => {
    const res = await app.request('/api/auth/gm-token', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toBeDefined();
    expect(data.role).toBe('gm');
    expect(data.deviceId).toBeDefined();

    // Verify GET also works
    const getRes = await app.request('/api/auth/gm-token', {
      method: 'GET',
    });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.token).toBeDefined();
    expect(getData.role).toBe('gm');
  });

  it('handles player join and character claim', async () => {
    const code = sessionManager.getSessionCode();

    // Join with invalid code
    const invalidJoin = await app.request('/api/auth/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'INVALID' }),
    });
    expect(invalidJoin.status).toBe(400);

    // Join with valid code
    const validJoin = await app.request('/api/auth/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(validJoin.status).toBe(200);
    const joinData = await validJoin.json();
    expect(joinData.characters.length).toBeGreaterThanOrEqual(4);

    const viper = joinData.characters.find((c: { name: string }) => c.name === 'ヴァイパー');
    expect(viper).toBeDefined();

    // Claim Viper
    const claimRes = await app.request('/api/auth/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, character_id: viper.id }),
    });
    expect(claimRes.status).toBe(200);
    const claimData = await claimRes.json();
    expect(claimData.token).toBeDefined();
    expect(claimData.role).toBe('player');
    expect(claimData.character_id).toBe(viper.id);

    // GET /api/me with player token
    const meRes = await app.request('/api/me', {
      headers: { Authorization: `Bearer ${claimData.token}` },
    });
    expect(meRes.status).toBe(200);
    const meData = await meRes.json();
    expect(meData.sheet.name).toBe('ヴァイパー');
    expect(meData.sheet.maxHumanity).toBeDefined();
    expect(meData.sheet.currentEmp).toBeDefined();
    expect(meData.sheet.woundState).toBe('ok');
  });

  it('handles second device claiming the same character with GM approval', async () => {
    const code = sessionManager.getSessionCode();
    const viper = db.select().from(characters).where(eq(characters.name, 'ヴァイパー')).get()!;

    // 1st device claims Viper
    const claim1 = await app.request('/api/auth/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, character_id: viper.id }),
    });
    const { token: token1 } = await claim1.json();
    expect(token1).toBeDefined();

    // GM gets token automatically
    const gmLogin = await app.request('/api/auth/gm-token', {
      method: 'POST',
    });
    const { token: gmToken } = await gmLogin.json();

    // 2nd device tries to claim Viper in background
    let claim2Resolved = false;
    let claim2Token = '';
    const claim2Promise = app
      .request('/api/auth/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Device 2' },
        body: JSON.stringify({ code, character_id: viper.id }),
      })
      .then(async (res) => {
        claim2Resolved = true;
        const d = await res.json();
        claim2Token = d.token;
        return res;
      });

    // Wait 50ms for claim request to register
    await new Promise((r) => setTimeout(r, 50));
    expect(claim2Resolved).toBe(false);

    // GM gets the pending claim request from sessionManager and resolves it
    const pendingRequests = sessionManager.getPendingClaimIds();
    expect(pendingRequests.length).toBe(1);
    const reqId = pendingRequests[0];

    const resolveRes = await app.request(`/api/auth/claim/${reqId}/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify({ allow: true }),
    });
    expect(resolveRes.status).toBe(200);

    const res2 = await claim2Promise;
    expect(res2.status).toBe(200);
    expect(claim2Token).toBeDefined();
    expect(claim2Token).not.toBe(token1);

    // Old token1 should now be revoked (401 on /api/me)
    const oldMe = await app.request('/api/me', {
      headers: { Authorization: `Bearer ${token1}` },
    });
    expect(oldMe.status).toBe(401);
  });

  it('enforces player permissions: 403 on GM APIs, GM images, and saves', async () => {
    const code = sessionManager.getSessionCode();
    const chars = db.select().from(characters).where(eq(characters.name, 'ニクス')).all();
    const nyx = chars[0];

    const claimRes = await app.request('/api/auth/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, character_id: nyx.id }),
    });
    const { token: playerToken } = await claimRes.json();

    // 1. GM APIs (e.g. GET /api/characters)
    const charsRes = await app.request('/api/characters', {
      headers: { Authorization: `Bearer ${playerToken}` },
    });
    expect(charsRes.status).toBe(403);

    // 2. Saves APIs (e.g. GET /api/saves)
    const savesRes = await app.request('/api/saves', {
      headers: { Authorization: `Bearer ${playerToken}` },
    });
    expect(savesRes.status).toBe(403);

    // 3. GM-only images
    // Insert a test GM image
    const gmImgId = 'test_gm_image_perm';
    db.insert(images)
      .values({
        id: gmImgId,
        path: 'fvtt/icons/weapons/light-pistol.svg',
        origin: 'book_scan',
        visibility: 'gm',
        is_primary: false,
      })
      .onConflictDoNothing()
      .run();

    const imgRes = await app.request(`/api/images/${gmImgId}`, {
      headers: { Authorization: `Bearer ${playerToken}` },
    });
    expect(imgRes.status).toBe(403);
  });

  it('handles money transactions, logs, and split remainder calculation', async () => {
    const gmLogin = await app.request('/api/auth/gm-token', {
      method: 'POST',
    });
    const { token: gmToken } = await gmLogin.json();

    const chars = db.select().from(characters).where(eq(characters.name, 'ジンジャー')).all();
    const ginger = chars[0];
    const initialEb = ginger.eb;

    // Send +500 eb to Ginger
    const moneyRes = await app.request(`/api/characters/${ginger.id}/money`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify({ amount: 500, reason: '依頼の前払い' }),
    });
    expect(moneyRes.status).toBe(200);
    const moneyData = await moneyRes.json();
    expect(moneyData.balance_after).toBe(initialEb + 500);

    // Check money logs
    const logsRes = await app.request('/api/money/log', {
      headers: { Authorization: `Bearer ${gmToken}` },
    });
    expect(logsRes.status).toBe(200);
    const logsData = await logsRes.json();
    expect(logsData.logs.some((l: { reason: string }) => l.reason === '依頼の前払い')).toBe(true);

    // Split money across all PCs (e.g., 1000 eb across 4 PCs -> 250 each, remainder 0)
    // or 1002 eb across 4 PCs -> 250 each, remainder 2
    const splitRes = await app.request('/api/money/split', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify({ total: 1002, reason: '略奪品の売却' }),
    });
    expect(splitRes.status).toBe(200);
    const splitData = await splitRes.json();
    expect(splitData.per_pc).toBe(250);
    expect(splitData.remainder).toBe(2);
  });

  it('handles application settings (starting_funds default to null)', async () => {
    const gmLogin = await app.request('/api/auth/gm-token', {
      method: 'POST',
    });
    const { token: gmToken } = await gmLogin.json();

    // GET settings
    const getRes = await app.request('/api/settings', {
      headers: { Authorization: `Bearer ${gmToken}` },
    });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    // Default or current value
    expect(getData).toHaveProperty('starting_funds');

    // PUT settings to 2550 eb
    const putRes = await app.request('/api/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify({ starting_funds: 2550 }),
    });
    expect(putRes.status).toBe(200);

    // Verify update
    const verifyRes = await app.request('/api/settings', {
      headers: { Authorization: `Bearer ${gmToken}` },
    });
    const verifyData = await verifyRes.json();
    expect(verifyData.starting_funds).toBe(2550);
  });
});
