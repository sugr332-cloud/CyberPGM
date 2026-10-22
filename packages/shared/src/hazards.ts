/**
 * 環境ダメージ（Phase 5v。日本語版コアルールブック p.180〜181）
 */
export type HazardKey = 'fire' | 'radiation' | 'electric' | 'drown' | 'vacuum' | 'fall' | 'poison' | 'drug' | 'weather';
export type HazardLevel = 'small' | 'medium' | 'large';

export const HAZARD_LEVEL_LABEL: Record<HazardLevel, string> = { small: '小', medium: '中', large: '大' };

export interface HazardDef {
  key: HazardKey;
  name: string;
  /** 危険度を選ぶか */
  leveled: boolean;
  desc: string;
}

export const HAZARDS: HazardDef[] = [
  { key: 'fire', name: '着火', leveled: true, desc: '自分のターンの終わりごとに HP に直接 小 2・中 4・大 6（防具を損耗させない）。アクション 1 回で消すまで続く。いちばん高い危険度だけ' },
  { key: 'radiation', name: '放射線', leveled: true, desc: '高線量の区域にいるあいだ、小（区域）か大（原子炉など）の着火と同じ。区域にいるあいだは消せない' },
  { key: 'electric', name: '感電', leveled: false, desc: 'すぐに 6d6（防具で減るが損耗しない）。離れるまで自分のターンの終わりごとに同じ' },
  { key: 'drown', name: '溺れ・窒息', leveled: false, desc: '息を止められるのは【体格】分。それを超えたら自分のターンの始めごとに【体格】ぶんを HP に直接' },
  { key: 'vacuum', name: '真空（宇宙空間）', leveled: false, desc: '窒息に加えて、自分のターンの終わりごとに【知力】【反応】【敏捷】が 1d6 ずつ減る。【知力】が 0 で死亡。空気を吸えば戻る' },
  { key: 'fall', name: '落下', leveled: false, desc: '10m 以上なら 10m ごとに 2d6（防具で減る）と、〈運動〉難易度 15 に失敗で「片脚損傷」。サイバーレッグ 2 本なら 30m までは無傷' },
  { key: 'poison', name: '毒', leveled: true, desc: '〈拷問／薬物抵抗〉で 小 11・中 13・大 15 を上回らないと、HP に直接 小 1d6・中 2d6・大 3d6' },
  { key: 'drug', name: '薬物を盛られる', leveled: true, desc: '〈拷問／薬物抵抗〉で 小 11・中 13・大 15 を上回らないと、小 酩酊・中 被暗示性・大 作成者の意図した効果' },
  { key: 'weather', name: '過酷な気候', leveled: false, desc: '1 日の終わりごとに HP に直接 1d6。そのあいだは自然治癒しない（適した装備があれば受けない）' },
];

export const FIRE_DAMAGE: Record<HazardLevel, number> = { small: 2, medium: 4, large: 6 };
export const RESIST_DV: Record<HazardLevel, number> = { small: 11, medium: 13, large: 15 };
export const POISON_DICE: Record<HazardLevel, number> = { small: 1, medium: 2, large: 3 };
export const DRUG_EFFECT: Record<HazardLevel, string> = { small: '酩酊', medium: '被暗示性', large: '薬物の効果' };

/** 続く環境の状態の名前（キャラの状態に付ける） */
export function hazardStatus(key: HazardKey, level?: HazardLevel | null): string | null {
  switch (key) {
    case 'fire':
      return `着火（${HAZARD_LEVEL_LABEL[level ?? 'small']}）`;
    case 'radiation':
      return `放射線（${HAZARD_LEVEL_LABEL[level === 'large' ? 'large' : 'small']}）`;
    case 'electric':
      return '感電';
    case 'drown':
      return '溺れ';
    case 'vacuum':
      return '真空';
    default:
      return null;
  }
}

/** 状態から、ターンの終わりの着火ダメージ（いちばん高いもの）を出す。放射線も着火として扱う */
export function burnDamage(status: string[]): number {
  let dmg = 0;
  for (const s of status) {
    const m = /^(着火|放射線)（(小|中|大)）$/.exec(s);
    if (m) dmg = Math.max(dmg, m[2] === '大' ? 6 : m[2] === '中' ? 4 : 2);
  }
  return dmg;
}

export const ONGOING_HAZARD_PREFIXES = ['着火（', '放射線（', '感電', '溺れ', '真空'];
export function isHazardStatus(s: string): boolean {
  return ONGOING_HAZARD_PREFIXES.some((p) => s.startsWith(p));
}
