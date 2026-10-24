import { describe, expect, it, beforeEach } from 'vitest';
import { db, sqlite } from '../src/db/client.js';
import { app } from '../src/index.js';
import {
  combats,
  combat_participants,
  combat_log,
  characters,
  scenarios,
  scenario_sessions,
  session_log,
  encounters,
} from '../src/db/schema.js';
import {
  SITUATION_MODIFIERS,
  generateUlid,
  type CombatParticipant,
} from '@cyberpgm/shared';
import {
  situationModifiers,
  attackModifierTotal,
  formatAttackModifier,
  rangedAttackModifiers,
} from '../src/services/attack-modifiers.js';
import { attackLine } from '../src/services/attack-line.js';
import { generateCombatSummary } from '../src/services/combat-summary.js';
import { registerDevice } from '../src/auth.js';
import { eq } from 'drizzle-orm';

describe('Phase 6h: 状況修正・状態異常の付け外し・戦闘ログをセッションログへ', () => {
  let GM_TOKEN: string;

  beforeEach(async () => {
    // Clear relevant tables
    sqlite.prepare('DELETE FROM session_log').run();
    sqlite.prepare('DELETE FROM encounters').run();
    sqlite.prepare('DELETE FROM scenario_sessions').run();
    sqlite.prepare('DELETE FROM scenarios').run();
    sqlite.prepare('DELETE FROM combat_log').run();
    sqlite.prepare('DELETE FROM combat_participants').run();
    sqlite.prepare('DELETE FROM combats').run();
    sqlite.prepare('DELETE FROM characters').run();
    sqlite.prepare('DELETE FROM devices').run();

    const gmReg = registerDevice({ role: 'gm', label: 'gm-test-device' });
    GM_TOKEN = gmReg.token;
  });

  describe('A. 状況修正（Issue #31）', () => {
    it('SITUATION_MODIFIERS contains p.130 modifiers', () => {
      expect(SITUATION_MODIFIERS.length).toBe(10);
      const obscured = SITUATION_MODIFIERS.find((s) => s.key === 'obscured');
      expect(obscured).toBeDefined();
      expect(obscured?.value).toBe(-4);
      expect(obscured?.label).toBe('煙や暗闇で視界が悪い');

      const dim = SITUATION_MODIFIERS.find((s) => s.key === 'dim');
      expect(dim?.value).toBe(-1);
    });

    it('calculates situation modifiers total with multiple keys and custom modifier', () => {
      // 煙や暗闇 (-4) + 複雑な行為 (-2) + その他 (+1) = -5
      const mods = situationModifiers(['obscured', 'complex'], 1);
      expect(mods).toHaveLength(3);
      expect(mods[0]).toEqual({ key: 'situation_obscured', label: '煙や暗闇で視界が悪い', value: -4 });
      expect(mods[1]).toEqual({ key: 'situation_complex', label: '複雑な行為', value: -2 });
      expect(mods[2]).toEqual({ key: 'situation_custom', label: 'その他', value: 1 });
      expect(attackModifierTotal(mods)).toBe(-5);

      // formatAttackModifier produces expected labels
      expect(formatAttackModifier(mods[0])).toBe('煙や暗闇で視界が悪い −4');
      expect(formatAttackModifier(mods[2])).toBe('その他 +1');
    });

    it('applies situation modifiers in rangedAttackModifiers and attackLine', () => {
      const actor: CombatParticipant = {
        id: 'actor-1',
        combat_id: 'c-1',
        character_id: 'char-1',
        side: 'ally',
        name: 'ソロ',
        initiative: 10,
        initiative_roll: {},
        order_index: 0,
        active: true,
        out: false,
        move_used: false,
        action_used: false,
        state: {},
        character: {
          id: 'char-1',
          name: 'ソロ',
          kind: 'pc',
          role: 'Solo',
          stats: { int: 6, ref: 8, dex: 6, tech: 6, cool: 6, will: 6, luck: 5, move: 4, body: 6, emp: 6 },
          skills: { handgun: 6, first_aid: 4 },
          hp: 40,
          hp_max: 40,
          sp_head: 0,
          sp_body: 0,
          weapons: [],
          inventory: [],
          status: [],
          crit_injuries: [],
        },
      };

      const mods = rangedAttackModifiers(
        db,
        actor,
        { weapon_type: 'pistol' },
        undefined,
        'ranged',
        10,
        {
          wound: 0,
          grapple: 0,
          ignoreSeriousWound: false,
          precision: 0,
          situations: ['obscured', 'dim'],
          situation_custom: -1,
        },
      );

      // -4 (obscured) + -1 (dim) + -1 (custom) = -6
      expect(attackModifierTotal(mods)).toBe(-6);
      expect(mods.some((m) => m.label === '煙や暗闇で視界が悪い' && m.value === -4)).toBe(true);

      // 応急手当の attackLine にも状況修正が効くこと
      const faLine = attackLine(
        {
          action_key: 'first_aid',
          situations: ['obscured'],
          situation_custom: -2,
        },
        actor,
      );
      expect(faLine).not.toBeNull();
      // TECH 6 + 応急手当 4 + 煙や暗闇で視界が悪い −4 + その他 −2 = 4
      expect(faLine?.text).toContain('煙や暗闇で視界が悪い −4');
      expect(faLine?.text).toContain('その他 −2');
      expect(faLine?.text).toContain('= 4');
    });

    it('persists negative default_situation_custom in combat settings and applies it', async () => {
      const combatId = generateUlid();
      db.insert(combats)
        .values({
          id: combatId,
          status: 'active',
          round: 1,
          turn_index: 0,
          settings: '{}',
          created_at: Date.now(),
        })
        .run();

      const patchRes = await app.request(`/api/combats/${combatId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GM_TOKEN}`,
        },
        body: JSON.stringify({
          settings: {
            default_situations: ['obscured'],
            default_situation_custom: -3,
          },
        }),
      });
      expect(patchRes.status).toBe(200);
      const patchJson = await patchRes.json();
      expect(patchJson.combat.settings.default_situation_custom).toBe(-3);
      expect(patchJson.combat.settings.default_situations).toEqual(['obscured']);

      // DB persistence
      const cb = db.select().from(combats).where(eq(combats.id, combatId)).get();
      const settings = JSON.parse(cb!.settings || '{}');
      expect(settings.default_situation_custom).toBe(-3);
      expect(settings.default_situations).toEqual(['obscured']);
    });

    it('applies situation modifiers to vehicle_control and vehicle_maneuver in resolve and attackLine', async () => {
      const charId = generateUlid();
      const vehId = 'test-veh-1';
      db.insert(characters)
        .values({
          id: charId,
          kind: 'pc',
          name: 'ドライバー',
          role: 'Solo',
          stats: JSON.stringify({ int: 6, ref: 6, dex: 6, tech: 6, cool: 6, will: 6, luck: 0, move: 4, body: 6, emp: 6 }),
          skills: JSON.stringify({ drive_land_vehicle: 2 }), // driveBase = 6 + 2 = 8 (< 10)
          hp: 40,
          hp_max: 40,
          sp_head: 0,
          sp_body: 0,
          humanity: 50,
          emp_max: 6,
          status: '[]',
          extra: JSON.stringify({
            vehicles: [
              { id: vehId, kind: 'land', name: '小型地上車', sdp: 50, sdp_max: 50, sp: 0, seats: 4, move: 20, upgrades: [] },
            ],
          }),
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .run();

      const combatId = generateUlid();
      db.insert(combats)
        .values({
          id: combatId,
          status: 'active',
          round: 1,
          turn_index: 0,
          settings: '{}',
          created_at: Date.now(),
        })
        .run();

      const partId = generateUlid();
      db.insert(combat_participants)
        .values({
          id: partId,
          combat_id: combatId,
          character_id: charId,
          side: 'ally',
          name: 'ドライバー',
          initiative: 10,
          initiative_roll: '{}',
          order_index: 0,
          active: true,
          out: false,
          move_used: false,
          action_used: false,
          state: JSON.stringify({
            in_vehicle: { owner_id: charId, vehicle_id: vehId, driver: true, started: true },
          }),
        })
        .run();

      // 1. attackLine の検証: 操縦 (vehicle_control) と 特殊機動 (vehicle_maneuver)
      const part = {
        id: partId,
        combat_id: combatId,
        character_id: charId,
        side: 'ally' as const,
        name: 'ドライバー',
        initiative: 10,
        initiative_roll: {},
        order_index: 0,
        active: true,
        out: false,
        move_used: false,
        action_used: false,
        state: { in_vehicle: { owner_id: charId, vehicle_id: vehId, driver: true, started: true } },
        character: {
          id: charId,
          name: 'ドライバー',
          kind: 'pc' as const,
          role: 'Solo',
          stats: { int: 6, ref: 6, dex: 6, tech: 6, cool: 6, will: 6, luck: 0, move: 4, body: 6, emp: 6 },
          skills: { drive_land_vehicle: 2 },
          hp: 40,
          hp_max: 40,
          sp_head: 0,
          sp_body: 0,
          weapons: [],
          inventory: [],
          status: [],
          crit_injuries: [],
          extra: {
            vehicles: [
              { id: vehId, kind: 'land', name: '小型地上車', sdp: 50, sdp_max: 50, sp: 0, seats: 4, move: 20, upgrades: [] },
            ],
          },
        },
      };

      // 操縦（判定が必要な場合）に煙（-4）+ その他（-1）が効く
      const ctrlLine = attackLine(
        {
          action_key: 'vehicle_control',
          situations: ['obscured'],
          situation_custom: -1,
        },
        part,
      );
      expect(ctrlLine).not.toBeNull();
      // REF 6 + 地上ヴィークル操縦 2 煙や暗闇で視界が悪い −4 その他 −1 = 3 vs 難易度 10 → 出目 7 以上で成功
      expect(ctrlLine?.text).toContain('煙や暗闇で視界が悪い −4');
      expect(ctrlLine?.text).toContain('その他 −1');
      expect(ctrlLine?.text).toContain('= 3 vs 難易度 10');
      expect(ctrlLine?.text).toContain('出目 8 以上で成功');

      // 特殊機動（急旋回: DV 13）に煙（-4）が効く
      const manLine = attackLine(
        {
          action_key: 'vehicle_maneuver',
          maneuver: 'swerve',
          situations: ['obscured'],
        },
        part,
      );
      expect(manLine).not.toBeNull();
      // REF 6 + 陸上ヴィークル運転 2 煙や暗闇で視界が悪い −4 = 4 vs 難易度 13 → 出目 10 以上で成功
      expect(manLine?.text).toContain('特殊機動「急ハンドル」');
      expect(manLine?.text).toContain('煙や暗闇で視界が悪い −4');
      expect(manLine?.text).toContain('= 4 vs 難易度 13');
      expect(manLine?.text).toContain('出目 10 以上で成功');

      // 2. 実判定 (POST /api/combats/:id/resolve) の検証: 不利な状況がDV判定に反映されること
      // 状況修正なしだと REF 6 + 操縦 2 + 出目 5 = 13 > 10 で成功するが、
      // 煙（-4）があると REF 6 + 操縦 2 − 4 + 出目 5 = 9 <= 10 で失敗（制御不能）になる
      const resolveRes = await app.request(`/api/combats/${combatId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GM_TOKEN}`,
        },
        body: JSON.stringify({
          action_key: 'vehicle_control',
          actor_id: partId,
          attack_roll: { first: 5 },
          situations: ['obscured'],
        }),
      });
      expect(resolveRes.status).toBe(200);
      const resJson = await resolveRes.json();
      expect(resJson.result.success).toBe(false);
      expect(resJson.result.formula).toContain('煙や暗闇で視界が悪い −4');
      expect(resJson.result.formula).toContain('= 9 vs 難易度 10 -> 失敗: 制御不能');

      // 特殊機動（急ハンドル DV 13）でも状況修正がDV判定に反映されること
      const manResolveRes = await app.request(`/api/combats/${combatId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GM_TOKEN}`,
        },
        body: JSON.stringify({
          action_key: 'vehicle_maneuver',
          maneuver: 'swerve',
          actor_id: partId,
          attack_roll: { first: 8 },
          situations: ['obscured'],
        }),
      });
      expect(manResolveRes.status).toBe(200);
      const manResJson = await manResolveRes.json();
      // 8 - 4 + 8 = 12 <= 13 (失敗)
      expect(manResJson.result.success).toBe(false);
      expect(manResJson.result.formula).toContain('煙や暗闇で視界が悪い −4');
      expect(manResJson.result.formula).toContain('= 12 vs 難易度 13 -> 失敗');

      // 3. 基本操縦が自動成功（driveBase >= 10）する場合の挙動が変わらないこと
      const autoSuccessLine = attackLine(
        {
          action_key: 'vehicle_control',
          situations: ['obscured'], // 不利な状況があっても
        },
        {
          ...part,
          character: {
            ...part.character,
            stats: { ...part.character.stats, ref: 8 },
            skills: { drive_land_vehicle: 2 }, // 8 + 2 = 10 (>= 10)
          },
        },
      );
      expect(autoSuccessLine?.text).toContain('基本的な操縦は判定もアクションも要らない');

      // 実判定でも自動成功
      sqlite.prepare("UPDATE characters SET stats = json_set(stats, '$.ref', 8) WHERE id = ?").run(charId);
      const autoResolveRes = await app.request(`/api/combats/${combatId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GM_TOKEN}`,
        },
        body: JSON.stringify({
          action_key: 'vehicle_control',
          actor_id: partId,
          situations: ['obscured'],
        }),
      });
      expect(autoResolveRes.status).toBe(200);
      const autoResolveJson = await autoResolveRes.json();
      expect(autoResolveJson.result.success).toBe(true);
      expect(autoResolveJson.result.formula).toContain('基本的な操縦は判定もアクションも要らない');
    });
  });

  describe('B. 状態異常の付け外し（Issue #34）', () => {
    it('manually adds and removes status with remaining rounds and supports undo', async () => {
      const charId = generateUlid();
      db.insert(characters)
        .values({
          id: charId,
          kind: 'pc',
          name: 'ジャック',
          role: 'Solo',
          stats: JSON.stringify({ int: 6, ref: 8, dex: 6, tech: 6, cool: 6, will: 6, luck: 5, move: 4, body: 6, emp: 6 }),
          skills: '{}',
          hp: 40,
          hp_max: 40,
          sp_head: 0,
          sp_body: 0,
          humanity: 50,
          emp_max: 6,
          status: '[]',
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .run();

      const combatId = generateUlid();
      db.insert(combats)
        .values({
          id: combatId,
          status: 'active',
          round: 1,
          turn_index: 0,
          settings: '{}',
          created_at: Date.now(),
        })
        .run();

      const partId = generateUlid();
      db.insert(combat_participants)
        .values({
          id: partId,
          combat_id: combatId,
          character_id: charId,
          side: 'ally',
          name: 'ジャック',
          initiative: 10,
          initiative_roll: '{}',
          order_index: 0,
          active: true,
          out: false,
          move_used: false,
          action_used: false,
          state: '{}',
        })
        .run();

      // 1. 手動で「気絶」を付与（3 ラウンド）
      const addRes = await app.request(`/api/combats/${combatId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GM_TOKEN}`,
        },
        body: JSON.stringify({
          participant_id: partId,
          action: 'add',
          status: '気絶',
          rounds: 3,
        }),
      });

      expect(addRes.status).toBe(200);
      const addJson = await addRes.json();
      expect(addJson.success).toBe(true);
      const updatedPart = addJson.combat.participants.find((p: any) => p.id === partId);
      expect(updatedPart.character.status).toContain('気絶');
      expect(updatedPart.state.statusRounds?.['気絶']).toBe(3);

      // HP自動状態の手動操作は禁止されていること
      const hpAutoRes = await app.request(`/api/combats/${combatId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GM_TOKEN}`,
        },
        body: JSON.stringify({
          participant_id: partId,
          action: 'remove',
          status: 'seriously',
        }),
      });
      expect(hpAutoRes.status).toBe(400);

      // 2. 「一手戻る」（undo）で気絶付与を取り消せること
      const undoRes = await app.request(`/api/combats/${combatId}/undo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${GM_TOKEN}` },
      });
      expect(undoRes.status).toBe(200);

      const revertedChar = db.select().from(characters).where(eq(characters.id, charId)).get();
      expect(JSON.parse(revertedChar!.status || '[]')).not.toContain('気絶');

      // 3. 手動で「伏せ」を付与（ラウンド指定なし＝永続）し、手動で解除する
      await app.request(`/api/combats/${combatId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GM_TOKEN}`,
        },
        body: JSON.stringify({
          participant_id: partId,
          action: 'add',
          status: '伏せ',
        }),
      });

      const charWithProne = db.select().from(characters).where(eq(characters.id, charId)).get();
      expect(JSON.parse(charWithProne!.status || '[]')).toContain('伏せ');

      const removeRes = await app.request(`/api/combats/${combatId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GM_TOKEN}`,
        },
        body: JSON.stringify({
          participant_id: partId,
          action: 'remove',
          status: '伏せ',
        }),
      });
      expect(removeRes.status).toBe(200);

      const charAfterRemove = db.select().from(characters).where(eq(characters.id, charId)).get();
      expect(JSON.parse(charAfterRemove!.status || '[]')).not.toContain('伏せ');
    });

    it('releases both sides when removing grapple status', async () => {
      const c1Id = generateUlid();
      const c2Id = generateUlid();
      for (const [id, name] of [[c1Id, 'ジャック'], [c2Id, '敵ガンナー']] as const) {
        db.insert(characters)
          .values({
            id,
            kind: 'pc',
            name,
            role: 'Solo',
            stats: '{}',
            skills: '{}',
            hp: 40,
            hp_max: 40,
            sp_head: 0,
            sp_body: 0,
            humanity: 50,
            emp_max: 6,
            status: JSON.stringify(['つかみ']),
            created_at: Date.now(),
            updated_at: Date.now(),
          })
          .run();
      }

      const combatId = generateUlid();
      db.insert(combats)
        .values({
          id: combatId,
          status: 'active',
          round: 1,
          turn_index: 0,
          settings: '{}',
          created_at: Date.now(),
        })
        .run();

      const p1Id = generateUlid();
      const p2Id = generateUlid();
      db.insert(combat_participants)
        .values({
          id: p1Id,
          combat_id: combatId,
          character_id: c1Id,
          side: 'ally',
          name: 'ジャック',
          initiative: 10,
          initiative_roll: '{}',
          order_index: 0,
          active: true,
          out: false,
          move_used: false,
          action_used: false,
          state: JSON.stringify({ grappling: p2Id, choke_count: 0 }),
        })
        .run();

      db.insert(combat_participants)
        .values({
          id: p2Id,
          combat_id: combatId,
          character_id: c2Id,
          side: 'enemy',
          name: '敵ガンナー',
          initiative: 8,
          initiative_roll: '{}',
          order_index: 1,
          active: true,
          out: false,
          move_used: false,
          action_used: false,
          state: JSON.stringify({ grappled_by: p1Id }),
        })
        .run();

      // ジャック側のつかみを解除 -> 敵ガンナー側のつかみも同時に解除されること
      const res = await app.request(`/api/combats/${combatId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GM_TOKEN}`,
        },
        body: JSON.stringify({
          participant_id: p1Id,
          action: 'remove',
          status: 'つかみ',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      const p1 = json.combat.participants.find((p: any) => p.id === p1Id);
      const p2 = json.combat.participants.find((p: any) => p.id === p2Id);
      expect(p1.character.status).not.toContain('つかみ');
      expect(p2.character.status).not.toContain('つかみ');
      expect(p1.state.grappling).toBeFalsy();
      expect(p2.state.grappled_by).toBeFalsy();
    });

    it('validates status names on add, rejecting unknown or remove-only statuses, while allowing valid manual statuses', async () => {
      const charId = generateUlid();
      db.insert(characters)
        .values({
          id: charId,
          kind: 'pc',
          name: '被験者',
          role: 'Solo',
          stats: '{}',
          skills: '{}',
          hp: 40,
          hp_max: 40,
          sp_head: 0,
          sp_body: 0,
          humanity: 50,
          emp_max: 6,
          status: '[]',
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .run();

      const combatId = generateUlid();
      db.insert(combats)
        .values({
          id: combatId,
          status: 'active',
          round: 1,
          turn_index: 0,
          settings: '{}',
          created_at: Date.now(),
        })
        .run();

      const partId = generateUlid();
      db.insert(combat_participants)
        .values({
          id: partId,
          combat_id: combatId,
          character_id: charId,
          side: 'ally',
          name: '被験者',
          initiative: 10,
          initiative_roll: '{}',
          order_index: 0,
          active: true,
          out: false,
          move_used: false,
          action_used: false,
          state: '{}',
        })
        .run();

      // 1. 未定義の状態名は 400 で拒否されること
      const unknownRes = await app.request(`/api/combats/${combatId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GM_TOKEN}`,
        },
        body: JSON.stringify({
          participant_id: partId,
          action: 'add',
          status: 'invalid_status_name',
        }),
      });
      expect(unknownRes.status).toBe(400);
      const unknownJson = await unknownRes.json();
      expect(unknownJson.error).toContain('未対応または手動付与できない状態名');

      // 2. 解除専用の状態名（つかみ・鋼のつかみ）を手動付与しようとすると 400 で拒否されること
      const grappleAddRes = await app.request(`/api/combats/${combatId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GM_TOKEN}`,
        },
        body: JSON.stringify({
          participant_id: partId,
          action: 'add',
          status: 'つかみ',
        }),
      });
      expect(grappleAddRes.status).toBe(400);

      // 3. 許可リストにある状態名（気絶・着火（小））は 200 で付与できること
      const validAddRes = await app.request(`/api/combats/${combatId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GM_TOKEN}`,
        },
        body: JSON.stringify({
          participant_id: partId,
          action: 'add',
          status: '着火（小）',
          rounds: 2,
        }),
      });
      expect(validAddRes.status).toBe(200);
      const validJson = await validAddRes.json();
      const p = validJson.combat.participants.find((x: any) => x.id === partId);
      expect(p.character.status).toContain('着火（小）');
      expect(p.state.statusRounds?.['着火（小）']).toBe(2);
    });
  });

  describe('C. 戦闘ログをセッションログへ（Issue #35）', () => {
    it('generates combat summary text correctly', () => {
      const summary = generateCombatSummary(
        { id: 'c-1', round: 2, created_at: Date.now() - 60000, ended_at: Date.now() },
        [
          {
            id: 'l-1',
            combat_id: 'c-1',
            round: 1,
            actor_id: 'p-jack',
            actor_name: 'ジャック',
            action_key: 'ranged',
            input: { target_id: 'p-enemy', weapon_id: '中型ハンドガン', ammo_spent: 1 },
            breakdown: { formula: 'REF 8 + ハンドガン 6 + 出目 5 = 19 vs 難易度 15 -> 命中' },
            changes: [
              { target_id: 'c-enemy', target_name: '敵ガンナー', field: 'hp', before: 30, after: 21, desc: 'HP 30 → 21' },
              { target_id: 'c-enemy', target_name: '敵ガンナー', field: 'sp_body', before: 7, after: 6, desc: 'SP 7 → 6' },
            ],
            undone: false,
            at: Date.now() - 50000,
          },
          {
            id: 'l-2',
            combat_id: 'c-1',
            round: 2,
            actor_id: 'p-jack',
            actor_name: 'ジャック',
            action_key: 'ranged',
            input: { target_id: 'p-enemy', weapon_id: '中型ハンドガン', ammo_spent: 1 },
            breakdown: { formula: 'REF 8 + ハンドガン 6 + 出目 8 = 22 vs 難易度 15 -> 命中' },
            changes: [
              { target_id: 'c-enemy', target_name: '敵ガンナー', field: 'hp', before: 21, after: 0, desc: 'HP 21 → 0' },
              { target_id: 'c-enemy', target_name: '敵ガンナー', field: 'status', before: [], after: ['dead'], desc: '死亡' },
            ],
            undone: false,
            at: Date.now() - 20000,
          },
        ],
        [
          { id: 'p-jack', character_id: 'c-jack', name: 'ジャック' } as any,
          { id: 'p-enemy', character_id: 'c-enemy', name: '敵ガンナー' } as any,
        ],
        '裏路地の遭遇',
      );

      expect(summary).toContain('【戦闘ログ要約】戦闘（裏路地の遭遇）（全 2 ラウンド');
      expect(summary).toContain('R1 ジャック → 敵ガンナー 中型ハンドガン 命中 ダメージ 9');
      expect(summary).toContain('REF 8 + ハンドガン 6 + 出目 5 = 19 vs 難易度 15 -> 命中');
      expect(summary).toContain('R2 ジャック → 敵ガンナー 中型ハンドガン 命中 ダメージ 21');
      expect(summary).toContain('【戦闘結果】');
      expect(summary).toContain('倒れた参加者: 敵ガンナー');
      expect(summary).toContain('消費弾薬: ジャック 2発');
    });

    it('saves combat summary into session_log when ending scenario combat and prevents duplicate', async () => {
      // 1. シナリオ・セッション・エンカウンターを作成
      const scenarioId = generateUlid();
      db.insert(scenarios)
        .values({
          id: scenarioId,
          title: 'テストシナリオ',
          status: 'ready',
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .run();

      const sessionId = generateUlid();
      db.insert(scenario_sessions)
        .values({
          id: sessionId,
          scenario_id: scenarioId,
          status: 'active',
          started_at: Date.now(),
        })
        .run();

      const combatId = generateUlid();
      const encounterId = generateUlid();

      // セッションログに戦闘投入ログを記録（scenario-play の戦闘開始時と同じ形式）
      db.insert(session_log)
        .values({
          id: generateUlid(),
          scenario_session_id: sessionId,
          at: Date.now(),
          kind: 'combat',
          text: '戦闘投入: 暴徒との銃撃戦',
          ref: JSON.stringify({ combat_id: combatId, encounter_id: encounterId }),
        })
        .run();

      // 戦闘作成
      db.insert(combats)
        .values({
          id: combatId,
          status: 'active',
          round: 2,
          turn_index: 0,
          settings: '{}',
          created_at: Date.now() - 30000,
        })
        .run();

      // combat_log を記録
      db.insert(combat_log)
        .values({
          id: generateUlid(),
          combat_id: combatId,
          round: 1,
          actor_id: 'p-1',
          action_key: 'ranged',
          input: JSON.stringify({ target_id: 'p-2', weapon_id: 'ライフル' }),
          breakdown: JSON.stringify({ formula: 'REF 8 + 6 + 5 = 19 -> 命中' }),
          changes: JSON.stringify([{ target_id: 'c-2', target_name: 'ボブ', field: 'hp', before: 20, after: 10, desc: 'HP 20 → 10' }]),
          undone: 0,
          at: Date.now() - 10000,
        })
        .run();

      // 2. 「戦闘を終える」（PATCH /api/combats/:id action: 'end'）
      const endRes = await app.request(`/api/combats/${combatId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GM_TOKEN}`,
        },
        body: JSON.stringify({ action: 'end' }),
      });
      expect(endRes.status).toBe(200);

      // session_log に要約が保存されていること
      const summaryLogs = db
        .select()
        .from(session_log)
        .where(
          eq(session_log.scenario_session_id, sessionId),
        )
        .all();

      const summaryEntry = summaryLogs.find((l) => l.ref?.includes('"summary":true'));
      expect(summaryEntry).toBeDefined();
      expect(summaryEntry?.kind).toBe('combat');
      expect(summaryEntry?.text).toContain('【戦闘ログ要約】');
      expect(summaryEntry?.text).toContain('REF 8 + 6 + 5 = 19 -> 命中');

      // 3. 再度 end を呼んでも二重保存されないこと
      await app.request(`/api/combats/${combatId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GM_TOKEN}`,
        },
        body: JSON.stringify({ action: 'end' }),
      });

      const afterDoubleEnd = db
        .select()
        .from(session_log)
        .where(
          eq(session_log.scenario_session_id, sessionId),
        )
        .all();
      const summariesAfter = afterDoubleEnd.filter((l) => l.ref?.includes('"summary":true'));
      expect(summariesAfter).toHaveLength(1);
    });
  });
});
