import { Hono } from 'hono';
import { eq, desc, and, like } from 'drizzle-orm';
import { db } from '../db/client.js';
import { characters, char_log, money_log, items, cyberwares } from '../db/schema.js';
import { requireGm } from '../auth.js';
import { sessionManager } from '../session.js';
import { generateUlid, DrugKey, TherapyKey, DRUGS, medicalOf, cyberpsychosisStage } from '@cyberpgm/shared';
import { currentEmp } from '@cyberpgm/rules';
import {
  MedChar,
  useDrug,
  passTime,
  resolveAddiction,
  treatInjury,
  hospitalVisit,
  therapy,
  loseHumanity,
  installCyberware,
  maxHumanityOf,
} from '../services/medical.js';

/**
 * 医療・ドラッグ・セラピー・人間性（Phase 5w。日本語版 p.149〜150、219〜232）。GM が戦闘の外で使う。
 * 変える前のキャラを char_log に残し、「戻す」で 1 手ずつ戻せる
 */
export const medicalRoutes = new Hono();

const SNAPSHOT_PREFIX = '[medical-undo]';

function loadMed(id: string): MedChar | null {
  const row = db.select().from(characters).where(eq(characters.id, id)).get();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    stats: JSON.parse(row.stats),
    skills: JSON.parse(row.skills),
    hp: row.hp,
    hp_max: row.hp_max,
    humanity: row.humanity,
    cyberware: JSON.parse(row.cyberware),
    crit_injuries: JSON.parse(row.crit_injuries),
    status: JSON.parse(row.status),
    extra: JSON.parse(row.extra || '{}'),
  };
}

/** 変えたあとの値を書き、変える前を残し、告知する */
function save(ch: MedChar, after: Partial<MedChar>, text: string): void {
  const row = db.select().from(characters).where(eq(characters.id, ch.id)).get()!;
  const now = Date.now();
  db.insert(char_log)
    .values({ id: generateUlid(), character_id: ch.id, text: `${SNAPSHOT_PREFIX}${JSON.stringify({ hp: row.hp, humanity: row.humanity, stats: row.stats, cyberware: row.cyberware, crit_injuries: row.crit_injuries, status: row.status, extra: row.extra, eb: row.eb })}`, at: now })
    .run();
  db.insert(char_log).values({ id: generateUlid(), character_id: ch.id, text, at: now + 1 }).run();
  const set: Record<string, unknown> = { updated_at: now };
  if (after.hp !== undefined) set.hp = after.hp;
  if (after.humanity !== undefined) set.humanity = after.humanity;
  if (after.stats) set.stats = JSON.stringify(after.stats);
  if (after.cyberware) set.cyberware = JSON.stringify(after.cyberware);
  if (after.crit_injuries) set.crit_injuries = JSON.stringify(after.crit_injuries);
  if (after.status) set.status = JSON.stringify(after.status);
  if (after.extra) set.extra = JSON.stringify(after.extra);
  db.update(characters).set(set).where(eq(characters.id, ch.id)).run();
  // 人間性が変わってサイバーサイコシスの段階が変わったら告知する（p.232）
  if (after.humanity !== undefined || after.cyberware) {
    const cur = loadMed(ch.id)!;
    const before = cyberpsychosisStage(currentEmp(ch.humanity, maxHumanityOf(ch)), ch.humanity);
    const now2 = cyberpsychosisStage(currentEmp(cur.humanity, maxHumanityOf(cur)), cur.humanity);
    if (now2.level !== before.level && now2.level > 0) sessionManager.announceCombat('サイバーサイコシス', `${ch.name}: ${now2.label}`);
  }
  sessionManager.updateCharacterSheet(ch.id);
  sessionManager.notifyCharacter(ch.id, 'info', '医療・人間性', text);
}

function pay(ch: MedChar, amount: number, reason: string): string | null {
  const row = db.select().from(characters).where(eq(characters.id, ch.id)).get()!;
  if (row.eb < amount) return `${ch.name} の所持金が足りません（${row.eb.toLocaleString()}eb / ${amount.toLocaleString()}eb）`;
  const balance = row.eb - amount;
  db.update(characters).set({ eb: balance }).where(eq(characters.id, ch.id)).run();
  db.insert(money_log).values({ id: generateUlid(), character_id: ch.id, amount: -amount, reason, balance_after: balance, at: Date.now() }).run();
  return null;
}

const bad = (c: any, msg: string | string[], status = 400) => c.json({ error: Array.isArray(msg) ? msg.join(' / ') : msg, missing_inputs: Array.isArray(msg) ? msg : [msg] }, status);

