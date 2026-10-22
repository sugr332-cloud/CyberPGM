import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../src/index.js';
import { db, sqlite } from '../src/db/client.js';
import { characters, items, weapons } from '../src/db/schema.js';
import { registerDevice } from '../src/auth.js';

// Phase 5y: ヴィークルと知名度（日本語版 p.136・161〜165・189〜193）
describe('Phase 5y: vehicles and reputation', () => {
  let H: Record<string, string>;
  const now = Date.now();
  const make = (id: string, name: string, over: Record<string, unknown> = {}) =>
    db
      .insert(characters)
      .values({
        id,
        kind: 'pc',
        name,
        role: 'Nomad',
        stats: JSON.stringify({ int: 6, ref: 6, dex: 6, tech: 6, cool: 6, will: 6, luck: 5, move: 6, body: 6, emp: 6 }),
        skills: JSON.stringify({ drive_land_vehicle: 2, evasion: 2, handgun: 4, land_vehicle_tech: 2 }),
        hp: 40,
        hp_max: 40,
        sp_head: 0,
        sp_body: 0,
        humanity: 60,
        emp_max: 6,
        created_at: now,
        updated_at: now,
        ...over,
      })
      .run();
  const req = async (method: string, p: string, body?: unknown) => (await app.request(p, { method, headers: H, body: body ? JSON.stringify(body) : undefined })).json();
  const ex = (id: string) => JSON.parse(db.select().from(characters).where(eq(characters.id, id)).get()!.extra);

  beforeEach(async () => {
    for (const t of ['combat_log', 'combat_participants', 'combats', 'char_log', 'characters', 'devices', 'weapons', 'items', 'rule_constants']) sqlite.prepare(`DELETE FROM ${t}`).run();
    sqlite.prepare('INSERT INTO rule_constants (key, value, note) VALUES (?, ?, ?)').run('dv_table.Pistol', JSON.stringify([{ range: [0, 12], dv: 13 }]), 't');
    db.insert(items).values({ id: 'car', kind: 'vehicle', name_en: 'Compact Groundcar', name_ja: '小型地上車', raw_system: JSON.stringify({ sdp: 50, seats: 4, speedCombat: 20 }), origin: 'official_verified', verify_status: 'official_verified', created_at: 1, updated_at: 1 }).run();
    db.insert(items).values({ id: 'pistol', kind: 'weapon', name_en: 'Heavy Pistol', name_ja: '大型拳銃', origin: 'official_verified', verify_status: 'official_verified', created_at: 1, updated_at: 1 }).run();
    db.insert(weapons).values({ item_id: 'pistol', weapon_type: 'heavy_pistol', skill: 'Handgun', damage: '3d6', rof: 2, magazine_max: 8, dv_table_key: 'Pistol', is_ranged: true } as any).run();
    const gm = registerDevice({ role: 'gm', label: 'GM' });
    H = { Authorization: `Bearer ${gm.token}`, 'Content-Type': 'application/json' };
    make('nomad', 'ノーマッド');
    make('shooter', '撃つ人', { inventory: JSON.stringify([{ entry_id: 'p', item_id: 'pistol', name: '大型拳銃', kind: 'weapon', qty: 1, equipped: true, ammo: 8 }]) });
    await req('POST', '/api/vehicles/nomad', { op: 'add', item_id: 'car', family: true });
  });
  const vid = () => ex('nomad').vehicles[0].id;
  const start = async () => {
    const c = await req('POST', '/api/combats', {});
    for (const id of ['nomad', 'shooter']) await req('POST', `/api/combats/${c.combat.id}/participants`, { character_id: id, side: id === 'nomad' ? 'ally' : 'enemy' });
    return (await req('GET', '/api/combats/current')).combat;
  };

  it('adds a family vehicle and applies upgrades within the Moto rank', async () => {
    expect(ex('nomad').vehicles[0]).toMatchObject({ name: '小型地上車', sdp: 50, seats: 4, move: 20, family: true });
    const pod = await req('POST', '/api/vehicles/nomad', { op: 'upgrade', vehicle_id: vid(), upgrade: 'Onboard Rocket Pod' });
    expect(pod.error).toContain('車体強化');
    await req('POST', '/api/vehicles/nomad', { op: 'upgrade', vehicle_id: vid(), upgrade: 'Heavy Chassis' });
    expect(ex('nomad').vehicles[0].sdp_max).toBe(70);
    const armor = await req('POST', '/api/vehicles/nomad', { op: 'upgrade', vehicle_id: vid(), upgrade: 'Armored Chassis' });
    expect(armor.error).toContain('ランク 5');
  });

  it('boards, starts (driver goes to the top of the order), and the driver moves at the vehicle speed', async () => {
    const cb = await start();
    const nomad = cb.participants.find((p: any) => p.name === 'ノーマッド');
    await req('POST', `/api/combats/${cb.id}/apply`, { action_key: 'vehicle_board', actor_id: nomad.id, vehicle_ref: { owner_id: 'nomad', vehicle_id: vid() }, as_driver: true });
    sqlite.prepare('UPDATE combat_participants SET action_used = 0 WHERE id = ?').run(nomad.id);
    sqlite.prepare("UPDATE combat_participants SET state = json_set(state, '$.actions_taken', 0) WHERE id = ?").run(nomad.id);
    await req('POST', `/api/combats/${cb.id}/apply`, { action_key: 'vehicle_start', actor_id: nomad.id });
    const after = (await req('GET', '/api/combats/current')).combat;
    expect(after.participants[0].name).toBe('ノーマッド');
    const move = await req('POST', `/api/combats/${cb.id}/resolve`, { action_key: 'move', actor_id: nomad.id });
    expect(move.result.formula).toContain('20');
    sqlite.prepare("UPDATE combat_participants SET action_used = 0, move_used = 1, state = json_set(state, '$.actions_taken', 0) WHERE id = ?").run(nomad.id);
    const run = await req('POST', `/api/combats/${cb.id}/resolve`, { action_key: 'run', actor_id: nomad.id });
    expect(run.result.missing_inputs.join()).toContain('走る');
  });

  it('a failed maneuver makes the vehicle go out of control', async () => {
    const cb = await start();
    const nomad = cb.participants.find((p: any) => p.name === 'ノーマッド');
    sqlite.prepare('UPDATE combat_participants SET state = ? WHERE id = ?').run(JSON.stringify({ in_vehicle: { owner_id: 'nomad', vehicle_id: vid(), driver: true, started: true } }), nomad.id);
    const r = await req('POST', `/api/combats/${cb.id}/apply`, { action_key: 'vehicle_maneuver', actor_id: nomad.id, maneuver: 'spin', attack_roll: { first: 2 } });
    expect(r.result.formula).toContain('制御不能');
    expect(ex('nomad').vehicles[0].out_of_control).toBe(true);
  });

  it('shooting a weak point: −8, damage doubled after SP', async () => {
    const cb = await start();
    const shooter = cb.participants.find((p: any) => p.name === '撃つ人');
    const r = await req('POST', `/api/combats/${cb.id}/resolve`, { action_key: 'attack_vehicle', actor_id: shooter.id, weapon_entry_id: 'p', target_vehicle: { owner_id: 'nomad', vehicle_id: vid() }, aimed_location: 'weakpoint', distance_m: 5, attack_roll: { first: 10, extra: 9 }, damage_dice: [4, 4, 4] });
    expect(r.result.formula).toContain('弱点 −8');
    expect(r.result.formula).toContain('SDP 50 → 26');
  });

  it('ramming a pedestrian: 6d6 to both and whiplash', async () => {
    sqlite.prepare('INSERT INTO rule_constants (key, value, note) VALUES (?, ?, ?)').run('critical_injury.head', JSON.stringify([{ range: [8, 8], name: 'Whiplash', summary: '' }]), 't');
    const cb = await start();
    const nomad = cb.participants.find((p: any) => p.name === 'ノーマッド');
    const shooter = cb.participants.find((p: any) => p.name === '撃つ人');
    sqlite.prepare('UPDATE combat_participants SET state = ? WHERE id = ?').run(JSON.stringify({ in_vehicle: { owner_id: 'nomad', vehicle_id: vid(), driver: true, started: true } }), nomad.id);
    const cur = (await req('GET', '/api/combats/current')).combat;
    const r = await req('POST', `/api/combats/${cb.id}/resolve`, { action_key: 'vehicle_ram', actor_id: nomad.id, target_id: shooter.id, damage_dice: [3, 3, 3, 3, 3, 3], defense_roll: { first: 2 } });
    expect(r.result.formula).toContain('SDP 50 → 32');
    expect(r.result.changes.filter((ch: any) => ch.field === 'crit_injuries').map((ch: any) => ch.after.at(-1).name)).toEqual(['頸椎損傷', '頸椎損傷']);
    expect(cur).toBeDefined();
  });

  it('reputation: known on 1d10 below the level, and facedown adds it (bad reputation subtracts)', async () => {
    await req('POST', '/api/vehicles/nomad', { op: 'reputation', level: 4, deed: 'ボスを助けた' });
    const known = await req('POST', '/api/vehicles/nomad', { op: 'reputation_known', die: 3 });
    expect(known.formula).toContain('聞いたことがある');
    const fd = await req('POST', '/api/vehicles/nomad', { op: 'facedown', roll: { first: 5 }, their_total: 14 });
    expect(fd.formula).toContain('COOL 6 + 知名度 4 + 出目 5 = 15');
    await req('POST', '/api/vehicles/nomad', { op: 'reputation', level: 4, deed: '仲間を見捨てた', bad: true });
    const fd2 = await req('POST', '/api/vehicles/nomad', { op: 'facedown', roll: { first: 5 }, their_total: 14 });
    expect(fd2.formula).toContain('知名度 -4');
  });
});
