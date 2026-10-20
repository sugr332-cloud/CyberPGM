import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { app, injectWebSocket } from '../src/index.js';
import { getRequestListener } from '@hono/node-server';
import { startDualServer, DualServerInstance } from '../src/net.js';
import { sessionManager } from '../src/session.js';
import { db } from '../src/db/client.js';
import { characters, devices } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { runDemoSeed } from '../src/db/seed-demo.js';

describe('WebSocket synchronization (phase 2 §5 & §9)', () => {
  let serverInstance: DualServerInstance;
  let testPort: number;
  let gmToken: string;
  let tokenA: string;
  let charAId: string;
  let tokenB: string;
  let charBId: string;

  beforeAll(async () => {
    runDemoSeed();
    db.delete(devices).run(); // Ensure clean devices
    testPort = 18791;

    const listener = getRequestListener(app.fetch);
    serverInstance = await startDualServer(listener, {
      port: testPort,
      lanIp: null, // test on loopback
    });

    for (const srv of serverInstance.servers) {
      injectWebSocket(srv);
    }

    // GM Token
    const gmLogin = await app.request('/api/auth/gm-token', {
      method: 'POST',
    });
    const gmData = await gmLogin.json();
    gmToken = gmData.token;

    // Player A = ヴァイパー
    const viper = db.select().from(characters).where(eq(characters.name, 'ヴァイパー')).get()!;
    charAId = viper.id;
    const code = sessionManager.getSessionCode();

    const claimA = await app.request('/api/auth/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, character_id: charAId }),
    });
    const claimAData = await claimA.json();
    tokenA = claimAData.token;

    // Player B = ニクス
    const nyx = db.select().from(characters).where(eq(characters.name, 'ニクス')).get()!;
    charBId = nyx.id;
    const claimB = await app.request('/api/auth/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, character_id: charBId }),
    });
    const claimBData = await claimB.json();
    tokenB = claimBData.token;
  });

  afterAll(async () => {
    if (serverInstance) {
      await serverInstance.close();
    }
  });

  it('delivers me:update and notify only to target player when GM sends funds', async () => {
    const wsUrlA = `ws://127.0.0.1:${testPort}/ws?token=${tokenA}`;
    const wsUrlB = `ws://127.0.0.1:${testPort}/ws?token=${tokenB}`;

    const wsA = new WebSocket(wsUrlA);
    const wsB = new WebSocket(wsUrlB);

    interface TestWsMsg {
      type: string;
      payload?: {
        id?: string;
        kind?: string;
        title?: string;
        body?: string;
        [key: string]: unknown;
      };
    }
    const messagesA: TestWsMsg[] = [];
    const messagesB: TestWsMsg[] = [];

    await Promise.all([
      new Promise<void>((resolve) => {
        wsA.on('open', () => resolve());
      }),
      new Promise<void>((resolve) => {
        wsB.on('open', () => resolve());
      }),
    ]);

    wsA.on('message', (data) => {
      messagesA.push(JSON.parse(data.toString()));
    });
    wsB.on('message', (data) => {
      messagesB.push(JSON.parse(data.toString()));
    });

    // Clear initial sheets sent on connection
    messagesA.length = 0;
    messagesB.length = 0;

    // GM sends +500 eb to Player A (Viper)
    const moneyRes = await app.request(`/api/characters/${charAId}/money`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify({ amount: 500, reason: '報奨金' }),
    });
    expect(moneyRes.status).toBe(200);

    // Wait a brief moment for WS message propagation
    await new Promise((res) => setTimeout(res, 200));

    // Player A should have received `me:update` and `notify`
    const notifyMsg = messagesA.find((m) => m.type === 'notify');
    const updateMsg = messagesA.find((m) => m.type === 'me:update');

    expect(notifyMsg).toBeDefined();
    expect(notifyMsg.payload.kind).toBe('money');
    expect(notifyMsg.payload.title).toContain('+500 eb');
    expect(notifyMsg.payload.body).toBe('報奨金');

    expect(updateMsg).toBeDefined();
    expect(updateMsg.payload.id).toBe(charAId);

    // Player B should NOT have received notify or update for player A
    const bNotify = messagesB.find((m) => m.type === 'notify');
    const bUpdate = messagesB.find((m) => m.type === 'me:update' && m.payload.id === charAId);
    expect(bNotify).toBeUndefined();
    expect(bUpdate).toBeUndefined();

    wsA.close();
    wsB.close();
  });
});