// ドラッグ・薬品を使う
medicalRoutes.post('/medical/:id/drug', requireGm, async (c) => {
  const ch = loadMed(c.req.param('id')!);
  if (!ch) return bad(c, 'キャラが見つかりません', 404);
  const b = await c.req.json();
  const by = b.given_by ? loadMed(b.given_by) : null;
  const byMedtech = Boolean(by && (by.skills.medical_tech ?? 0) > 0);
  const res = useDrug(ch, b.drug as DrugKey, { doses: b.doses, dice: b.dice, byMedtech });
  if (!res.ok) return bad(c, res.missing!);
  save(ch, res.after!, res.formula);
  return c.json({ formula: res.formula });
});

// 二次効果（依存症）の判定
medicalRoutes.post('/medical/:id/addiction', requireGm, async (c) => {
  const ch = loadMed(c.req.param('id')!);
  if (!ch) return bad(c, 'キャラが見つかりません', 404);
  const b = await c.req.json();
  const res = resolveAddiction(ch, b.drug as DrugKey, b.roll);
  if (!res.ok) return bad(c, res.missing!);
  save(ch, res.after!, res.formula);
  return c.json({ formula: res.formula });
});

// 時間を進める（全員）。休んだ人は自然治癒する
medicalRoutes.post('/medical/time', requireGm, async (c) => {
  const b = await c.req.json();
  const hours = Math.max(1, Number(b.hours) || 0);
  const rested: string[] = Array.isArray(b.rested_ids) ? b.rested_ids : [];
  const report: string[] = [];
  for (const row of db.select().from(characters).all()) {
    const ch = loadMed(row.id)!;
    const m = medicalOf(ch.extra);
    const relevant = (m.drugs?.length ?? 0) > 0 || Object.keys(m.drug_cooldowns ?? {}).length > 0 || m.healing || ch.crit_injuries.some((x) => x.quick_fixed) || Boolean(ch.extra?.net_drain);
    if (!relevant) continue;
    const r = passTime(ch, hours, { rested: rested.includes(ch.id) });
    if (r.formula.length === 0 && JSON.stringify(r.after.extra) === JSON.stringify(ch.extra)) continue;
    save(ch, r.after, `${hours} 時間たった${r.formula.length ? `: ${r.formula.join(' / ')}` : ''}`);
    if (r.formula.length) report.push(`${ch.name}: ${r.formula.join(' / ')}`);
  }
  if (report.length) sessionManager.announceCombat('時間の経過', report.join('\n'));
  return c.json({ report });
});

// 致命的損傷の治療（対症治療・根本治療）
medicalRoutes.post('/medical/:id/treat', requireGm, async (c) => {
  const ch = loadMed(c.req.param('id')!);
  if (!ch) return bad(c, 'キャラが見つかりません', 404);
  const b = await c.req.json();
  const healer = loadMed(b.healer_id ?? ch.id);
  if (!healer) return bad(c, '治療する人を選んでください');
  const res = treatInjury(ch, healer, Number(b.index), b.mode === 'full' ? 'full' : 'quick', b.roll, Boolean(b.cybertech));
  if (!res.ok) return bad(c, res.missing!);
  if (res.after) save(ch, res.after, res.formula);
  return c.json({ formula: res.formula });
});

// 病院に行く（いちばん高い難易度の分だけ払う）
medicalRoutes.post('/medical/:id/hospital', requireGm, async (c) => {
  const ch = loadMed(c.req.param('id')!);
  if (!ch) return bad(c, 'キャラが見つかりません', 404);
  const b = await c.req.json().catch(() => ({}));
  const r = hospitalVisit(ch);
  if (b.pay !== false && r.cost > 0) {
    const err = pay(ch, r.cost, '病院の治療費');
    if (err) return bad(c, `${err}。返済計画を立てるなら「払わずに治療」を選んでください（翌月の頭までに払う）`);
  }
  save(loadMed(ch.id)!, r.after, r.formula + (b.pay === false ? '（後払い）' : ''));
  return c.json({ formula: r.formula, cost: r.cost });
});

// 自然治癒を始める／やめる（安定化したか）
medicalRoutes.post('/medical/:id/healing', requireGm, async (c) => {
  const ch = loadMed(c.req.param('id')!);
  if (!ch) return bad(c, 'キャラが見つかりません', 404);
  const b = await c.req.json();
  save(ch, { extra: { ...ch.extra, healing: Boolean(b.on) } }, b.on ? '安定化した。休めば 1 日ごとに【体格】ぶん回復する' : '自然治癒が止まった（無理をして傷が開いた。もう一度安定化が要る）');
  return c.json({ ok: true });
});

// セラピー
medicalRoutes.post('/medical/:id/therapy', requireGm, async (c) => {
  const ch = loadMed(c.req.param('id')!);
  if (!ch) return bad(c, 'キャラが見つかりません', 404);
  const b = await c.req.json();
  const doctor = loadMed(b.doctor_id ?? '');
  if (!doctor) return bad(c, 'セラピーをするメドテクを選んでください');
  const res = therapy(ch, doctor, b.therapy as TherapyKey, b.roll, { dice: b.dice, drug: b.drug });
  if (!res.ok) return bad(c, res.missing!);
  if (b.pay && res.cost) {
    const err = pay(ch, res.cost, 'セラピー');
    if (err) return bad(c, err);
  }
  save(loadMed(ch.id)!, res.after ?? {}, res.formula);
  return c.json({ formula: res.formula });
});

