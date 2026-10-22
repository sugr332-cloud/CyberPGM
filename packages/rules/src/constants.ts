export interface RuleConstants {
  tieRule: 'fail' | 'success'; // 難易度と同値のとき（Issue #1）既定 'fail'
  opposedTieWinner: 'defender' | 'attacker'; // 対抗判定の同値（Issue #1）既定 'defender'
  rangedDodgeMinRef: number; // 射撃を回避できる REF（Issue #2）既定 8
  aimedShotPenalty: number; // 既定 -8（確認済み）
  critBonusDamage: number; // 既定 5（確認済み）
  critSixesNeeded: number; // 既定 2（確認済み）
  seriousWoundPenalty: number; // 既定 -2（確認済み）
  mortalWoundPenalty: number; // 既定 -4（確認済み）
  defaultAblation: number; // 既定 1（確認済み）
  metersPerSquare: number; // 既定 2
  diagonalRule: 'chebyshev' | 'alternate'; // 斜め移動（Issue #10）既定 'chebyshev'
  initiativeCrit: boolean; // 既定 true（FVTT の既定）
  humanityPerCyberware: number; // 既定 2（確認済み）
  humanityPerBorgware: number; // 既定 4（確認済み）
}

export const DEFAULT_RULES: RuleConstants = {
  tieRule: 'fail',
  opposedTieWinner: 'defender',
  rangedDodgeMinRef: 8,
  aimedShotPenalty: -8,
  critBonusDamage: 5,
  critSixesNeeded: 2,
  seriousWoundPenalty: -2,
  mortalWoundPenalty: -4,
  defaultAblation: 1,
  metersPerSquare: 2,
  diagonalRule: 'chebyshev',
  initiativeCrit: true,
  humanityPerCyberware: 2,
  humanityPerBorgware: 4,
};
