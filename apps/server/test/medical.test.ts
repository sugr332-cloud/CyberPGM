import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../src/index.js';
import { db, sqlite } from '../src/db/client.js';
import { characters, items, cyberwares } from '../src/db/schema.js';
import { registerDevice } from '../src/auth.js';
import { getCharacterSheetById } from '../src/character-helper.js';

// Phase 5w: 医療・ドラッグ・セラピー・人間性（日本語版 p.149〜150、219〜232）
describe('Phase 5w: medical, drugs, therapy and humanity', () => {
  let H: Record<string, string>;
  const now = Date.now();
  const make = (id: string, name: string, over: Record<string, unknown> = {}) =>
    db
      .insert(characters)
      .values({
        id,
        kind: 'pc',
        name,
        role: 'Solo',
        stats: JSON.stringify({ int: 6, ref: 6, dex: 6, tech: 6, cool: 6, will: 6, luck: 5, move: 6, body: 6, emp: 6 }),
        skills: JSON.stringify({ resist_torture_drugs: 2, paramedic: 4, conversation: 3 }),
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
  const row = (id: string) => db.select().from(characters).where(eq(characters.id, id)).get()!;
  const post = async (path: string, body: unknown) => (await app.request(path, { method: 'POST', headers: H, body: JSON.stringify(body) })).json();

  beforeEach(() => {
    sqlite.prepare('DELETE FROM char_log').run();
    sqlite.prepare('DELETE FROM money_log').run();
    sqlite.prepare('DELETE FROM combat_participants').run();
    sqlite.prepare('DELETE FROM combats').run();
    sqlite.prepare('DELETE FROM characters').run();
    sqlite.prepare('DELETE FROM devices').run();
    const gm = registerDevice({ role: 'gm', label: 'GM' });
    H = { Authorization: `Bearer ${gm.token}`, 'Content-Type': 'application/json' };
    make('pc1', 'ヴァイパー');
    make('doc', 'ドク', { skills: JSON.stringify({ medical_tech: 3, surgery: 6, paramedic: 4, first_aid: 4 }), stats: JSON.stringify({ int: 6, ref: 6, dex: 6, tech: 8, cool: 6, will: 6, luck: 5, move: 6, body: 6, emp: 6 }) });
  });

  it('a street drug changes checks while it lasts, then asks for the addiction roll', async () => {
    const r = await post('/api/medical/pc1/drug', { drug: 'synthcoke' });
    expect(r.formula).toContain('シンセコーク');
    expect(getCharacterSheetById('pc1')!.effectNotes).toContain('シンセコーク: 【反応】+1');
    await post('/api/medical/time', { hours: 5 });
    const extra = JSON.parse(row('pc1').extra);
    expect(extra.drugs).toEqual([]);
    expect(extra.pending_addiction[0].key).toBe('synthcoke');
    const fail = await post('/api/medical/pc1/addiction', { drug: 'synthcoke', roll: { first: 2 } });
    expect(fail.formula).toContain('依存症');
    expect(getCharacterSheetById('pc1')!.effectNotes).toContain('シンセコーク依存症: 【反応】−2');
  });

  it('Black Lace returns the humanity when resisted', async () => {
    await post('/api/medical/pc1/drug', { drug: 'black_lace', dice: [3, 4] });
    expect(row('pc1').humanity).toBe(53);
    await post('/api/medical/time', { hours: 24 });
    await post('/api/medical/pc1/addiction', { drug: 'black_lace', roll: { first: 10, extra: 9 } });
    expect(row('pc1').humanity).toBe(60);
  });

  it('Medtech-only drugs need a Medtech; Speedheal heals BODY + WILL once a day', async () => {
    db.update(characters).set({ hp: 10 }).where(eq(characters.id, 'pc1')).run();
    const noDoc = await post('/api/medical/pc1/drug', { drug: 'speedheal' });
    expect(noDoc.error).toContain('メドテク');
    await post('/api/medical/pc1/drug', { drug: 'speedheal', given_by: 'doc' });
    expect(row('pc1').hp).toBe(22);
    const again = await post('/api/medical/pc1/drug', { drug: 'speedheal', given_by: 'doc' });
    expect(again.error).toContain('時間は効果を受けられません');
  });

  it('treats a critical injury (quick fix until the day ends, full treatment removes it) and the hospital charges by the highest DV', async () => {
    const ribs = { range: [5, 5], table: 'body', name: '肋骨損傷', quickFix: { dvFirstAid: 0, dvParamedic: 13, type: 'paramedic' }, treatment: { dvParamedic: 15, dvSurgery: 13, type: 'paramedicSurgery' } };
    db.update(characters).set({ crit_injuries: JSON.stringify([ribs]), hp: 30, eb: 1000 }).where(eq(characters.id, 'pc1')).run();
    const quick = await post('/api/medical/pc1/treat', { index: 0, mode: 'quick', healer_id: 'doc', roll: { first: 5 } });
    expect(quick.formula).toContain('成功');
    expect(JSON.parse(row('pc1').crit_injuries)[0].quick_fixed).toBe(true);
    const self = await post('/api/medical/pc1/treat', { index: 0, mode: 'full', healer_id: 'pc1', roll: { first: 9 } });
    expect(self.error).toContain('自分自身');
    const full = await post('/api/medical/pc1/treat', { index: 0, mode: 'full', healer_id: 'doc', roll: { first: 5 } });
    expect(full.formula).toContain('外科手術');
    expect(JSON.parse(row('pc1').crit_injuries)).toEqual([]);
    // 病院: 重傷でなく軽傷（難易度 10）なら 50eb
    const hosp = await post('/api/medical/pc1/hospital', { pay: true });
    expect(hosp.cost).toBe(50);
    expect(row('pc1').eb).toBe(950);
  });

  it('therapy restores humanity up to the cap, and undo puts things back', async () => {
    db.update(characters).set({ humanity: 40, cyberware: JSON.stringify([{ name: 'サイバーアーム', static_loss: 7 }]) }).where(eq(characters.id, 'pc1')).run();
    const r = await post('/api/medical/pc1/therapy', { therapy: 'extreme', doctor_id: 'doc', roll: { first: 10, extra: 5 }, dice: [6, 6, 6, 6] });
    expect(r.formula).toContain('上限 58');
    expect(row('pc1').humanity).toBe(58);
    await post('/api/medical/pc1/undo', {});
    expect(row('pc1').humanity).toBe(40);
  });

  it('installs cyberware with rolled humanity loss and lowers the humanity cap', async () => {
    db.insert(items).values({ id: 'cw1', kind: 'cyberware', name_en: 'Test Arm', name_ja: 'テストアーム', origin: 'official_verified', verify_status: 'official_verified', created_at: 1, updated_at: 1 }).run();
    db.insert(cyberwares).values({ item_id: 'cw1', cw_type: 'cyberArm', install_location: 'hospital', humanity_loss_roll: '2d6', humanity_loss_static: 7 }).run();
    const need = await post('/api/medical/pc1/install', { item_id: 'cw1' });
    expect(need.error).toContain('2d6');
    const r = await post('/api/medical/pc1/install', { item_id: 'cw1', dice: [3, 2] });
    expect(r.formula).toContain('人間性の上限は 58');
    expect(row('pc1').humanity).toBe(55);
    expect(JSON.parse(row('pc1').cyberware)[0].static_loss).toBe(5);
  });

  it('trauma: humanity loss and the cyberpsychosis stage on the sheet', async () => {
    db.update(characters).set({ humanity: 22 }).where(eq(characters.id, 'pc1')).run();
    await post('/api/medical/pc1/humanity-loss', { dice: [4], reason: '拷問' });
    expect(row('pc1').humanity).toBe(18);
    expect(getCharacterSheetById('pc1')!.psychosis!.level).toBe(2);
  });
});