// 人間性喪失（トラウマ・エキゾチックな人体彫刻など）
medicalRoutes.post('/medical/:id/humanity-loss', requireGm, async (c) => {
  const ch = loadMed(c.req.param('id')!);
  if (!ch) return bad(c, 'キャラが見つかりません', 404);
  const b = await c.req.json();
  const res = loseHumanity(ch, Array.isArray(b.dice) ? b.dice : [], b.reason || '人間性喪失');
  if (!res.ok) return bad(c, res.missing!);
  save(ch, res.after!, res.formula);
  return c.json({ formula: res.formula });
});

// サイバーウェアのインストール（人間性喪失を振る）
medicalRoutes.post('/medical/:id/install', requireGm, async (c) => {
  const ch = loadMed(c.req.param('id')!);
  if (!ch) return bad(c, 'キャラが見つかりません', 404);
  const b = await c.req.json();
  const it = db.select().from(items).where(eq(items.id, b.item_id ?? '')).get();
  const cw = it ? db.select().from(cyberwares).where(eq(cyberwares.item_id, it.id)).get() : null;
  if (!it || !cw) return bad(c, 'サイバーウェアを選んでください');
  const surgeon = b.surgeon_id ? loadMed(b.surgeon_id) : null;
  const res = installCyberware(ch, { id: it.id, name: it.name_ja_override || it.name_ja || it.name_en, cw_type: cw.cw_type, humanity_loss_roll: cw.humanity_loss_roll, install_location: cw.install_location }, { dice: b.dice, surgeon: surgeon ?? undefined, roll: b.roll });
  if (!res.ok) return bad(c, res.missing!);
  if (res.after) save(ch, res.after, res.formula);
  return c.json({ formula: res.formula });
});

// サイバーウェアの摘出（人間性は戻らない）
medicalRoutes.post('/medical/:id/uninstall', requireGm, async (c) => {
  const ch = loadMed(c.req.param('id')!);
  if (!ch) return bad(c, 'キャラが見つかりません', 404);
  const b = await c.req.json();
  const cw = ch.cyberware[Number(b.index)];
  if (!cw) return bad(c, '外すサイバーウェアを選んでください');
  const text = `${cw.name} を外した（人間性の上限は戻るが、失った人間性はセラピーで取り戻す）`;
  save(ch, { cyberware: ch.cyberware.filter((_, i) => i !== Number(b.index)) }, text);
  return c.json({ formula: text });
});

// トラウマ・チームの契約
medicalRoutes.put('/medical/:id/trauma-plan', requireGm, async (c) => {
  const ch = loadMed(c.req.param('id')!);
  if (!ch) return bad(c, 'キャラが見つかりません', 404);
  const b = await c.req.json();
  const plan = b.plan === 'silver' || b.plan === 'executive' ? b.plan : null;
  save(ch, { extra: { ...ch.extra, trauma_plan: plan } }, plan ? `トラウマ・チームの${plan === 'silver' ? 'シルバー（月 500eb）' : 'エグゼクティヴ（月 1,000eb）'}に加入` : 'トラウマ・チームの契約なし');
  return c.json({ ok: true });
});

// 1 手戻す
medicalRoutes.post('/medical/:id/undo', requireGm, async (c) => {
  const id = c.req.param('id')!;
  const snap = db
    .select()
    .from(char_log)
    .where(and(eq(char_log.character_id, id), like(char_log.text, `${SNAPSHOT_PREFIX}%`)))
    .orderBy(desc(char_log.at))
    .get();
  if (!snap) return bad(c, '戻せる操作がありません');
  const v = JSON.parse(snap.text.slice(SNAPSHOT_PREFIX.length));
  db.update(characters).set({ hp: v.hp, humanity: v.humanity, ...(v.stats ? { stats: v.stats } : {}), cyberware: v.cyberware, crit_injuries: v.crit_injuries, status: v.status, extra: v.extra, eb: v.eb, updated_at: Date.now() }).where(eq(characters.id, id)).run();
  db.delete(char_log).where(eq(char_log.id, snap.id)).run();
  db.insert(char_log).values({ id: generateUlid(), character_id: id, text: '医療・人間性の操作を 1 つ戻した', at: Date.now() }).run();
  sessionManager.updateCharacterSheet(id);
  return c.json({ ok: true });
});

// ドラッグ一覧（画面用）
medicalRoutes.get('/medical/drugs', requireGm, (c) => c.json({ drugs: DRUGS }));
