import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { app } from '../src/index.js';
import { db, sqlite } from '../src/db/client.js';
import { characters, items, weapons } from '../src/db/schema.js';
import { registerDevice } from '../src/auth.js';
import { getProjectRoot } from '@cyberpgm/shared';

// Phase 5x: ロール特技（日本語版 p.142〜165）
describe('Phase 5x: role abilities', () => {
  let H: Record<string, string>;
  const now = Date.now();
  const dir = path.join(getProjectRoot(), 'data', 'sources', 'core-ja');
  const file = path.join(dir, 'roles.json');
  let wrote = false;
  beforeAll(() => {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({
          squads: { lawman: [{ ranks: '3〜4', name: '巡回警官', count: 2, combat: 10, sp: 7, hp: 25, move_body: 5, weapons: ['Heavy Pistol'] }], trauma: [{ name: '医師', count: 1, combat: 10, sp: 11, hp: 20, move_body: 4, weapons: [] }] },
          execTeam: { order: ['int', 'ref', 'dex', 'tech', 'cool', 'will', 'move', 'body', 'emp'], jobs: [{ key: 'bodyguard', name: '企業親衛員', rows: [[3, 7, 7, 4, 7, 6, 4, 8, 4]], skills: { '6': ['ハンドガン'] }, gear: [] }] },
        }),
      );
      wrote = true;
    }
  });
  afterAll(() => {
    if (wrote) fs.rmSync(file);
  });
  const make = (id: string, name: string, role: string, over: Record<string, unknown> = {}) =>
    db
      .insert(characters)
      .values({
        id,
        kind: 'pc',
        name,
        role,
        stats: JSON.stringify({ int: 6, ref: 8, dex: 6, tech: 6, cool: 6, will: 6, luck: 5, move: 6, body: 6, emp: 6 }),
        skills: JSON.stringify({ handgun: 4, evasion: 2, trading: 4 }),
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
  const row = (id: string) => db.select().from(characters).where(eq(characters.id, id)).get()!;

  beforeEach(() => {
    sqlite.prepare('DELETE FROM combat_log').run();
    sqlite.prepare('DELETE FROM combat_participants').run();
    sqlite.prepare('DELETE FROM combats').run();
    sqlite.prepare('DELETE FROM char_log').run();
    sqlite.prepare('DELETE FROM characters').run();
    sqlite.prepare('DELETE FROM devices').run();
    sqlite.prepare('DELETE FROM weapons').run();
    sqlite.prepare('DELETE FROM items').run();
    sqlite.prepare('DELETE FROM rule_constants').run();
    sqlite.prepare('INSERT INTO rule_constants (key, value, note) VALUES (?, ?, ?)').run('dv_table.Pistol', JSON.stringify([{ range: [0, 12], dv: 13 }]), 't');
    db.insert(items).values({ id: 'pistol', kind: 'weapon', name_en: 'Heavy Pistol', name_ja: '大型拳銃', origin: 'official_verified', verify_status: 'official_verified', created_at: 1, updated_at: 1 }).run();
    db.insert(weapons).values({ item_id: 'pistol', weapon_type: 'heavy_pistol', skill: 'Handgun', damage: '3d6', rof: 2, magazine_max: 8, dv_table_key: 'Pistol', is_ranged: true, autofire: null, suppressive: false } as any).run();
    const gm = registerDevice({ role: 'gm', label: 'GM' });
    H = { Authorization: `Bearer ${gm.token}`, 'Content-Type': 'application/json' };
    make('solo', 'ソロ', 'Solo', { inventory: JSON.stringify([{ entry_id: 'p', item_id: 'pistol', name: '大型拳銃', kind: 'weapon', qty: 1, equipped: true, ammo: 8 }]), extra: JSON.stringify({ solo_alloc: { precision: 3, fumble_immunity: 0, spot_weakness: 1 } }) });
    make('foe', 'ソロの敵', 'Solo', { extra: JSON.stringify({ solo_alloc: { damage_reduction: 4 } }) });
  });

  const combatOf = async () => {
    const c = await req('POST', '/api/combats', {});
    for (const id of ['solo', 'foe']) await req('POST', `/api/combats/${c.combat.id}/participants`, { character_id: id, side: id === 'solo' ? 'ally' : 'enemy' });
    const cur = await req('GET', '/api/combats/current');
    return cur.combat;
  };

  it('Solo: precision adds to the attack, spot weakness and damage reduction apply to the first hit of the round', async () => {
    const cb = await combatOf();
    const solo = cb.participants.find((p: any) => p.name === 'ソロ');
    const foe = cb.participants.find((p: any) => p.name === 'ソロの敵');
    const r = await req('POST', `/api/combats/${cb.id}/resolve`, { action_key: 'ranged', actor_id: solo.id, target_id: foe.id, weapon_entry_id: 'p', distance_m: 5, attack_roll: { first: 5 }, damage_dice: [2, 2, 2] });
    expect(r.result.formula).toContain('+1（精密攻撃）');
    expect(r.result.formula).toContain('弱点看破 +1');
    expect(r.result.formula).toContain('ダメージ軽減 −2');
    const hp = r.result.changes.find((ch: any) => ch.field === 'hp');
    expect(40 - hp.after).toBe(6 + 1 - 2);
  });

  it('rejects a Solo allocation over the rank', async () => {
    const res = await req('PUT', '/api/roles/solo', { solo_alloc: { precision: 3, initiative: 2 } });
    expect(res.error).toContain('ランク 4');
  });

  it('Medtech allocation sets Surgery and Medical Tech', async () => {
    make('med', 'メド', 'Medtech');
    await req('PUT', '/api/roles/med', { medicine: { surgery: 2, pharma: 1, cryo: 1, pharma_known: ['speedheal'] } });
    const sk = JSON.parse(row('med').skills);
    expect(sk.surgery).toBe(4);
    expect(sk.medical_tech).toBe(2);
  });

  it('Rockerboy impact check: rank + 1d10 vs DV', async () => {
    make('rb', 'ロッカー', 'Rockerboy');
    const res = await req('POST', '/api/roles/rb/check', { kind: 'rockerboy', size: 'small', roll: { first: 7 } });
    expect(res.formula).toContain('ランク 4 + 出目 7 = 11 vs 難易度 10 -> 成功');
  });

  it('Exec recruits a team member from the table, and checks loyalty with 1d6', async () => {
    make('ex', 'エグゼク', 'Exec');
    const res = await req('POST', '/api/roles/ex/check', { kind: 'exec_recruit', job: 'bodyguard', stat_die: 1, loyalty_die: 3 });
    expect(res.formula).toContain('初期忠誠度 4');
    const team = JSON.parse(row('ex').extra).exec_team;
    expect(team).toHaveLength(1);
    const chk = await req('POST', '/api/roles/ex/check', { kind: 'exec_loyalty', index: 0, die: 5 });
    expect(chk.formula).toContain('拒否する');
  });

  it('Lawman calls backup, and squads join without dodging bullets', async () => {
    make('law', 'ローマン', 'Lawman');
    const cb = await combatOf();
    await req('POST', `/api/combats/${cb.id}/participants`, { character_id: 'law', side: 'ally' });
    const cur = (await req('GET', '/api/combats/current')).combat;
    const law = cur.participants.find((p: any) => p.name === 'ローマン');
    const call = await req('POST', `/api/combats/${cb.id}/resolve`, { action_key: 'call_backup', actor_id: law.id, attack_roll: { first: 3 }, damage_dice: [2] });
    expect(call.result.formula).toContain('2 ラウンド後にランク 3〜4');
    const sq = await req('POST', `/api/combats/${cb.id}/squad`, { type: 'lawman', tier: '3〜4' });
    expect(sq.added.length).toBeGreaterThanOrEqual(2);
    const cop = sq.combat.participants.find((p: any) => p.name.startsWith('巡回警官'));
    expect(cop.character.status).toContain('弾丸を回避できない');
    expect(cop.character.stats.ref + cop.character.skills.handgun).toBe(10);
  });
});
