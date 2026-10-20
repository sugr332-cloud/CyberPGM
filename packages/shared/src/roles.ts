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
