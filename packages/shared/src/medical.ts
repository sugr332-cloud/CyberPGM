/**
 * 医療・ドラッグ・セラピー・人間性（Phase 5w。日本語版コアルールブック p.149〜150、219〜232）
 */
import type { CharacterExtra, CharacterStats } from './types.js';

// ── ストリート・ドラッグとメドテクの薬品 ──
export type DrugKey = 'synthcoke' | 'smash' | 'boost' | 'black_lace' | 'blue_glass' | 'antibiotics' | 'rapidetox' | 'speedheal' | 'stim' | 'surge';

export interface DrugDef {
  key: DrugKey;
  name: string;
  /** 品目の英語名（所持品から探す） */
  item_en: string;
  /** 初期効果の時間（時間）。0 はすぐ終わるもの */
  hours: number;
  /** 二次効果（依存症）の難易度。null はなし（メドテクの薬品） */
  addictionDv: number | null;
  /** メドテクだけが正しく投与できる薬品（p.150） */
  medtechOnly: boolean;
  /** 1 人が効果を受けられる間隔（時間）。null は制限なし */
  cooldownHours: number | null;
  effect: string;
  addiction?: string;
}

const SMASH_SKILLS = ['acting', 'conversation', 'contortionist', 'human_perception', 'persuasion', 'dance'];

export const DRUGS: DrugDef[] = [
  { key: 'synthcoke', name: 'シンセコーク', item_en: 'Synthcoke', hours: 4, addictionDv: 15, medtechOnly: false, cooldownHours: null, effect: '【反応】+1（8 を超えてもよい）。被害妄想に囚われやすい', addiction: '効いていないあいだ【反応】−2。ときどき欲しくてたまらなくなる' },
  { key: 'smash', name: 'スマッシュ', item_en: 'Smash', hours: 4, addictionDv: 15, medtechOnly: false, cooldownHours: null, effect: '〈演技〉〈会話術〉〈柔軟〉〈真意看破〉〈説得〉〈舞踊〉+2', addiction: '同じ技能に −2。ときどき欲しくてたまらなくなる' },
  { key: 'boost', name: 'ブースト', item_en: 'Boost', hours: 24, addictionDv: 17, medtechOnly: false, cooldownHours: null, effect: '【知力】+2（8 を超えてもよい）', addiction: '効いていないあいだ【知力】−2' },
  { key: 'black_lace', name: 'ブラック・レース', item_en: 'Black Lace', hours: 24, addictionDv: 17, medtechOnly: false, cooldownHours: null, effect: '使うと人間性 2d6 喪失（依存症にならなければ戻る）。重傷の効果を無視', addiction: '人間性は戻らない。効いていないあいだ【反応】−2' },
  { key: 'blue_glass', name: 'ブルー・グラス', item_en: 'Blue Glass', hours: 4, addictionDv: 15, medtechOnly: false, cooldownHours: null, effect: 'GM がときどき「フラッシュアウト」を宣言し、そのターンはアクションできない', addiction: 'GM がときどきフラッシュアウトを宣言する（1 時間に 1 回くらい）。効いているあいだは起きない' },
  { key: 'antibiotics', name: '抗生剤', item_en: 'Antibiotic', hours: 168, addictionDv: null, medtechOnly: true, cooldownHours: null, effect: '自然治癒が始まっている人に。1 週間、1 日の回復 +2（重ねても同じ）' },
  { key: 'rapidetox', name: '瞬間解毒剤', item_en: 'Rapidetox', hours: 0, addictionDv: null, medtechOnly: true, cooldownHours: null, effect: '効いているドラッグ・毒・酩酊をすべて終わらせる' },
  { key: 'speedheal', name: '高速治癒剤', item_en: 'Speedheal', hours: 0, addictionDv: null, medtechOnly: true, cooldownHours: 24, effect: '瀕死でなければ、すぐに【体格】＋【意志】回復（1 日 1 回）' },
  { key: 'stim', name: '興奮剤', item_en: 'Stim', hours: 1, addictionDv: null, medtechOnly: true, cooldownHours: 24, effect: '1 時間、重傷の効果を無視（1 日 1 回）' },
  { key: 'surge', name: '覚醒剤', item_en: 'Surge', hours: 24, addictionDv: null, medtechOnly: true, cooldownHours: 168, effect: '24 時間、睡眠不足の効果を受けない（1 週間に 1 回）' },
];

export interface ActiveDrug {
  key: DrugKey;
  /** 残り時間（時間） */
  hours: number;
  /** ブラック・レースで失った人間性（依存症にならなければ戻す） */
  humanity_loss?: number;
}

