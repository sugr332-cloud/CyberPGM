import {
  CharacterExtra,
  DRUGS,
  DrugKey,
  MedicalExtra,
  medicalOf,
  THERAPIES,
  TherapyKey,
  hospitalCost,
  INSTALL_FACILITIES,
  getSkillDef,
  skillNameToKey,
} from '@cyberpgm/shared';
import { maxHumanity, resolveD10, woundState } from '@cyberpgm/rules';

/**
 * 医療・ドラッグ・セラピー・人間性の計算（Phase 5w。日本語版 p.149〜150、219〜232）。
 * キャラの値を受け取り、変えたあとの値を返す（DB には書かない）
 */
export interface MedChar {
  id: string;
  name: string;
  stats: Record<string, number>;
  skills: Record<string, number>;
  hp: number;
  hp_max: number;
  humanity: number;
  cyberware: Array<{ item_id?: string; name: string; type?: string; static_loss?: number }>;
  crit_injuries: Array<Record<string, any>>;
  status: string[];
  extra: CharacterExtra;
}

export interface MedResult {
  ok: boolean;
  /** 足りない入力・できない理由 */
  missing?: string[];
  formula: string;
  after?: Partial<MedChar>;
}

const sum = (dice?: number[]) => (dice ?? []).reduce((a, b) => a + b, 0);
const fail = (msg: string): MedResult => ({ ok: false, missing: [msg], formula: msg });
const d10 = (roll: { first: number; extra?: number } | undefined, label: string): number | string => {
  if (!roll) return `${label}の出目 (1d10) を入力してください`;
  if ((roll.first === 10 || roll.first === 1) && roll.extra === undefined) return `${label}${roll.first === 10 ? 'クリティカル' : 'ファンブル'}: 追加出目 (1d10) を入力してください`;
  return resolveD10(roll.first, roll.extra).value;
};

export function maxHumanityOf(ch: MedChar): number {
  return maxHumanity(ch.stats.emp, ch.cyberware.map((c) => ({ type: c.type, staticLoss: c.static_loss ?? 0 })));
}

// ── ドラッグ・薬品を使う（p.149〜150、227〜229） ──
export function useDrug(ch: MedChar, key: DrugKey, opts: { doses?: number; dice?: number[]; byMedtech?: boolean }): MedResult {
  const def = DRUGS.find((d) => d.key === key);
  if (!def) return fail('ドラッグ・薬品を選んでください');
  if (def.medtechOnly && !opts.byMedtech) return fail(`${def.name} はメドテクでないと正しく投与できません（p.150）`);
  const m: MedicalExtra = { ...medicalOf(ch.extra) };
  const cd = m.drug_cooldowns?.[key] ?? 0;
  if (def.cooldownHours && cd > 0) return fail(`${def.name} はあと ${cd} 時間は効果を受けられません`);
  const doses = Math.max(1, opts.doses ?? 1);
  const after: Partial<MedChar> = {};
  let formula = `${ch.name} に ${def.name}${doses > 1 ? ` ×${doses}` : ''}: ${def.effect}`;
  const extra: MedicalExtra & CharacterExtra = { ...ch.extra, ...m };
  if (def.cooldownHours) extra.drug_cooldowns = { ...(m.drug_cooldowns ?? {}), [key]: def.cooldownHours };

  if (key === 'rapidetox') {
    // ドラッグ・毒・酩酊をすべて終わらせる（依存症は治らない）
    extra.drugs = [];
    extra.pending_addiction = [];
    after.status = ch.status.filter((s) => !['酩酊', '被暗示性', '薬物の効果'].includes(s));
    formula += '。効いていたドラッグ・薬物はすべて終わった';
  } else if (key === 'speedheal') {
    if (woundState(ch.hp, ch.hp_max) === 'mortally') return fail('高速治癒剤は瀕死の人には効きません');
    const heal = ch.stats.body + ch.stats.will;
    after.hp = Math.min(ch.hp_max, ch.hp + heal);
    formula += `。HP ${ch.hp} → ${after.hp}`;
  } else {
    const drugs = [...(m.drugs ?? [])];
    const cur = drugs.find((d) => d.key === key);
    const hours = def.hours * doses; // 2 回分・3 回分で時間が 2 倍・3 倍（p.227）
    let humanityLoss = 0;
    if (key === 'black_lace') {
      if (!opts.dice || opts.dice.length !== 2) return fail('ブラック・レースの人間性喪失 2d6 の出目を入れてください');
      humanityLoss = sum(opts.dice);
      after.humanity = ch.humanity - humanityLoss;
      formula += `。人間性 ${ch.humanity} → ${after.humanity}（依存症にならなければ戻る）`;
    }
    if (cur) {
      cur.hours += hours;
      cur.humanity_loss = (cur.humanity_loss ?? 0) + humanityLoss;
    } else drugs.push({ key, hours, ...(humanityLoss ? { humanity_loss: humanityLoss } : {}) });
    extra.drugs = drugs;
    formula += `（${hours} 時間）`;
  }
  after.extra = extra;
  return { ok: true, formula, after };
}

