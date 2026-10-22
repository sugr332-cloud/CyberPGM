export interface RoleMeta {
  key: string;
  nameEn: string;
  nameJa: string;
}

export const ROLES: RoleMeta[] = [
  { key: 'Solo', nameEn: 'Solo', nameJa: 'ソロ' },
  { key: 'Netrunner', nameEn: 'Netrunner', nameJa: 'ネットランナー' },
  { key: 'Tech', nameEn: 'Tech', nameJa: 'テク' },
  { key: 'Medtech', nameEn: 'Medtech', nameJa: 'メドテク' },
  { key: 'Media', nameEn: 'Media', nameJa: 'メディア' },
  { key: 'Exec', nameEn: 'Exec', nameJa: 'エグゼク' },
  { key: 'Lawman', nameEn: 'Lawman', nameJa: 'ローマン' },
  { key: 'Fixer', nameEn: 'Fixer', nameJa: 'フィクサー' },
  { key: 'Nomad', nameEn: 'Nomad', nameJa: 'ノーマッド' },
  { key: 'Rockerboy', nameEn: 'Rockerboy', nameJa: 'ロッカーボーイ' },
];

export function formatRole(role: string): string {
  const found = ROLES.find((r) => r.key.toLowerCase() === role.toLowerCase() || r.nameJa === role);
  return found ? found.nameJa : role;
}

/**
 * ロール特技の説明（Phase 5s）。日本語版コアルールブックの要約は手元の data/sources/core-ja/roles.json に置き、
 * リポジトリには含めない。サーバーは /api/role-info で返す（ファイルがなければ空）
 */
export interface RoleInfo {
  key: string;
  ability: string;
  page?: number;
  overview: string;
  rules: string[];
  ranks: Array<{ range: string; text: string }>;
}

/** 「3〜4」「9」「1〜10」のような範囲にランクが入るか */
export function rankInRange(range: string, rank: number): boolean {
  const m = /^(\d+)(?:[〜~\-](\d+))?$/.exec(range.trim());
  if (!m) return false;
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  return rank >= lo && rank <= hi;
}