export interface MedicalExtra {
  /** 効いているドラッグ・薬品 */
  drugs?: ActiveDrug[];
  /** 初期効果が切れて、二次効果（依存症）の判定待ちのドラッグ */
  pending_addiction?: Array<{ key: DrugKey; humanity_loss?: number }>;
  /** 依存症 */
  addictions?: DrugKey[];
  /** 依存症を治してから 1 年間、二次効果の判定に自動で失敗するドラッグ（p.230） */
  addiction_relapse?: DrugKey[];
  /** 次に使えるようになるまでの時間（1 日 1 回などの薬品） */
  drug_cooldowns?: Partial<Record<DrugKey, number>>;
  /** 自然治癒が始まっている（安定化した） */
  healing?: boolean;
  /** トラウマ・チームの契約 */
  trauma_plan?: 'silver' | 'executive' | null;
}

export function medicalOf(extra: CharacterExtra | undefined | null): MedicalExtra {
  return (extra ?? {}) as MedicalExtra;
}

/**
 * ドラッグと依存症で変わる能力値と技能（p.227〜229）。キャラの記録そのものは変えず、判定のときに使う
 */
export function drugModifiers(extra: CharacterExtra | undefined | null): {
  stats: Partial<Record<keyof CharacterStats, number>>;
  skills: Record<string, number>;
  ignoreSeriousWound: boolean;
  notes: string[];
} {
  const m = medicalOf(extra);
  const active = new Set((m.drugs ?? []).map((d) => d.key));
  const addicted = new Set(m.addictions ?? []);
  const stats: Partial<Record<keyof CharacterStats, number>> = {};
  const skills: Record<string, number> = {};
  const notes: string[] = [];
  const add = (k: keyof CharacterStats, n: number) => (stats[k] = (stats[k] ?? 0) + n);
  if (active.has('synthcoke')) { add('ref', 1); notes.push('シンセコーク: 【反応】+1'); }
  else if (addicted.has('synthcoke')) { add('ref', -2); notes.push('シンセコーク依存症: 【反応】−2'); }
  if (active.has('boost')) { add('int', 2); notes.push('ブースト: 【知力】+2'); }
  else if (addicted.has('boost')) { add('int', -2); notes.push('ブースト依存症: 【知力】−2'); }
  if (!active.has('black_lace') && addicted.has('black_lace')) { add('ref', -2); notes.push('ブラック・レース依存症: 【反応】−2'); }
  const smash = active.has('smash') ? 2 : addicted.has('smash') ? -2 : 0;
  if (smash) {
    for (const k of SMASH_SKILLS) skills[k] = (skills[k] ?? 0) + smash;
    notes.push(`スマッシュ${smash > 0 ? '' : '依存症'}: 〈演技〉〈会話術〉〈柔軟〉〈真意看破〉〈説得〉〈舞踊〉${smash > 0 ? '+2' : '−2'}`);
  }
  const ignoreSeriousWound = active.has('black_lace') || active.has('stim');
  if (ignoreSeriousWound) notes.push('重傷の効果を無視');
  if (active.has('blue_glass') || addicted.has('blue_glass')) notes.push(active.has('blue_glass') && addicted.has('blue_glass') ? 'ブルー・グラス: 効いているのでフラッシュアウトは起きない' : 'ブルー・グラス: GM がフラッシュアウトを宣言することがある');
  return { stats, skills, ignoreSeriousWound, notes };
}

// ── 治療 ──
/** 病院の 1 回の通院の費用（受ける処置のうち最も高い難易度で決まる。p.225） */
export function hospitalCost(highestDv: number): number {
  if (highestDv >= 17) return 1000;
  if (highestDv >= 15) return 500;
  if (highestDv >= 13) return 100;
  if (highestDv >= 10) return 50;
  return 0;
}

// ── セラピー（p.229〜230） ──
export type TherapyKey = 'addiction' | 'standard' | 'extreme';
export const THERAPIES: Array<{ key: TherapyKey; name: string; cost: number; dv: number; medicine: number; dice: number; effect: string }> = [
  { key: 'addiction', name: '依存症', cost: 1000, dv: 15, medicine: 500, dice: 0, effect: '依存症を 1 つ治す。ただし 1 年間は同じドラッグの二次効果の判定に自動で失敗する' },
  { key: 'standard', name: '標準的な人間性喪失', cost: 500, dv: 15, medicine: 100, dice: 2, effect: '失った人間性が 2d6 回復する' },
  { key: 'extreme', name: '末期的な人間性喪失', cost: 1000, dv: 17, medicine: 500, dice: 4, effect: '失った人間性が 4d6 回復する' },
];