// ── 時間を進める（ドラッグの時間・1 日 1 回の薬品・自然治癒・対症治療の期限） ──
export function passTime(ch: MedChar, hours: number, opts: { rested?: boolean }): { formula: string[]; after: Partial<MedChar> } {
  const m: MedicalExtra = { ...medicalOf(ch.extra) };
  const notes: string[] = [];
  const pending = [...(m.pending_addiction ?? [])];
  const drugs: NonNullable<MedicalExtra['drugs']> = [];
  let antibioticDays = 0;
  for (const d of m.drugs ?? []) {
    const left = d.hours - hours;
    if (d.key === 'antibiotics') antibioticDays = Math.min(Math.floor(hours / 24), Math.ceil(d.hours / 24));
    if (left > 0) drugs.push({ ...d, hours: left });
    else {
      const def = DRUGS.find((x) => x.key === d.key)!;
      notes.push(`${def.name} の効果が切れた`);
      if (def.addictionDv !== null) {
        pending.push({ key: d.key, ...(d.humanity_loss ? { humanity_loss: d.humanity_loss } : {}) });
        notes.push(`${def.name} の二次効果の判定（WILL + 拷問／薬物抵抗 + 1d10 vs 難易度 ${def.addictionDv}）`);
      }
    }
  }
  const cooldowns: MedicalExtra['drug_cooldowns'] = {};
  for (const [k, v] of Object.entries(m.drug_cooldowns ?? {})) if ((v ?? 0) - hours > 0) cooldowns[k as DrugKey] = (v ?? 0) - hours;
  const after: Partial<MedChar> = {};
  const days = Math.floor(hours / 24);
  // 自然治癒: 安定化したあと、1 日休むごとに【体格】ぶん（抗生剤で +2）。無理をした日は回復しない（p.222〜223）
  if (days > 0 && m.healing && opts.rested && ch.hp < ch.hp_max && woundState(ch.hp, ch.hp_max) !== 'mortally') {
    const heal = ch.stats.body * days + 2 * antibioticDays;
    after.hp = Math.min(ch.hp_max, ch.hp + heal);
    notes.push(`自然治癒: HP ${ch.hp} → ${after.hp}`);
  }
  // 対症治療は「その日が終わるまで」（p.223）
  if (days > 0 && ch.crit_injuries.some((c) => c.quick_fixed)) {
    after.crit_injuries = ch.crit_injuries.map(({ quick_fixed: _q, ...rest }) => rest);
    notes.push('対症治療の効果が切れた');
  }
  const nextExtra: Record<string, unknown> = { ...ch.extra, ...m, drugs, pending_addiction: pending, drug_cooldowns: cooldowns, ...(after.hp === ch.hp_max ? { healing: false } : {}) };
  // プログラム・ブラック ICE（リッチ・スコーピオン・ナーヴスクラブ）による 1 時間の能力値低下を戻す（Phase 5z）
  if (ch.extra.net_drain && hours >= (ch.extra.net_drain.hours ?? 1)) {
    const nextStats = { ...ch.stats };
    for (const [k, v] of Object.entries(ch.extra.net_drain.stats ?? {})) {
      if (typeof v === 'number') nextStats[k] = (nextStats[k] ?? 0) + v;
    }
    after.stats = nextStats;
    delete nextExtra.net_drain;
    notes.push('プログラム／ブラック ICE による能力値低下（1 時間）が回復した');
  }
  after.extra = nextExtra as CharacterExtra;
  return { formula: notes, after };
}

