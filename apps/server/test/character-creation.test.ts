import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../src/index.js';
import { db } from '../src/db/client.js';
import { initPhase3bData } from '../src/db/init-phase3b.js';
import { characters, character_submissions, money_log } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('Phase 3b Character Creation & Reception API', () => {
  let gmToken = '';

  beforeAll(async () => {
    initPhase3bData(db);
    const res = await app.request('/api/auth/gm-token', { method: 'POST' });
    const data = await res.json();
    gmToken = data.token;
  });

  afterAll(() => {
    db.delete(characters).where(eq(characters.name, 'Alt Cunningham')).run();
    db.delete(character_submissions).run();
  });

  const gmHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${gmToken}`,
  });

  it('GET /api/creation-methods returns methods with all nulls initially', async () => {
    const res = await app.request('/api/creation-methods');
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.active_method).toBe('complete_package');
    expect(Array.isArray(data.methods)).toBe(true);

    const completePkg = data.methods.find((m: any) => m.key === 'complete_package');
    expect(completePkg).toBeDefined();
    expect(completePkg.stat_points).toBeNull();
    expect(completePkg.stat_min).toBeNull();
    expect(completePkg.stat_max).toBeNull();
    expect(completePkg.skill_points).toBeNull();
    expect(completePkg.skill_level_max).toBeNull();
    expect(completePkg.basic_skill_min).toBeNull();
    expect(completePkg.difficult_cost).toBeNull();
  });

  it('GET /api/skill-notes returns seeded skill notes', async () => {
    const res = await app.request('/api/skill-notes');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.notes).toBe('object');
    expect(data.notes.perception).toBeDefined();
    expect(data.notes.evasion).toBeDefined();
    expect(data.notes.handgun).toBeDefined();
  });

  it('PATCH /api/skill-notes/:key allows GM to update note', async () => {
    const res = await app.request('/api/skill-notes/perception', {
      method: 'PATCH',
      headers: gmHeaders(),
      body: JSON.stringify({ text: 'GMによる知覚のカスタムメモ' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.text).toBe('GMによる知覚のカスタムメモ');

    const checkRes = await app.request('/api/skill-notes');
    const checkData = await checkRes.json();
    expect(checkData.notes.perception).toBe('GMによる知覚のカスタムメモ');
  });

  it('POST /api/character-submissions creates pending submission with null-check exemption', async () => {
    const draft = {
      name: 'Johnny Silverhand',
      role: 'Rockerboy',
      stats: {
        int: 7,
        ref: 8,
        dex: 7,
        tech: 5,
        cool: 9,
        will: 8,
        luck: 6,
        move: 6,
        body: 7,
        emp: 7,
      },
      skills: {
        athletics: 3,
        handgun: 6,
        brawling: 4,
      },
      inventory: [
        { name: 'Malorian Arms 3516', qty: 1, price_eb: 500 },
      ],
      cyberware: [
        { name: 'Cyberarm (Silver)', static_loss: 7 },
      ],
    };

    const res = await app.request('/api/character-submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character: draft, source: 'wifi' }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.status).toBe('pending');
    expect(data.validation_results.valid).toBe(true);
    expect(data.validation_results.stats.unconfigured).toBe(true);

    // GM lists submissions
    const listRes = await app.request('/api/character-submissions', {
      headers: gmHeaders(),
    });
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    const found = listData.submissions.find((s: any) => s.id === data.id);
    expect(found).toBeDefined();
    expect(found.name).toBe('Johnny Silverhand');
    expect(found.role).toBe('Rockerboy');
    expect(found.source).toBe('wifi');
  });

  it('POST /api/character-submissions/:id/accept creates PC in characters table', async () => {
    // Create draft
    const draft = {
      name: 'Alt Cunningham',
      role: 'Netrunner',
      stats: {
        int: 10,
        ref: 6,
        dex: 6,
        tech: 8,
        cool: 7,
        will: 7,
        luck: 5,
        move: 5,
        body: 5,
        emp: 8,
      },
      skills: {
        basic_tech: 5,
        cybertech: 6,
      },
      inventory: [
        { name: 'Cyberdeck', qty: 1, price_eb: 500 },
      ],
      cyberware: [
        { name: 'Neural Link', static_loss: 7 },
      ],
    };

    const subRes = await app.request('/api/character-submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        character: draft,
        source: 'wifi',
        created_with: { method: 'complete_package', starting_funds: 2550 },
      }),
    });
    const subData = await subRes.json();

    // GM accepts
    const acceptRes = await app.request(`/api/character-submissions/${subData.id}/accept`, {
      method: 'POST',
      headers: gmHeaders(),
    });
    expect(acceptRes.status).toBe(200);
    const acceptData = await acceptRes.json();
    expect(acceptData.ok).toBe(true);
    expect(acceptData.character_id).toBeDefined();

    // Verify character in DB
    const pc = db
      .select()
      .from(characters)
      .where(eq(characters.id, acceptData.character_id))
      .get();
    expect(pc).toBeDefined();
    expect(pc!.name).toBe('Alt Cunningham');
    expect(pc!.role).toBe('Netrunner');
    expect(pc!.kind).toBe('pc');
    // Starting funds 2550 - 500 spent = 2050 eb
    expect(pc!.eb).toBe(2050);

    // Verify money_log entry
    const logEntry = db
      .select()
      .from(money_log)
      .where(eq(money_log.character_id, acceptData.character_id))
      .get();
    expect(logEntry).toBeDefined();
    expect(logEntry!.reason).toBe('開始資金');
    expect(logEntry!.amount).toBe(2050);
  });

  it('POST /api/character-submissions/:id/reject records GM comment', async () => {
    const draft = {
      name: 'Reject Test',
      role: 'Solo',
      stats: { int: 5, ref: 5, dex: 5, tech: 5, cool: 5, will: 5, luck: 5, move: 5, body: 5, emp: 5 },
      skills: {},
      inventory: [],
      cyberware: [],
    };

    const subRes = await app.request('/api/character-submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character: draft }),
    });
    const subData = await subRes.json();

    const rejectRes = await app.request(`/api/character-submissions/${subData.id}/reject`, {
      method: 'POST',
      headers: gmHeaders(),
      body: JSON.stringify({ comment: '能力値の割り振りを再確認してください' }),
    });
    expect(rejectRes.status).toBe(200);

    // Check status
    const checkRes = await app.request(`/api/character-submissions/${subData.id}`);
    const checkData = await checkRes.json();
    expect(checkData.status).toBe('rejected');
    expect(checkData.rejection_comment).toBe('能力値の割り振りを再確認してください');
  });

  it('POST /api/character-submissions/import handles .cpgm file import and rejects corrupted files', async () => {
    const validCpgm = {
      format: 'cpgm-character',
      version: 1,
      character: {
        name: 'Kerry Eurodyne',
        role: 'Rockerboy',
        stats: { int: 6, ref: 6, dex: 7, tech: 5, cool: 8, will: 7, luck: 6, move: 6, body: 6, emp: 8 },
        skills: { athletics: 2 },
        inventory: [{ name: 'Guitar', qty: 1, price_eb: 100 }],
        cyberware: [],
      },
      created_with: {
        method: 'complete_package',
        starting_funds: 2550,
      },
    };

    // Valid import
    const res = await app.request('/api/character-submissions/import', {
      method: 'POST',
      headers: gmHeaders(),
      body: JSON.stringify(validCpgm),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe('Kerry Eurodyne');
    expect(data.source).toBe('file');
    expect(data.status).toBe('pending');

    // Corrupted format import
    const badRes = await app.request('/api/character-submissions/import', {
      method: 'POST',
      headers: gmHeaders(),
      body: JSON.stringify({ format: 'invalid-format', version: 99 }),
    });
    expect(badRes.status).toBe(400);
  });
});
