/**
 * ロール特技を判定と戦闘で使う（Phase 5x。日本語版コアルールブック p.142〜165）
 */
import type { CharacterExtra } from './types.js';
import { ROLES } from './roles.js';

/** 作成時のランク（p.142） */
export const STARTING_ROLE_RANK = 4;

export interface RoleExtra {
  /** ロールごとのロール特技のランク。転職（マルチクラス）したら複数（p.143） */
  role_ranks?: Record<string, number>;
  /** ソロ《コンバット・アウェアネス》の割り振り */
  solo_alloc?: Partial<Record<SoloAbility, number>>;
  /** テク《メイカー》の専門分野のランク */
  maker?: Partial<Record<MakerSpecialty, number>>;
  /** メドテク《メディシン》の割り当て */
  medicine?: { surgery?: number; pharma?: number; cryo?: number; pharma_known?: string[] };
  /** エグゼクのチーム・メンバー */
  exec_team?: Array<{ character_id: string; job: string; loyalty: number }>;
}

export function roleKeyOf(role: string): string {
  return ROLES.find((r) => r.key.toLowerCase() === role.toLowerCase() || r.nameJa === role)?.key ?? role;
}

/** ロール特技のランク。記録がなければ、主のロールは作成時のランク 4 */
export function roleRank(role: string, extra: CharacterExtra | undefined | null, which?: string): number {
  const ranks = ((extra ?? {}) as RoleExtra).role_ranks ?? {};
  const key = roleKeyOf(which ?? role);
  if (typeof ranks[key] === 'number') return ranks[key];
  return key === roleKeyOf(role) ? STARTING_ROLE_RANK : 0;
}

// ── ソロ《コンバット・アウェアネス》（p.146） ──
export type SoloAbility = 'damage_reduction' | 'fumble_immunity' | 'initiative' | 'precision' | 'spot_weakness' | 'threat_detection';
export const SOLO_ABILITIES: Array<{ key: SoloAbility; name: string; step: number; max: number; effect: (pts: number) => string }> = [
  { key: 'damage_reduction', name: 'ダメージ軽減', step: 2, max: 10, effect: (p) => `各ラウンドで最初に受けるダメージ −${Math.floor(p / 2)}` },
  { key: 'fumble_immunity', name: '決定的失敗無効', step: 4, max: 4, effect: (p) => (p >= 4 ? '自分の攻撃で決定的失敗が起きない（出目 1 は 1 のまま）' : '—') },
  { key: 'initiative', name: 'イニシアチブ強化', step: 1, max: 10, effect: (p) => `イニシアチブ +${p}` },
  { key: 'precision', name: '精密攻撃', step: 3, max: 9, effect: (p) => `攻撃判定 +${Math.floor(p / 3)}` },
  { key: 'spot_weakness', name: '弱点看破', step: 1, max: 10, effect: (p) => `各ラウンドで最初に当てた攻撃のダメージ +${p}（防具を引く前）` },
  { key: 'threat_detection', name: '危険感知', step: 1, max: 10, effect: (p) => `〈知覚〉判定 +${p}` },
];

export interface SoloEffects {
  damageReduction: number;
  fumbleImmune: boolean;
  initiative: number;
  precision: number;
  spotWeakness: number;
  threatDetection: number;
}

export function soloEffects(role: string, extra: CharacterExtra | undefined | null): SoloEffects {
  const a = ((extra ?? {}) as RoleExtra).solo_alloc ?? {};
  const has = roleRank(role, extra, 'Solo') > 0;
  const v = (k: SoloAbility) => (has ? Math.max(0, a[k] ?? 0) : 0);
  return {
    damageReduction: Math.floor(v('damage_reduction') / 2),
    fumbleImmune: v('fumble_immunity') >= 4,
    initiative: v('initiative'),
    precision: Math.floor(v('precision') / 3),
    spotWeakness: v('spot_weakness'),
    threatDetection: v('threat_detection'),
  };
}

/** 割り振りが《コンバット・アウェアネス》のランクを超えていないか */
export function soloAllocError(rank: number, alloc: Partial<Record<SoloAbility, number>>): string | null {
  const total = Object.values(alloc).reduce((s: number, n) => s + (n ?? 0), 0);
  if (total > rank) return `割り振りの合計 ${total} が《コンバット・アウェアネス》のランク ${rank} を超えています`;
  for (const ab of SOLO_ABILITIES) {
    const n = alloc[ab.key] ?? 0;
    if (n % ab.step !== 0) return `${ab.name} は ${ab.step} ポイント単位です`;
    if (n > ab.max) return `${ab.name} は最大 ${ab.max} ポイントです`;
  }
  return null;
}

// ── テク《メイカー》（p.147〜149） ──
export type MakerSpecialty = 'field' | 'upgrade' | 'fabrication' | 'invention';
export const MAKER_SPECIALTIES: Record<MakerSpecialty, string> = { field: '現場エンジニア', upgrade: '改造エンジニア', fabrication: '作成エンジニア', invention: '発明エンジニア' };
/** 現場エンジニアのランクを足す技術系技能 */
export const FIELD_EXPERTISE_SKILLS = ['sea_vehicle_tech', 'basic_tech', 'air_vehicle_tech', 'cybertech', 'electronics_security_tech', 'land_vehicle_tech', 'weaponstech'];