// ── 二次効果（依存症）の判定 ──
export function resolveAddiction(ch: MedChar, key: DrugKey, roll: { first: number; extra?: number } | undefined): MedResult {
  const def = DRUGS.find((d) => d.key === key);
  const m = medicalOf(ch.extra);
  const p = (m.pending_addiction ?? []).find((x) => x.key === key);
  if (!def || def.addictionDv === null || !p) return fail('二次効果の判定待ちのドラッグではありません');
  const relapse = (m.addiction_relapse ?? []).includes(key);
  let fell: boolean;
  let formula: string;
  if (relapse) {
    fell = true;
    formula = `${def.name} の二次効果: 依存症の治療から 1 年たっていないので自動で失敗`;
  } else {
    const r = d10(roll, '〈拷問／薬物抵抗〉');
    if (typeof r === 'string') return fail(r);
    const res = ch.skills[skillNameToKey('resist_torture_drugs')] ?? 0;
    const total = ch.stats.will + res + r;
    fell = total <= def.addictionDv;
    formula = `${def.name} の二次効果: WILL ${ch.stats.will} + 拷問／薬物抵抗 ${res} + 出目 ${r} = ${total} vs 難易度 ${def.addictionDv} -> ${fell ? '失敗' : '抵抗した'}`;
  }
  const after: Partial<MedChar> = {};
  const addictions = new Set(m.addictions ?? []);
  if (fell) {
    addictions.add(key);
    formula += `。依存症: ${def.addiction}`;
  } else if (p.humanity_loss) {
    // ブラック・レースの人間性喪失は、二次効果を受けなければ戻る
    after.humanity = Math.min(maxHumanityOf(ch), ch.humanity + p.humanity_loss);
    formula += `。人間性が戻る（${ch.humanity} → ${after.humanity}）`;
  }
  after.extra = { ...ch.extra, ...m, addictions: [...addictions], pending_addiction: (m.pending_addiction ?? []).filter((x) => x !== p) };
  return { ok: true, formula, after };
}

// ── 致命的損傷の治療（p.223） ──
const SKILL_OF: Record<string, string> = { dvFirstAid: 'first_aid', dvParamedic: 'paramedic', dvSurgery: 'surgery' };
export function treatInjury(
  patient: MedChar,
  healer: MedChar,
  index: number,
  mode: 'quick' | 'full',
  roll: { first: number; extra?: number } | undefined,
  useCybertech: boolean,
): MedResult {
  const inj = patient.crit_injuries[index];
  if (!inj) return fail('治療する致命的損傷を選んでください');
  if (mode === 'full' && healer.id === patient.id) return fail('根本治療は自分自身にはできません');
  const spec = (mode === 'quick' ? inj.quickFix : inj.treatment) ?? {};
  // 使える技能と難易度（0 や無いものは使えない）
  const options = Object.entries(SKILL_OF)
    .map(([field, skill]) => ({ skill, dv: Number(spec[field] ?? 0) }))
    .filter((o) => o.dv > 0);
  if (mode === 'quick' && spec.type === 'notApplicable') return fail(`${inj.name} は対症治療できません`);
  if (options.length === 0) {
    if (mode === 'full' && inj.quickFix && (spec.type === 'quickFix' || spec.type === undefined)) {
      return fail(`${inj.name} は対症治療だけで効果が永久に消えます（対症治療をしてください）`);
    }
    return fail(`${inj.name} の${mode === 'quick' ? '対症治療' : '根本治療'}の難易度がデータにありません`);
  }
  // 治す人の持っている技能のうち、いちばん基本値の高いもの（サイバー部位なら〈サイバー技術〉でも可）
  const cands = options.map((o) => ({ ...o, level: healer.skills[o.skill] ?? 0 }));
  if (useCybertech) for (const o of options) cands.push({ ...o, skill: 'cybertech', level: healer.skills.cybertech ?? 0 });
  const usable = cands.filter((c) => c.skill !== 'surgery' || c.level > 0);
  if (usable.length === 0) return fail(`${inj.name} の${mode === 'quick' ? '対症治療' : '根本治療'}には〈外科手術〉が要ります（メドテクだけ）`);
  const best = usable.sort((a, b) => b.level - a.level || a.dv - b.dv)[0];
  const r = d10(roll, '治療');
  if (typeof r === 'string') return fail(r);
  const tech = healer.stats.tech;
  const total = tech + best.level + r;
  const ok = total > best.dv;
  const skillName = getSkillDef(best.skill)?.name ?? best.skill;
  let formula = `${inj.name} の${mode === 'quick' ? '対症治療（1 分、その日の終わりまで）' : '根本治療（4 時間、永久に治る）'}: TECH ${tech} + ${skillName} ${best.level} + 出目 ${r} = ${total} vs 難易度 ${best.dv} -> ${ok ? '成功' : '失敗'}`;
  if (!ok) return { ok: true, formula };
  const list = [...patient.crit_injuries];
  const permanentByQuick = mode === 'quick' && (inj.treatment?.type === 'quickFix' || /対症治療だけで/.test(String(inj.treatment?.note ?? '')));
  if (mode === 'full' || permanentByQuick) {
    list.splice(index, 1);
    formula += `。${inj.name} が治った`;
  } else {
    list[index] = { ...inj, quick_fixed: true };
    formula += '。その日の終わりまで効果がなくなる';
  }
  return { ok: true, formula, after: { crit_injuries: list } };
}

