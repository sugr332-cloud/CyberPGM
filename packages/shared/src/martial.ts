/**
 * 武術奥義（Phase 5u。日本語版コアルールブック p.178〜180）。
 * 判定は【敏捷】＋その流派の〈武術〉＋1d10。dv が null の奥義は相手の【敏捷】＋〈回避〉＋1d10 との対抗判定
 */
export type MartialTechniqueKey =
  | 'kip_up'
  | 'disarm'
  | 'iron_grip'
  | 'armor_break'
  | 'bone_break'
  | 'dodge_throw'
  | 'arm_counter'
  | 'pressure_point'
  | 'flying_kick';

export interface MartialTechnique {
  key: MartialTechniqueKey;
  name: string;
  /** 使える流派。共通奥義は null */
  style: string | null;
  dv: number | null;
  /** アクションを 1 回使うか */
  usesAction: boolean;
  /** 武術攻撃のダメージを与えるか（ダメージの出目が要る） */
  damage: boolean;
  /** 頭部を狙える（判定 −8） */
  canAimHead: boolean;
  /** 能力値の条件 */
  statReq?: { stat: 'will' | 'move'; min: number };
  /** GM が確かめる条件（自動では判定しない） */
  requirement: string;
  effect: string;
}

export const MARTIAL_TECHNIQUES: MartialTechnique[] = [
  { key: 'kip_up', name: '跳ね起き', style: null, dv: 13, usesAction: false, damage: false, canAimHead: false, requirement: '伏せ状態から立ち上がるとき', effect: '成功するとアクションを使わずに立ち上がる' },
  { key: 'disarm', name: '武器落とし', style: '合気道', dv: 15, usesAction: false, damage: false, canAimHead: false, requirement: 'このターン、〈格闘〉攻撃と武術攻撃が同じ相手に当たった（1 ターンに 1 回）', effect: '相手が手に持っている物を 1 つ奪うか落とさせる' },
  { key: 'iron_grip', name: '鋼のつかみ', style: '合気道', dv: 15, usesAction: true, damage: false, canAimHead: false, requirement: '相手をつかんでいる（1 ターンに 1 回）', effect: '相手がつかみから逃れる判定にさらに −2。つかみが終わるまで相手は遠隔攻撃できない' },
  { key: 'armor_break', name: '鎧砕き', style: '空手', dv: 15, usesAction: false, damage: false, canAimHead: false, requirement: 'このターン、〈近接武器〉攻撃と武術攻撃が同じ相手に当たった（1 ターンに 1 回）', effect: '相手の頭部と身体の防具がすべて 2 SP 減る' },
  { key: 'bone_break', name: '骨砕き', style: '空手', dv: null, usesAction: true, damage: true, canAimHead: true, statReq: { stat: 'will', min: 8 }, requirement: '武術攻撃 2 回の代わりに 1 回（間合いの相手）', effect: '武術攻撃のダメージに加えて致命的損傷「肋骨損傷」（頭部なら「頭蓋損傷」）' },
  { key: 'dodge_throw', name: 'かわし投げ', style: '柔道', dv: 15, usesAction: true, damage: false, canAimHead: false, requirement: '前の手番から受けた近接攻撃をすべて回避した（1 ターンに 1 回）', effect: 'その近接攻撃をした間合いの相手を投げる（回避不可。【体格】ぶんのダメージを HP に直接、伏せ状態）' },
  { key: 'arm_counter', name: '腕捕り返し', style: '柔道', dv: 15, usesAction: false, damage: false, canAimHead: false, requirement: '自分をつかんでいる相手に、このターン近接攻撃が 2 回当たった（1 ターンに 1 回）', effect: 'つかみが終わり、相手は致命的損傷「片腕損傷」' },
  { key: 'pressure_point', name: '点穴撃', style: 'テコンドー', dv: null, usesAction: true, damage: true, canAimHead: true, statReq: { stat: 'will', min: 8 }, requirement: '武術攻撃 2 回の代わりに 1 回（間合いの相手）', effect: '武術攻撃のダメージに加えて致命的損傷「脊椎損傷」（頭部なら「脳損傷」）' },
  { key: 'flying_kick', name: '跳び蹴り', style: 'テコンドー', dv: null, usesAction: true, damage: true, canAimHead: false, statReq: { stat: 'move', min: 8 }, requirement: 'このターンに 4m（2 マス）以上移動し、4m 以内の相手へ跳ぶ。このあと攻撃・移動はできない', effect: '武術攻撃のダメージを身体に与え、相手は伏せ状態（密閉されていない乗り物からは落ちる）' },
];

/** 武術攻撃のダメージ（【体格】で決まる。p.178） */
export function martialArtsDice(body: number): number {
  return body <= 4 ? 1 : body <= 6 ? 2 : body <= 10 ? 3 : 4;
}
