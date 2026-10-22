import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { characters, char_log, items } from '../db/schema.js';
import { requireGm } from '../auth.js';
import { sessionManager } from '../session.js';
import { generateUlid, VehicleRec, vehicleKindOf, VEHICLE_UPGRADES, roleRank, Reputation, REPUTATION_LEVELS } from '@cyberpgm/shared';
import { resolveD10 } from '@cyberpgm/rules';

/**
 * ヴィークルと知名度（Phase 5y。日本語版 p.136・161〜165・189〜193）。GM が戦闘の外で使う
 */
export const vehiclesRoutes = new Hono();

const load = (id: string) => db.select().from(characters).where(eq(characters.id, id)).get();
const bad = (c: any, msg: string) => c.json({ error: msg, missing_inputs: [msg] }, 400);
function save(id: string, extra: Record<string, unknown>, text: string) {
  db.update(characters).set({ extra: JSON.stringify(extra), updated_at: Date.now() }).where(eq(characters.id, id)).run();
  db.insert(char_log).values({ id: generateUlid(), character_id: id, text, at: Date.now() }).run();
  sessionManager.notifyCharacter(id, 'info', 'ヴィークル・知名度', text);
  sessionManager.updateCharacterSheet(id);
}
const TECH_SKILL = { land: 'land_vehicle_tech', air: 'air_vehicle_tech', sea: 'sea_vehicle_tech' } as const;
/** ヴィークルの修理（p.136）: 軽度 9・3 時間、重度 13・1 日、破壊 17・1 週間 */
const REPAIR = { light: { name: '軽度', dv: 9, time: '3 時間' }, heavy: { name: '重度', dv: 13, time: '1 日' }, destroyed: { name: '破壊', dv: 17, time: '1 週間' } } as const;

