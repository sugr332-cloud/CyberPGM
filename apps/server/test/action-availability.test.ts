import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/index.js';
import { db, sqlite } from '../src/db/client.js';
import { characters, items, weapons, boards, board_tokens, board_objects, combats, combat_participants } from '../src/db/schema.js';
import { registerDevice } from '../src/auth.js';
import { validatePlayerMove } from '../src/routes/combat.js';
import { eq } from 'drizzle-orm';

/**
 * Phase 6a: できない行動の理由（画面のグレー表示）と、スマホのマップで選んだ移動先の確認
 */
describe('Phase 6a: action availability & player map move', () => {
  const now = Date.now();
  let GM: Record<string, string>;
  let PL: Record<string, string>;

  const pc = (id: string, name: string, over: Record<string, unknown> = {}) =>
    db
      .insert(characters)
      .values({
        id,
        kind: 'pc',
        name,
        role: 'Solo',
        stats: JSON.stringify({ int: 6, ref: 8, dex: 6, tech: 6, cool: 6, will: 6, luck: 5, move: 4, body: 6, emp: 6 }),
        skills: JSON.stringify({ handgun: 4, evasion: 2 }),
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
  const part = (id: string, charId: string, order: number, over: Record<string, unknown> = {}) => ({
    id,
    combat_id: 'cb',
    character_id: charId,
    side: 'ally',
    name: charId,
    initiative: 20 - order,
    order_index: order,
    active: true,
    out: false,
    move_used: false,
    action_used: false,
    state: '{}',
    ...over,
  });
  const gun = (ammo: number) =>
    JSON.stringify([{ entry_id: 'g', item_id: 'pistol', name: '大型拳銃', kind: 'weapon', qty: 1, equipped: true, ammo }]);
  const availability = async (headers: Record<string, string>, pid?: string) =>
    (await app.request(`/api/combat-availability${pid ? `?participant_id=${pid}` : ''}`, { headers })).json();
  const resolve = async (body: Record<string, unknown>) =>
    (await (await app.request('/api/combats/cb/resolve', { method: 'POST', headers: GM, body: JSON.stringify(body) })).json()).result;

  beforeEach(() => {
    for (const t of ['combat_log', 'combat_participants', 'combats', 'board_tokens', 'board_objects', 'boards', 'char_log', 'characters', 'devices', 'weapons', 'items']) {
      sqlite.prepare(`DELETE FROM ${t}`).run();
    }
    db.insert(items).values({ id: 'pistol', kind: 'weapon', name_en: 'Heavy Pistol', name_ja: '大型拳銃', origin: 'official_verified', verify_status: 'official_verified', created_at: 1, updated_at: 1 }).run();
    db.insert(weapons).values({ item_id: 'pistol', weapon_type: 'heavy_pistol', skill: 'Handgun', damage: '3d6', rof: 2, magazine_max: 8, dv_table_key: 'Pistol', is_ranged: true, autofire: null, suppressive: false } as any).run();
    pc('pc-a', 'エー', { inventory: gun(0) });
    pc('pc-b', 'ビー', { status: JSON.stringify(['気絶']) });
    db.insert(boards).values({ id: 'bd', name: '盤面', grid: JSON.stringify({ show: true, cell_m: 2, origin_x: 0, origin_y: 0, cell_px: 40, cols: 12, rows: 10 }), created_at: now, updated_at: now }).run();
    db.insert(board_objects).values({ id: 'wall', board_id: 'bd', kind: 'wall', label: '壁', x: 3, y: 0, w: 1, h: 3, rotation: 0, passable: false, blocks_los: 'full' } as any).run();
    db.insert(board_tokens).values([
      { id: 't-a', board_id: 'bd', character_id: 'pc-a', x: 1, y: 1, gm_only: false },
      { id: 't-b', board_id: 'bd', character_id: 'pc-b', x: 8, y: 8, gm_only: false },
    ] as any).run();
    db.insert(combats).values({ id: 'cb', status: 'active', round: 1, turn_index: 0, board_id: 'bd', settings: JSON.stringify({}), created_at: now }).run();
    db.insert(combat_participants).values([part('p-a', 'pc-a', 0), part('p-b', 'pc-b', 1, { state: JSON.stringify({ statusRounds: { 気絶: 12 } }) })] as any).run();
    GM = { Authorization: `Bearer ${registerDevice({ role: 'gm', label: 'GM' }).token}`, 'Content-Type': 'application/json' };
    PL = { Authorization: `Bearer ${registerDevice({ role: 'player', label: 'p', characterId: 'pc-a' }).token}` };
  });

  it('gives the same reason as the resolver (out of ammo, move used, unconscious)', async () => {
    const a = await availability(GM);
    expect(a.participant_id).toBe('p-a');
    // 弾 0 の射撃: 画面の理由と、撃とうとしたときの理由が同じ
    const shot = await resolve({ action_key: 'ranged', actor_id: 'p-a', weapon_entry_id: 'g', target_id: 'p-b', attacks: [{ target_id: 'p-b', roll: { first: 5 } }] });
    expect(a.actions.ranged).toBe('弾切れです。リロード（アクション 1 回）するか、別の武器・行動を選んでください');
    expect(shot.missing_inputs).toContain(a.actions.ranged);
    expect(a.actions.reload).toBe('予備の弾薬がありません');
    expect(a.actions.move).toBeNull();

    // 移動済み
    sqlite.prepare("UPDATE combat_participants SET move_used = 1 WHERE id = 'p-a'").run();
    const b = await availability(GM);
    const moved = await resolve({ action_key: 'move', actor_id: 'p-a' });
    expect(b.actions.move).toContain('移動アクションは使用済みです');
    expect(moved.missing_inputs).toEqual([b.actions.move]);
    expect(b.actions.run).toBeNull();

    // 気絶している人
    sqlite.prepare("UPDATE combats SET turn_index = 1 WHERE id = 'cb'").run();
    const c = await availability(GM);
    const ko = await resolve({ action_key: 'brawl', actor_id: 'p-b', target_id: 'p-a' });
    expect(c.actions.brawl).toBe('気絶しています（あと 12 ラウンド）');
    expect(ko.missing_inputs).toEqual([c.actions.brawl]);
    expect(c.actions.death_save).toBeNull();

    // NET アクション（《インタフェース》なし）
    expect(a.actions.net_action).toContain('《インタフェース》');
    // GM がほかの人を見ると、手番でない理由が出る（回避は別）
    const other = await availability(GM, 'p-a');
    expect(other.actions.ranged).toBe('弾切れです。リロード（アクション 1 回）するか、別の武器・行動を選んでください');
    expect(other.actions.brawl).toBe('pc-aの手番ではありません（今は pc-b の手番です）');
  });

  it('player sees own availability, and not-their-turn for others; ammo reasons hidden in hidden-ammo mode', async () => {
    const mine = await availability(PL);
    expect(mine.participant_id).toBe('p-a');
    expect(mine.actions.ranged).toContain('弾切れ');

    sqlite.prepare("UPDATE combats SET settings = ? WHERE id = 'cb'").run(JSON.stringify({ playerAmmoVisible: false }));
    const hidden = await availability(PL);
    expect(hidden.actions.ranged).toBeNull();

    sqlite.prepare("UPDATE combats SET turn_index = 1 WHERE id = 'cb'").run();
    const off = await availability(PL);
    expect(off.actions.move).toContain('自分の手番ではありません');
    expect(off.actions.dodge).toBeNull();
  });

  it('blocks untrained martial arts with the same availability and resolver reason, while first aid remains available at skill 0', async () => {
    const noStyle = await availability(GM);
    const denied = await resolve({ action_key: 'martial_arts', actor_id: 'p-a', target_id: 'p-b' });
    const reason = '〈武術〉を 1 レベル以上修得していないと使えません（p.178）';
    expect(noStyle.actions.martial_arts).toBe(reason);
    expect(noStyle.actions.martial_technique).toBe(reason);
    expect(denied.missing_inputs).toContain(reason);

    db.update(characters).set({ skills: JSON.stringify({ handgun: 4, evasion: 2, 'martial_arts:karate': 1 }) }).where(eq(characters.id, 'pc-a')).run();
    const trained = await availability(GM);
    expect(trained.actions.martial_arts).toBeNull();
    const permitted = await resolve({ action_key: 'martial_arts', actor_id: 'p-a', target_id: 'p-b' });
    expect(permitted.missing_inputs ?? []).not.toContain(reason);
    expect(permitted.missing_fields).toContainEqual({ field: 'attack_roll', attack_index: 0 });

    expect(trained.actions.first_aid).toBeNull();
  });

  it('returns stable missing field identifiers for death save and first aid rolls', async () => {
    const death = await resolve({ action_key: 'death_save', actor_id: 'p-a' });
    expect(death.missing_fields).toContainEqual({ field: 'death_save_roll', attack_index: 0 });
    const aid = await resolve({ action_key: 'first_aid', actor_id: 'p-a', target_id: 'p-b' });
    expect(aid.missing_fields).toContainEqual({ field: 'attack_roll', attack_index: 0 });
  });

  it('validates a destination chosen on the phone map', async () => {
    // 届くマス
    expect(validatePlayerMove('pc-a', 'move', 2, 3)).toEqual({ participant_id: 'p-a', action_key: 'move', destination: { x: 2, y: 3 } });
    // 移動力 4 では届かないマス
    expect(validatePlayerMove('pc-a', 'move', 10, 9)).toHaveProperty('error');
    // 壁のマス
    expect(validatePlayerMove('pc-a', 'move', 3, 1)).toHaveProperty('error');
    // 手番でない人
    expect((validatePlayerMove('pc-b', 'move', 8, 7) as { error: string }).error).toContain('自分の手番ではありません');
    // 移動・走る以外
    expect(validatePlayerMove('pc-a', 'ranged', 2, 2)).toHaveProperty('error');

    // マップ: 自分のコマと移動力が来る。プレイヤー以外は読めない
    const map = await (await app.request('/api/player-combat-map', { headers: PL })).json();
    expect(map.my_token_id).toBe('t-a');
    expect(map.max_moves).toBe(4);
    expect(map.is_my_turn).toBe(true);
    expect((await app.request('/api/player-combat-map', { headers: GM })).status).toBe(401);
  });
});
