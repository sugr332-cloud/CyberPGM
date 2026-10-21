import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/index.js';
import { db } from '../src/db/client.js';
import { items, cyberwares, armors } from '../src/db/schema.js';
import { and, eq, gt } from 'drizzle-orm';
import { hpMaxFromStats } from '@cyberpgm/rules';

// Phase 5f: GM のキャラ作成（品目から選んだ武器・防具・サイバーウェアを持たせる）
describe('GM character editor (Phase 5f)', () => {
  let gm: string;
  const H = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${gm}` });
  const stats = { int: 5, ref: 7, dex: 6, tech: 4, cool: 5, will: 5, luck: 0, move: 5, body: 7, emp: 4 };

  beforeAll(async () => {
    gm = (await (await app.request('/api/auth/gm-token', { method: 'POST' })).json()).token;
  });

  it('saves catalog equipment and counts borgware against max humanity', async () => {
    const pistol = db.select().from(items).where(eq(items.name_en, 'Heavy Pistol')).get()!;
    const armor = db
      .select({ id: items.id, name: items.name_en })
      .from(items)
      .innerJoin(armors, eq(armors.item_id, items.id))
      .where(and(eq(armors.is_shield, false), gt(armors.sp_body, 0)))
      .get()!;
    const borg = db
      .select({ id: items.id, name: items.name_en, loss: cyberwares.humanity_loss_static })
      .from(items)
      .innerJoin(cyberwares, eq(cyberwares.item_id, items.id))
      .where(eq(cyberwares.cw_type, 'borgware'))
      .get()!;
    const eye = db
      .select({ id: items.id, name: items.name_en, loss: cyberwares.humanity_loss_static })
      .from(items)
      .innerJoin(cyberwares, eq(cyberwares.item_id, items.id))
      .where(and(eq(cyberwares.cw_type, 'cyberEye'), gt(cyberwares.humanity_loss_static, 0)))
      .get()!;

    const hpMax = hpMaxFromStats(stats.body, stats.will);
    const res = await app.request('/api/characters', {
      method: 'POST',
      headers: H(),
      body: JSON.stringify({
        kind: 'npc',
        name: 'エディタの NPC',
        role: 'ソロ',
        stats,
        skills: { handgun: 6, evasion: 4 },
        hp: hpMax,
        hp_max: hpMax,
        sp_head: 0,
        sp_body: 11,
        humanity: 30,
        emp_max: stats.emp,
        eb: 0,
        inventory: [
          { entry_id: 'e1', item_id: pistol.id, name: 'ヘビー・ピストル', kind: 'weapon', qty: 1, equipped: true },
          { entry_id: 'e2', item_id: armor.id, name: armor.name, kind: 'armor', qty: 1, equipped: true },
        ],
        cyberware: [
          { item_id: borg.id, name: borg.name, type: 'borgware', static_loss: borg.loss ?? 0 },
          { item_id: eye.id, name: eye.name, type: 'cyberEye', static_loss: eye.loss! },
        ],
        weapons: [],
      }),
    });
    expect(res.status).toBe(201);
    const { character } = await res.json();
    expect(hpMax).toBe(40);
    expect(character.hp_max).toBe(40);
    expect(character.inventory.map((i: { item_id: string }) => i.item_id)).toEqual([pistol.id, armor.id]);
    // 最大人間性 = EMP × 10 − ボーグウェア 4 − サイバーウェア 2
    expect(character.maxHumanity).toBe(stats.emp * 10 - 4 - 2);
    expect(character.skillsList.find((s: { key: string }) => s.key === 'handgun').base).toBe(stats.ref + 6);

    // 直す: 防具を外して SP を 0 に
    const patched = await app.request(`/api/characters/${character.id}`, {
      method: 'PATCH',
      headers: H(),
      body: JSON.stringify({ inventory: character.inventory.slice(0, 1), sp_body: 0 }),
    });
    expect(patched.status).toBe(200);
    const after = (await patched.json()).character;
    expect(after.inventory).toHaveLength(1);
    expect(after.sp_body).toBe(0);
  });

  it('rejects stats out of range instead of filling in a value', async () => {
    const res = await app.request('/api/characters', {
      method: 'POST',
      headers: H(),
      body: JSON.stringify({ kind: 'mook', name: '能力値なし', role: 'ソロ', stats: { ...stats, ref: 0 }, hp: 30, hp_max: 30, humanity: 30, emp_max: 4 }),
    });
    expect(res.status).toBe(400);
  });
});