// ── 病院（p.225） ──
export function hospitalVisit(ch: MedChar): { cost: number; highestDv: number; formula: string; after: Partial<MedChar> } {
  const ws = woundState(ch.hp, ch.hp_max);
  const stabDv = ch.hp >= ch.hp_max ? 0 : ws === 'mortally' ? 15 : ws === 'seriously' ? 13 : 10;
  let highest = stabDv;
  for (const inj of ch.crit_injuries) {
    const t = inj.treatment ?? {};
    const dvs = [t.dvParamedic, t.dvSurgery, inj.quickFix?.dvFirstAid, inj.quickFix?.dvParamedic].map(Number).filter((n) => n > 0);
    if (dvs.length) highest = Math.max(highest, Math.min(...dvs));
  }
  const cost = hospitalCost(highest);
  const after: Partial<MedChar> = {
    crit_injuries: [],
    hp: ws === 'mortally' ? 1 : ch.hp,
    extra: { ...ch.extra, healing: ch.hp < ch.hp_max ? true : medicalOf(ch.extra).healing },
  };
  const formula = `病院: 最も高い難易度 ${highest || '—'} → ${cost.toLocaleString()}eb。致命的損傷はすべて根本治療され、自然治癒が始まる（自宅で回復を待てる。入院は 1 泊 100eb）`;
  return { cost, highestDv: highest, formula, after };
}

