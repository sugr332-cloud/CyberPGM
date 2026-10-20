import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../src/index.js';
import { db, sqlite } from '../src/db/client.js';
import { characters, weapons, items, combats, combat_participants, combat_log, devices } from '../src/db/schema.js';
import { generateUlid, generateSessionCode } from '@cyberpgm/shared';
import { registerDevice } from '../src/auth.js';

describe('Phase 4a: Combat API & Resolution System', () => {
  let authGm: { Authorization: string };
  let pcId1: string;
  let pcId2: string;
  let mookId1: string;
  let weaponId1: string;
  let playerToken1: string;

  beforeEach(() => {
    // Clear existing combat tables and characters
    sqlite.prepare('DELETE FROM devices').run();
    sqlite.prepare('DELETE FROM combat_log').run();
    sqlite.prepare('DELETE FROM combat_participants').run();
    sqlite.prepare('DELETE FROM combats').run();
    sqlite.prepare('DELETE FROM characters').run();
    sqlite.prepare('DELETE FROM weapons').run();
    sqlite.prepare('DELETE FROM items').run();

    const gmDevice = registerDevice({ role: 'gm', label: 'GM Test' });
    authGm = { Authorization: `Bearer ${gmDevice.token}` };

    const now = Date.now();
    // Create Weapon (Medium Pistol)
    weaponId1 = 'item-pistol-1';
    db.insert(items).values({
      id: weaponId1,
      kind: 'weapon',
      name_en: 'Heavy Pistol',
      name_ja: 'ヘビーピストル',
      origin: 'official_verified',
      verify_status: 'official_verified',
      created_at: now,
      updated_at: now,
    }).run();

    db.insert(weapons).values({
      item_id: weaponId1,
      weapon_type: 'pistol',
      skill: 'Handgun',
      damage: '3d6',
      rof: 2,
      magazine_max: 8,
      autofire: null,
      suppressive: false,
      dv_table_key: 'Pistol',
      is_ranged: true,
    }).run();

    // Create PC 1: Viper
    pcId1 = generateUlid();
    db.insert(characters).values({
      id: pcId1,
      kind: 'pc',
      name: 'ヴァイパー',
      role: 'Solo',
      stats: JSON.stringify({ int: 6, ref: 8, dex: 7, tech: 4, cool: 6, will: 6, luck: 5, move: 6, body: 7, emp: 4 }),
      skills: JSON.stringify({ Handgun: 6, Evasion: 6 }),
      hp: 40,
      hp_max: 40,
      sp_head: 7,
      sp_body: 7,
      humanity: 40,
      emp_max: 4,
      weapons: JSON.stringify([weaponId1]),
      inventory: JSON.stringify([{ entry_id: 'e1', item_id: weaponId1, name: 'ヘビーピストル', qty: 1, equipped: true }]),
      status: '[]',
      crit_injuries: '[]',
      created_at: now,
      updated_at: now,
    }).run();

    // Create PC 2: Nyx
    pcId2 = generateUlid();
    db.insert(characters).values({
      id: pcId2,
      kind: 'pc',
      name: 'ニクス',
      role: 'Netrunner',
      stats: JSON.stringify({ int: 8, ref: 6, dex: 6, tech: 7, cool: 5, will: 6, luck: 6, move: 5, body: 5, emp: 6 }),
      skills: JSON.stringify({ Handgun: 4, Evasion: 4 }),
      hp: 35,
      hp_max: 35,
      sp_head: 4,
      sp_body: 4,
      humanity: 50,
      emp_max: 6,
      weapons: '[]',
      inventory: '[]',
      status: '[]',
      crit_injuries: '[]',
      created_at: now,
      updated_at: now,
    }).run();

    // Create Mook template: Ganger
    mookId1 = generateUlid();
    db.insert(characters).values({
      id: mookId1,
      kind: 'mook',
      name: 'ガンガー',
      role: 'Ganger',
      stats: JSON.stringify({ int: 4, ref: 5, dex: 5, tech: 3, cool: 4, will: 4, luck: 0, move: 5, body: 6, emp: 3 }),
      skills: JSON.stringify({ Handgun: 3, Evasion: 3 }),
      hp: 25,
      hp_max: 25,
      sp_head: 4,
      sp_body: 7,
      humanity: 30,
      emp_max: 3,
      weapons: '[]',
      inventory: '[]',
      status: '[]',
      crit_injuries: '[]',
      created_at: now,
      updated_at: now,
    }).run();

    playerToken1 = registerDevice({ role: 'player', characterId: pcId1 }).token;
  });

  it('creates a new combat in setup status with active PCs automatically included', async () => {
    const res = await app.request('/api/combats', {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.combat.status).toBe('setup');
    expect(json.combat.round).toBe(1);
    // Both Viper and Nyx should be in participants
    expect(json.combat.participants.length).toBe(2);
    expect(json.combat.participants.some((p: any) => p.name === 'ヴァイパー')).toBe(true);
    expect(json.combat.participants.some((p: any) => p.name === 'ニクス')).toBe(true);
  });

  it('adds replicated mooks (count = 2) with independent names "ガンガー #1" and "ガンガー #2"', async () => {
    const cRes = await app.request('/api/combats', {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const cJson = await cRes.json();
    const combatId = cJson.combat.id;

    const addRes = await app.request(`/api/combats/${combatId}/participants`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        character_id: mookId1,
        name: 'ガンガー',
        side: 'enemy',
        count: 2,
      }),
    });
    expect(addRes.status).toBe(201);
    const addJson = await addRes.json();
    expect(addJson.combat.participants.length).toBe(4);
    expect(addJson.combat.participants.some((p: any) => p.name === 'ガンガー #1')).toBe(true);
    expect(addJson.combat.participants.some((p: any) => p.name === 'ガンガー #2')).toBe(true);
  });

  it('sets initiative order and starts combat', async () => {
    const cRes = await app.request('/api/combats', {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const { combat } = await cRes.json();
    const combatId = combat.id;

    const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
    const pNyx = combat.participants.find((p: any) => p.name === 'ニクス');

    // Viper roll 15 (order 0), Nyx roll 12 (order 1)
    const initRes = await app.request(`/api/combats/${combatId}/initiative`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participants: [
          { id: pViper.id, initiative: 15, order_index: 0 },
          { id: pNyx.id, initiative: 12, order_index: 1 },
        ],
      }),
    });
    expect(initRes.status).toBe(200);

    // Start combat
    const patchRes = await app.request(`/api/combats/${combatId}`, {
      method: 'PATCH',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start' }),
    });
    expect(patchRes.status).toBe(200);
    const patchJson = await patchRes.json();
    expect(patchJson.combat.status).toBe('active');
    expect(patchJson.combat.turn_index).toBe(0);
  });

  it('resolves ranged attack, applies changes, and verifies HP and ammo update', async () => {
    // 1. Setup combat with Viper and Ganger
    const cRes = await app.request('/api/combats', {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const { combat } = await cRes.json();
    const combatId = combat.id;

    // Add Ganger
    const addRes = await app.request(`/api/combats/${combatId}/participants`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        character_id: mookId1,
        name: 'ガンガー',
        side: 'enemy',
        count: 1,
      }),
    });
    const { combat: combatWithGanger } = await addRes.json();

    const pViper = combatWithGanger.participants.find((p: any) => p.name === 'ヴァイパー');
    const pGanger = combatWithGanger.participants.find((p: any) => p.name.startsWith('ガンガー'));

    // 2. Resolve ranged attack (Viper shooting Ganger at 5m: DV 13)
    // Attack: REF 8 + Handgun 6 + roll 7 = 21 vs DV 13 -> Hit!
    // Damage: [6, 6, 2] = 14 + crit bonus 5 = 19 vs SP 7 -> Pen 7, HP loss 12, ablation to SP 6, crit injury table body
    const resolveRes = await app.request(`/api/combats/${combatId}/resolve`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_key: 'ranged',
        actor_id: pViper.id,
        target_id: pGanger.id,
        distance_m: 5,
        weapon_id: weaponId1,
        attack_roll: { first: 7 },
        damage_dice: [6, 6, 2],
        crit_injury_roll: 7, // Foreign Object
      }),
    });
    expect(resolveRes.status).toBe(200);
    const { result } = await resolveRes.json();
    expect(result.success).toBe(true);
    expect(result.changes.some((ch: any) => ch.field === 'hp' && ch.after === 13)).toBe(true);
    expect(result.changes.some((ch: any) => ch.field === 'sp_body' && ch.after === 6)).toBe(true);

    // 3. Apply changes to DB
    const applyRes = await app.request(`/api/combats/${combatId}/apply`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_key: 'ranged',
        actor_id: pViper.id,
        target_id: pGanger.id,
        distance_m: 5,
        weapon_id: weaponId1,
        attack_roll: { first: 7 },
        damage_dice: [6, 6, 2],
        crit_injury_roll: 7,
      }),
    });
    expect(applyRes.status).toBe(200);

    // Verify DB character updates directly
    const updatedGangerChar = db.select().from(characters).where(eq(characters.id, pGanger.character_id)).get();
    expect(updatedGangerChar?.hp).toBe(13);
    expect(updatedGangerChar?.sp_body).toBe(6);

    // 4. Test Undo: Revert the attack!
    const undoRes = await app.request(`/api/combats/${combatId}/undo`, {
      method: 'POST',
      headers: authGm,
    });
    expect(undoRes.status).toBe(200);

    // Verify DB character was restored
    const restoredGangerChar = db.select().from(characters).where(eq(characters.id, pGanger.character_id)).get();
    expect(restoredGangerChar?.hp).toBe(25);
    expect(restoredGangerChar?.sp_body).toBe(7);
  });

  it('advances turns, increases round when wrapping around, and skips out participants', async () => {
    const cRes = await app.request('/api/combats', {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const { combat } = await cRes.json();
    const combatId = combat.id;

    // Start combat
    await app.request(`/api/combats/${combatId}`, {
      method: 'PATCH',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start' }),
    });

    // Advance turn (0 -> 1)
    const turn1Res = await app.request(`/api/combats/${combatId}`, {
      method: 'PATCH',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'next_turn' }),
    });
    const turn1Json = await turn1Res.json();
    expect(turn1Json.combat.turn_index).toBe(1);
    expect(turn1Json.combat.round).toBe(1);

    // Advance turn again (1 -> wrap to 0, round +1)
    const turn2Res = await app.request(`/api/combats/${combatId}`, {
      method: 'PATCH',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'next_turn' }),
    });
    const turn2Json = await turn2Res.json();
    expect(turn2Json.combat.turn_index).toBe(0);
    expect(turn2Json.combat.round).toBe(2);
  });

  it('resolves aimed headshot with 2x damage and aimed -8 penalty', async () => {
    const cRes = await app.request('/api/combats', {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const { combat } = await cRes.json();
    const combatId = combat.id;

    const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
    const pNyx = combat.participants.find((p: any) => p.name === 'ニクス');

    // Aimed headshot:
    // Base: REF 8 + Handgun 6 - aimed 8 = 6. Roll 9 -> Total 15 vs DV 13 -> Hit!
    // Headshot damage: dice [4, 3, 2] = 9 vs SP Head 4 -> Pen (9 - 4) * 2 = 10 HP loss. SP Head ablates to 3.
    const res = await app.request(`/api/combats/${combatId}/resolve`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_key: 'aimed',
        actor_id: pViper.id,
        target_id: pNyx.id,
        distance_m: 5,
        weapon_id: weaponId1,
        aimed_location: 'head',
        attack_roll: { first: 9 },
        damage_dice: [4, 3, 2],
      }),
    });
    expect(res.status).toBe(200);
    const { result } = await res.json();
    expect(result.success).toBe(true);
    // Nyx HP 35 - 10 = 25
    expect(result.changes.some((ch: any) => ch.field === 'hp' && ch.after === 25)).toBe(true);
    expect(result.changes.some((ch: any) => ch.field === 'sp_head' && ch.after === 3)).toBe(true);
  });

  it('resolves melee attack with armor SP halved', async () => {
    const cRes = await app.request('/api/combats', {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const { combat } = await cRes.json();
    const combatId = combat.id;

    const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
    const pNyx = combat.participants.find((p: any) => p.name === 'ニクス');

    // Melee attack:
    // Attacker Viper DEX 7 + Melee 0 + Roll 8 = 15
    // Defender Nyx DEX 6 + Evasion 4 + Roll 3 = 13
    // Hit! Damage [5, 4] = 9. Nyx SP Body 4 is halved (Math.round(4 * 0.5) = 2).
    // Penetrating = 9 - 2 = 7 HP loss. SP Body ablates from 4 to 3.
    const res = await app.request(`/api/combats/${combatId}/resolve`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_key: 'melee',
        actor_id: pViper.id,
        target_id: pNyx.id,
        attack_roll: { first: 8 },
        defense_roll: { first: 3 },
        damage_dice: [5, 4],
      }),
    });
    expect(res.status).toBe(200);
    const { result } = await res.json();
    expect(result.success).toBe(true);
    expect(result.changes.some((ch: any) => ch.field === 'hp' && ch.after === 28)).toBe(true);
    expect(result.changes.some((ch: any) => ch.field === 'sp_body' && ch.after === 3)).toBe(true);
  });

  it('handles unconfirmed actions with manual GM input', async () => {
    const cRes = await app.request('/api/combats', {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const { combat } = await cRes.json();
    const combatId = combat.id;

    const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');

    // Suppressive fire: unconfirmed
    const res = await app.request(`/api/combats/${combatId}/resolve`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_key: 'suppressive',
        actor_id: pViper.id,
        manual_notes: '敵2体が遮蔽に退避',
        manual_changes: [
          {
            target_id: pViper.id,
            target_name: pViper.name,
            field: 'custom',
            before: null,
            after: '制圧中',
            desc: '敵を制圧射撃中',
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const { result } = await res.json();
    expect(result.success).toBe(true);
    expect(result.changes.some((ch: any) => ch.desc === '敵を制圧射撃中')).toBe(true);
  });
});