// ── 精神的トラウマ（p.231） ──
export const TRAUMAS: Array<{ key: string; name: string; dice: number }> = [
  { key: 'physical', name: '肉体的トラウマ（拷問など）', dice: 1 },
  { key: 'mental', name: '精神的トラウマ（残虐な殺人の目撃など）', dice: 1 },
  { key: 'long_mental', name: '長期の精神的ストレス（誘拐・幽閉・長期の虐待）', dice: 2 },
  { key: 'long_env', name: '長期の環境的ストレス（交戦地帯・飢餓・被災）', dice: 2 },
  { key: 'exotic_sculpt', name: 'エキゾチックな人体彫刻', dice: 4 },
];

// ── サイバーサイコシス（p.232） ──
export function cyberpsychosisStage(currentEmp: number, humanity: number): { level: 0 | 1 | 2 | 3 | 4; label: string } {
  if (currentEmp <= 0 && humanity < 0) return { level: 4, label: '重度のサイバーサイコ。キャラは GM が動かす（人間性がプラスに戻れば手元に戻る）' };
  if (currentEmp <= 0) return { level: 3, label: 'サイバーサイコ。PCL の特徴が 5 つ以上強く出る' };
  if (currentEmp === 1) return { level: 2, label: '解離性障害。サイバーサイコと紙一重。PCL の特徴が 3 つ以上強く出る' };
  if (currentEmp === 2) return { level: 1, label: '解離性障害の瀬戸際' };
  return { level: 0, label: '' };
}

/** サイバーウェアのインストール施設（p.226） */
export const INSTALL_FACILITIES: Record<string, { name: string; dv: number; cost: number }> = {
  mall: { name: 'モール', dv: 13, cost: 100 },
  clinic: { name: 'クリニック', dv: 15, cost: 500 },
  hospital: { name: '病院', dv: 17, cost: 1000 },
};

// ── 致命的損傷の日本語名と効果（p.221〜222。効果は短くまとめたもの） ──
export const CRIT_INJURIES_JA: Record<'body' | 'head', Record<number, { name: string; effect: string }>> = {
  body: {
    2: { name: '片腕喪失', effect: '腕 1 本を失い、その手の物を落とす。死亡セーヴの基本値 +1' },
    3: { name: '片手喪失', effect: '手 1 本を失い、その手の物を落とす。死亡セーヴの基本値 +1' },
    4: { name: '肺損傷', effect: '【移動】−2（最低 1）。死亡セーヴの基本値 +1' },
    5: { name: '肋骨損傷', effect: '1 ターンに徒歩で 4m（2 マス）より多く動くと、ターンの終わりに HP に直接 5' },
    6: { name: '片腕損傷', effect: 'その腕は使えず、その手の物を落とす' },
    7: { name: '外傷異物', effect: '1 ターンに徒歩で 4m（2 マス）より多く動くと、ターンの終わりに HP に直接 5' },
    8: { name: '片脚損傷', effect: '【移動】−4（最低 1）' },
    9: { name: '筋肉断裂', effect: '近接攻撃に −2' },
    10: { name: '脊椎損傷', effect: '次のターンはアクションできない（移動はできる）。死亡セーヴの基本値 +1' },
    11: { name: '指損傷', effect: 'その手を使うアクションに −4' },
    12: { name: '片脚喪失', effect: '脚 1 本を失う。【移動】−6（最低 1）。攻撃を回避できない。死亡セーヴの基本値 +1' },
  },
  head: {
    2: { name: '片目喪失', effect: '遠隔攻撃と視覚の〈知覚〉に −2。死亡セーヴの基本値 +1' },
    3: { name: '脳損傷', effect: 'すべてのアクションに −2。死亡セーヴの基本値 +1' },
    4: { name: '片目損傷', effect: '遠隔攻撃と視覚の〈知覚〉に −2' },
    5: { name: '脳震盪', effect: 'すべてのアクションに −2' },
    6: { name: '顎部損傷', effect: '声を出すアクションに −4' },
    7: { name: '外傷異物', effect: '1 ターンに徒歩で 4m（2 マス）より多く動くと、ターンの終わりに HP に直接 5' },
    8: { name: '頸椎損傷', effect: '死亡セーヴの基本値 +1' },
    9: { name: '頭蓋損傷', effect: '頭部への狙い撃ちは 3 倍。死亡セーヴの基本値 +1' },
    10: { name: '片耳損傷', effect: '1 ターンに 4m より多く動くと次のターンは移動できない。聴覚の〈知覚〉に −2' },
    11: { name: '気管損傷', effect: '声を出せない。死亡セーヴの基本値 +1' },
    12: { name: '片耳喪失', effect: '1 ターンに 4m より多く動くと次のターンは移動できない。聴覚の〈知覚〉に −4。死亡セーヴの基本値 +1' },
  },
};
