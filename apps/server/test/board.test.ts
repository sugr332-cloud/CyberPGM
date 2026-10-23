import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { app } from '../src/index.js';
import { db, sqlite } from '../src/db/client.js';
import { characters, images, board_tokens, board_objects } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { sessionManager } from '../src/session.js';
import { registerDevice } from '../src/auth.js';
import { generateUlid } from '@cyberpgm/shared';

describe('Phase 4b: Board API, Combat Integration & TV Broadcast (§1, §2, §3, §4, §5, §7, §8, §9)', () => {
  let gmToken: string;
  let viperCharId: string;
  let gangerCharId: string;

  beforeAll(async () => {
    // 1. Acquire GM token
    const gmDevice = registerDevice({ role: 'gm', label: 'Test GM Board' });
    gmToken = gmDevice.token;

    // 2. Seed DV Table and Weapon into items/weapons/rule_constants
    const now = Date.now();
    sqlite
      .prepare('INSERT OR REPLACE INTO rule_constants (key, value, note) VALUES (?, ?, ?)')
      .run(
        'dv_table.Pistol',
        JSON.stringify([
          { range: [0, 6], dv: 13 },
          { range: [7, 12], dv: 15 },
          { range: [13, 25], dv: 20 },
          { range: [26, 50], dv: 25 },
          { range: [51, 100], dv: 30 },
        ]),
        '',
      );

    sqlite
      .prepare(
        `INSERT OR REPLACE INTO items (id, kind, name_ja, name_en, origin, verify_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('w-pistol-1', 'weapon', '大型拳銃', 'Heavy Pistol', 'core', 'verified', now, now);

    sqlite
      .prepare(
        `INSERT OR REPLACE INTO weapons (item_id, weapon_type, skill, damage, rof, magazine_max, dv_table_key, is_ranged, autofire)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('w-pistol-1', 'pistol', 'Handgun', '3d6', 2, 8, 'Pistol', 1, 0);

    sqlite.prepare(
      `INSERT OR REPLACE INTO items (id, kind, name_ja, name_en, origin, verify_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('w-melee-test', 'weapon', 'テスト用ナイフ', 'Test Knife', 'core', 'verified', now, now);
    sqlite.prepare(
      `INSERT OR REPLACE INTO weapons (item_id, weapon_type, skill, damage, rof, magazine_max, dv_table_key, is_ranged, autofire)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('w-melee-test', 'melee', 'Melee Weapon', '1d6', 2, null, null, 0, 0);

    // 3. Fetch or create Viper (PC) and Ganger (NPC)
    const allChars = db.select().from(characters).all();
    let viper = allChars.find((c) => c.name === 'ヴァイパー');
    if (!viper) {
      const vId = generateUlid();
      db.insert(characters)
        .values({
          id: vId,
          kind: 'pc',
          name: 'ヴァイパー',
          role: 'Solo',
          stats: JSON.stringify({ int: 6, ref: 8, dex: 6, tech: 4, cool: 6, will: 6, luck: 5, move: 6, body: 7, emp: 4 }),
          skills: JSON.stringify({ handgun: 6, brawling: 4, evasion: 6 }),
          hp: 40,
          hp_max: 40,
          sp_head: 7,
          sp_body: 7,
          humanity: 40,
          emp_max: 4,
          inventory: JSON.stringify([
            {
              entry_id: 'w-pistol-1',
              name: 'ヘビー・ピストル',
              kind: 'weapon',
              ammo: 8,
              equipped: true,
            },
          ]),
          status: '[]',
          crit_injuries: '[]',
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .run();
      viper = db.select().from(characters).where(eq(characters.id, vId)).get()!;
    }
    viperCharId = viper.id;
    const viperInventory = JSON.parse(viper.inventory || '[]');
    if (!viperInventory.some((entry: { item_id?: string }) => entry.item_id === 'w-melee-test')) {
      viperInventory.push({ entry_id: 'w-melee-test-entry', item_id: 'w-melee-test', name: 'テスト用ナイフ', kind: 'weapon', equipped: true });
      db.update(characters).set({ inventory: JSON.stringify(viperInventory) }).where(eq(characters.id, viper.id)).run();
    }

    let ganger = allChars.find((c) => c.name.includes('ガンガー'));
    if (!ganger) {
      const gId = generateUlid();
      db.insert(characters)
        .values({
          id: gId,
          kind: 'npc',
          name: 'ガンガー #1',
          role: 'Ganger',
          stats: JSON.stringify({ int: 4, ref: 6, dex: 5, tech: 3, cool: 4, will: 4, luck: 0, move: 5, body: 6, emp: 3 }),
          skills: JSON.stringify({ handgun: 4, evasion: 4 }),
          hp: 25,
          hp_max: 25,
          sp_head: 4,
          sp_body: 4,
          humanity: 30,
          emp_max: 3,
          inventory: '[]',
          status: '[]',
          crit_injuries: '[]',
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .run();
      ganger = db.select().from(characters).where(eq(characters.id, gId)).get()!;
    }
    gangerCharId = ganger.id;
  });

  beforeEach(() => {
    sqlite.prepare('DELETE FROM combat_log').run();
    sqlite.prepare('DELETE FROM combat_participants').run();
    sqlite.prepare('DELETE FROM combats').run();
    sqlite.prepare('DELETE FROM board_drops').run();
    sqlite.prepare('DELETE FROM board_tokens').run();
    sqlite.prepare('DELETE FROM board_objects').run();
    sqlite.prepare('DELETE FROM boards').run();
  });

  it('manages boards, objects, and tokens via CRUD endpoints (Phase 4b §1, §8)', async () => {
    // 1. Create board
    const createRes = await app.request('/api/boards', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify({
        name: '廃ビル 1F',
        grid: { cols: 15, rows: 10, cell_m: 2, cell_px: 50 },
      }),
    });
    expect(createRes.status).toBe(201);
    const { board } = await createRes.json();
    expect(board.name).toBe('廃ビル 1F');
    expect(board.grid.cell_m).toBe(2);

    // 2. Add wall and crate
    const wallRes = await app.request(`/api/boards/${board.id}/objects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify({
        kind: 'wall',
        label: '外壁',
        x: 5,
        y: 0,
        w: 1,
        h: 5,
        passable: false,
        blocks_los: 'full',
      }),
    });
    expect(wallRes.status).toBe(201);

    const crateRes = await app.request(`/api/boards/${board.id}/objects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify({
        kind: 'crate',
        label: '木箱',
        x: 3,
        y: 2,
        w: 1,
        h: 1,
        passable: true,
        blocks_los: 'partial',
        cover_hp: 20,
        cover_hp_max: 20,
      }),
    });
    expect(crateRes.status).toBe(201);

    // 3. Add token
    const tokenRes = await app.request(`/api/boards/${board.id}/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmToken}`,
      },
      body: JSON.stringify({
        character_id: viperCharId,
        x: 1,
        y: 2,
        gm_only: false,
      }),
    });
    expect(tokenRes.status).toBe(201);

    // Check board state
    const getRes = await app.request(`/api/boards/${board.id}`);
    expect(getRes.status).toBe(200);
    const { board: loaded } = await getRes.json();
    expect(loaded.objects).toHaveLength(2);
    expect(loaded.tokens).toHaveLength(1);
  });

  it('resolves board movement with pathfinding and supports force move and undo (Phase 4b §3, §8, §9)', async () => {
    // 1. Create board
    const bRes = await app.request('/api/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ name: '移動テスト盤面', grid: { cols: 15, rows: 10, cell_m: 2 } }),
    });
    const { board } = await bRes.json();

    // Wall at (2, 0) through (2, 5), height 6
    await app.request(`/api/boards/${board.id}/objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({
        kind: 'wall',
        label: '仕切り壁',
        x: 2,
        y: 0,
        w: 1,
        h: 6,
        passable: false,
        blocks_los: 'full',
      }),
    });

    // Place Viper at (1, 1)
    const tViper = await app.request(`/api/boards/${board.id}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ character_id: viperCharId, x: 1, y: 1 }),
    });
    const { board: bWithTokens } = await tViper.json();
    const viperToken = bWithTokens.tokens.find((t: any) => t.character_id === viperCharId);

    // Place another token at (1, 2)
    await app.request(`/api/boards/${board.id}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ character_id: gangerCharId, x: 1, y: 2 }),
    });

    // Start combat with this board
    const cbRes = await app.request('/api/combats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ board_id: board.id }),
    });
    const { combat } = await cbRes.json();
    const actorPart = combat.participants.find((p: any) => p.character_id === viperCharId);

    // Test 1: Try to stop on occupied square (1, 2) -> fails
    const occRes = await app.request(`/api/combats/${combat.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({
        action_key: 'move',
        actor_id: actorPart.id,
        destination: { x: 1, y: 2 },
      }),
    });
    const occData = await occRes.json();
    expect(occData.result.success).toBe(false);

    // Test 2: Try to move through wall directly into (3, 1) with insufficient detour -> fails
    // From (1, 1) around wall ending at y=4 requires: (1,1)->(1,2)->(1,3)->(1,4)->(2,4)->(3,3)->(3,2)->(3,1) = 7 moves
    // Viper move is 6 -> cannot reach (3, 1)
    const wallRes = await app.request(`/api/combats/${combat.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({
        action_key: 'move',
        actor_id: actorPart.id,
        destination: { x: 3, y: 1 },
      }),
    });
    const wallData = await wallRes.json();
    expect(wallData.result.success).toBe(false);

    // Test 3: Normal move to reachable open square (1, 3)
    const validRes = await app.request(`/api/combats/${combat.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({
        action_key: 'move',
        actor_id: actorPart.id,
        destination: { x: 1, y: 3 },
      }),
    });
    expect(validRes.status).toBe(200);

    // Verify token position in DB was updated to (1, 3)
    const updatedTok = db.select().from(board_tokens).where(eq(board_tokens.id, viperToken.id)).get()!;
    expect(updatedTok.x).toBe(1);
    expect(updatedTok.y).toBe(3);

    // Test 4: Undo restores position to (1, 1)
    const undoRes = await app.request(`/api/combats/${combat.id}/undo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gmToken}` },
    });
    expect(undoRes.status).toBe(200);
    const restoredTok = db.select().from(board_tokens).where(eq(board_tokens.id, viperToken.id)).get()!;
    expect(restoredTok.x).toBe(1);
    expect(restoredTok.y).toBe(1);

    // Test 5: GM Force Move anywhere
    const forceRes = await app.request(`/api/combats/${combat.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({
        action_key: 'move',
        actor_id: actorPart.id,
        force_move: true,
        destination: { x: 10, y: 10 },
      }),
    });
    expect(forceRes.status).toBe(200);
    const forcedTok = db.select().from(board_tokens).where(eq(board_tokens.id, viperToken.id)).get()!;
    expect(forcedTok.x).toBe(10);
    expect(forcedTok.y).toBe(10);
  });

  it('auto-populates distance, calculates LoS, handles cover damage and destruction, and supports undo (Phase 4b §4, §9)', async () => {
    // 1. Create board
    const bRes = await app.request('/api/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ name: '射線テスト盤面' }),
    });
    const { board } = await bRes.json();

    // Wood crate with 20 HP at (2, 0)
    const crateRes = await app.request(`/api/boards/${board.id}/objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({
        kind: 'crate',
        label: '木箱',
        x: 2,
        y: 0,
        w: 1,
        h: 1,
        blocks_los: 'partial',
        cover_hp: 20,
        cover_hp_max: 20,
      }),
    });
    const { board: bWithCrate } = await crateRes.json();
    const crateObj = bWithCrate.objects.find((o: any) => o.label === '木箱');

    // Place Viper at (0, 0)
    await app.request(`/api/boards/${board.id}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ character_id: viperCharId, x: 0, y: 0 }),
    });

    // Place Ganger at (4, 0) -> Line passes through crate at (2, 0)
    await app.request(`/api/boards/${board.id}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ character_id: gangerCharId, x: 4, y: 0 }),
    });

    // Create combat
    const cbRes = await app.request('/api/combats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ board_id: board.id }),
    });
    const { combat } = await cbRes.json();

    // Add ganger as enemy participant
    await app.request(`/api/combats/${combat.id}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ character_id: gangerCharId, name: 'ガンガー #1', side: 'enemy' }),
    });

    const curCbRes = await app.request('/api/combats/current', {
      headers: { Authorization: `Bearer ${gmToken}` },
    });
    const { combat: curCombat } = await curCbRes.json();
    const viperPart = curCombat.participants.find((p: any) => p.character_id === viperCharId);
    const gangerPart = curCombat.participants.find((p: any) => p.character_id === gangerCharId);

    // Test 1: Hit cover! GM chooses to hit the cover and inflicts 20 damage (destroys cover)
    const applyHitCover = await app.request(`/api/combats/${combat.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({
        action_key: 'ranged',
        actor_id: viperPart.id,
        target_id: gangerPart.id,
        weapon_id: 'w-pistol-1',
        hit_cover: true,
        cover_object_id: crateObj.id,
        cover_damage: 20,
        attack_roll: { first: 9 }, // High roll
      }),
    });
    expect(applyHitCover.status).toBe(200);

    // Verify crate cover_hp in DB is now 0 and blocks_los is 'none'
    let crateInDb = db.select().from(board_objects).where(eq(board_objects.id, crateObj.id)).get()!;
    expect(crateInDb.cover_hp).toBe(0);
    expect(crateInDb.blocks_los).toBe('none');

    // Test 2: Undo restores crate cover_hp to 20 and blocks_los to 'partial'
    const undoRes = await app.request(`/api/combats/${combat.id}/undo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gmToken}` },
    });
    expect(undoRes.status).toBe(200);
    crateInDb = db.select().from(board_objects).where(eq(board_objects.id, crateObj.id)).get()!;
    expect(crateInDb.cover_hp).toBe(20);
    expect(crateInDb.blocks_los).toBe('partial');

    // Test 3: When cover has cover_hp = null, resolver requires GM to provide cover_current_hp and does NOT treat it as 0 (§12.7)
    db.update(board_objects).set({ cover_hp: null }).where(eq(board_objects.id, crateObj.id)).run();

    // 3a. Without cover_current_hp -> fails with missing input
    const resolveNullCover = await app.request(`/api/combats/${combat.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({
        action_key: 'ranged',
        actor_id: viperPart.id,
        target_id: gangerPart.id,
        weapon_id: 'w-pistol-1',
        hit_cover: true,
        cover_object_id: crateObj.id,
        cover_damage: 5,
        attack_roll: { first: 9 },
      }),
    });
    const nullCoverData = await resolveNullCover.json();
    expect(nullCoverData.result.success).toBe(false);
    expect(nullCoverData.result.missing_inputs).toContain('遮蔽物の HP を入力してください');

    // 3b. With GM-provided cover_current_hp = 30 -> inflicts 5 damage, new HP = 25 (not destroyed!)
    const resolveWithCoverHp = await app.request(`/api/combats/${combat.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({
        action_key: 'ranged',
        actor_id: viperPart.id,
        target_id: gangerPart.id,
        weapon_id: 'w-pistol-1',
        hit_cover: true,
        cover_object_id: crateObj.id,
        cover_current_hp: 30,
        cover_damage: 5,
        attack_roll: { first: 9 },
      }),
    });
    const withCoverHpData = await resolveWithCoverHp.json();
    expect(withCoverHpData.result.success).toBe(true);
    const coverChange = withCoverHpData.result.changes.find((c: any) => c.field === 'cover_hp');
    expect(coverChange).toBeDefined();
    expect(coverChange.after.cover_hp).toBe(25);
    expect(coverChange.after.blocks_los).toBe('partial');
  });

  it('rejects melee attack when target distance > 1 square (Phase 4b §4, §9)', async () => {
    // 1. Create board
    const bRes = await app.request('/api/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ name: '近接距離テスト盤面' }),
    });
    const { board } = await bRes.json();

    // Viper at (0, 0), Ganger at (2, 0) (distance 2 squares > 1)
    await app.request(`/api/boards/${board.id}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ character_id: viperCharId, x: 0, y: 0 }),
    });
    await app.request(`/api/boards/${board.id}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ character_id: gangerCharId, x: 2, y: 0 }),
    });

    const cbRes = await app.request('/api/combats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ board_id: board.id }),
    });
    const { combat } = await cbRes.json();

    // Add ganger as enemy participant
    await app.request(`/api/combats/${combat.id}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ character_id: gangerCharId, name: 'ガンガー #1', side: 'enemy' }),
    });

    const curCbRes = await app.request('/api/combats/current', {
      headers: { Authorization: `Bearer ${gmToken}` },
    });
    const { combat: curCombat } = await curCbRes.json();
    const viperPart = curCombat.participants.find((p: any) => p.character_id === viperCharId);
    const gangerPart = curCombat.participants.find((p: any) => p.character_id === gangerCharId);

    const meleeRes = await app.request(`/api/combats/${combat.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({
        action_key: 'melee',
        actor_id: viperPart.id,
        target_id: gangerPart.id,
        weapon_id: 'w-melee-test',
        ignore_armor_percent: 50,
        attack_roll: { first: 5 },
        defense_roll: { first: 5 },
      }),
    });
    const meleeData = await meleeRes.json();
    expect(meleeData.result.success).toBe(false);
    expect(meleeData.result.missing_inputs.some((m: string) => m.includes('隣接'))).toBe(true);
  });

  it('allows picking up dropped item from adjacent square and prevents picking up from distance > 1 (Phase 4b §5, §9)', async () => {
    // 1. Create board
    const bRes = await app.request('/api/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ name: '拾うテスト盤面' }),
    });
    const { board } = await bRes.json();

    // Viper at (1, 1)
    await app.request(`/api/boards/${board.id}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ character_id: viperCharId, x: 1, y: 1 }),
    });

    // Add drop at (1, 2) (adjacent)
    const dropRes = await app.request(`/api/boards/${board.id}/drops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({
        x: 1,
        y: 2,
        inventory_entry: {
          entry_id: 'dropped-knife-1',
          name: 'コンバット・ナイフ',
          kind: 'weapon',
        },
      }),
    });
    const { board: bWithDrop } = await dropRes.json();
    const dropObj = bWithDrop.drops[0];

    // Add another drop far away at (5, 5)
    const farDropRes = await app.request(`/api/boards/${board.id}/drops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({
        x: 5,
        y: 5,
        inventory_entry: {
          entry_id: 'far-gun-1',
          name: 'ショットガン',
          kind: 'weapon',
        },
      }),
    });
    const { board: bWithFarDrop } = await farDropRes.json();
    const farDropObj = bWithFarDrop.drops.find((d: any) => d.x === 5);

    const cbRes = await app.request('/api/combats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ board_id: board.id }),
    });
    const { combat } = await cbRes.json();
    const viperPart = combat.participants.find((p: any) => p.character_id === viperCharId);

    // 1. Try to pickup far drop -> fails
    const farRes = await app.request(`/api/combats/${combat.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({
        action_key: 'pickup',
        actor_id: viperPart.id,
        pickup_drop_id: farDropObj.id,
      }),
    });
    const farData = await farRes.json();
    expect(farData.result.success).toBe(false);

    // 2. Pickup adjacent drop -> succeeds
    const pickRes = await app.request(`/api/combats/${combat.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({
        action_key: 'pickup',
        actor_id: viperPart.id,
        pickup_drop_id: dropObj.id,
      }),
    });
    expect(pickRes.status).toBe(200);

    // Verify drop removed from board_drops
    const checkDrop = await app.request(`/api/boards/${board.id}`);
    const checkDropData = await checkDrop.json();
    expect(checkDropData.board.drops.some((d: any) => d.id === dropObj.id)).toBe(false);

    // Verify item added to Viper's inventory
    const viperChar = db.select().from(characters).where(eq(characters.id, viperCharId)).get()!;
    const inv = JSON.parse(viperChar.inventory);
    expect(inv.some((i: any) => i.name === 'コンバット・ナイフ')).toBe(true);

    // 3. Undo restores drop to board
    const undoRes = await app.request(`/api/combats/${combat.id}/undo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gmToken}` },
    });
    expect(undoRes.status).toBe(200);
    const restoredDropCheck = await app.request(`/api/boards/${board.id}`);
    const restoredData = await restoredDropCheck.json();
    expect(restoredData.board.drops.some((d: any) => d.id === dropObj.id)).toBe(true);
  });

  it('filters screen:update payload for TV: masks enemy HP/SP, excludes gm_only and hidden tokens, hides GM-only background image (Phase 4b §7, §9)', async () => {
    // 1. Create a background image with visibility = 'gm'
    const imgId = generateUlid();
    db.insert(images)
      .values({
        id: imgId,
        path: '/uploads/gm-secret-map.png',
        origin: 'book_scan',
        visibility: 'gm',
        is_primary: false,
      })
      .run();

    // 2. Create board with this background image
    const bRes = await app.request('/api/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({
        name: 'TV テスト盤面',
        background_image_id: imgId,
      }),
    });
    const { board } = await bRes.json();

    // Add token 1: Ally Viper (normal)
    await app.request(`/api/boards/${board.id}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ character_id: viperCharId, x: 1, y: 1, gm_only: false }),
    });

    // Add token 2: Enemy Ganger (hidden)
    // Mark ganger status in DB with '隠れている'
    db.update(characters)
      .set({ status: JSON.stringify(['隠れている']) })
      .where(eq(characters.id, gangerCharId))
      .run();

    await app.request(`/api/boards/${board.id}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ character_id: gangerCharId, x: 3, y: 3, gm_only: false }),
    });

    // Add token 3: GM-only token
    await app.request(`/api/boards/${board.id}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ character_id: null, x: 5, y: 5, gm_only: true }),
    });

    // 3. Create combat and turn on TV broadcast
    const cbRes = await app.request('/api/combats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({
        board_id: board.id,
        settings: { broadcastToTv: true },
      }),
    });
    const { combat } = await cbRes.json();

    // Add ganger as enemy participant
    await app.request(`/api/combats/${combat.id}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ character_id: gangerCharId, name: 'ガンガー #1', side: 'enemy' }),
    });

    // Build screen payload via sessionManager
    const screenPayload: any = sessionManager.buildScreenPayload();
    expect(screenPayload.active).toBe(true);
    expect(screenPayload.combat).toBeDefined();

    // Check Ally: HP numbers present
    const ally = screenPayload.combat.participants.find((p: any) => p.side === 'ally');
    expect(ally).toBeDefined();
    expect(ally.character.hp).toBe(40);
    expect(ally.character.hp_max).toBe(40);

    // Check Enemy: HP numbers OMITTED, only wound_state present
    const enemy = screenPayload.combat.participants.find((p: any) => p.side === 'enemy');
    expect(enemy).toBeDefined();
    expect(enemy.character.hp).toBeUndefined();
    expect(enemy.character.hp_max).toBeUndefined();
    expect(enemy.character.sp_head).toBeUndefined();
    expect(enemy.character.sp_body).toBeUndefined();
    expect(enemy.character.wound_state).toBe('健康');

    // Check Board:
    expect(screenPayload.board).toBeDefined();
    // GM-only background image omitted from TV
    expect(screenPayload.board.background_image_path).toBeNull();

    // Tokens: GM-only token omitted, and hidden enemy token omitted
    const tvTokens = screenPayload.board.tokens;
    expect(tvTokens).toHaveLength(1);
    expect(tvTokens[0].character_id).toBe(viperCharId);
    expect(tvTokens[0].name).toBe('ヴァイパー');
    expect(tvTokens[0].side).toBe('ally');
    expect(tvTokens[0].wound_state).toBe('ok');
    expect(tvTokens[0].hp).toBe(40);
    expect(tvTokens[0].hp_max).toBe(40);
    expect(tvTokens.some((t: any) => t.gm_only)).toBe(false);
    expect(tvTokens.some((t: any) => t.character_id === gangerCharId)).toBe(false);
  });
});
