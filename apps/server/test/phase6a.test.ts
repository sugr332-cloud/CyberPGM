import { getCoreSourceDir } from '../src/source-data.js';
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { app } from '../src/index.js';
import { db, sqlite } from '../src/db/client.js';
import {
  characters,
  boards,
  board_tokens,
  board_objects,
  combats,
  combat_participants,
} from '../src/db/schema.js';
import { registerDevice } from '../src/auth.js';

describe('Phase 6a: Combat GM Token Drag Move & Skill Info API', () => {
  let H: Record<string, string>;
  const now = Date.now();

  beforeEach(() => {
    for (const t of [
      'combat_log',
      'combat_participants',
      'combats',
      'board_drops',
      'board_tokens',
      'board_objects',
      'boards',
      'char_log',
      'characters',
    ]) {
      sqlite.prepare(`DELETE FROM ${t}`).run();
    }
    const { token } = registerDevice({ role: 'gm' });
    H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  });

  it('moves a token during active combat without consuming move_used, logs GM move, rejects blocked/occupied cells, and restores position on undo', async () => {
    db.insert(characters)
      .values({
        id: 'pc-viper',
        kind: 'pc',
        name: 'ヴァイパー',
        role: 'Solo',
        stats: JSON.stringify({
          int: 6,
          ref: 8,
          dex: 8,
          tech: 5,
          cool: 6,
          will: 7,
          luck: 5,
          move: 6,
          body: 7,
          emp: 5,
        }),
        skills: JSON.stringify({ handgun: 6, evasion: 6 }),
        hp: 40,
        hp_max: 40,
        sp_head: 11,
        sp_body: 11,
        humanity: 50,
        emp_max: 5,
        created_at: now,
        updated_at: now,
      })
      .run();

    db.insert(characters)
      .values({
        id: 'npc-ganger',
        kind: 'npc',
        name: 'ガンガー',
        role: 'Solo',
        stats: JSON.stringify({
          int: 4,
          ref: 6,
          dex: 6,
          tech: 4,
          cool: 4,
          will: 5,
          luck: 0,
          move: 5,
          body: 6,
          emp: 4,
        }),
        skills: JSON.stringify({ handgun: 4 }),
        hp: 30,
        hp_max: 30,
        sp_head: 7,
        sp_body: 7,
        humanity: 40,
        emp_max: 4,
        created_at: now,
        updated_at: now,
      })
      .run();

    db.insert(boards)
      .values({
        id: 'board-6a',
        name: 'Phase 6a 盤面',
        grid: JSON.stringify({
          show: true,
          cell_m: 2,
          origin_x: 0,
          origin_y: 0,
          cell_px: 40,
          cols: 12,
          rows: 10,
        }),
        created_at: now,
        updated_at: now,
      })
      .run();

    // Impassable wall at (5, 2)
    db.insert(board_objects)
      .values({
        id: 'wall-6a',
        board_id: 'board-6a',
        kind: 'wall',
        label: 'コンクリート壁',
        x: 5,
        y: 2,
        w: 1,
        h: 2,
        rotation: 0,
        passable: false,
        blocks_los: 'full',
      })
      .run();

    // Tokens
    db.insert(board_tokens)
      .values({
        id: 'tok-viper',
        board_id: 'board-6a',
        character_id: 'pc-viper',
        x: 2,
        y: 2,
        gm_only: false,
      })
      .run();

    db.insert(board_tokens)
      .values({
        id: 'tok-ganger',
        board_id: 'board-6a',
        character_id: 'npc-ganger',
        x: 8,
        y: 2,
        gm_only: false,
      })
      .run();

    // Active combat
    db.insert(combats)
      .values({
        id: 'combat-6a',
        status: 'active',
        round: 1,
        turn_index: 0,
        board_id: 'board-6a',
        settings: JSON.stringify({ tieBreak: 'reroll', board_id: 'board-6a' }),
        created_at: now,
      })
      .run();

    db.insert(combat_participants)
      .values([
        {
          id: 'part-viper',
          combat_id: 'combat-6a',
          character_id: 'pc-viper',
          side: 'ally',
          name: 'ヴァイパー',
          initiative: 15,
          order_index: 0,
          active: true,
          out: false,
          move_used: false,
          action_used: false,
          state: '{}',
        },
        {
          id: 'part-ganger',
          combat_id: 'combat-6a',
          character_id: 'npc-ganger',
          side: 'enemy',
          name: 'ガンガー',
          initiative: 10,
          order_index: 1,
          active: true,
          out: false,
          move_used: false,
          action_used: false,
          state: '{}',
        },
      ])
      .run();

    // 1. Reject moving onto impassable wall (5, 2)
    const wallRes = await app.request('/api/combats/combat-6a/move-token', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ token_id: 'tok-ganger', x: 5, y: 2 }),
    });
    expect(wallRes.status).toBe(400);
    const wallBody = await wallRes.json();
    expect(wallBody.error).toContain('通れない置物');

    // 2. Reject moving onto occupied cell (2, 2)
    const occRes = await app.request('/api/combats/combat-6a/move-token', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ token_id: 'tok-ganger', x: 2, y: 2 }),
    });
    expect(occRes.status).toBe(400);
    const occBody = await occRes.json();
    expect(occBody.error).toContain('ほかのコマがいます');

    // 3. Valid GM move of Ganger token (8,2) -> (6,4)
    const moveRes = await app.request('/api/combats/combat-6a/move-token', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ token_id: 'tok-ganger', x: 6, y: 4 }),
    });
    expect(moveRes.status).toBe(200);
    const moveBody = await moveRes.json();
    expect(moveBody.combat.logs).toHaveLength(1);
    expect(moveBody.combat.logs[0].changes[0]).toMatchObject({
      field: 'token_position',
      before: { x: 8, y: 2 },
      after: { x: 6, y: 4 },
      desc: 'GM がコマを動かした: ガンガー (8,2)→(6,4)',
    });

    // Verify token updated in DB and move_used is still false
    const updatedTok = db.select().from(board_tokens).where(eq(board_tokens.id, 'tok-ganger')).get();
    expect(updatedTok?.x).toBe(6);
    expect(updatedTok?.y).toBe(4);
    const gangerPart = db
      .select()
      .from(combat_participants)
      .where(eq(combat_participants.id, 'part-ganger'))
      .get();
    expect(gangerPart?.move_used).toBe(false);

    // 4. Undo restores token to (8, 2)
    const undoRes = await app.request('/api/combats/combat-6a/undo', {
      method: 'POST',
      headers: H,
    });
    expect(undoRes.status).toBe(200);
    const restoredTok = db.select().from(board_tokens).where(eq(board_tokens.id, 'tok-ganger')).get();
    expect(restoredTok?.x).toBe(8);
    expect(restoredTok?.y).toBe(2);
  });

  it('returns skill info when data/sources/core-ja/skills.json is present and empty fallback when absent', async () => {
    const dir = getCoreSourceDir();
    const file = path.join(dir, 'skills.json');
    const backup = path.join(dir, 'skills.json.bak-test');
    const hadOriginal = fs.existsSync(file);

    try {
      if (!hadOriginal) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          file,
          JSON.stringify({
            skills: {
              handgun: {
                summary: 'テスト用ハンドガン要約',
                uses: ['ピストル射撃'],
                opposed: ['回避'],
                pages: [82, 131],
              },
            },
          }),
        );
      }

      // Case 1: skills.json exists
      const resPresent = await app.request('/api/skill-info');
      expect(resPresent.status).toBe(200);
      const bodyPresent = await resPresent.json();
      expect(bodyPresent.hasSource).toBe(true);
      expect(bodyPresent.skills.handgun).toBeDefined();
      expect(typeof bodyPresent.skills.handgun.summary).toBe('string');
      expect(Array.isArray(bodyPresent.skills.handgun.uses)).toBe(true);
      expect(Array.isArray(bodyPresent.skills.handgun.pages)).toBe(true);

      // Case 2: skills.json does not exist
      fs.renameSync(file, backup);
      const resAbsent = await app.request('/api/skill-info');
      expect(resAbsent.status).toBe(200);
      const bodyAbsent = await resAbsent.json();
      expect(bodyAbsent).toEqual({ skills: {}, hasSource: false });
    } finally {
      if (fs.existsSync(backup)) {
        fs.renameSync(backup, file);
      } else if (!hadOriginal && fs.existsSync(file)) {
        fs.rmSync(file);
      }
    }
  });
});
