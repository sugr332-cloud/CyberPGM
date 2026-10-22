import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { characters, char_log, items } from '../db/schema.js';
import { requireGm } from '../auth.js';
import { sessionManager } from '../session.js';
import {
  generateUlid,
  roleRank,
  RoleExtra,
  soloAllocError,
  SoloAbility,
  medicineSkills,
  CRAFT_TABLE,
  MAKER_SPECIALTIES,
  MakerSpecialty,
  RUMORS,
  credibilityChance,
  IMPACT_DV,
  execTeamSize,
  DRUGS,
  skillNameToKey,
  formatSkillName,
  roleKeyOf,
} from '@cyberpgm/shared';
import { resolveD10, hpMaxFromStats } from '@cyberpgm/rules';
import { loadRoleData } from './character-creation.js';

/**
 * ロール特技の道具（Phase 5x。日本語版 p.142〜165）。GM が戦闘の外で使う
 */
export const rolesRoutes = new Hono();

const load = (id: string) => db.select().from(characters).where(eq(characters.id, id)).get();
const bad = (c: any, msg: string) => c.json({ error: msg, missing_inputs: [msg] }, 400);
const d10 = (roll: { first: number; extra?: number } | undefined): number | null =>
  roll && Number.isInteger(roll.first) ? (roll.first === 10 || roll.first === 1) && roll.extra === undefined ? null : resolveD10(roll.first, roll.extra).value : null;

function log(id: string, text: string) {
  db.insert(char_log).values({ id: generateUlid(), character_id: id, text, at: Date.now() }).run();
  sessionManager.notifyCharacter(id, 'info', 'ロール特技', text);
  sessionManager.updateCharacterSheet(id);
}

// ランク・割り振りを変える（ロールのランク、ソロ、テク、メドテク）
rolesRoutes.put('/roles/:id', requireGm, async (c) => {
  const row = load(c.req.param('id')!);
  if (!row) return bad(c, 'キャラが見つかりません');
  const b = await c.req.json();
  const extra = JSON.parse(row.extra || '{}') as RoleExtra & Record<string, unknown>;
  const next: RoleExtra & Record<string, unknown> = { ...extra };
  if (b.role_ranks) next.role_ranks = Object.fromEntries(Object.entries(b.role_ranks as Record<string, number>).map(([k, v]) => [roleKeyOf(k), Math.max(0, Math.min(10, Number(v) || 0))]));
  const rankOf = (r: string) => roleRank(row.role, next, r);
  if (b.solo_alloc) {
    const err = soloAllocError(rankOf('Solo'), b.solo_alloc as Partial<Record<SoloAbility, number>>);
    if (err) return bad(c, err);
    next.solo_alloc = b.solo_alloc;
  }
  if (b.maker) {
    // 《メイカー》はランクが 1 上がるたびに専門分野 2 つを 1 ずつ（合計はランク × 2）
    const total = Object.values(b.maker as Record<string, number>).reduce((s, n) => s + (Number(n) || 0), 0);
    if (total > rankOf('Tech') * 2) return bad(c, `専門分野の合計 ${total} が《メイカー》のランク ${rankOf('Tech')} × 2 を超えています`);
    next.maker = b.maker;
  }
  let skills = JSON.parse(row.skills);
  if (b.medicine) {
    // 《メディシン》はランク 1 ごとに 1 ポイント。薬品とクリオは最大 5（p.149〜150）
    const m = b.medicine as NonNullable<RoleExtra['medicine']>;
    const total = (m.surgery ?? 0) + (m.pharma ?? 0) + (m.cryo ?? 0);
    if (total > rankOf('Medtech')) return bad(c, `割り当ての合計 ${total} が《メディシン》のランク ${rankOf('Medtech')} を超えています`);
    if ((m.pharma ?? 0) > 5 || (m.cryo ?? 0) > 5) return bad(c, '医療技術（薬品）と（クリオシステム操作）はそれぞれ最大 5 です');
    if ((m.pharma_known ?? []).length > (m.pharma ?? 0)) return bad(c, `使える薬品は医療技術（薬品）のポイント（${m.pharma ?? 0}）までです`);
    next.medicine = m;
    const ms = medicineSkills(m);
    skills = { ...skills, surgery: ms.surgery, medical_tech: ms.medical_tech };
  }
  db.update(characters).set({ extra: JSON.stringify(next), skills: JSON.stringify(skills), updated_at: Date.now() }).where(eq(characters.id, row.id)).run();
  log(row.id, 'ロール特技の設定を変えた');
  return c.json({ ok: true });
});