/** 価格等級ごとの改造・作成・発明・修理の難易度と時間（p.149。修理も同じ表を使う。p.136） */
export const CRAFT_TABLE: Array<{ key: string; name: string; dv: number; time: string }> = [
  { key: 'cheap', name: '安物／日用', dv: 9, time: '1 時間' },
  { key: 'costly', name: '程々', dv: 13, time: '6 時間' },
  { key: 'premium', name: '上等', dv: 17, time: '1 日' },
  { key: 'expensive', name: '高級', dv: 21, time: '1 週間' },
  { key: 'very_expensive', name: '超高級', dv: 24, time: '2 週間' },
  { key: 'luxury', name: '極上', dv: 29, time: '1 月' },
  { key: 'super_luxury', name: '超極上', dv: 29, time: '10,000eb ごとに 1 月' },
];

// ── ノーマッド《モト》（p.161） ──
export const MOTO_SKILLS = ['drive_land_vehicle', 'land_vehicle_tech', 'pilot_air_vehicle', 'air_vehicle_tech', 'pilot_sea_vehicle', 'sea_vehicle_tech'];

/**
 * ロール特技が技能に足す値（判定のとき）。ソロの危険感知、テクの現場エンジニア、ノーマッドのモト
 */
export function roleSkillBonuses(role: string, extra: CharacterExtra | undefined | null): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (k: string, n: number) => n > 0 && (out[k] = (out[k] ?? 0) + n);
  add('perception', soloEffects(role, extra).threatDetection);
  if (roleRank(role, extra, 'Tech') > 0) {
    const field = ((extra ?? {}) as RoleExtra).maker?.field ?? 0;
    for (const k of FIELD_EXPERTISE_SKILLS) add(k, field);
  }
  const moto = roleRank(role, extra, 'Nomad');
  for (const k of MOTO_SKILLS) add(k, moto);
  return out;
}

// ── メドテク《メディシン》（p.149〜150） ──
/** 割り当てから〈外科手術〉と〈医療技術〉のレベル（外科手術は 1 ポイント 2 レベル、最大 10） */
export function medicineSkills(m: RoleExtra['medicine'] | undefined): { surgery: number; medical_tech: number } {
  return { surgery: Math.min(10, 2 * (m?.surgery ?? 0)), medical_tech: Math.min(10, (m?.pharma ?? 0) + (m?.cryo ?? 0)) };
}
export const CRYO_BENEFITS = ['クリオポンプ 1 台', '公認クリオタンク技師の資格', 'クリオタンク 1 台（選んだ部屋に）', 'クリオタンク +2 台、クリオポンプのチャージ 2', 'クリオタンク +3 台、クリオポンプのチャージ 3'];

// ── メディア《クレディビリティ》（p.151〜152） ──
export const RUMORS = [
  { name: 'あいまいな噂', passive: 7, active: 13 },
  { name: 'ありがちな噂', passive: 9, active: 15 },
  { name: '信頼できる噂', passive: 11, active: 17 },
  { name: '確証的な噂', passive: 13, active: 21 },
];
/** 報道を信じてもらえる確率（10 分の いくつ） */
export function credibilityChance(rank: number): number {
  return rank >= 10 ? 7 : rank >= 9 ? 6 : rank >= 7 ? 5 : rank >= 5 ? 4 : rank >= 3 ? 3 : 2;
}

// ── ロッカーボーイ《カリズマティック・インパクト》（p.144） ──
export const IMPACT_DV = { one: 8, small: 10, large: 12 };

// ── エグゼク《チームワーク》（p.153〜154） ──
export const LOYALTY_CHANGES: Array<{ label: string; delta: number }> = [
  { label: '働きぶりを褒める（同じ週に何度もは上がらない）', delta: 1 },
  { label: '200eb 以上のボーナス・特典', delta: 4 },
  { label: '経営陣からかばう', delta: 4 },
  { label: '報酬の 20% を分ける', delta: 6 },
  { label: '有給休暇（1 セッション休ませる）', delta: 6 },
  { label: '身を危険に晒して守る', delta: 8 },
  { label: '1 セッション上がらなかった', delta: -1 },
  { label: '叱責・非難する', delta: -2 },
  { label: '貢献を無視する・誕生日を忘れる', delta: -4 },
  { label: '約束のボーナスを反故にする', delta: -6 },
  { label: '経営陣から見捨てる', delta: -6 },
  { label: '戦闘中に見捨てる', delta: -8 },
];
/** チーム・メンバーの数（ランク 3 で 1、5 で 2、9 で 3） */
export function execTeamSize(rank: number): number {
  return rank >= 9 ? 3 : rank >= 5 ? 2 : rank >= 3 ? 1 : 0;
}

// ── ローマン《バックアップ》（p.158） ──
export function backupTier(rank: number): string {
  return rank >= 10 ? '10' : rank >= 9 ? '9' : rank >= 8 ? '8' : rank >= 5 ? '5〜7' : rank >= 3 ? '3〜4' : '1〜2';
}
export const BACKUP_TIERS = ['1〜2', '3〜4', '5〜7', '8', '9', '10'];