// ── セラピー（p.229〜230） ──
export function therapy(
  patient: MedChar,
  doctor: MedChar,
  key: TherapyKey,
  roll: { first: number; extra?: number } | undefined,
  opts: { dice?: number[]; drug?: DrugKey },
): MedResult & { cost?: number } {
  const t = THERAPIES.find((x) => x.key === key);
  if (!t) return fail('セラピーを選んでください');
  if (doctor.id === patient.id) return fail('メドテクは自分自身にセラピーを行なえません');
  const level = doctor.skills.medical_tech ?? 0;
  if (level < 1) return fail('セラピーには〈医療技術〉（メドテクの《メディシン》）が要ります');
  const m = medicalOf(patient.extra);
  if (key === 'addiction' && (!opts.drug || !(m.addictions ?? []).includes(opts.drug))) return fail('治す依存症を選んでください');
  if (t.dice && (!opts.dice || opts.dice.length !== t.dice)) return fail(`回復する人間性 ${t.dice}d6 の出目を入れてください（成功したときに使います）`);
  const r = d10(roll, '〈医療技術〉');
  if (typeof r === 'string') return fail(r);
  const total = doctor.stats.tech + level + r;
  const ok = total > t.dv;
  let formula = `セラピー（${t.name}、1 週間）: TECH ${doctor.stats.tech} + 医療技術 ${level} + 出目 ${r} = ${total} vs 難易度 ${t.dv} -> ${ok ? '成功' : '失敗（1 週間と医薬品は無駄になる）'}。費用 ${t.cost.toLocaleString()}eb（医薬品代 ${t.medicine}eb）`;
  if (!ok) return { ok: true, formula, cost: t.cost };
  const after: Partial<MedChar> = {};
  if (key === 'addiction') {
    const def = DRUGS.find((d) => d.key === opts.drug)!;
    after.extra = { ...patient.extra, addictions: (m.addictions ?? []).filter((a) => a !== opts.drug), addiction_relapse: [...new Set([...(m.addiction_relapse ?? []), opts.drug!])] };
    formula += `。${def.name} の依存症が治った（1 年間は同じドラッグの二次効果に自動で失敗）`;
  } else {
    const cap = maxHumanityOf(patient);
    after.humanity = Math.min(cap, patient.humanity + sum(opts.dice));
    formula += `。人間性 ${patient.humanity} → ${after.humanity}（上限 ${cap}: サイバーウェア 1 つにつき −2、ボーグウェアは −4）`;
  }
  return { ok: true, formula, after, cost: t.cost };
}

// ── 人間性喪失（トラウマなど。p.231） ──
export function loseHumanity(ch: MedChar, dice: number[], reason: string): MedResult {
  if (!dice.length) return fail('人間性喪失の出目を入れてください');
  const n = sum(dice);
  return { ok: true, formula: `${reason}: 人間性 ${ch.humanity} → ${ch.humanity - n}（−${n}）`, after: { humanity: ch.humanity - n } };
}

// ── サイバーウェアのインストール・摘出（p.226） ──
export function installCyberware(
  ch: MedChar,
  item: { id: string; name: string; cw_type?: string | null; humanity_loss_roll?: string | null; install_location?: string | null },
  opts: { dice?: number[]; surgeon?: MedChar; roll?: { first: number; extra?: number } },
): MedResult {
  const m = /^(\d+)d(\d+)$/.exec(item.humanity_loss_roll ?? '');
  const need = m ? Number(m[1]) : 0;
  if (need && (!opts.dice || opts.dice.length !== need)) return fail(`人間性喪失 ${item.humanity_loss_roll} の出目を ${need} 個入れてください`);
  const fac = INSTALL_FACILITIES[item.install_location ?? 'mall'] ?? INSTALL_FACILITIES.mall;
  let formula = `${item.name} をインストール（${fac.name}`;
  if (opts.surgeon) {
    if (opts.surgeon.id === ch.id && fac.name !== 'モール') return fail('モール以外の施設のサイバーウェアは、自分で自分にインストールできません');
    const r = d10(opts.roll, '〈外科手術〉');
    if (typeof r === 'string') return fail(r);
    const lv = opts.surgeon.skills.surgery ?? 0;
    const total = opts.surgeon.stats.tech + lv + r;
    if (total <= fac.dv) return { ok: true, formula: `${item.name} のインストール: TECH ${opts.surgeon.stats.tech} + 外科手術 ${lv} + 出目 ${r} = ${total} vs 難易度 ${fac.dv} -> 失敗（2 時間の作業が無駄になる。サイバーウェアは無事）` };
    formula += `、TECH ${opts.surgeon.stats.tech} + 外科手術 ${lv} + 出目 ${r} = ${total} vs 難易度 ${fac.dv} 成功`;
  } else {
    formula += `、医療機関の費用 ${fac.cost.toLocaleString()}eb。購入した品はインストール費用込み`;
  }
  const loss = sum(opts.dice);
  const cyberware = [...ch.cyberware, { item_id: item.id, name: item.name, type: item.cw_type ?? undefined, static_loss: loss }];
  const after: Partial<MedChar> = { cyberware, humanity: ch.humanity - loss };
  const capAfter = maxHumanityOf({ ...ch, cyberware });
  formula += `）。人間性 ${ch.humanity} → ${ch.humanity - loss}（−${loss}）。人間性の上限は ${capAfter}`;
  return { ok: true, formula, after };
}