// ロール特技の判定・道具
rolesRoutes.post('/roles/:id/check', requireGm, async (c) => {
  const row = load(c.req.param('id')!);
  if (!row) return bad(c, 'キャラが見つかりません');
  const b = await c.req.json();
  const extra = JSON.parse(row.extra || '{}') as RoleExtra & Record<string, any>;
  const stats = JSON.parse(row.stats);
  const skills = JSON.parse(row.skills);
  const rank = (r: string) => roleRank(row.role, extra, r);
  const r = d10(b.roll);
  const needRoll = () => bad(c, '出目 (1d10) を入れてください（10 と 1 は追加の出目も）');
  let text = '';

  switch (b.kind) {
    case 'rockerboy': {
      // 《カリズマティック・インパクト》ランク + 1d10 vs 1 人 8・6 人以下 10・多人数 12（p.144）
      if (rank('Rockerboy') < 1) return bad(c, '《カリズマティック・インパクト》がありません');
      if (r === null) return needRoll();
      const dv = IMPACT_DV[(b.size as keyof typeof IMPACT_DV) ?? 'one'] ?? 8;
      const total = rank('Rockerboy') + r;
      text = `カリズマティック・インパクト: ランク ${rank('Rockerboy')} + 出目 ${r} = ${total} vs 難易度 ${dv} -> ${total > dv ? '成功（頼みを全力で果たそうとする。ランクで頼める範囲はロールの説明を参照）' : '失敗（1 週間は同じことを頼めない）'}`;
      break;
    }
    case 'media_passive': {
      // 受動的な噂: ランク + 1d10 が上回った中で最も高い噂（p.151）
      if (rank('Media') < 1) return bad(c, '《クレディビリティ》がありません');
      if (r === null) return needRoll();
      const total = rank('Media') + r;
      const got = [...RUMORS].reverse().find((x) => total > x.passive);
      text = `受動的な噂: ランク ${rank('Media')} + 出目 ${r} = ${total} -> ${got ? `${got.name}が入る` : '噂は入らない'}`;
      break;
    }
    case 'media_believe': {
      // 報道を信じてもらえるか: 1d10 が確率以下なら信じる。裏付けのある証拠 1 つ以上 +1、5 つ以上 さらに +1。【運命】は使えない（p.151〜152）
      if (rank('Media') < 1) return bad(c, '《クレディビリティ》がありません');
      const die = b.roll?.first;
      if (!die) return needRoll();
      const ev = Number(b.evidence) || 0;
      const chance = credibilityChance(rank('Media')) + (ev >= 1 ? 1 : 0) + (ev >= 5 ? 1 : 0);
      text = `報道の信頼性: 確率 10 分の ${chance}（ランク ${rank('Media')}、証拠 ${ev}）、出目 ${die} -> ${die <= chance ? '信じてもらえた' : '信じてもらえなかった'}`;
      break;
    }
    case 'fixer_haggle': {
      // 値切り: COOL + 売買 + ランク + 1d10 vs 相手の COOL + 売買（相手もフィクサーならランク）+ 1d10（p.159）
      if (rank('Fixer') < 1) return bad(c, '《オペレーター》がありません');
      if (r === null) return needRoll();
      const mine = stats.cool + (skills.trading ?? 0) + rank('Fixer') + r;
      const theirs = Number(b.their_total);
      if (!Number.isFinite(theirs)) return bad(c, '相手の合計（COOL + 売買 + 1d10）を入れてください');
      text = `値切り: COOL ${stats.cool} + 売買 ${skills.trading ?? 0} + ランク ${rank('Fixer')} + 出目 ${r} = ${mine} vs 相手 ${theirs} -> ${mine > theirs ? `勝ち。ランク ${rank('Fixer')} 以下の値切りの利益を 1 つ` : '負け（同じなら相手の勝ち）'}`;
      break;
    }
    case 'tech_craft': {
      // 改造・作成・発明・修理: TECH + 修理に使う技術系技能 + 専門分野のランク + 1d10（p.136・148〜149）
      const spec = b.specialty as MakerSpecialty | 'repair';
      const row2 = CRAFT_TABLE.find((x) => x.key === b.price);
      if (!row2) return bad(c, '品物の価格等級を選んでください');
      if (r === null) return needRoll();
      const skillKey = skillNameToKey(b.skill || 'basic_tech');
      const lvl = skills[skillKey] ?? 0;
      const specRank = spec === 'repair' ? 0 : (extra.maker?.[spec] ?? 0);
      if (spec !== 'repair' && specRank < 1) return bad(c, `${MAKER_SPECIALTIES[spec]}のランクがありません`);
      const field = spec === 'repair' && rank('Tech') > 0 ? (extra.maker?.field ?? 0) : 0;
      const total = stats.tech + lvl + specRank + field + r;
      const label = spec === 'repair' ? '修理' : MAKER_SPECIALTIES[spec];
      text = `${label}（${row2.name}、${row2.time}）: TECH ${stats.tech} + ${formatSkillName(skillKey)} ${lvl}${specRank ? ` + ${MAKER_SPECIALTIES[spec as MakerSpecialty]} ${specRank}` : ''}${field ? ` + 現場エンジニア ${field}` : ''} + 出目 ${r} = ${total} vs 難易度 ${row2.dv} -> ${total > row2.dv ? '成功' : '失敗（時間の半分で気づき、やり直し。原材料は無事）'}`;
      if (spec === 'field' && b.field_repair) text = `応急修理（アクション 1 回、ランク ${specRank} × 10 だけもつ）: ` + text;
      break;
    }
    case 'medtech_pharma': {
      // 薬品の調合: 〈医療技術〉難易度 13、1 時間と 200eb。成功で〈医療技術〉レベルの個数（p.149）
      const known = extra.medicine?.pharma_known ?? [];
      const drug = DRUGS.find((d) => d.key === b.drug && d.medtechOnly);
      if (!drug || !known.includes(drug.key)) return bad(c, '調合できる薬品（医療技術（薬品）で選んだもの）を選んでください');
      if (r === null) return needRoll();
      const lvl = skills.medical_tech ?? 0;
      const total = stats.tech + lvl + r;
      const ok = total > 13;
      text = `${drug.name} の調合（1 時間・200eb）: TECH ${stats.tech} + 医療技術 ${lvl} + 出目 ${r} = ${total} vs 難易度 13 -> ${ok ? `成功。${lvl} 回分できた` : '失敗（原材料は失われる）'}`;
      if (ok && lvl > 0) {
        const it = db.select().from(items).where(eq(items.name_en, drug.item_en)).get();
        const inv = JSON.parse(row.inventory || '[]');
        const same = inv.find((i: any) => i.item_id === it?.id);
        if (same) same.qty += lvl;
        else inv.push({ entry_id: generateUlid(), item_id: it?.id, name: drug.name, kind: 'drug', qty: lvl });
        db.update(characters).set({ inventory: JSON.stringify(inv) }).where(eq(characters.id, row.id)).run();
      }
      break;
    }
    case 'exec_recruit': {
      // チーム・メンバーを作る: 職務を選び、1d6 で能力値の行。初期忠誠度 1d6 + 1（p.154〜157）
      const team = extra.exec_team ?? [];
      if (team.length >= execTeamSize(rank('Exec'))) return bad(c, `《チームワーク》ランク ${rank('Exec')} のチーム・メンバーは ${execTeamSize(rank('Exec'))} 人までです`);
      const data = loadRoleData().execTeam;
      const job = data?.jobs.find((j: any) => j.key === b.job);
      if (!data || !job) return bad(c, '職務を選んでください（手元のルール資料 roles.json）');
      const statDie = Number(b.stat_die);
      const loyaltyDie = Number(b.loyalty_die);
      if (!(statDie >= 1 && statDie <= 6) || !(loyaltyDie >= 1 && loyaltyDie <= 6)) return bad(c, '能力値の 1d6 と忠誠度の 1d6 を入れてください');
      const rowStats = job.rows[statDie - 1] as number[];
      const st: Record<string, number> = { luck: 0 };
      data.order.forEach((k: string, i: number) => (st[k] = rowStats[i]));
      const sk: Record<string, number> = {};
      for (const [lv, names] of Object.entries(job.skills as Record<string, string[]>)) for (const n of names) sk[skillNameToKey(n)] = Number(lv);
      const inv = (job.gear as string[]).map((en) => {
        const it = db.select().from(items).where(eq(items.name_en, en)).get();
        return { entry_id: generateUlid(), item_id: it?.id, name: it?.name_ja || en, kind: it?.kind, qty: 1, equipped: true };
      });
      const id = generateUlid();
      const now = Date.now();
      const hp = hpMaxFromStats(st.body, st.will);
      db.insert(characters)
        .values({ id, kind: 'npc', name: b.name || `${job.name}（${row.name}のチーム）`, role: 'Exec', stats: JSON.stringify(st), skills: JSON.stringify(sk), hp, hp_max: hp, sp_head: 11, sp_body: 11, humanity: st.emp * 10, emp_max: st.emp, inventory: JSON.stringify(inv), notes_gm: `${row.name} のチーム・メンバー（${job.name}）。技能は成長しない。軽装アーマージャック以外の防具は着られない（p.153）`, created_at: now, updated_at: now })
        .run();
      const loyalty = loyaltyDie + 1;
      db.update(characters).set({ extra: JSON.stringify({ ...extra, exec_team: [...team, { character_id: id, job: job.name, loyalty }] }) }).where(eq(characters.id, row.id)).run();
      text = `チーム・メンバー（${job.name}）を作った。能力値は 1d6 = ${statDie} の行、初期忠誠度 ${loyalty}`;
      break;
    }
    case 'exec_loyalty': {
      const team = [...(extra.exec_team ?? [])];
      const m = team[Number(b.index)];
      if (!m) return bad(c, 'チーム・メンバーを選んでください');
      const name = load(m.character_id)?.name ?? m.job;
      if (b.delta !== undefined) {
        m.loyalty += Number(b.delta) || 0;
        text = `${name} の忠誠度 ${m.loyalty - Number(b.delta)} → ${m.loyalty}${b.reason ? `（${b.reason}）` : ''}`;
      } else {
        // 忠誠度判定: GM が 1d6 を振り、忠誠度以上なら拒否・失敗・不利益（p.154）
        const die = Number(b.die);
        if (!(die >= 1 && die <= 6)) return bad(c, '忠誠度判定の 1d6 を入れてください');
        text = `${name} の忠誠度判定: 1d6 = ${die} vs 忠誠度 ${m.loyalty} -> ${die >= m.loyalty ? '拒否する・失敗する・不利益をもたらすことがある' : '業務を引き受ける'}${m.loyalty <= 0 ? '（忠誠度 0 以下: 裏切ることもある）' : ''}`;
      }
      db.update(characters).set({ extra: JSON.stringify({ ...extra, exec_team: team }) }).where(eq(characters.id, row.id)).run();
      break;
    }
    default:
      return bad(c, '判定の種類が分かりません');
  }
  log(row.id, text);
  return c.json({ formula: text });
});