vehiclesRoutes.post('/vehicles/:id', requireGm, async (c) => {
  const row = load(c.req.param('id')!);
  if (!row) return bad(c, 'キャラが見つかりません');
  const b = await c.req.json();
  const extra = JSON.parse(row.extra || '{}');
  const list: VehicleRec[] = [...(extra.vehicles ?? [])];
  let text = '';
  switch (b.op) {
    case 'add': {
      const it = db.select().from(items).where(eq(items.id, b.item_id ?? '')).get();
      if (!it || it.kind !== 'vehicle') return bad(c, 'ヴィークルを選んでください');
      const sys = JSON.parse(it.raw_system || '{}');
      const v: VehicleRec = { id: generateUlid(), item_id: it.id, name: it.name_ja || it.name_en, kind: vehicleKindOf(it.name_en), sdp: sys.sdp ?? 50, sdp_max: sys.sdp ?? 50, sp: 0, move: sys.speedCombat ?? 20, seats: sys.seats ?? 2, upgrades: [], ...(b.family ? { family: true } : {}) };
      list.push(v);
      text = `${v.name} を持った${b.family ? '（家族のヴィークル）' : ''}（SDP ${v.sdp}、座席 ${v.seats}、【移動】${v.move}）`;
      break;
    }
    case 'remove': {
      const i = list.findIndex((v) => v.id === b.vehicle_id);
      if (i < 0) return bad(c, 'ヴィークルが見つかりません');
      text = `${list[i].name} を手放した`;
      list.splice(i, 1);
      break;
    }
    case 'upgrade': {
      const v = list.find((x) => x.id === b.vehicle_id);
      const up = VEHICLE_UPGRADES.find((u) => u.en === b.upgrade);
      if (!v || !up) return bad(c, 'ヴィークルとアップグレードを選んでください');
      if ((up.en === 'Onboard Rocket Pod' || up.en === 'Vehicle Heavy Weapon Mount') && !v.upgrades.includes('Heavy Chassis')) return bad(c, `${up.name} には先に「車体強化」が必要です`);
      // 家族のヴィークルは《モト》ランク以下のアップグレードだけ（p.161）
      if (v.family && roleRank(row.role, extra, 'Nomad') < up.rank) return bad(c, `${up.name} には《モト》ランク ${up.rank} 以上が必要です`);
      if (v.upgrades.includes(up.en) && !['Bulletproof Glass', 'NOS', 'Seating Upgrade', 'Smuggling Upgrade', 'Onboard Flamethrower', 'Onboard Machine Gun', 'Onboard Rocket Pod', 'Onboard Melee Weapon', 'Deployable Spike Strip'].includes(up.en)) return bad(c, `${up.name} は同じヴィークルに 1 回だけです`);
      v.upgrades = [...v.upgrades, up.en];
      if (up.en === 'Heavy Chassis') {
        v.sdp_max += 20;
        v.sdp += 20;
      }
      if (up.en === 'Armored Chassis') v.sp = 13;
      if (up.en === 'Seating Upgrade') v.seats += 2;
      text = `${v.name} に ${up.name}: ${up.effect}`;
      break;
    }
    case 'set': {
      const v = list.find((x) => x.id === b.vehicle_id);
      if (!v) return bad(c, 'ヴィークルが見つかりません');
      if (typeof b.sdp === 'number') v.sdp = Math.max(0, Math.min(v.sdp_max, b.sdp));
      if (typeof b.out_of_control === 'boolean') v.out_of_control = b.out_of_control;
      text = `${v.name} SDP ${v.sdp}/${v.sdp_max}${v.out_of_control ? '（制御不能）' : ''}`;
      break;
    }
    case 'repair': {
      // 修理: TECH + ヴィークル技術 + 1d10（p.136）。ノーマッドの家族のヴィークルが壊れたら家族が 1 週間で直す（500eb。p.162）
      const v = list.find((x) => x.id === b.vehicle_id);
      const sev = REPAIR[b.severity as keyof typeof REPAIR];
      const mech = load(b.mechanic_id ?? row.id);
      if (!v || !sev || !mech) return bad(c, 'ヴィークル・損傷の程度・修理する人を選んでください');
      if (b.family_repair) {
        v.sdp = v.sdp_max;
        text = `${v.name} を家族が直した（1 週間、500eb）`;
        break;
      }
      const roll = b.roll as { first: number; extra?: number } | undefined;
      if (!roll || ((roll.first === 10 || roll.first === 1) && roll.extra === undefined)) return bad(c, '修理の出目 (1d10) を入れてください');
      const r = resolveD10(roll.first, roll.extra).value;
      const mstats = JSON.parse(mech.stats);
      const mskills = JSON.parse(mech.skills);
      const mex = JSON.parse(mech.extra || '{}');
      const skillKey = TECH_SKILL[v.kind];
      const bonus = (roleRank(mech.role, mex, 'Tech') > 0 ? (mex.maker?.field ?? 0) : 0) + roleRank(mech.role, mex, 'Nomad');
      const total = mstats.tech + (mskills[skillKey] ?? 0) + bonus + r;
      const ok = total > sev.dv;
      if (ok) v.sdp = v.sdp_max;
      text = `${v.name} の修理（${sev.name}、${sev.time}）: TECH ${mstats.tech} + ヴィークル技術 ${mskills[skillKey] ?? 0}${bonus ? ` + ロール特技 ${bonus}` : ''} + 出目 ${r} = ${total} vs 難易度 ${sev.dv} -> ${ok ? `成功。SDP ${v.sdp_max}` : '失敗'}`;
      break;
    }
    case 'reputation': {
      // 知名度（p.193）: レベルと行為。悪名は威圧でマイナス
      const rep: Reputation = { level: Math.max(0, Math.min(10, Number(b.level) || 0)), deed: String(b.deed ?? ''), bad: Boolean(b.bad) };
      save(row.id, { ...extra, reputation: rep }, `知名度 ${rep.level}${rep.deed ? `（${rep.deed}）` : ''}${rep.bad ? '・悪名' : ''}: ${REPUTATION_LEVELS[rep.level] ?? ''}`);
      return c.json({ ok: true });
    }
    case 'reputation_known': {
      // 初めて会った相手に 1d10。知名度レベルより低ければ評判を聞いたことがある
      const rep = extra.reputation as Reputation | undefined;
      const die = Number(b.die);
      if (!(die >= 1 && die <= 10)) return bad(c, '1d10 の出目を入れてください');
      const lv = rep?.level ?? 0;
      return c.json({ formula: `知名度 ${lv}: 1d10 = ${die} -> ${die < lv ? `相手は評判（${rep?.deed || '—'}${rep?.bad ? '、悪名' : ''}）を聞いたことがある` : '相手は知らない'}` });
    }
    case 'facedown': {
      // 威圧: 【魅力】＋知名度（悪名はマイナス）＋1d10 で比べる。同値は何も起きない。負けた側は引き下がるか、その相手に 1 度勝つまで −2（p.193）
      const roll = b.roll as { first: number; extra?: number } | undefined;
      if (!roll) return bad(c, '威圧の出目 (1d10) を入れてください');
      const r = resolveD10(roll.first, roll.extra).value;
      const rep = extra.reputation as Reputation | undefined;
      const repv = (rep?.level ?? 0) * (rep?.bad ? -1 : 1);
      const cool = JSON.parse(row.stats).cool;
      const mine = cool + repv + r;
      const theirs = Number(b.their_total);
      if (!Number.isFinite(theirs)) return bad(c, '相手の合計（COOL + 知名度 + 1d10）を入れてください');
      return c.json({ formula: `威圧: COOL ${cool} + 知名度 ${repv} + 出目 ${r} = ${mine} vs 相手 ${theirs} -> ${mine === theirs ? '同値: どちらも引かない' : mine > theirs ? '勝ち。相手は引き下がるか、こちらに 1 度勝つまで −2' : '負け。引き下がるか、相手に 1 度勝つまで相手へのアクションに −2'}` });
    }
    default:
      return bad(c, '操作が分かりません');
  }
  save(row.id, { ...extra, vehicles: list }, text);
  return c.json({ formula: text });
});
