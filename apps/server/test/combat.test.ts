import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../src/index.js';
import { db, sqlite } from '../src/db/client.js';
import {
  characters,
  weapons,
  items,
} from '../src/db/schema.js';
import { generateUlid } from '@cyberpgm/shared';
import { registerDevice } from '../src/auth.js';
import { sessionManager } from '../src/session.js';
import { saveInitiativeRoll } from '../src/routes/combat.js';
import { maskAmmoForPlayer } from '../src/character-helper.js';

describe('Phase 4a & Review 02: Combat API & Resolution System', () => {
  let authGm: { Authorization: string };
  let pcId1: string;
  let pcId2: string;
  let mookId1: string;
  let weaponIdPistol: string;
  let weaponIdRifle: string;
  let weaponIdMelee: string;

  beforeEach(() => {
    // Clear existing combat tables and characters
    sqlite.prepare('DELETE FROM devices').run();
    sqlite.prepare('DELETE FROM combat_log').run();
    sqlite.prepare('DELETE FROM combat_participants').run();
    sqlite.prepare('DELETE FROM combats').run();
    sqlite.prepare('DELETE FROM characters').run();
    sqlite.prepare('DELETE FROM weapons').run();
    sqlite.prepare('DELETE FROM items').run();
    sqlite.prepare('DELETE FROM rule_constants').run();

    const gmDevice = registerDevice({ role: 'gm', label: 'GM Test' });
    authGm = { Authorization: `Bearer ${gmDevice.token}` };

    const now = Date.now();

    // 1. Seed DV Tables into rule_constants
    // Pistol DV table
    sqlite
      .prepare('INSERT INTO rule_constants (key, value, note) VALUES (?, ?, ?)')
      .run(
        'dv_table.Pistol',
        JSON.stringify([
          { range: [0, 6], dv: 13 },
          { range: [7, 12], dv: 15 },
          { range: [13, 25], dv: 20 },
          { range: [26, 50], dv: 25 },
          { range: [51, 100], dv: 30 },
        ]),
        'Pistol DV Table',
      );

    // Assault Rifle DV table & Autofire DV table (11.2)
    sqlite
      .prepare('INSERT INTO rule_constants (key, value, note) VALUES (?, ?, ?)')
      .run(
        'dv_table.Assault Rifle',
        JSON.stringify([
          { range: [0, 6], dv: 17 },
          { range: [7, 12], dv: 16 },
          { range: [13, 25], dv: 15 },
          { range: [26, 50], dv: 20 },
        ]),
        'Assault Rifle DV Table',
      );

    sqlite
      .prepare('INSERT INTO rule_constants (key, value, note) VALUES (?, ?, ?)')
      .run(
        'dv_table.DV Assault Rifle (Autofire)',
        JSON.stringify([
          { range: [0, 6], dv: 22 },
          { range: [7, 12], dv: 20 },
          { range: [13, 25], dv: 17 },
          { range: [26, 50], dv: 20 },
        ]),
        'Assault Rifle Autofire DV Table',
      );

    // Critical injury table (11.8)
    sqlite
      .prepare('INSERT INTO rule_constants (key, value, note) VALUES (?, ?, ?)')
      .run(
        'critical_injury.body',
        JSON.stringify([
          {
            range: [7, 7],
            name: '<p>Foreign Object</p>',
            summary: '<p>−2 to all actions until removed.</p>',
          },
        ]),
        'Critical Injury Table Body',
      );

    // 2. Create Weapons
    // Heavy Pistol (ROF 2, 8 rounds)
    weaponIdPistol = 'item-pistol-1';
    db.insert(items)
      .values({
        id: weaponIdPistol,
        kind: 'weapon',
        name_en: 'Heavy Pistol',
        name_ja: 'ヘビーピストル',
        origin: 'official_verified',
        verify_status: 'official_verified',
        created_at: now,
        updated_at: now,
      })
      .run();

    db.insert(weapons)
      .values({
        item_id: weaponIdPistol,
        weapon_type: 'pistol',
        skill: 'Handgun',
        damage: '3d6',
        rof: 2,
        magazine_max: 8,
        autofire: null,
        suppressive: false,
        dv_table_key: 'Pistol',
        is_ranged: true,
        ignore_armor_percent: 0,
      })
      .run();

    // Assault Rifle (ROF 1, autofire cap 4, dvTable = DV Assault Rifle)
    weaponIdRifle = 'item-rifle-1';
    db.insert(items)
      .values({
        id: weaponIdRifle,
        kind: 'weapon',
        name_en: 'Assault Rifle',
        name_ja: 'アサルト・ライフル',
        origin: 'official_verified',
        verify_status: 'official_verified',
        created_at: now,
        updated_at: now,
      })
      .run();

    db.insert(weapons)
      .values({
        item_id: weaponIdRifle,
        weapon_type: 'assault_rifle',
        skill: 'Shoulder Arms',
        damage: '5d6',
        rof: 1,
        magazine_max: 25,
        autofire: 4,
        suppressive: true,
        dv_table_key: 'DV Assault Rifle',
        is_ranged: true,
        ignore_armor_percent: 0,
      })
      .run();

    // Melee Weapon (Knife / Machete, ignore_armor_percent = 50)
    weaponIdMelee = 'item-melee-1';
    db.insert(items)
      .values({
        id: weaponIdMelee,
        kind: 'weapon',
        name_en: 'Combat Knife',
        name_ja: 'コンバット・ナイフ',
        origin: 'official_verified',
        verify_status: 'official_verified',
        created_at: now,
        updated_at: now,
      })
      .run();

    db.insert(weapons)
      .values({
        item_id: weaponIdMelee,
        weapon_type: 'melee',
        skill: 'Melee Weapon',
        damage: '2d6',
        rof: 2,
        magazine_max: null,
        autofire: null,
        suppressive: false,
        dv_table_key: null,
        is_ranged: false,
        ignore_armor_percent: 50,
      })
      .run();

    // 3. Create PC 1: Viper (REF 8, handgun: 6, evasion: 6)
    pcId1 = generateUlid();
    db.insert(characters)
      .values({
        id: pcId1,
        kind: 'pc',
        name: 'ヴァイパー',
        role: 'Solo',
        stats: JSON.stringify({
          int: 6,
          ref: 8,
          dex: 7,
          tech: 4,
          cool: 6,
          will: 6,
          luck: 5,
          move: 6,
          body: 7,
          emp: 4,
        }),
        skills: JSON.stringify({ handgun: 6, evasion: 6, melee_weapon: 4, shoulder_arms: 5 }),
        hp: 40,
        hp_max: 40,
        sp_head: 7,
        sp_body: 7,
        humanity: 40,
        emp_max: 4,
        weapons: JSON.stringify([weaponIdPistol]),
        inventory: JSON.stringify([
          {
            entry_id: 'e1',
            item_id: weaponIdPistol,
            name: 'ヘビーピストル',
            qty: 1,
            equipped: true,
            ammo: 8,
          },
          {
            entry_id: 'e_ammo',
            name: '大型拳銃用弾薬',
            kind: 'ammo',
            qty: 5,
          },
        ]),
        status: '[]',
        crit_injuries: '[]',
        created_at: now,
        updated_at: now,
      })
      .run();

    // 4. Create PC 2: Nyx (DEX 5, evasion: 4)
    pcId2 = generateUlid();
    db.insert(characters)
      .values({
        id: pcId2,
        kind: 'pc',
        name: 'ニクス',
        role: 'Netrunner',
        stats: JSON.stringify({
          int: 8,
          ref: 6,
          dex: 5,
          tech: 7,
          cool: 5,
          will: 6,
          luck: 6,
          move: 5,
          body: 5,
          emp: 6,
        }),
        skills: JSON.stringify({ handgun: 4, evasion: 4 }),
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
      })
      .run();

    // 5. Create Mook: Ganger (HP 25, SP 7)
    mookId1 = generateUlid();
    db.insert(characters)
      .values({
        id: mookId1,
        kind: 'mook',
        name: 'ガンガー',
        role: 'Mook',
        stats: JSON.stringify({
          int: 4,
          ref: 6,
          dex: 6,
          tech: 3,
          cool: 4,
          will: 4,
          luck: 0,
          move: 4,
          body: 6,
          emp: 3,
        }),
        skills: JSON.stringify({ handgun: 4, evasion: 4 }),
        hp: 25,
        hp_max: 25,
        sp_head: 7,
        sp_body: 7,
        humanity: 30,
        emp_max: 3,
        weapons: '[]',
        inventory: '[]',
        status: '[]',
        crit_injuries: '[]',
        created_at: now,
        updated_at: now,
      })
      .run();

    const pDevice = registerDevice({
      role: 'player',
      characterId: pcId1,
      label: 'Viper Mobile',
    });
  });

  async function createTestCombat() {
    const res = await app.request('/api/combats', {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { autoRollPc: true, autoRollNpc: true } }),
    });
    const { combat } = await res.json();

    // Add Ganger to combat
    const addRes = await app.request(`/api/combats/${combat.id}/participants`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        character_id: mookId1,
        name: 'ガンガー',
        side: 'enemy',
        count: 1,
      }),
    });
    const addJson = await addRes.json();
    return addJson.combat;
  }

  // 11.3: 技能値が0にならず、canonical keyから引かれて正しく計算されるテスト
  it('11.3: resolves Viper base attack with Handgun (REF 8 + handgun 6 = 14) and Nyx defense (DEX 5 + evasion 4 = 9)', async () => {
    const combat = await createTestCombat();
    const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
    const pNyx = combat.participants.find((p: any) => p.name === 'ニクス');

    // Resolve ranged attack from Viper to Nyx (distance 5m -> DV 13)
    const resolveRes = await app.request(`/api/combats/${combat.id}/resolve`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_key: 'ranged',
        actor_id: pViper.id,
        target_id: pNyx.id,
        distance_m: 5,
        weapon_id: weaponIdPistol,
        attack_roll: { first: 7 }, // 14 + 7 = 21
        damage_dice: [3, 4, 5],
      }),
    });

    expect(resolveRes.status).toBe(200);
    const { result } = await resolveRes.json();
    expect(result.success).toBe(true);
    // Viper attack calculation should display REF 8 + 技能 6 = 14 (+ 出目 7 = 21)
    expect(result.formula).toContain('REF 8 + 技能 6 + 出目 7');

    // 2. Viper melee attacks Nyx -> Nyx defends with DEX 5 + 回避 4 + 出目 5 = 14
    const resolveMelee = await app.request(`/api/combats/${combat.id}/resolve`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_key: 'melee',
        actor_id: pViper.id,
        target_id: pNyx.id,
        weapon_id: weaponIdMelee,
        attack_roll: { first: 8 },
        defense_roll: { first: 5 }, // DEX 5 + evasion 4 + 5 = 14
        damage_dice: [3, 4],
      }),
    });
    expect(resolveMelee.status).toBe(200);
    const meleeJson = await resolveMelee.json();
    expect(meleeJson.result.success).toBe(true);
    expect(meleeJson.result.formula).toContain('DEX 5 + 回避 4 + 出目 5');
  });

  // 11.1: 作り話の値を完全排除し、未入力項目を画面へ返すテスト
  it('11.1: stops calculation and reports missing inputs when required data is not supplied', async () => {
    const combat = await createTestCombat();
    const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
    const pGanger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));

    // Missing distance and attack roll
    const resolveRes = await app.request(`/api/combats/${combat.id}/resolve`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_key: 'ranged',
        actor_id: pViper.id,
        target_id: pGanger.id,
        weapon_id: weaponIdPistol,
        // distance_m and attack_roll omitted
      }),
    });

    const json = await resolveRes.json();
    expect(json.result.success).toBe(false);
    expect(json.result.missing_inputs).toBeDefined();
    expect(json.result.missing_inputs).toContain('距離を入力してください');
    expect(json.result.missing_inputs).toContain('攻撃の出目 (1d10) を入力してください');
    expect(json.result.changes.length).toBe(0);
  });

  // 11.2: オートファイアの DV 表が dv_table.${weapon.dv_table_key} (Autofire) から正しく引かれるテスト
  it('11.2: resolves autofire using dv_table.${dvTableKey} (Autofire), always spending 10 rounds', async () => {
    const combat = await createTestCombat();
    const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
    const pGanger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));

    // Equip assault rifle to Viper
    const viperChar = db.select().from(characters).where(eq(characters.id, pcId1)).get()!;
    const inv = JSON.parse(viperChar.inventory);
    inv.push({
      entry_id: 'e_rifle',
      item_id: weaponIdRifle,
      name: 'アサルト・ライフル',
      qty: 1,
      equipped: true,
      ammo: 25,
    });
    db.update(characters)
      .set({ inventory: JSON.stringify(inv) })
      .where(eq(characters.id, pcId1))
      .run();

    // Autofire at distance 15m (Assault Rifle Autofire DV at 13-25m is 17)
    const resolveRes = await app.request(`/api/combats/${combat.id}/resolve`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_key: 'autofire',
        actor_id: pViper.id,
        target_id: pGanger.id,
        weapon_id: weaponIdRifle,
        distance_m: 15,
        attack_roll: { first: 8 }, // REF 8 + shoulder_arms 5 + 8 = 21 (DV 17 exceeds by 4)
        damage_dice: [2, 2], // 4 * multiplier (cap 4) = 16 damage
      }),
    });

    const json = await resolveRes.json();
    expect(json.result.success).toBe(true);
    expect(json.result.formula).toContain('難易度 17');
    // Verify ammo consumed in changes is 10
    const ammoChange = json.result.changes.find((c: any) => c.field === 'ammo');
    expect(ammoChange.before).toBe(25);
    expect(ammoChange.after).toBe(15);
  });

  // 11.4: 近接攻撃で weapons.ignore_armor_percent の値が適用されるテスト
  it('11.4: resolves melee attack applying weapon ignore_armor_percent (50%) to target SP', async () => {
    const combat = await createTestCombat();
    const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
    const pGanger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));

    // Viper attacks Ganger with Combat Knife (ignore_armor_percent: 50)
    // Ganger SP body is 7. Half SP = Math.floor(7 * 0.5) = 3.
    // Damage dice [4, 5] = 9. HP loss = 9 - 3 = 6. SP reduces to 6.
    const resolveRes = await app.request(`/api/combats/${combat.id}/resolve`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_key: 'melee',
        actor_id: pViper.id,
        target_id: pGanger.id,
        weapon_id: weaponIdMelee,
        attack_roll: { first: 8 }, // DEX 7 + melee_weapon 4 + 8 = 19
        defense_roll: { first: 3 }, // DEX 6 + evasion 4 + 3 = 13
        damage_dice: [4, 5],
      }),
    });

    const json = await resolveRes.json();
    expect(json.result.success).toBe(true);
    expect(json.result.formula).toContain('防具無視 50%');
    const hpChange = json.result.changes.find((c: any) => c.field === 'hp');
    expect(hpChange.before).toBe(25);
    expect(hpChange.after).toBe(20); // Effective SP = round(7 * 0.5) = 4, 9 - 4 = 5 dmg -> 25 - 5 = 20
  });

  // 11.5: 弾数管理（8/8 -> 7/8、取り消しで8/8、リロードで満タンと予備弾薬消費）のテスト
  it('11.5: tracks weapon ammo on attack, restores on undo, and refills on reload', async () => {
    const combat = await createTestCombat();
    const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
    const pGanger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));

    // 1. Attack once -> ammo decreases from 8 to 7
    const applyRes = await app.request(`/api/combats/${combat.id}/apply`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_key: 'ranged',
        actor_id: pViper.id,
        target_id: pGanger.id,
        distance_m: 5,
        weapon_id: weaponIdPistol,
        attack_roll: { first: 7 },
        damage_dice: [3, 3, 3],
      }),
    });

    expect(applyRes.status).toBe(200);
    const updatedChar1 = db.select().from(characters).where(eq(characters.id, pcId1)).get()!;
    const inv1 = JSON.parse(updatedChar1.inventory);
    const pistol1 = inv1.find((i: any) => i.item_id === weaponIdPistol);
    expect(pistol1.ammo).toBe(7);

    // 2. Undo -> ammo restores to 8
    const undoRes = await app.request(`/api/combats/${combat.id}/undo`, {
      method: 'POST',
      headers: authGm,
    });
    expect(undoRes.status).toBe(200);
    const restoredChar = db.select().from(characters).where(eq(characters.id, pcId1)).get()!;
    const invRestored = JSON.parse(restoredChar.inventory);
    const pistolRestored = invRestored.find((i: any) => i.item_id === weaponIdPistol);
    expect(pistolRestored.ammo).toBe(8);

    // 3. Shoot down to 0 and reload
    pistolRestored.ammo = 0;
    db.update(characters)
      .set({ inventory: JSON.stringify(invRestored) })
      .where(eq(characters.id, pcId1))
      .run();

    const reloadRes = await app.request(`/api/combats/${combat.id}/apply`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_key: 'reload',
        actor_id: pViper.id,
        weapon_id: weaponIdPistol,
      }),
    });
    expect(reloadRes.status).toBe(200);
    const reloadedChar = db.select().from(characters).where(eq(characters.id, pcId1)).get()!;
    const invReloaded = JSON.parse(reloadedChar.inventory);
    const pistolReloaded = invReloaded.find((i: any) => i.item_id === weaponIdPistol);
    expect(pistolReloaded.ammo).toBe(8); // magazine_max
    // Spare ammo decreased by 1
    const spareAmmo = invReloaded.find((i: any) => i.name === '大型拳銃用弾薬');
    expect(spareAmmo.qty).toBe(4);
  });

  // 11.6: 出目 10 / 1 のとき追加ロールが未入力なら計算を止めるテスト
  it('11.6: requires extra roll when attack or defense roll is 10 or 1', async () => {
    const combat = await createTestCombat();
    const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
    const pGanger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));

    // Attack roll = 10 without extra
    const resolveRes1 = await app.request(`/api/combats/${combat.id}/resolve`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_key: 'ranged',
        actor_id: pViper.id,
        target_id: pGanger.id,
        distance_m: 5,
        weapon_id: weaponIdPistol,
        attack_roll: { first: 10 }, // extra omitted
      }),
    });
    const json1 = await resolveRes1.json();
    expect(json1.result.success).toBe(false);
    expect(json1.result.missing_inputs).toContain(
      '攻撃クリティカル: 追加出目 (1d10) を入力してください',
    );

    // With extra = 4
    const resolveRes2 = await app.request(`/api/combats/${combat.id}/resolve`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_key: 'ranged',
        actor_id: pViper.id,
        target_id: pGanger.id,
        distance_m: 5,
        weapon_id: weaponIdPistol,
        attack_roll: { first: 10, extra: 4 }, // 10 + 4 = 14
        damage_dice: [3, 3, 3],
      }),
    });
    const json2 = await resolveRes2.json();
    expect(json2.result.success).toBe(true);
    // 14 (base) + 14 (roll) = 28
    expect(json2.result.formula).toContain('出目 14 = 28');
  });

  // 11.7: 大型拳銃（ROF 2）で 2 回分の変化がまとめて反映され、弾が 2 減るテスト
  it('11.7: resolves ROF 2 sequential attacks in one action, applying 2 hits and spending 2 ammo', async () => {
    const combat = await createTestCombat();
    const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
    const pGanger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));

    const applyRes = await app.request(`/api/combats/${combat.id}/apply`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_key: 'ranged',
        actor_id: pViper.id,
        weapon_id: weaponIdPistol,
        attacks: [
          {
            target_id: pGanger.id,
            distance_m: 5,
            attack_roll: { first: 7 }, // hits
            damage_dice: [3, 4, 4], // 11 damage
          },
          {
            target_id: pGanger.id,
            distance_m: 5,
            attack_roll: { first: 8 }, // hits
            damage_dice: [3, 3, 5], // 11 damage
          },
        ],
      }),
    });

    expect(applyRes.status).toBe(200);
    const json = await applyRes.json();
    expect(json.result.success).toBe(true);
    // Ammo should decrease by 2 (8 -> 6)
    const ammoChange = json.result.changes.find((c: any) => c.field === 'ammo');
    expect(ammoChange.before).toBe(8);
    expect(ammoChange.after).toBe(6);

    // Ganger should take damage from both shots
    const gangerAfter = db.select().from(characters).where(eq(characters.id, pGanger.character_id)).get()!;
    expect(gangerAfter.hp).toBeLessThan(25);
    const pistolAfter = JSON.parse(
      db.select().from(characters).where(eq(characters.id, pcId1)).get()!.inventory,
    ).find((i: any) => i.item_id === weaponIdPistol);
    expect(pistolAfter.ammo).toBe(6);
  });

  // 11.8: 致命傷表 2d6 の出目要求と HTML タグ除去のテスト
  it('11.8: requires 2d6 roll on critical injury and strips HTML tags from description', async () => {
    const combat = await createTestCombat();
    const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
    const pGanger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));

    // Two 6s rolled in damage dice (critical injury) without crit roll
    const resolveRes1 = await app.request(`/api/combats/${combat.id}/resolve`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_key: 'ranged',
        actor_id: pViper.id,
        target_id: pGanger.id,
        distance_m: 5,
        weapon_id: weaponIdPistol,
        attack_roll: { first: 7 },
        damage_dice: [6, 6, 2], // Two 6s -> Critical!
      }),
    });
    const json1 = await resolveRes1.json();
    expect(json1.result.success).toBe(false);
    expect(json1.result.missing_inputs).toContain('致命傷表 (2d6) の出目を入力してください');

    // With crit_injury_roll = 7
    const resolveRes2 = await app.request(`/api/combats/${combat.id}/resolve`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_key: 'ranged',
        actor_id: pViper.id,
        target_id: pGanger.id,
        distance_m: 5,
        weapon_id: weaponIdPistol,
        attack_roll: { first: 7 },
        damage_dice: [6, 6, 2],
        crit_injury_roll: 7,
      }),
    });
    const json2 = await resolveRes2.json();
    expect(json2.result.success).toBe(true);
    const critChange = json2.result.changes.find((c: any) => c.field === 'crit_injuries');
    expect(critChange).toBeDefined();
    // HTML tags stripped
    expect(critChange.desc).not.toContain('<p>');
    expect(critChange.desc).toContain('Foreign Object');
  });

  // 11.9: プレイヤーに敵の HP/SP 数値を送らないテスト
  it('11.9: does not leak enemy numeric HP and SP to player in combat:result notification', async () => {
    let capturedPlayerNotification: any = null;
    const originalNotify = sessionManager.notifyCombatResult.bind(sessionManager);
    sessionManager.notifyCombatResult = (params: any) => {
      if (params.characterId === pcId1 && !params.is_victim) {
        capturedPlayerNotification = params;
      }
      originalNotify(params);
    };

    const combat = await createTestCombat();
    const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
    const pGanger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));

    await app.request(`/api/combats/${combat.id}/apply`, {
      method: 'POST',
      headers: { ...authGm, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_key: 'ranged',
        actor_id: pViper.id,
        target_id: pGanger.id,
        distance_m: 5,
        weapon_id: weaponIdPistol,
        attack_roll: { first: 7 },
        damage_dice: [3, 4, 5], // 12 damage
      }),
    });

    expect(capturedPlayerNotification).not.toBeNull();
    // Verify player notification does not contain raw enemy HP or SP changes
    const enemySpChange = capturedPlayerNotification.changes.find(
      (c: any) => c.target_id === pGanger.character_id && (c.field === 'sp_head' || c.field === 'sp_body'),
    );
    expect(enemySpChange).toBeUndefined();

    const enemyHpChange = capturedPlayerNotification.changes.find(
      (c: any) => c.target_id === pGanger.character_id && c.field === 'hp',
    );
    expect(enemyHpChange).toBeUndefined();

    // Verify player receives formatted damage summary without leaking exact remaining HP
    const customSummary = capturedPlayerNotification.changes.find(
      (c: any) => c.target_id === pGanger.character_id && c.field === 'custom',
    );
    expect(customSummary).toBeDefined();
    expect(customSummary.desc).toMatch(/命中 · ガンガー.* に \d+ ダメージ →/);
  });

  describe('Phase 4a Review 03: Defaults cleanup, Spare ammo by kind, and Weapon entry alignment (§12)', () => {
    // 12.1: 作り話の既定値の全廃
    it('12.1: halts reload when magazine_max is undefined or null', async () => {
      const combat = await createTestCombat();
      const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');

      // weaponIdMelee has magazine_max: null
      const res = await app.request(`/api/combats/${combat.id}/resolve`, {
        method: 'POST',
        headers: { ...authGm, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_key: 'reload',
          actor_id: pViper.id,
          weapon_id: weaponIdMelee,
        }),
      });

      const json = await res.json();
      expect(json.result.success).toBe(false);
      expect(json.result.formula).toBe('装弾数が不明なためリロードできません');
      expect(json.result.missing_inputs).toContain('装弾数が不明なためリロードできません');
    });

    it('12.1: halts autofire when autofire cap is missing or unconfigured', async () => {
      const combat = await createTestCombat();
      const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const pGanger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));

      // weaponIdPistol has autofire: null
      const res = await app.request(`/api/combats/${combat.id}/resolve`, {
        method: 'POST',
        headers: { ...authGm, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_key: 'autofire',
          actor_id: pViper.id,
          target_id: pGanger.id,
          distance_m: 5,
          weapon_id: weaponIdPistol,
          ammo_spent: 10,
          attack_roll: { first: 8 },
          damage_dice: [2, 2],
        }),
      });

      const json = await res.json();
      expect(json.result.missing_inputs.join()).toContain('フルオート射撃ができません');
    });

    it('12.1: requires GM input for ignore_armor_percent when weapon value is missing, and resolves once provided', async () => {
      const combat = await createTestCombat();
      const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const pGanger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));

      // Insert melee weapon with ignore_armor_percent: null
      const nullIgnoreWepId = 'item-melee-null-ignore';
      const now = Date.now();
      db.insert(items).values({
        id: nullIgnoreWepId,
        kind: 'weapon',
        name_en: 'Improvised Club',
        name_ja: '角材',
        origin: 'official_verified',
        verify_status: 'official_verified',
        created_at: now,
        updated_at: now,
      }).run();

      db.insert(weapons).values({
        item_id: nullIgnoreWepId,
        weapon_type: 'melee',
        skill: 'Melee Weapon',
        damage: '2d6',
        rof: 2,
        magazine_max: null,
        autofire: null,
        suppressive: false,
        dv_table_key: null,
        is_ranged: false,
        ignore_armor_percent: null,
      }).run();

      // Without GM input -> missing_inputs
      const res1 = await app.request(`/api/combats/${combat.id}/resolve`, {
        method: 'POST',
        headers: { ...authGm, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_key: 'melee',
          actor_id: pViper.id,
          target_id: pGanger.id,
          weapon_id: nullIgnoreWepId,
          attack_roll: { first: 8 },
          defense_roll: { first: 3 },
          damage_dice: [4, 5],
        }),
      });
      const json1 = await res1.json();
      expect(json1.result.missing_inputs).toContain('防具無視率が不明です (GM が入力してください)');

      // With GM input (30%) -> resolves successfully
      const res2 = await app.request(`/api/combats/${combat.id}/resolve`, {
        method: 'POST',
        headers: { ...authGm, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_key: 'melee',
          actor_id: pViper.id,
          target_id: pGanger.id,
          weapon_id: nullIgnoreWepId,
          ignore_armor_percent: 30,
          attack_roll: { first: 8 },
          defense_roll: { first: 3 },
          damage_dice: [4, 5],
        }),
      });
      const json2 = await res2.json();
      expect(json2.result.success).toBe(true);
      expect(json2.result.formula).toContain('防具無視 30%');
    });

    it('12.1: does not check or deduct ammo when weapon magazine_max is null', async () => {
      const combat = await createTestCombat();
      const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const pGanger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));

      // weapon with magazine_max: null (e.g. bow or thrown weapon)
      const thrownWepId = 'item-thrown-1';
      const now = Date.now();
      db.insert(items).values({
        id: thrownWepId,
        kind: 'weapon',
        name_en: 'Thrown Knife',
        name_ja: '投げナイフ',
        origin: 'official_verified',
        verify_status: 'official_verified',
        created_at: now,
        updated_at: now,
      }).run();

      db.insert(weapons).values({
        item_id: thrownWepId,
        weapon_type: 'pistol',
        skill: 'Handgun',
        damage: '2d6',
        rof: 1,
        magazine_max: null,
        autofire: null,
        suppressive: false,
        dv_table_key: 'Pistol',
        is_ranged: true,
        ignore_armor_percent: 0,
      }).run();

      const res = await app.request(`/api/combats/${combat.id}/resolve`, {
        method: 'POST',
        headers: { ...authGm, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_key: 'ranged',
          actor_id: pViper.id,
          target_id: pGanger.id,
          distance_m: 5,
          weapon_id: thrownWepId,
          attack_roll: { first: 7 },
          damage_dice: [3, 4],
        }),
      });

      const json = await res.json();
      expect(json.result.success).toBe(true);
      // No ammo change recorded
      const ammoChange = json.result.changes.find((c: any) => c.field === 'ammo');
      expect(ammoChange).toBeUndefined();
    });

    // 12.2: 予備弾薬を kind = 'ammo' で探索 & 予備なしリロード不可
    it('12.2: prohibits reload when no spare ammo with kind = ammo is present in inventory', async () => {
      const combat = await createTestCombat();
      const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');

      // Set inventory with no kind = 'ammo' items (even if name has '弾薬')
      db.update(characters)
        .set({
          inventory: JSON.stringify([
            {
              entry_id: 'e1',
              item_id: weaponIdPistol,
              name: 'ヘビーピストル',
              kind: 'weapon',
              qty: 1,
              equipped: true,
              ammo: 0,
            },
            {
              entry_id: 'e_misc',
              name: '弾薬箱 (空)',
              qty: 1,
            },
          ]),
        })
        .where(eq(characters.id, pcId1))
        .run();

      const res = await app.request(`/api/combats/${combat.id}/resolve`, {
        method: 'POST',
        headers: { ...authGm, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_key: 'reload',
          actor_id: pViper.id,
          weapon_id: weaponIdPistol,
        }),
      });

      const json = await res.json();
      expect(json.result.success).toBe(false);
      expect(json.result.formula).toBe('予備の弾薬がありません');
      expect(json.result.missing_inputs).toContain('予備の弾薬がありません');
    });

    it('12.2: consumes spare ammo of qty 1 on reload and removes the entry completely from inventory', async () => {
      const combat = await createTestCombat();
      const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');

      // Set inventory with spare ammo qty: 1
      db.update(characters)
        .set({
          inventory: JSON.stringify([
            {
              entry_id: 'e1',
              item_id: weaponIdPistol,
              name: 'ヘビーピストル',
              kind: 'weapon',
              qty: 1,
              equipped: true,
              ammo: 0,
            },
            {
              entry_id: 'e_spare_single',
              name: '大型拳銃弾 (予備パック)',
              kind: 'ammo',
              qty: 1,
            },
          ]),
        })
        .where(eq(characters.id, pcId1))
        .run();

      const applyRes = await app.request(`/api/combats/${combat.id}/apply`, {
        method: 'POST',
        headers: { ...authGm, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_key: 'reload',
          actor_id: pViper.id,
          weapon_id: weaponIdPistol,
        }),
      });

      expect(applyRes.status).toBe(200);
      const reloadedChar = db.select().from(characters).where(eq(characters.id, pcId1)).get()!;
      const invReloaded = JSON.parse(reloadedChar.inventory);
      const pistolReloaded = invReloaded.find((i: any) => i.item_id === weaponIdPistol);
      expect(pistolReloaded.ammo).toBe(8); // restored to magazine_max

      // Verify spare ammo entry was completely removed (not left at qty 0)
      const spareEntry = invReloaded.find((i: any) => i.entry_id === 'e_spare_single');
      expect(spareEntry).toBeUndefined();
    });

    // 12.3: 武器選択欄と計算武器の不一致解消
    it('12.3: resolves action and deducts ammo by weapon_entry_id from kind = weapon inventory entries', async () => {
      const combat = await createTestCombat();
      const pViper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const pGanger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));

      // Character has 2 weapons in inventory
      const customEntry1 = 'w_entry_primary';
      const customEntry2 = 'w_entry_secondary';
      db.update(characters)
        .set({
          inventory: JSON.stringify([
            {
              entry_id: customEntry1,
              item_id: weaponIdPistol,
              name: '大型拳銃 #1',
              kind: 'weapon',
              qty: 1,
              equipped: true,
              ammo: 8,
            },
            {
              entry_id: customEntry2,
              item_id: weaponIdPistol,
              name: '大型拳銃 #2',
              kind: 'weapon',
              qty: 1,
              equipped: true,
              ammo: 4,
            },
          ]),
        })
        .where(eq(characters.id, pcId1))
        .run();

      // Fire weapon #2 using weapon_entry_id
      const applyRes = await app.request(`/api/combats/${combat.id}/apply`, {
        method: 'POST',
        headers: { ...authGm, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_key: 'ranged',
          actor_id: pViper.id,
          target_id: pGanger.id,
          distance_m: 5,
          weapon_id: weaponIdPistol,
          weapon_entry_id: customEntry2,
          attack_roll: { first: 7 },
          damage_dice: [3, 3, 3],
        }),
      });

      expect(applyRes.status).toBe(200);
      const updatedChar = db.select().from(characters).where(eq(characters.id, pcId1)).get()!;
      const inv = JSON.parse(updatedChar.inventory);
      const w1 = inv.find((i: any) => i.entry_id === customEntry1);
      const w2 = inv.find((i: any) => i.entry_id === customEntry2);

      // Weapon #1 was untouched at 8
      expect(w1.ammo).toBe(8);
      // Weapon #2 decreased from 4 to 3
      expect(w2.ammo).toBe(3);
    });
  });

  // Phase 5j: 移動とアクションを使い切ったら自動で次の手番へ。取り消しで戻る。2 回行動
  describe('Phase 5j: turn auto-advance and multiple actions', () => {
    const H = () => ({ ...authGm, 'Content-Type': 'application/json' });
    const apply = (combatId: string, actorId: string, action_key: string) =>
      app.request(`/api/combats/${combatId}/apply`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ action_key, actor_id: actorId, manual_changes: [] }),
      });
    const start = async () => {
      const combat = await createTestCombat();
      const res = await app.request(`/api/combats/${combat.id}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ action: 'start' }) });
      return (await res.json()).combat;
    };

    it('advances to the next turn after move + action, and undo brings the turn back', async () => {
      const combat = await start();
      const actor = combat.participants[0];
      const first = await (await apply(combat.id, actor.id, 'move')).json();
      expect(first.auto_advanced).toBe(false);
      const second = await (await apply(combat.id, actor.id, 'other')).json();
      expect(second.auto_advanced).toBe(true);
      expect(second.combat.turn_index).toBe(1);
      expect(second.combat.participants[0].action_used).toBe(false);

      const undo = await (await app.request(`/api/combats/${combat.id}/undo`, { method: 'POST', headers: authGm })).json();
      expect(undo.combat.turn_index).toBe(0);
      expect(undo.combat.participants[0].move_used).toBe(true);
      expect(undo.combat.participants[0].action_used).toBe(false);
    });

    it('undoes a manual next turn ("一手戻る")', async () => {
      const combat = await start();
      await app.request(`/api/combats/${combat.id}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ action: 'next_turn' }) });
      const undo = await (await app.request(`/api/combats/${combat.id}/undo`, { method: 'POST', headers: authGm })).json();
      expect(undo.combat.turn_index).toBe(0);
      expect(undo.combat.round).toBe(1);
    });

    it('refuses a second action in one turn, unless the GM grants more', async () => {
      const combat = await start();
      const actor = combat.participants[0];
      await apply(combat.id, actor.id, 'other');
      const again = await apply(combat.id, actor.id, 'other');
      expect(again.status).toBe(400);
      expect((await again.json()).error).toContain('アクションは使い切っています');

      // このターンだけ +1 アクション
      await app.request(`/api/combats/${combat.id}/participants/${actor.id}/actions`, { method: 'POST', headers: H(), body: JSON.stringify({ bonus: 1 }) });
      const bonus = await apply(combat.id, actor.id, 'other');
      expect(bonus.status).toBe(200);
      const after = await (await apply(combat.id, actor.id, 'move')).json();
      expect(after.auto_advanced).toBe(true);
      // ターンが終わると +1 は消える
      const p0 = after.combat.participants[0];
      expect(p0.state.bonus_actions).toBeUndefined();
      expect(p0.state.actions_taken).toBeUndefined();
    });

    it('moves text-only weapons into the inventory so they can be chosen in combat', async () => {
      db.update(characters).set({ weapons: JSON.stringify(['Heavy Pistol', '謎の銃']), inventory: '[]' }).where(eq(characters.id, pcId1)).run();
      const combat = await createTestCombat();
      const p = combat.participants.find((x: any) => x.character_id === pcId1);
      const w = p.character.inventory.filter((i: any) => i.kind === 'weapon');
      expect(w.map((i: any) => i.item_id)).toEqual([weaponIdPistol]);
      expect(w[0].ammo).toBe(8);
      expect(p.character.weapons).toEqual(['謎の銃']);
    });

    it('lets a participant act twice every turn (actions_per_turn = 2)', async () => {
      const combat = await start();
      const actor = combat.participants[0];
      await app.request(`/api/combats/${combat.id}/participants/${actor.id}/actions`, { method: 'POST', headers: H(), body: JSON.stringify({ actions_per_turn: 2 }) });
      const a1 = await (await apply(combat.id, actor.id, 'other')).json();
      expect(a1.combat.participants[0].action_used).toBe(false);
      expect(a1.result.changes[0].desc).toContain('1/2 回目');
      await apply(combat.id, actor.id, 'move');
      const a2 = await (await apply(combat.id, actor.id, 'other')).json();
      expect(a2.auto_advanced).toBe(true);
      // 次のターンでも 2 回のまま
      expect(a2.combat.participants[0].state.actions_per_turn).toBe(2);
    });
  });

  // Phase 5l: 流れに沿った点検で見つかった戦闘の不具合
  describe('Phase 5l: brawl, participant check, phone initiative', () => {
    const H = () => ({ ...authGm, 'Content-Type': 'application/json' });

    it('resolves a brawl with damage dice from BODY (BODY 7 = 3d6), armor applies', async () => {
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const ganger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));
      const res = await app.request(`/api/combats/${combat.id}/resolve`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({
          action_key: 'brawl',
          actor_id: viper.id,
          target_id: ganger.id,
          attack_roll: { first: 9 },
          defense_roll: { first: 2 },
          damage_dice: [4, 4, 4],
        }),
      });
      const { result } = await res.json();
      expect(result.formula).toContain('格闘 (3d6)');
      const hp = result.changes.find((ch: any) => ch.field === 'hp');
      expect(hp.before - hp.after).toBe(12 - ganger.character.sp_body);
    });

    it('drops unchecked participants when the combat starts', async () => {
      const combat = await createTestCombat();
      const nyx = combat.participants.find((p: any) => p.name === 'ニクス');
      await app.request(`/api/combats/${combat.id}/participants/${nyx.id}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ active: false }) });
      const started = await (await app.request(`/api/combats/${combat.id}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ action: 'start' }) })).json();
      expect(started.combat.participants.some((p: any) => p.name === 'ニクス')).toBe(false);
    });

    it('keeps the initiative roll sent from a phone on the participant', async () => {
      const combat = await createTestCombat();
      saveInitiativeRoll(pcId1, { first: 7 });
      const cur = await (await app.request('/api/combats/current', { headers: authGm })).json();
      const viper = cur.combat.participants.find((p: any) => p.character_id === pcId1);
      expect(viper.initiative_roll).toEqual({ first: 7 });
      expect(cur.combat.id).toBe(combat.id);
    });
  });

  // Phase 5m: 攻撃の結果が HP・SP・状態に正しく入るか（ルールとの突き合わせ）
  describe('Phase 5m: attack results reach HP/SP/status', () => {
    const H = () => ({ ...authGm, 'Content-Type': 'application/json' });
    const resolve = async (combatId: string, body: Record<string, unknown>) =>
      (await (await app.request(`/api/combats/${combatId}/resolve`, { method: 'POST', headers: H(), body: JSON.stringify(body) })).json()).result;

    it('applies both hits of a ROF 2 melee attack, the second from the HP/SP left by the first', async () => {
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const ganger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));
      const g = ganger.character;
      const hit = { target_id: ganger.id, attack_roll: { first: 9 }, defense_roll: { first: 2 }, damage_dice: [5, 5] };
      const result = await resolve(combat.id, { action_key: 'melee', actor_id: viper.id, weapon_id: weaponIdMelee, attacks: [hit, hit] });
      const hps = result.changes.filter((ch: any) => ch.field === 'hp');
      expect(hps).toHaveLength(2);
      // 近接武器は SP 半分（切り上げ）。1 回目のあと SP は 1 減る
      const sp1 = Math.round(g.sp_body / 2);
      const after1 = g.hp - (10 - sp1);
      expect(hps[0].after).toBe(after1);
      const sp2 = Math.round((g.sp_body - 1) / 2);
      expect(hps[1].before).toBe(after1);
      expect(hps[1].after).toBe(after1 - (10 - sp2));
      const sps = result.changes.filter((ch: any) => ch.field === 'sp_body');
      expect(sps.map((c: any) => c.after)).toEqual([g.sp_body - 1, g.sp_body - 2]);
    });

    it('writes both hits to the database on apply, and undo restores HP and SP', async () => {
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const ganger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));
      const g = ganger.character;
      const hit = { target_id: ganger.id, attack_roll: { first: 9 }, defense_roll: { first: 2 }, damage_dice: [5, 5] };
      const res = await app.request(`/api/combats/${combat.id}/apply`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ action_key: 'melee', actor_id: viper.id, weapon_id: weaponIdMelee, attacks: [hit, hit] }),
      });
      expect(res.status).toBe(200);
      const row = db.select().from(characters).where(eq(characters.id, g.id)).get()!;
      const after1 = g.hp - (10 - Math.round(g.sp_body / 2));
      expect(row.hp).toBe(after1 - (10 - Math.round((g.sp_body - 1) / 2)));
      expect(row.sp_body).toBe(g.sp_body - 2);
      await app.request(`/api/combats/${combat.id}/undo`, { method: 'POST', headers: authGm });
      const back = db.select().from(characters).where(eq(characters.id, g.id)).get()!;
      expect(back.hp).toBe(g.hp);
      expect(back.sp_body).toBe(g.sp_body);
    });

    it('refuses more attacks than the weapon ROF, and the wrong number of damage dice', async () => {
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const ganger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));
      const hit = { target_id: ganger.id, attack_roll: { first: 9 }, defense_roll: { first: 2 }, damage_dice: [5, 5] };
      const three = await resolve(combat.id, { action_key: 'melee', actor_id: viper.id, weapon_id: weaponIdMelee, attacks: [hit, hit, hit] });
      expect(three.missing_inputs.join()).toContain('ROF は 2');
      const wrongDice = await resolve(combat.id, { action_key: 'melee', actor_id: viper.id, weapon_id: weaponIdMelee, attacks: [{ ...hit, damage_dice: [5] }] });
      expect(wrongDice.missing_inputs.join()).toContain('2d6 なので、d6 の出目を 2 個');
    });

    it('marks the target seriously wounded and adds +5 on a critical (two 6s)', async () => {
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const ganger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));
      const g = ganger.character;
      const result = await resolve(combat.id, {
        action_key: 'melee', actor_id: viper.id, weapon_id: weaponIdMelee,
        attacks: [{ target_id: ganger.id, attack_roll: { first: 9 }, defense_roll: { first: 2 }, damage_dice: [6, 6], crit_injury_roll: 7 }],
      });
      const hp = result.changes.find((ch: any) => ch.field === 'hp');
      expect(g.hp - hp.after).toBe(12 - Math.round(g.sp_body / 2) + 5);
      expect(result.changes.some((ch: any) => ch.field === 'crit_injuries')).toBe(true);
      if (hp.after < Math.ceil(g.hp_max / 2)) expect(result.changes.some((ch: any) => ch.field === 'status')).toBe(true);
    });

    it('stabilizes a mortally wounded ally to HP 1 with first aid (DV 15)', async () => {
      db.update(characters).set({ hp: 0, status: JSON.stringify(['mortally']) }).where(eq(characters.id, pcId2)).run();
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const nyx = combat.participants.find((p: any) => p.name === 'ニクス');
      const fail = await resolve(combat.id, { action_key: 'first_aid', actor_id: viper.id, target_id: nyx.id, attack_roll: { first: 2 } });
      expect(fail.formula).toContain('難易度 15（瀕死）-> 失敗');
      const ok = await resolve(combat.id, { action_key: 'first_aid', actor_id: viper.id, target_id: nyx.id, attack_roll: { first: 10, extra: 9 } });
      expect(ok.success).toBe(true);
      expect(ok.changes.find((ch: any) => ch.field === 'hp').after).toBe(1);
      expect(ok.changes.find((ch: any) => ch.field === 'status').after).toEqual(['seriously']);
    });

    it('lowers REF for ranged attacks by the heaviest worn armor penalty', async () => {
      db.insert(items).values({ id: 'item-flak', kind: 'armor', name_en: 'Flak', name_ja: 'フラック', origin: 'official_verified', verify_status: 'official_verified', created_at: 1, updated_at: 1 }).run();
      sqlite.prepare('INSERT INTO armors (item_id, sp_head, sp_body, is_head, is_body, is_shield, shield_hp, penalty) VALUES (?, 0, 15, 0, 1, 0, 0, 4)').run('item-flak');
      const viperRow = db.select().from(characters).where(eq(characters.id, pcId1)).get()!;
      const inv = JSON.parse(viperRow.inventory);
      db.update(characters).set({ inventory: JSON.stringify([...inv, { entry_id: 'flak', item_id: 'item-flak', name: 'フラック', kind: 'armor', qty: 1, equipped: true }]) }).where(eq(characters.id, pcId1)).run();
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const ganger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));
      expect(viper.character.armor_penalty).toBe(4);
      const r = await resolve(combat.id, { action_key: 'ranged', actor_id: viper.id, target_id: ganger.id, weapon_id: weaponIdPistol, distance_m: 5, attack_roll: { first: 5 }, damage_dice: [1, 1, 1] });
      expect(r.formula).toContain('REF 4 + 技能 6');
    });

    it('allows running only after the move action, and cuts MOVE by 6 while mortally wounded', async () => {
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const run = await resolve(combat.id, { action_key: 'run', actor_id: viper.id });
      expect(run.missing_inputs.join()).toContain('移動アクションを使ったあと');
      db.update(characters).set({ hp: 0 }).where(eq(characters.id, pcId1)).run();
      const move = await resolve(combat.id, { action_key: 'move', actor_id: viper.id });
      expect(move.formula).toContain('MOVE 1マス');
      expect(move.formula).toContain('瀕死 6');
    });
  });

  // Phase 5q: 日本語版コアルールブックとの差（瀕死中の被弾、気絶、フルオート 10 発、死亡セーヴの基本値、頭蓋損傷、サイバーアーム）
  describe('Phase 5q: rulebook fixes', () => {
    const H = () => ({ ...authGm, 'Content-Type': 'application/json' });
    const resolve = async (combatId: string, body: Record<string, unknown>) =>
      (await (await app.request(`/api/combats/${combatId}/resolve`, { method: 'POST', headers: H(), body: JSON.stringify(body) })).json()).result;
    const pistolShot = (targetId: string, extra: Record<string, unknown> = {}) => ({
      action_key: 'ranged',
      target_id: targetId,
      weapon_id: weaponIdPistol,
      distance_m: 5,
      attack_roll: { first: 9 },
      damage_dice: [5, 5, 4],
      ...extra,
    });

    it('gives a critical injury and +1 death save penalty when a mortally wounded target takes damage (p.186・188)', async () => {
      db.update(characters).set({ hp: 0, status: JSON.stringify(['mortally']) }).where(eq(characters.id, pcId2)).run();
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const nyx = combat.participants.find((p: any) => p.name === 'ニクス');
      const noRoll = await resolve(combat.id, { ...pistolShot(nyx.id), actor_id: viper.id });
      expect(noRoll.missing_inputs).toContain('致命傷表 (2d6) の出目を入力してください');
      const r = await resolve(combat.id, { ...pistolShot(nyx.id, { crit_injury_roll: 7 }), actor_id: viper.id });
      const crit = r.changes.find((ch: any) => ch.field === 'crit_injuries');
      expect(crit.after[0].table).toBe('body');
      const pen = r.changes.find((ch: any) => ch.field === 'state' && ch.target_id === nyx.id);
      expect(pen.after).toEqual({ deathSavePenalty: 1 });
      expect(r.formula).toContain('瀕死で被弾');
    });

    it('adds the death save base from critical injuries, and stabilizing leaves the target unconscious', async () => {
      db.update(characters)
        .set({ hp: 0, status: JSON.stringify(['mortally']), crit_injuries: JSON.stringify([{ range: [2, 2], table: 'body', name: 'Dismembered Arm' }]) })
        .where(eq(characters.id, pcId2))
        .run();
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const nyx = combat.participants.find((p: any) => p.name === 'ニクス');
      const save = await resolve(combat.id, { action_key: 'death_save', actor_id: nyx.id, death_save_roll: 2 });
      expect(save.breakdown.basePenalty).toBe(1);
      expect(save.breakdown.penalty).toBe(1);
      expect(save.formula).toContain('致命的損傷 1');
      const ok = await resolve(combat.id, { action_key: 'first_aid', actor_id: viper.id, target_id: nyx.id, attack_roll: { first: 10, extra: 9 } });
      const statuses = ok.changes.filter((ch: any) => ch.field === 'status');
      expect(statuses[statuses.length - 1].after).toContain('気絶');
      expect(ok.formula).toContain('気絶');
    });

    it('autofire always spends 10 rounds and cannot fire with fewer than 10 left (p.173)', async () => {
      const viperChar = db.select().from(characters).where(eq(characters.id, pcId1)).get()!;
      const inv = JSON.parse(viperChar.inventory);
      inv.push({ entry_id: 'e_rifle', item_id: weaponIdRifle, name: 'アサルト・ライフル', qty: 1, equipped: true, ammo: 9 });
      db.update(characters).set({ inventory: JSON.stringify(inv) }).where(eq(characters.id, pcId1)).run();
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const ganger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));
      const r = await resolve(combat.id, {
        action_key: 'autofire', actor_id: viper.id, target_id: ganger.id, weapon_entry_id: 'e_rifle', distance_m: 15, attack_roll: { first: 8 }, damage_dice: [2, 2],
      });
      expect(r.missing_inputs.join()).toContain('10 発未満');
    });

    it('triples head damage after a cracked skull (p.188)', async () => {
      db.update(characters).set({ crit_injuries: JSON.stringify([{ range: [9, 9], table: 'head', name: 'Cracked Skull' }]) }).where(eq(characters.id, pcId2)).run();
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const nyx = combat.participants.find((p: any) => p.name === 'ニクス');
      const n = nyx.character;
      const r = await resolve(combat.id, { ...pistolShot(nyx.id, { action_key: 'aimed', aimed_location: 'head', attack_roll: { first: 10, extra: 9 } }), actor_id: viper.id });
      const hp = r.changes.find((ch: any) => ch.field === 'hp');
      expect(n.hp - hp.after).toBe(Math.min(n.hp, (14 - n.sp_head) * 3));
    });

    it('brawls for at least 2d6 with a cyberarm (p.176)', async () => {
      const viperChar = db.select().from(characters).where(eq(characters.id, pcId1)).get()!;
      const stats = { ...JSON.parse(viperChar.stats), body: 3 };
      db.update(characters).set({ stats: JSON.stringify(stats), cyberware: JSON.stringify([{ name: 'サイバーアーム' }]) }).where(eq(characters.id, pcId1)).run();
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const nyx = combat.participants.find((p: any) => p.name === 'ニクス');
      const r = await resolve(combat.id, {
        action_key: 'brawl', actor_id: viper.id,
        attacks: [{ target_id: nyx.id, attack_roll: { first: 9 }, defense_roll: { first: 2 }, damage_dice: [1, 1] }],
      });
      expect(r.formula).toContain('格闘 (2d6)');
    });
  });

  // Phase 5r: 告知・気絶の時間・2 つ目の致命傷・弾の扱い
  describe('Phase 5r: notices, unconscious timer, second injury, ammo', () => {
    const H = () => ({ ...authGm, 'Content-Type': 'application/json' });
    const resolve = async (combatId: string, body: Record<string, unknown>) =>
      (await (await app.request(`/api/combats/${combatId}/resolve`, { method: 'POST', headers: H(), body: JSON.stringify(body) })).json()).result;
    const setViperInventory = (extra: unknown[], pistolAmmo = 8) => {
      db.update(characters)
        .set({
          inventory: JSON.stringify([
            { entry_id: 'e1', item_id: weaponIdPistol, name: 'ヘビーピストル', qty: 1, equipped: true, ammo: pistolAmmo },
            { entry_id: 'e_ammo', name: '大型拳銃用弾薬', kind: 'ammo', qty: 5 },
            ...extra,
          ]),
        })
        .where(eq(characters.id, pcId1))
        .run();
    };

    it('asks for a second injury roll when a crit lands on a mortally wounded target, and applies both', async () => {
      db.update(characters).set({ hp: 0, status: JSON.stringify(['mortally']) }).where(eq(characters.id, pcId2)).run();
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const nyx = combat.participants.find((p: any) => p.name === 'ニクス');
      const shot = { action_key: 'ranged', actor_id: viper.id, target_id: nyx.id, weapon_id: weaponIdPistol, distance_m: 5, attack_roll: { first: 9 }, damage_dice: [6, 6, 4], crit_injury_roll: 7 };
      const one = await resolve(combat.id, shot);
      expect(one.missing_inputs.join()).toContain('2 つ目');
      const both = await resolve(combat.id, { ...shot, extra_crit_injury_roll: 7 });
      expect(both.changes.filter((ch: any) => ch.field === 'crit_injuries')).toHaveLength(2);
    });

    it('keeps a stabilized target unconscious for 20 rounds, then clears it (undo restores it)', async () => {
      db.update(characters).set({ hp: 0, status: JSON.stringify(['mortally']) }).where(eq(characters.id, pcId2)).run();
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const nyx = combat.participants.find((p: any) => p.name === 'ニクス');
      const ok = await resolve(combat.id, { action_key: 'first_aid', actor_id: viper.id, target_id: nyx.id, attack_roll: { first: 10, extra: 9 } });
      const timer = ok.changes.find((ch: any) => ch.field === 'state' && ch.after?.statusRounds);
      expect(timer.after.statusRounds['気絶']).toBe(20);

      // 残り 1 ラウンドの気絶が、ラウンドが変わると外れる
      db.update(characters).set({ hp: 1, status: JSON.stringify(['seriously', '気絶']) }).where(eq(characters.id, pcId2)).run();
      sqlite.prepare('UPDATE combat_participants SET state = ? WHERE id = ?').run(JSON.stringify({ statusRounds: { 気絶: 1 } }), nyx.id);
      await app.request(`/api/combats/${combat.id}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ action: 'start' }) });
      for (let i = 0; i < combat.participants.length; i++) {
        await app.request(`/api/combats/${combat.id}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ action: 'next_turn' }) });
      }
      const cleared = db.select().from(characters).where(eq(characters.id, pcId2)).get()!;
      expect(JSON.parse(cleared.status)).toEqual(['seriously']);
      await app.request(`/api/combats/${combat.id}/undo`, { method: 'POST', headers: authGm });
      const back = db.select().from(characters).where(eq(characters.id, pcId2)).get()!;
      expect(JSON.parse(back.status)).toContain('気絶');
    });

    it('fires only the rounds left, and refuses with an empty magazine', async () => {
      setViperInventory([], 1);
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const ganger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));
      const hit = { target_id: ganger.id, distance_m: 5, attack_roll: { first: 2 }, damage_dice: [1, 1, 1] };
      const r = await resolve(combat.id, { action_key: 'ranged', actor_id: viper.id, weapon_entry_id: 'e1', attacks: [hit, hit] });
      expect(r.formula).toContain('残弾 1 発なので 1 回だけ撃つ');
      expect(r.changes.find((ch: any) => ch.field === 'ammo').after).toBe(0);

      setViperInventory([], 0);
      const combat2 = await createTestCombat();
      const v2 = combat2.participants.find((p: any) => p.name === 'ヴァイパー');
      const g2 = combat2.participants.find((p: any) => p.name.startsWith('ガンガー'));
      const empty = await resolve(combat2.id, { action_key: 'ranged', actor_id: v2.id, weapon_entry_id: 'e1', attacks: [{ ...hit, target_id: g2.id }] });
      expect(empty.missing_inputs.join()).toContain('弾切れ');
    });

    it('suppressive fire spends 10 rounds and needs at least 10 (p.174)', async () => {
      setViperInventory([{ entry_id: 'e_rifle', item_id: weaponIdRifle, name: 'アサルト・ライフル', qty: 1, equipped: true, ammo: 25 }]);
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const ok = await resolve(combat.id, { action_key: 'suppressive', actor_id: viper.id, weapon_entry_id: 'e_rifle' });
      expect(ok.changes.find((ch: any) => ch.field === 'ammo').after).toBe(15);
      const noWeapon = await resolve(combat.id, { action_key: 'suppressive', actor_id: viper.id });
      expect(noWeapon.missing_inputs.join()).toContain('武器を選択');

      setViperInventory([{ entry_id: 'e_rifle', item_id: weaponIdRifle, name: 'アサルト・ライフル', qty: 1, equipped: true, ammo: 9 }]);
      const combat2 = await createTestCombat();
      const v2 = combat2.participants.find((p: any) => p.name === 'ヴァイパー');
      const short = await resolve(combat2.id, { action_key: 'suppressive', actor_id: v2.id, weapon_entry_id: 'e_rifle' });
      expect(short.missing_inputs.join()).toContain('10 発未満');
    });

    it('hides ammo from players only when the combat says so', () => {
      const ch = { inventory: [{ entry_id: 'e1', name: 'ピストル', ammo: 3 }] };
      expect(maskAmmoForPlayer(ch, false)).toEqual(ch);
      const hidden = maskAmmoForPlayer(ch, true);
      expect(hidden.inventory).toEqual([{ entry_id: 'e1', name: 'ピストル' }]);
      expect(hidden.ammo_hidden).toBe(true);
    });
  });

  // Phase 5u: 武術・つかむ・締め・投げ・立ち上がる・奥義（日本語版 p.177〜180）
  describe('Phase 5u: martial arts and grappling', () => {
    const H = () => ({ ...authGm, 'Content-Type': 'application/json' });
    const resolve = async (combatId: string, body: Record<string, unknown>) =>
      (await (await app.request(`/api/combats/${combatId}/resolve`, { method: 'POST', headers: H(), body: JSON.stringify(body) })).json()).result;
    const apply = async (combatId: string, body: Record<string, unknown>) =>
      (await (await app.request(`/api/combats/${combatId}/apply`, { method: 'POST', headers: H(), body: JSON.stringify(body) })).json());
    const giveKarate = (stats: Record<string, number> = {}) => {
      const row = db.select().from(characters).where(eq(characters.id, pcId1)).get()!;
      db.update(characters)
        .set({ skills: JSON.stringify({ ...JSON.parse(row.skills), 'martial_arts:空手': 4 }), stats: JSON.stringify({ ...JSON.parse(row.stats), ...stats }) })
        .where(eq(characters.id, pcId1))
        .run();
    };

    it('resolves a martial arts attack: DEX + style, damage by BODY, armor halved', async () => {
      giveKarate();
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const nyx = combat.participants.find((p: any) => p.name === 'ニクス');
      const r = await resolve(combat.id, {
        action_key: 'martial_arts', actor_id: viper.id,
        attacks: [{ target_id: nyx.id, attack_roll: { first: 9 }, defense_roll: { first: 2 }, damage_dice: [5, 5, 5] }],
      });
      expect(r.formula).toContain('武術 (武術：空手、3d6)');
      const hp = r.changes.find((ch: any) => ch.field === 'hp');
      expect(nyx.character.hp - hp.after).toBe(15 - Math.round(nyx.character.sp_body / 2));
    });

    it('refuses a martial arts attack without the skill', async () => {
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const nyx = combat.participants.find((p: any) => p.name === 'ニクス');
      const r = await resolve(combat.id, { action_key: 'martial_arts', actor_id: viper.id, attacks: [{ target_id: nyx.id, attack_roll: { first: 9 }, defense_roll: { first: 2 }, damage_dice: [1, 1, 1] }] });
      expect(r.missing_inputs.join()).toContain('〈武術〉');
    });

    it('grabs, chokes (HP stops at 1 and knocks out), and the held target cannot move', async () => {
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const nyx = combat.participants.find((p: any) => p.name === 'ニクス');
      const grab = await apply(combat.id, { action_key: 'grab', actor_id: viper.id, target_id: nyx.id, attack_roll: { first: 9 }, defense_roll: { first: 2 } });
      expect(grab.result.success).toBe(true);
      let nyxRow = db.select().from(characters).where(eq(characters.id, pcId2)).get()!;
      expect(JSON.parse(nyxRow.status)).toContain('つかみ');
      const move = await resolve(combat.id, { action_key: 'move', actor_id: nyx.id });
      expect(move.missing_inputs.join()).toContain('つかまれている');

      db.update(characters).set({ hp: 5 }).where(eq(characters.id, pcId2)).run();
      // 次の手番相当: アクションを戻してから締める
      sqlite.prepare('UPDATE combat_participants SET action_used = 0 WHERE id = ?').run(viper.id);
      sqlite.prepare("UPDATE combat_participants SET state = json_set(state, '$.actions_taken', 0) WHERE id = ?").run(viper.id);
      const choke = await apply(combat.id, { action_key: 'choke', actor_id: viper.id, target_id: nyx.id });
      expect(choke.result.formula).toContain('気絶');
      nyxRow = db.select().from(characters).where(eq(characters.id, pcId2)).get()!;
      expect(nyxRow.hp).toBe(1);
      expect(JSON.parse(nyxRow.status)).toContain('気絶');
    });

    it('throws a held target (BODY direct damage, prone), and prone blocks movement until standing', async () => {
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const nyx = combat.participants.find((p: any) => p.name === 'ニクス');
      await apply(combat.id, { action_key: 'grab', actor_id: viper.id, target_id: nyx.id, attack_roll: { first: 9 }, defense_roll: { first: 2 } });
      sqlite.prepare('UPDATE combat_participants SET action_used = 0, state = ? WHERE id = ?').run(JSON.stringify({ grappling: nyx.id }), viper.id);
      const before = db.select().from(characters).where(eq(characters.id, pcId2)).get()!;
      const t = await apply(combat.id, { action_key: 'throw', actor_id: viper.id, target_id: nyx.id });
      expect(t.result.success).toBe(true);
      const after = db.select().from(characters).where(eq(characters.id, pcId2)).get()!;
      expect(before.hp - after.hp).toBe(7); // ヴァイパーの BODY
      expect(JSON.parse(after.status)).toEqual(['伏せ']);
      const move = await resolve(combat.id, { action_key: 'move', actor_id: nyx.id });
      expect(move.missing_inputs.join()).toContain('伏せ状態');
      const stand = await resolve(combat.id, { action_key: 'stand', actor_id: nyx.id });
      expect(stand.changes.find((ch: any) => ch.field === 'status').after).toEqual([]);
    });

    it('bone break (karate, WILL 8+) deals martial damage plus Broken Ribs', async () => {
      sqlite.prepare('INSERT OR REPLACE INTO rule_constants (key, value, note) VALUES (?, ?, ?)').run(
        'critical_injury.body',
        JSON.stringify([{ range: [5, 5], name: 'Broken Ribs', summary: 'ribs' }, { range: [7, 7], name: 'Foreign Object', summary: '' }]),
        'test',
      );
      giveKarate();
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const nyx = combat.participants.find((p: any) => p.name === 'ニクス');
      const body = { action_key: 'martial_technique', technique: 'bone_break', actor_id: viper.id, target_id: nyx.id, attack_roll: { first: 9 }, defense_roll: { first: 2 }, damage_dice: [4, 4, 4] };
      const noWill = await resolve(combat.id, body);
      expect(noWill.missing_inputs.join()).toContain('【意志】8');
      giveKarate({ will: 8 });
      const combat2 = await createTestCombat();
      const v2 = combat2.participants.find((p: any) => p.name === 'ヴァイパー');
      const n2 = combat2.participants.find((p: any) => p.name === 'ニクス');
      const r = await resolve(combat2.id, { ...body, actor_id: v2.id, target_id: n2.id });
      expect(r.success).toBe(true);
      expect(r.changes.find((ch: any) => ch.field === 'crit_injuries').after.at(-1).name).toBe('Broken Ribs');
      expect(r.changes.some((ch: any) => ch.field === 'hp')).toBe(true);
    });

    it('rejects a technique from another style', async () => {
      giveKarate();
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const nyx = combat.participants.find((p: any) => p.name === 'ニクス');
      const r = await resolve(combat.id, { action_key: 'martial_technique', technique: 'dodge_throw', martial_style: 'martial_arts:空手', actor_id: viper.id, target_id: nyx.id, attack_roll: { first: 9 } });
      expect(r.missing_inputs.join()).toContain('柔道 の奥義');
    });
  });

  // Phase 5v: 【運命】点・物を投げる・環境ダメージ（日本語版 p.130、177〜181）
  describe('Phase 5v: luck, throwing and hazards', () => {
    const H = () => ({ ...authGm, 'Content-Type': 'application/json' });
    const resolve = async (combatId: string, body: Record<string, unknown>) =>
      (await (await app.request(`/api/combats/${combatId}/resolve`, { method: 'POST', headers: H(), body: JSON.stringify(body) })).json()).result;
    const apply = async (combatId: string, body: Record<string, unknown>) =>
      await (await app.request(`/api/combats/${combatId}/apply`, { method: 'POST', headers: H(), body: JSON.stringify(body) })).json();
    const nyxRow = () => db.select().from(characters).where(eq(characters.id, pcId2)).get()!;

    it('adds spent luck to the first attack roll and records it; refuses more than is left', async () => {
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const ganger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));
      const shot = { action_key: 'ranged', actor_id: viper.id, target_id: ganger.id, weapon_id: weaponIdPistol, distance_m: 5, attack_roll: { first: 2 }, damage_dice: [1, 1, 1] };
      const plain = await resolve(combat.id, shot);
      const lucky = await resolve(combat.id, { ...shot, luck_spent: 3 });
      expect(lucky.formula).toContain('+3（運命）');
      expect(plain.formula).not.toContain('運命');
      expect(plain.changes.some((ch: any) => ch.field === 'extra')).toBe(false);
      const rec = lucky.changes.find((ch: any) => ch.field === 'extra');
      expect(rec.after.luck_used).toBe(3);
      const tooMuch = await resolve(combat.id, { ...shot, luck_spent: 9 });
      expect(tooMuch.missing_inputs.join()).toContain('【運命】点が足りません');
    });

    it('sets fire, burns at the end of the turn, and undo restores HP', async () => {
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const started = await (await app.request(`/api/combats/${combat.id}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ action: 'start' }) })).json();
      const first = started.combat.participants[started.combat.turn_index];
      await apply(combat.id, { action_key: 'hazard', actor_id: first.id, target_id: first.id, hazard: 'fire', hazard_level: 'medium' });
      const charId = first.character_id;
      const hpBefore = db.select().from(characters).where(eq(characters.id, charId)).get()!.hp;
      expect(JSON.parse(db.select().from(characters).where(eq(characters.id, charId)).get()!.status)).toContain('着火（中）');
      await app.request(`/api/combats/${combat.id}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ action: 'next_turn' }) });
      expect(db.select().from(characters).where(eq(characters.id, charId)).get()!.hp).toBe(hpBefore - 4);
      await app.request(`/api/combats/${combat.id}/undo`, { method: 'POST', headers: authGm });
      expect(db.select().from(characters).where(eq(characters.id, charId)).get()!.hp).toBe(hpBefore);
      expect(viper).toBeDefined();
    });

    it('falls: 2d6 per 10m and a failed Athletics check gives a broken leg', async () => {
      sqlite.prepare('INSERT OR REPLACE INTO rule_constants (key, value, note) VALUES (?, ?, ?)').run(
        'critical_injury.body',
        JSON.stringify([{ range: [8, 8], name: 'Broken Leg', summary: '' }]),
        'test',
      );
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const nyx = combat.participants.find((p: any) => p.name === 'ニクス');
      const needDice = await resolve(combat.id, { action_key: 'hazard', actor_id: viper.id, target_id: nyx.id, hazard: 'fall', fall_m: 20, attack_roll: { first: 2 } });
      expect(needDice.missing_inputs.join()).toContain('4d6');
      const r = await resolve(combat.id, { action_key: 'hazard', actor_id: viper.id, target_id: nyx.id, hazard: 'fall', fall_m: 20, attack_roll: { first: 2 }, damage_dice: [6, 6, 6, 6] });
      expect(r.formula).toContain('片脚損傷');
      expect(r.changes.find((ch: any) => ch.field === 'crit_injuries').after.at(-1).name).toBe('Broken Leg');
    });

    it('poison: resisted or direct HP damage', async () => {
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const nyx = combat.participants.find((p: any) => p.name === 'ニクス');
      const base = { action_key: 'hazard', actor_id: viper.id, target_id: nyx.id, hazard: 'poison', hazard_level: 'large', damage_dice: [3, 3, 3] };
      const resisted = await resolve(combat.id, { ...base, attack_roll: { first: 10, extra: 9 } });
      expect(resisted.formula).toContain('抵抗した');
      const hit = await resolve(combat.id, { ...base, attack_roll: { first: 2 } });
      const hp = hit.changes.find((ch: any) => ch.field === 'hp');
      expect(nyx.character.hp - hp.after).toBe(9);
    });

    it('vacuum: ending it restores the lost stats', async () => {
      const row = nyxRow();
      const stats = JSON.parse(row.stats);
      db.update(characters)
        .set({ status: JSON.stringify(['真空']), stats: JSON.stringify({ ...stats, int: stats.int - 3 }), extra: JSON.stringify({ vacuum_loss: { int: 3 } }) })
        .where(eq(characters.id, pcId2))
        .run();
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const nyx = combat.participants.find((p: any) => p.name === 'ニクス');
      await apply(combat.id, { action_key: 'hazard_end', actor_id: viper.id, target_id: nyx.id, hazard_status: '真空' });
      const after = nyxRow();
      expect(JSON.parse(after.stats).int).toBe(stats.int);
      expect(JSON.parse(after.status)).toEqual([]);
    });

    it('throws a melee weapon: DEX + Athletics vs the grenade launcher table, item leaves the hand', async () => {
      sqlite.prepare('INSERT OR REPLACE INTO rule_constants (key, value, note) VALUES (?, ?, ?)').run(
        'dv_table.DV Grenade Launcher',
        JSON.stringify([{ range: [0, 6], dv: 16 }, { range: [7, 12], dv: 15 }, { range: [13, 25], dv: 15 }]),
        'test',
      );
      const row = db.select().from(characters).where(eq(characters.id, pcId1)).get()!;
      db.update(characters)
        .set({ inventory: JSON.stringify([...JSON.parse(row.inventory), { entry_id: 'knife', item_id: weaponIdMelee, name: 'コンバット・ナイフ', kind: 'weapon', qty: 1, equipped: true }]) })
        .where(eq(characters.id, pcId1))
        .run();
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const nyx = combat.participants.find((p: any) => p.name === 'ニクス');
      const far = await resolve(combat.id, { action_key: 'throw_object', actor_id: viper.id, target_id: nyx.id, throw_entry_id: 'knife', distance_m: 30, attack_roll: { first: 9 }, damage_dice: [3, 3] });
      expect(far.missing_inputs.join()).toContain('25m');
      const r = await resolve(combat.id, { action_key: 'throw_object', actor_id: viper.id, target_id: nyx.id, throw_entry_id: 'knife', distance_m: 5, attack_roll: { first: 10, extra: 5 }, damage_dice: [6, 5] });
      expect(r.formula).toContain('難易度 16');
      const inv = r.changes.find((ch: any) => ch.field === 'inventory');
      expect(inv.after.some((i: any) => i.entry_id === 'knife')).toBe(false);
    });
  });

  // Phase 5n: 出目を入れる前の成功ライン
  describe('Phase 5n: attack line before the roll', () => {
    it('shows the success line for a ranged attack at a distance, and bands for the phone', async () => {
      const combat = await createTestCombat();
      const viper = combat.participants.find((p: any) => p.name === 'ヴァイパー');
      const ganger = combat.participants.find((p: any) => p.name.startsWith('ガンガー'));
      const res = await (
        await app.request(`/api/combats/${combat.id}/line`, {
          method: 'POST',
          headers: { ...authGm, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action_key: 'ranged', actor_id: viper.id, target_id: ganger.id, weapon_entry_id: 'e1', distance_m: 5 }),
        })
      ).json();
      // REF 8 + ハンドガン 6 = 14 vs 難易度 13 → 出目 0 以上 = 「2 以上で成功」
      expect(res.line.text).toContain('= 14 vs 難易度 13（5m）→ 2 以上で成功');

      const pdev = registerDevice({ role: 'player', label: 'p', characterId: pcId1 });
      const mine = await (await app.request('/api/combats/current/my-lines?weapon_entry_id=e1', { headers: { Authorization: `Bearer ${pdev.token}` } })).json();
      expect(mine.lines.ranged.bands[0]).toEqual({ range: '0〜6m', dv: 13, needed: '2 以上で成功' });
    });
  });
});

describe('Phase 5s: role info and autofire table names', () => {
  it('returns role info (empty when the local rule file is missing)', async () => {
    const res = await (await app.request('/api/role-info')).json();
    expect(Array.isArray(res.roles)).toBe(true);
    expect(res.starting_rank).toBe(4);
  });
});
