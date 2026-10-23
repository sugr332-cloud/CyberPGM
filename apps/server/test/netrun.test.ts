import { getCoreSourceDir } from '../src/source-data.js';
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { app } from '../src/index.js';
import { db, sqlite } from '../src/db/client.js';
import { characters, boards, board_tokens, board_objects } from '../src/db/schema.js';
import { registerDevice } from '../src/auth.js';
import {
  netActionsForRank,
  generateNetArchitecture,
  validateCyberdeck,
  calculateArchitecturePriceEb,
  BLACK_ICE_CATALOG,
  DEMON_CATALOG,
  DEFAULT_LOBBY_TABLE,
  DEFAULT_FLOORS_TABLE,
  DECK_SLOTS,
} from '@cyberpgm/shared';

// Phase 5z: ネットランニング（日本語版 p.195〜222）
describe('Phase 5z: Netrunning', () => {
  let H: Record<string, string>;
  const now = Date.now();
  const dir = getCoreSourceDir();
  const file = path.join(dir, 'netrun.json');
  let wrote = false;

  beforeAll(() => {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({
          blackIce: BLACK_ICE_CATALOG,
          demons: DEMON_CATALOG,
          difficulties: {
            basic: { name: '初歩的', dv: 6 },
            standard: { name: '標準的', dv: 8 },
            uncommon: { name: '例外的', dv: 10 },
            advanced: { name: '先進的', dv: 12 },
          },
          lobby: DEFAULT_LOBBY_TABLE,
          floors: DEFAULT_FLOORS_TABLE,
          decks: DECK_SLOTS,
        }),
      );
      wrote = true;
    }
  });

  afterAll(() => {
    if (wrote) fs.rmSync(file);
  });

  const makeChar = (id: string, name: string, over: Record<string, unknown> = {}) =>
    db
      .insert(characters)
      .values({
        id,
        kind: 'pc',
        name,
        role: 'Netrunner',
        stats: JSON.stringify({
          int: 8,
          ref: 7,
          dex: 7,
          tech: 7,
          cool: 6,
          will: 7,
          luck: 5,
          move: 6,
          body: 6,
          emp: 6,
        }),
        skills: JSON.stringify({
          electronics_security_tech: 6,
          evasion: 4,
          handgun: 4,
          brawling: 4,
        }),
        extra: JSON.stringify({
          role_rank: 4,
          virtuality_goggles: true,
          deck: {
            quality: 'Standard',
            slots: 7,
            programs: ['See Ya', 'Worm', 'Sword', 'Hellbolt', 'Armor', 'Shield', 'Flak'],
            black_ice: [],
            hardware: [],
          },
        }),
        hp: 35,
        hp_max: 35,
        sp_head: 11,
        sp_body: 11,
        humanity: 60,
        emp_max: 6,
        created_at: now,
        updated_at: now,
        ...over,
      })
      .run();

  const req = async (method: string, p: string, body?: unknown) =>
    (
      await app.request(p, {
        method,
        headers: H,
        body: body ? JSON.stringify(body) : undefined,
      })
    ).json();

  const getChar = (id: string) => db.select().from(characters).where(eq(characters.id, id)).get()!;
  const getExtra = (id: string) => JSON.parse(getChar(id).extra || '{}');
  const getStats = (id: string) => JSON.parse(getChar(id).stats || '{}');
  const getStatus = (id: string) => JSON.parse(getChar(id).status || '[]') as string[];

  beforeEach(() => {
    for (const t of [
      'combat_log',
      'combat_participants',
      'combats',
      'board_drops',
      'board_objects',
      'board_tokens',
      'boards',
      'char_log',
      'characters',
      'devices',
      'weapons',
      'items',
      'rule_constants',
    ]) {
      sqlite.prepare(`DELETE FROM ${t}`).run();
    }
    const gm = registerDevice({ role: 'gm', label: 'GM' });
    H = { Authorization: `Bearer ${gm.token}`, 'Content-Type': 'application/json' };
    makeChar('runner', 'バグ');
    makeChar('enemy_runner', '敵ネットランナー', {
      extra: JSON.stringify({
        role_rank: 4,
        virtuality_goggles: true,
        deck: {
          quality: 'Standard',
          slots: 7,
          programs: ['Sword', 'Hellbolt'],
          black_ice: [],
          hardware: [],
        },
      }),
    });
  });

  const startCombat = async (boardId?: string) => {
    const c = await req('POST', '/api/combats', boardId ? { board_id: boardId } : {});
    await req('POST', `/api/combats/${c.combat.id}/participants`, { character_id: 'runner', side: 'ally' });
    await req('POST', `/api/combats/${c.combat.id}/participants`, { character_id: 'enemy_runner', side: 'enemy' });
    return (await req('GET', '/api/combats/current')).combat;
  };

  const resetTurn = (partId: string) => {
    const row = sqlite.prepare('SELECT state FROM combat_participants WHERE id = ?').get(partId) as any;
    const st = JSON.parse(row?.state || '{}');
    delete st.actions_taken;
    if (st.net) {
      st.net.net_used = 0;
      st.net.slid_this_turn = false;
      st.net.controlled_used_this_turn = [];
    }
    sqlite
      .prepare('UPDATE combat_participants SET move_used = 0, action_used = 0, state = ? WHERE id = ?')
      .run(JSON.stringify(st), partId);
  };

  it('1. Interface rank 1-3 -> 2, 4-6 -> 3, 7-9 -> 4, 10 -> 5 NET actions, and Wisp reduces by 1 (min 2)', async () => {
    expect(netActionsForRank(1, false)).toBe(2);
    expect(netActionsForRank(3, false)).toBe(2);
    expect(netActionsForRank(4, false)).toBe(3);
    expect(netActionsForRank(6, false)).toBe(3);
    expect(netActionsForRank(7, false)).toBe(4);
    expect(netActionsForRank(9, false)).toBe(4);
    expect(netActionsForRank(10, false)).toBe(5);

    // ウィスプの効果中は -1（最低 2）
    expect(netActionsForRank(2, true)).toBe(2);
    expect(netActionsForRank(4, true)).toBe(2);
    expect(netActionsForRank(7, true)).toBe(3);
    expect(netActionsForRank(10, true)).toBe(4);

    // 実際の戦闘でもランク 4（3 回）→ ウィスプ後は 2 回で使い切ることを確認
    const archRes = await req('POST', '/api/netrun/architectures', {
      name: 'テストNET',
      difficulty: 'standard',
      floors: [{ floor: 1, depth: 1, branch: 0, parent_floor: null, raw: 'file:6' }],
    });
    const cb = await startCombat();
    const runner = cb.participants.find((p: any) => p.character_id === 'runner');

    // 1回目: ジャックイン
    const r1 = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'jack_in', arch_id: archRes.architecture.id },
    });
    expect(r1.result.success).toBe(true);

    // 2回目: パスファインダー
    const r2 = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      attack_roll: { first: 5 },
      net: { sub_action: 'pathfinder' },
    });
    expect(r2.result.success).toBe(true);

    // 3回目: アイディー -> これで 3/3 使い切り
    const r3 = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      attack_roll: { first: 5 },
      net: { sub_action: 'eyedee', target_floor: 1 },
    });
    expect(r3.result.success).toBe(true);

    // 4回目は失敗（使い切り）
    const r4 = await req('POST', `/api/combats/${cb.id}/resolve`, {
      action_key: 'net_action',
      actor_id: runner.id,
      attack_roll: { first: 5 },
      net: { sub_action: 'pathfinder' },
    });
    expect(r4.result.success).toBe(false);
  });

  it('2 & 3. Pathfinder reveals floors up to total, stops at Password exceeding total, See Ya adds +2, and Backdoor (+2 with Worm) unlocks Password', async () => {
    const archRes = await req('POST', '/api/netrun/architectures', {
      name: '社内サーバ',
      difficulty: 'standard',
      floors: [
        { floor: 1, depth: 1, branch: 0, parent_floor: null, raw: 'file:6' },
        { floor: 2, depth: 2, branch: 0, parent_floor: 1, raw: 'password:10' },
        { floor: 3, depth: 3, branch: 0, parent_floor: 2, raw: 'control:8' },
      ],
    });
    const archId = archRes.architecture.id;
    const cb = await startCombat();
    const runner = cb.participants.find((p: any) => p.character_id === 'runner');

    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'jack_in', arch_id: archId },
    });

    // シーヤとワームを起動
    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'activate', program_key: 'See Ya' },
    });
    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'activate', program_key: 'Worm' },
    });
    resetTurn(runner.id);

    // パスファインダー: インタフェース 4 + シーヤ 2 + 出目 3 = 9 -> F2 のパスワード (DV10 > 9) で止まる（F1, F2 まで公開、F3 は見えず）
    const pf = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      attack_roll: { first: 3 },
      net: { sub_action: 'pathfinder' },
    });
    expect(pf.result.formula).toContain('+ シーヤ 2');
    expect(pf.result.formula).toContain('パスワード DV10 で遮断');
    expect(pf.result.breakdown.revealed).toEqual([1, 2]);

    // F2（パスワード階）に移動してから F3 に進もうとするとブロックされる
    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'descend', target_floor: 2 },
    });
    const blocked = await req('POST', `/api/combats/${cb.id}/resolve`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'descend', target_floor: 3 },
    });
    expect(blocked.result.success).toBe(false);
    expect(blocked.result.formula).toContain('パスワード');

    // バックドア: インタフェース 4 + ワーム 2 + 出目 5 = 11 > DV 10 で突破
    const bd = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      attack_roll: { first: 5 },
      net: { sub_action: 'backdoor', target_floor: 2 },
    });
    expect(bd.result.success).toBe(true);
    expect(bd.result.formula).toContain('+ ワーム 2');

    // 突破後は F3 へ移動できる
    const desc3 = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'descend', target_floor: 3 },
    });
    expect(desc3.result.success).toBe(true);
  });

  it('4. Eye-Dee identifies files and Control masters control nodes and allows operating devices once per turn', async () => {
    const archRes = await req('POST', '/api/netrun/architectures', {
      name: '防衛システム',
      difficulty: 'basic',
      floors: [
        { floor: 1, depth: 1, branch: 0, parent_floor: null, raw: 'file:6', note: '極秘口座データ' },
        { floor: 2, depth: 2, branch: 0, parent_floor: 1, raw: 'control:6', note: '廊下のオートタレット' },
      ],
    });
    const cb = await startCombat();
    const runner = cb.participants.find((p: any) => p.character_id === 'runner');

    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'jack_in', arch_id: archRes.architecture.id },
    });

    // F1 アイディー
    const idRes = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      attack_roll: { first: 5 },
      net: { sub_action: 'eyedee', target_floor: 1 },
    });
    expect(idRes.result.success).toBe(true);
    expect(idRes.result.formula).toContain('極秘口座データ');

    // F2 に降りてコントロールで掌握
    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'descend', target_floor: 2 },
    });
    const ctrl = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      attack_roll: { first: 5 },
      net: { sub_action: 'control', target_floor: 2 },
    });
    expect(ctrl.result.success).toBe(true);
    expect(ctrl.result.formula).toContain('掌握成功');

    resetTurn(runner.id);
    // 掌握済みの制御ノードを 1 ターンに 1 回作動
    const op1 = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'operate_node', target_floor: 2 },
    });
    expect(op1.result.success).toBe(true);
    expect(op1.result.formula).toContain('廊下のオートタレット');

    // 同じターンにもう一度動かそうとするとエラー
    const op2 = await req('POST', `/api/combats/${cb.id}/resolve`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'operate_node', target_floor: 2 },
    });
    expect(op2.result.success).toBe(false);
    expect(op2.result.formula).toContain('1 ターンに 1 回');
  });

  it('5. Sword (3d6 REZ to Black ICE) and Hellbolt (2d6 direct brain damage ignoring SP + fire unless Insulated Wiring)', async () => {
    const archRes = await req('POST', '/api/netrun/architectures', {
      name: '激戦区NET',
      difficulty: 'standard',
      floors: [{ floor: 1, depth: 1, branch: 0, parent_floor: null, raw: 'ice:Wisp' }],
    });
    const cb = await startCombat();
    const runner = cb.participants.find((p: any) => p.character_id === 'runner');
    const enemy = cb.participants.find((p: any) => p.character_id === 'enemy_runner');

    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: {
        sub_action: 'jack_in',
        arch_id: archRes.architecture.id,
        ice_rolls: [{ ice_roll: { first: 1, extra: 1 }, runner_roll: { first: 8 } }],
      },
    });

    // ソードで F1 のウィスプ (REZ 15, DEF 2) を攻撃: インタフェース 4 + ATK 1 + 出目 8 = 13 vs DEF 2 + 出目 2 = 4 -> 3d6 = [6, 5, 5] = 16 ダメージで消滅
    const sw = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      attack_roll: { first: 8 },
      defense_roll: { first: 2 },
      damage_dice: [6, 5, 5],
      net: { sub_action: 'program', program_key: 'Sword', target_ice_id: `arch-${archRes.architecture.id}-f1-0` },
    });
    expect(sw.result.success).toBe(true);
    expect(sw.result.formula).toContain('REZ 15 → 0、消滅');

    // ヘルボルトで敵ネットランナー（SP 11 あり）を攻撃 -> 防具 SP を無視して HP 35 → 27、着火（小）付与
    const hb = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      target_id: enemy.id,
      attack_roll: { first: 9 },
      defense_roll: { first: 2 },
      damage_dice: [4, 4],
      net: { sub_action: 'program', program_key: 'Hellbolt' },
    });
    expect(hb.result.success).toBe(true);
    expect(getChar('enemy_runner').hp).toBe(27);
    expect(getChar('enemy_runner').sp_body).toBe(11);
    expect(getStatus('enemy_runner')).toContain('着火（小）');

    // インスレーテッド・ワイヤリングを装備していれば着火しない
    await req('POST', '/api/netrun/deck/enemy_runner', {
      quality: 'Standard',
      slots: 7,
      programs: ['Sword'],
      black_ice: [],
      hardware: ['Insulated Wiring'],
    });
    sqlite.prepare('UPDATE characters SET status = ? WHERE id = ?').run('[]', 'enemy_runner');
    resetTurn(runner.id);

    const hb2 = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      target_id: enemy.id,
      attack_roll: { first: 9 },
      defense_roll: { first: 2 },
      damage_dice: [3, 3],
      net: { sub_action: 'program', program_key: 'Hellbolt' },
    });
    expect(hb2.result.formula).toContain('インスレーテッド・ワイヤリング');
    expect(getStatus('enemy_runner')).not.toContain('着火（小）');
  });

  it('6. Armor (-4 brain damage, non-stacking), Shield (blocks first non-Black ICE brain damage), and Flit Switch (+2 Slide)', async () => {
    await req('POST', '/api/netrun/deck/runner', {
      quality: 'Excellent',
      slots: 9,
      programs: ['Armor', 'Armor', 'Shield'],
      black_ice: [],
      hardware: ['Flit Switch'],
    });
    const archRes = await req('POST', '/api/netrun/architectures', {
      name: '防御検証NET',
      difficulty: 'standard',
      floors: [{ floor: 1, depth: 1, branch: 0, parent_floor: null, raw: 'ice:Hellhound' }],
    });
    const cb = await startCombat();
    const runner = cb.participants.find((p: any) => p.character_id === 'runner');
    const enemy = cb.participants.find((p: any) => p.character_id === 'enemy_runner');

    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: {
        sub_action: 'jack_in',
        arch_id: archRes.architecture.id,
        ice_rolls: [{ ice_roll: { first: 2 }, runner_roll: { first: 9 } }],
      },
    });
    // アーマーを起動（2コピー目は同時に起動できない）
    const act1 = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'activate', program_key: 'Armor' },
    });
    expect(act1.result.success).toBe(true);
    const actDup = await req('POST', `/api/combats/${cb.id}/resolve`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'activate', program_key: 'Armor' },
    });
    expect(actDup.result.success).toBe(false);
    expect(actDup.result.formula).toContain('同時に 1 枚しか起動できません');

    // シールドを起動
    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'activate', program_key: 'Shield' },
    });

    // 敵ネットランナーもジャックインしてザップ（非ブラック ICE 脳ダメージ）-> シールドが完全に防いで停止（HP 35 のまま）
    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: enemy.id,
      net: {
        sub_action: 'jack_in',
        arch_id: archRes.architecture.id,
        ice_rolls: [{ ice_roll: { first: 2 }, runner_roll: { first: 9 } }],
      },
    });
    const zapRes = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: enemy.id,
      target_id: runner.id,
      attack_roll: { first: 9 },
      defense_roll: { first: 2 },
      damage_dice: [6],
      net: { sub_action: 'zap' },
    });
    expect(zapRes.result.formula).toContain('シールドが脳ダメージ（6）を完全に防いで停止');
    expect(getChar('runner').hp).toBe(35);

    // ヘルハウンド（ブラック ICE 2d6 = 9）の攻撃 -> アーマーが 4 点軽減して 5 ダメージ（HP 35 → 30）
    const iceAtk = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_ice_attack',
      actor_id: runner.id,
      target_id: runner.id,
      attack_roll: { first: 9 },
      defense_roll: { first: 2 },
      damage_dice: [5, 4],
      net: { target_ice_id: `arch-${archRes.architecture.id}-f1-0` },
    });
    expect(iceAtk.result.formula).toContain('アーマー −4 → 5');
    expect(getChar('runner').hp).toBe(30);

    // スピーディ・ゴンザルヴェス起動でスライドに +2
    resetTurn(runner.id);
    await req('POST', '/api/netrun/deck/runner', {
      quality: 'Excellent',
      slots: 9,
      programs: ['Speedy Gonzalvez', 'Armor', 'Shield'],
      black_ice: [],
      hardware: [],
    });
    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'activate', program_key: 'Speedy Gonzalvez' },
    });
    const slideRes = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      attack_roll: { first: 6 },
      defense_roll: { first: 2 },
      net: { sub_action: 'slide', target_ice_id: `arch-${archRes.architecture.id}-f1-0` },
    });
    expect(slideRes.result.success).toBe(true);
    expect(slideRes.result.formula).toContain('+ スピーディ 2');
  });

  it('7. Black ICE ambush (SPD contest), stat drain (Liche/Scorpion + 1h restore), program destruction (Asp), pin (Kraken), and force-out (Giant vs KRASH Barrier)', async () => {
    // クラーケン + リッチ + アスプ + ジャイアントの階層を持つアーキテクチャ
    const archRes = await req('POST', '/api/netrun/architectures', {
      name: 'ブラックICE試験場',
      difficulty: 'uncommon',
      floors: [
        { floor: 1, depth: 1, branch: 0, parent_floor: null, raw: 'ice:Kraken,Liche,Asp' },
        { floor: 2, depth: 2, branch: 0, parent_floor: 1, raw: 'ice:Giant' },
      ],
    });
    const archId = archRes.architecture.id;
    const cb = await startCombat();
    const runner = cb.participants.find((p: any) => p.character_id === 'runner');

    // ジャックイン時にクラーケンが先制攻撃 (SPD 2 + 8 = 10 >= 4 + 3 = 7) で命中 -> 移動封じ
    const ji = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: {
        sub_action: 'jack_in',
        arch_id: archId,
        ice_rolls: [
          { ice_roll: { first: 8 }, runner_roll: { first: 3 }, damage_dice: [2, 2, 2] },
          { ice_roll: { first: 2 }, runner_roll: { first: 8 } },
          { ice_roll: { first: 2 }, runner_roll: { first: 8 } },
        ],
      },
    });
    expect(ji.result.formula).toContain('クラーケン 先制攻撃成功');
    expect(ji.result.formula).toContain('移動封じ');

    // クラーケン効果中は F2 への移動も安全なジャックアウトもできない
    const moveBlocked = await req('POST', `/api/combats/${cb.id}/resolve`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'descend', target_floor: 2 },
    });
    expect(moveBlocked.result.success).toBe(false);
    expect(moveBlocked.result.formula).toContain('移動を封じられている');

    const joBlocked = await req('POST', `/api/combats/${cb.id}/resolve`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'jack_out' },
    });
    expect(joBlocked.result.success).toBe(false);

    // リッチの攻撃: INT / REF / DEX が 1d6 低下（1時間経過で戻る）
    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_ice_attack',
      actor_id: runner.id,
      target_id: runner.id,
      attack_roll: { first: 9 },
      defense_roll: { first: 2 },
      damage_dice: [3, 2, 4],
      net: { target_ice_id: `arch-${archId}-f1-1` },
    });
    expect(getStats('runner').int).toBe(5);
    expect(getStats('runner').ref).toBe(5);
    expect(getStats('runner').dex).toBe(3);

    // 1 時間経過（medical time）で能力値が元に戻る
    await req('POST', '/api/medical/time', { hours: 1 });
    expect(getStats('runner').int).toBe(8);
    expect(getStats('runner').ref).toBe(7);
    expect(getStats('runner').dex).toBe(7);

    // アスプの攻撃: デッキ上のプログラムが 1 つ破壊される
    const progsBefore = getExtra('runner').deck.programs.length;
    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_ice_attack',
      actor_id: runner.id,
      target_id: runner.id,
      attack_roll: { first: 9 },
      defense_roll: { first: 2 },
      net: { target_ice_id: `arch-${archId}-f1-2` },
    });
    expect(getExtra('runner').deck.programs.length).toBe(progsBefore - 1);

    // クラーケンをソードで倒せば移動封じが解ける
    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      attack_roll: { first: 9 },
      defense_roll: { first: 2 },
      damage_dice: [6, 6, 6],
      net: { sub_action: 'program', program_key: 'Sword', target_ice_id: `arch-${archId}-f1-0` },
    });
    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      attack_roll: { first: 9 },
      defense_roll: { first: 2 },
      damage_dice: [6, 6, 6],
      net: { sub_action: 'program', program_key: 'Sword', target_ice_id: `arch-${archId}-f1-0` },
    });

    // F2 に降りてジャイアントと遭遇（KRASHバリアがあれば強制切断されない）
    await req('POST', '/api/netrun/deck/runner', {
      quality: 'Standard',
      slots: 7,
      programs: ['Sword'],
      black_ice: [],
      hardware: ['KRASH Barrier'],
    });
    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: {
        sub_action: 'descend',
        target_floor: 2,
        ice_rolls: [{ ice_roll: { first: 9 }, runner_roll: { first: 2 }, damage_dice: [1, 1, 1] }],
      },
    });
    const afterKrash = (await req('GET', '/api/combats/current')).combat.participants.find(
      (p: any) => p.id === runner.id,
    );
    expect(afterKrash.state.net.jacked_in).toBe(true);
  });

  it('8. Unsafe Jack Out suffers effects of all remaining un-slid antipersonnel Black ICE before disconnecting', async () => {
    const archRes = await req('POST', '/api/netrun/architectures', {
      name: '多重ICE罠',
      difficulty: 'standard',
      floors: [
        { floor: 1, depth: 1, branch: 0, parent_floor: null, raw: 'ice:Wisp' },
        { floor: 2, depth: 2, branch: 0, parent_floor: 1, raw: 'ice:Hellhound' },
      ],
    });
    const cb = await startCombat();
    const runner = cb.participants.find((p: any) => p.character_id === 'runner');

    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: {
        sub_action: 'jack_in',
        arch_id: archRes.architecture.id,
        ice_rolls: [{ ice_roll: { first: 1, extra: 1 }, runner_roll: { first: 9 } }],
      },
    });
    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: {
        sub_action: 'descend',
        target_floor: 2,
        ice_rolls: [{ ice_roll: { first: 1, extra: 1 }, runner_roll: { first: 9 } }],
      },
    });

    // ウィスプ(1d6=4) + ヘルハウンド(2d6=3+5=8) の計 12 ダメージと着火を一気に受けて切断
    const ujo = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      damage_dice: [4, 3, 5],
      net: { sub_action: 'unsafe_jack_out' },
    });
    expect(ujo.result.success).toBe(true);
    expect(ujo.result.formula).toContain('ウィスプ');
    expect(ujo.result.formula).toContain('ヘルハウンド');
    expect(getChar('runner').hp).toBe(23);
    expect(getStatus('runner')).toContain('着火（小）');
    const updatedPart = ujo.combat.participants.find((p: any) => p.id === runner.id);
    expect(updatedPart.state.net.jacked_in).toBe(false);
  });

  it('9. Virus requires the specified number of NET actions and DV check at the lowest floor and persists on the architecture', async () => {
    const archRes = await req('POST', '/api/netrun/architectures', {
      name: '銀行メインフレーム',
      difficulty: 'standard',
      floors: [
        { floor: 1, depth: 1, branch: 0, parent_floor: null, raw: 'file:6' },
        { floor: 2, depth: 2, branch: 0, parent_floor: 1, raw: 'control:8' },
      ],
    });
    const archId = archRes.architecture.id;
    const cb = await startCombat();
    const runner = cb.participants.find((p: any) => p.character_id === 'runner');

    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'jack_in', arch_id: archId },
    });

    // F1（最下層ではない）でウイルスを作ろうとするとエラー
    const notBottom = await req('POST', `/api/combats/${cb.id}/resolve`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'virus', virus_desc: '毎月送金', virus_actions: 2, virus_dv: 10 },
    });
    expect(notBottom.result.success).toBe(false);
    expect(notBottom.result.formula).toContain('最下層');

    // F2（最下層）へ移動して 2 アクションのウイルスを作成
    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'descend', target_floor: 2 },
    });
    const v1 = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'virus', virus_desc: '監視ログ自動消去', virus_actions: 2, virus_dv: 10 },
    });
    expect(v1.result.formula).toContain('1/2 NET アクション完了');

    const v2 = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      attack_roll: { first: 8 },
      net: { sub_action: 'virus', virus_desc: '監視ログ自動消去', virus_actions: 2, virus_dv: 10 },
    });
    expect(v2.result.success).toBe(true);
    expect(v2.result.formula).toContain('設置成功');

    const updatedArch = (await req('GET', `/api/netrun/architectures/${archId}`)).architecture;
    expect(updatedArch.viruses).toHaveLength(1);
    expect(updatedArch.viruses[0].description).toBe('監視ログ自動消去');
  });

  it('10. Cyberdeck slot limits (5/7/9), 2-slot cost for Black ICE & Range Upgrade, and Backup Drive restoration', async () => {
    // 5 スロットにプログラム 4 個 + ブラック ICE 1 個 (計 6 スロット) は上限超過
    const vFail = validateCyberdeck({
      quality: 'Poor',
      slots: 5,
      programs: ['Sword', 'Worm', 'See Ya', 'Armor'],
      black_ice: ['Wisp'],
      hardware: [],
    });
    expect(vFail.ok).toBe(false);
    expect(vFail.used).toBe(6);

    const apiFail = await req('POST', '/api/netrun/deck/runner', {
      quality: 'Poor',
      slots: 5,
      programs: ['Sword', 'Worm', 'See Ya', 'Armor'],
      black_ice: ['Wisp'],
      hardware: [],
    });
    expect(apiFail.error).toContain('スロット上限');

    // バックアップ・ドライブを装備してアスプにプログラムを破壊された後、復元できる
    await req('POST', '/api/netrun/deck/runner', {
      quality: 'Standard',
      slots: 7,
      programs: ['Sword', 'Hellbolt'],
      black_ice: [],
      hardware: ['Backup Drive'],
    });
    const archRes = await req('POST', '/api/netrun/architectures', {
      name: 'アスプの巣',
      difficulty: 'basic',
      floors: [{ floor: 1, depth: 1, branch: 0, parent_floor: null, raw: 'ice:Asp' }],
    });
    const cb = await startCombat();
    const runner = cb.participants.find((p: any) => p.character_id === 'runner');
    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: {
        sub_action: 'jack_in',
        arch_id: archRes.architecture.id,
        ice_rolls: [{ ice_roll: { first: 9 }, runner_roll: { first: 2 } }],
      },
    });
    expect(getExtra('runner').deck.programs).toEqual(['Hellbolt']);
    expect(getExtra('runner').deck.backup_saved).toEqual(['Sword']);

    const restored = await req('POST', '/api/netrun/deck/runner', { restore_backup: true });
    expect(restored.deck.programs).toEqual(['Hellbolt', 'Sword']);
    expect(restored.deck.backup_saved).toEqual([]);
  });

  it('11. Automatic NET Architecture generation obeys 3d6 floors, lobby no-branch, unique longest root, demon limits, and duplicate rerolls', async () => {
    const arch = generateNetArchitecture({ difficulty: 'uncommon', name: 'テスト自動生成NET' });
    expect(arch.floors.length).toBeGreaterThanOrEqual(3);
    expect(arch.floors.length).toBeLessThanOrEqual(18);
    // 第1〜2階層（ロビー）は分岐なし（'main'）
    expect(arch.floors[0].branch).toBe('main');
    if (arch.floors.length >= 2) {
      expect(arch.floors[1].branch).toBe('main');
    }
    // 最長ルート（最大の depth）は 1 つだけ（幹が最長）
    const maxDepth = Math.max(...arch.floors.map((f) => f.depth));
    const deepestFloors = arch.floors.filter((f) => f.depth === maxDepth);
    expect(deepestFloors).toHaveLength(1);
    expect(deepestFloors[0].branch).toBe('main');

    // デーモン上限チェックと自宅購入価格（初歩的 = 1000eb/階層 × 5階層 = 5000eb）
    expect(
      calculateArchitecturePriceEb({
        difficulty: 'basic',
        floors: Array.from({ length: 5 }, (_, i) => ({
          floor: i + 1,
          depth: i + 1,
          branch: 'main',
          raw: 'file:6',
          kind: 'file' as const,
        })),
      }).floorCost,
    ).toBe(5000);
    const tooManyDemons = await req('POST', '/api/netrun/architectures', {
      name: '違法デーモン構成',
      difficulty: 'basic',
      floors: [
        { floor: 1, depth: 1, branch: 'main', parent_floor: null, raw: 'demon:Imp' },
        { floor: 2, depth: 2, branch: 'main', parent_floor: 1, raw: 'demon:Efreet' },
      ],
    });
    expect(tooManyDemons.error).toContain('最大 1 体');
  });

  it('12. Scanner (Electronics/Security Tech + Tech Field Expertise) finds access points, and >6m (8m with Range Upgrade) or wall LOS breaks connection', async () => {
    // テク兼ネットランナーに現場エンジニアを 4 振る
    sqlite
      .prepare('UPDATE characters SET role = ?, extra = ? WHERE id = ?')
      .run(
        'Tech',
        JSON.stringify({
          role_rank: 4,
          role_ranks: { Netrunner: 4, Tech: 4 },
          maker: { field: 4, upgrade: 0, fabricate: 0, invent: 0 },
          virtuality_goggles: true,
          deck: { quality: 'Standard', slots: 7, programs: ['Sword'], black_ice: [], hardware: [] },
        }),
        'runner',
      );

    // 盤面とアクセスポイント、遮蔽壁を作成
    db.insert(boards)
      .values({ id: 'b1', name: 'ビル1F', grid: JSON.stringify({ cols: 20, rows: 20 }), created_at: now, updated_at: now } as any)
      .run();
    db.insert(board_tokens)
      .values({ id: 'tok_runner', board_id: 'b1', character_id: 'runner', x: 2, y: 2, size: 1 })
      .run();
    db.insert(board_objects)
      .values({
        id: 'ap1',
        board_id: 'b1',
        kind: 'access_point',
        label: '壁面端子',
        x: 4,
        y: 2,
        w: 1,
        h: 1,
        rotation: 0,
        passable: true,
        blocks_los: 'none',
        note: '壁面端子',
      } as any)
      .run();

    const archRes = await req('POST', '/api/netrun/architectures', {
      name: 'ビル制御系',
      difficulty: 'basic',
      floors: [{ floor: 1, depth: 1, branch: 0, parent_floor: null, raw: 'ice:Wisp' }],
    });
    const cb = await startCombat('b1');
    const runner = cb.participants.find((p: any) => p.character_id === 'runner');

    // スキャナ: TECH 7 + 電子/セキュリティ 6 + 現場エンジニア 4 + 出目 5 = 22 > DV 13
    const scan = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'scanner',
      actor_id: runner.id,
      attack_roll: { first: 5 },
      net: { scanner_dv: 13 },
    });
    expect(scan.result.success).toBe(true);
    expect(scan.result.formula).toContain('現場エンジニア 4');
    expect(scan.result.formula).toContain('壁面端子');

    resetTurn(runner.id);
    // 2マス = 4m（6m以内）なのでジャックイン成功
    const ji = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: {
        sub_action: 'jack_in',
        arch_id: archRes.architecture.id,
        ice_rolls: [{ ice_roll: { first: 1, extra: 1 }, runner_roll: { first: 9 } }],
      },
    });
    expect(ji.result.success).toBe(true);

    // 移動で (8, 2) へ（アクセスポイント (4,2) から 4マス = 8m > 6m）-> 安全でないジャックアウトが自動発生！
    const mv = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'move',
      actor_id: runner.id,
      destination: { x: 8, y: 2 },
      damage_dice: [3],
    });
    expect(mv.result.formula).toContain('範囲外切断');
    const runnerAfterMove = mv.combat.participants.find((p: any) => p.id === runner.id);
    expect(runnerAfterMove.state.net.jacked_in).toBe(false);

    // レンジ・アップグレード（8m = 4マス）を付ければ (8, 2) からでもジャックインできるが、間に壁があれば失敗する
    await req('POST', '/api/netrun/deck/runner', {
      quality: 'Standard',
      slots: 7,
      programs: ['Sword'],
      black_ice: [],
      hardware: ['Range Upgrade'],
    });
    resetTurn(runner.id);
    const jiRange = await req('POST', `/api/combats/${cb.id}/resolve`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'jack_in', arch_id: archRes.architecture.id },
    });
    expect(jiRange.result.success).toBe(true);

    // 遮蔽壁を (6, 2) に置くと射線が遮られてジャックイン不可
    db.insert(board_objects)
      .values({
        id: 'wall1',
        board_id: 'b1',
        kind: 'wall_H',
        label: '壁',
        x: 6,
        y: 2,
        w: 1,
        h: 1,
        rotation: 0,
        passable: false,
        blocks_los: 'full',
      } as any)
      .run();
    const jiBlockedLos = await req('POST', `/api/combats/${cb.id}/resolve`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'jack_in', arch_id: archRes.architecture.id },
    });
    expect(jiBlockedLos.result.success).toBe(false);
    expect(jiBlockedLos.result.formula).toContain('遮蔽物');
  });

  it('13. Demons and Defenses (Turrets/Drones) join at top of initiative; stationary Turrets cannot dodge while Drones can', async () => {
    const cb = await startCombat();
    const runner = cb.participants.find((p: any) => p.character_id === 'runner');

    // 固定式自動砲塔（固定設備）と自律小型ドローン（移動可）を戦闘に追加
    const addTurret = await req('POST', `/api/combats/${cb.id}/net-join`, {
      kind: 'security',
      key: 'auto_turret',
      side: 'enemy',
    });
    expect(addTurret.participant.initiative).toBeGreaterThanOrEqual(21);

    const addDrone = await req('POST', `/api/combats/${cb.id}/net-join`, {
      kind: 'security',
      key: 'mini_drone',
      side: 'enemy',
    });
    expect(addDrone.participant.initiative).toBeGreaterThan(addTurret.participant.initiative);

    const turretChar = getChar(addTurret.participant.character_id);
    const droneChar = getChar(addDrone.participant.character_id);
    expect(JSON.parse(turretChar.status)).toContain('回避できない');
    expect(JSON.parse(droneChar.status)).not.toContain('回避できない');

    // 固定設備への格闘攻撃は防御ロールなしで自動命中する（BODY 6 の格闘は 2d6）
    const brawlTurret = await req('POST', `/api/combats/${cb.id}/resolve`, {
      action_key: 'brawl',
      actor_id: runner.id,
      target_id: addTurret.participant.id,
      attack_roll: { first: 5 },
      damage_dice: [4, 4],
    });
    expect(brawlTurret.result.success).toBe(true);
    expect(brawlTurret.result.formula).toContain('固定設備（回避不可） -> 命中');

    // Undo で直前に追加したドローンが消える
    const undoRes = await req('POST', `/api/combats/${cb.id}/undo`, {});
    expect(undoRes.success).toBe(true);
    expect(undoRes.combat.participants.some((p: any) => p.id === addDrone.participant.id)).toBe(false);
  });

  it('14. Duplicate reroll with fixed RNG, meat action blocked after NET action, turn reset, DeckKRASH, Poison Flatline, and Flak', async () => {
    // 固定乱数でロビー 1階・2階ともに同じ出目 2 (password:6) が出たあと 5 (ice:Wisp) が出る列を渡し、重複振り直しを確認
    const seq = [
      // totalFloors 3d6 -> 1+1+1 = 3
      0.0, 0.0, 0.0,
      // branch 1d10 -> 1 (分岐なし)
      0.0,
      // floor 1 (1d6) -> 2 (password:6)
      0.2,
      // floor 2 (1d6) -> 2 (password:6 -> 重複で振り直し) -> 5 (ice:Wisp)
      0.2, 0.7,
      // floor 3 (3d6) -> 3+3+4 = 10 (password:8)
      0.4, 0.4, 0.6,
    ];
    let idx = 0;
    const dupArch = generateNetArchitecture({
      difficulty: 'standard',
      rng: () => seq[idx++] ?? 0.5,
    });
    expect(dupArch.floors[0].raw).toBe('password:6');
    expect(dupArch.floors[1].raw).toBe('ice:Wisp');

    // NET アクションを使ったターンは肉体アクション不可、手番送り（next-turn）で net_used が 0 に戻る
    const archRes = await req('POST', '/api/netrun/architectures', {
      name: '対戦NET',
      difficulty: 'basic',
      floors: [{ floor: 1, depth: 1, branch: 'main', parent_floor: null, raw: 'file:6' }],
    });
    await req('POST', '/api/netrun/deck/enemy_runner', {
      quality: 'Standard',
      slots: 7,
      programs: ['DeckKRASH', 'Poison Flatline', 'Hellbolt', 'Flak'],
      black_ice: [],
      hardware: [],
    });
    const cb = await startCombat();
    const runner = cb.participants.find((p: any) => p.character_id === 'runner');
    const enemy = cb.participants.find((p: any) => p.character_id === 'enemy_runner');

    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'jack_in', arch_id: archRes.architecture.id },
    });

    // NETアクション使用後に肉体アクション（brawl）を使おうとすると拒否される
    const meatAfterNet = await req('POST', `/api/combats/${cb.id}/resolve`, {
      action_key: 'brawl',
      actor_id: runner.id,
      target_id: enemy.id,
      attack_roll: { first: 5 },
      defense_roll: { first: 2 },
      damage_dice: [3, 3],
    });
    expect(meatAfterNet.result.success).toBe(false);
    expect(meatAfterNet.result.formula).toContain('NET アクションを使っているため');

    // フラックを起動しておく
    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: runner.id,
      net: { sub_action: 'activate', program_key: 'Flak' },
    });

    // 手番を 2 回進めて一巡させると runner の net_used が 0 に戻る
    await req('PATCH', `/api/combats/${cb.id}`, { action: 'next_turn' });
    await req('PATCH', `/api/combats/${cb.id}`, { action: 'next_turn' });
    const afterTurn = (await req('GET', '/api/combats/current')).combat.participants.find((p: any) => p.id === runner.id);
    expect(afterTurn.state.net.net_used).toBe(0);

    // 敵ネットランナーがジャックインし、ヘルボルト（ATK 2）で攻撃 -> フラックが ATK を 0 にして停止
    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: enemy.id,
      net: { sub_action: 'jack_in', arch_id: archRes.architecture.id },
    });
    const flakHit = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: enemy.id,
      target_id: runner.id,
      attack_roll: { first: 6 },
      defense_roll: { first: 5 },
      damage_dice: [3, 3],
      net: { sub_action: 'program', program_key: 'Hellbolt' },
    });
    expect(flakHit.result.formula).toContain('フラックにより ATK 0');

    // ポイズン・フラットラインでプログラム破壊
    const progsBefore = getExtra('runner').deck.programs.length;
    await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: enemy.id,
      target_id: runner.id,
      attack_roll: { first: 9 },
      defense_roll: { first: 2 },
      net: { sub_action: 'program', program_key: 'Poison Flatline' },
    });
    expect(getExtra('runner').deck.programs.length).toBe(progsBefore - 1);

    // デッキKRASHで強制ジャックアウト
    resetTurn(enemy.id);
    const krash = await req('POST', `/api/combats/${cb.id}/apply`, {
      action_key: 'net_action',
      actor_id: enemy.id,
      target_id: runner.id,
      attack_roll: { first: 9 },
      defense_roll: { first: 2 },
      net: { sub_action: 'program', program_key: 'DeckKRASH' },
    });
    expect(krash.result.formula).toContain('強制ジャックアウト');
    expect(krash.combat.participants.find((p: any) => p.id === runner.id).state.net.jacked_in).toBe(false);
  });
});
