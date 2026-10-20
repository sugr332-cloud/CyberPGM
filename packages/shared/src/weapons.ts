/**
 * Weapon and Ammo localization & display helpers.
 *
 * Sourced from FVTT ja-JP / babele where available, marked provisional when temporary.
 * Ref: Issue #11, Phase 3a review rollover (docs/agy/phase3b-character.md §9)
 */

export interface WeaponTypeMeta {
  key: string;
  nameJa: string;
  provisional?: boolean;
}

export const WEAPON_TYPES: Record<string, WeaponTypeMeta> = {
  assaultRifle: { key: 'assaultRifle', nameJa: 'アサルト・ライフル', provisional: false },
  bow: { key: 'bow', nameJa: '弓とクロスボウ', provisional: false },
  grenadeLauncher: { key: 'grenadeLauncher', nameJa: 'グレネード・ランチャー', provisional: false },
  heavyMelee: { key: 'heavyMelee', nameJa: '大型近接武器', provisional: true },
  heavyPistol: { key: 'heavyPistol', nameJa: '大型拳銃', provisional: false },
  heavySmg: { key: 'heavySmg', nameJa: '大型SMG', provisional: false },
  lightMelee: { key: 'lightMelee', nameJa: '小型近接武器', provisional: true },
  martialArts: { key: 'martialArts', nameJa: '武術', provisional: false },
  medMelee: { key: 'medMelee', nameJa: '中型近接武器', provisional: true },
  medPistol: { key: 'medPistol', nameJa: '中型拳銃', provisional: false },
  rocketLauncher: { key: 'rocketLauncher', nameJa: 'ロケット・ランチャー', provisional: false },
  shotgun: { key: 'shotgun', nameJa: 'ショットガン', provisional: false },
  smg: { key: 'smg', nameJa: 'SMG', provisional: false },
  sniperRifle: { key: 'sniperRifle', nameJa: 'スナイパー・ライフル', provisional: false },
  thrownWeapon: { key: 'thrownWeapon', nameJa: '投擲武器', provisional: true },
  unarmed: { key: 'unarmed', nameJa: '素手', provisional: false },
  vHeavyMelee: { key: 'vHeavyMelee', nameJa: '超大型近接武器', provisional: true },
  vHeavyPistol: { key: 'vHeavyPistol', nameJa: '超大型拳銃', provisional: false },
};

export interface AmmoVarietyMeta {
  key: string;
  nameJa: string;
  displayForWeapon: string;
  provisional?: boolean;
}

export const AMMO_VARIETIES: Record<string, AmmoVarietyMeta> = {
  arrow: { key: 'arrow', nameJa: '矢', displayForWeapon: '矢用', provisional: false },
  battery: { key: 'battery', nameJa: 'バッテリー', displayForWeapon: 'バッテリー用', provisional: false },
  custom: { key: 'custom', nameJa: 'カスタム弾', displayForWeapon: 'カスタム弾用', provisional: true },
  grenade: { key: 'grenade', nameJa: 'グレネード', displayForWeapon: 'グレネード用', provisional: false },
  heavyPistol: { key: 'heavyPistol', nameJa: '大型拳銃弾', displayForWeapon: '大型拳銃用', provisional: false },
  medPistol: { key: 'medPistol', nameJa: '中型拳銃弾', displayForWeapon: '中型拳銃用', provisional: false },
  paintball: { key: 'paintball', nameJa: 'ペイントボール', displayForWeapon: 'ペイントボール用', provisional: false },
  rifle: { key: 'rifle', nameJa: 'ライフル弾', displayForWeapon: 'ライフル用', provisional: false },
  rocket: { key: 'rocket', nameJa: 'ロケット', displayForWeapon: 'ロケット用', provisional: false },
  shotgunShell: { key: 'shotgunShell', nameJa: 'ショットガンの散弾', displayForWeapon: '散弾用', provisional: false },
  shotgunSlug: { key: 'shotgunSlug', nameJa: 'ショットガンのスラッグ弾', displayForWeapon: 'スラッグ弾用', provisional: false },
  vHeavyPistol: { key: 'vHeavyPistol', nameJa: '超大型拳銃弾', displayForWeapon: '超大型拳銃用', provisional: false },
};

/**
 * Format weapon_type internal key to Japanese name.
 */
export function formatWeaponType(type: string | null | undefined): string {
  if (!type) return '—';
  return WEAPON_TYPES[type]?.nameJa ?? type;
}

/**
 * Format ammo variety key to weapon-detail representation (e.g. "大型拳銃用").
 */
export function formatAmmoVariety(key: string): string {
  const meta = AMMO_VARIETIES[key];
  if (!meta) return key;
  return meta.displayForWeapon || meta.nameJa;
}

/**
 * Parse JSON array string of ammo_types safely.
 */
export function parseAmmoTypes(ammoTypesJson: string | null | undefined): string[] {
  if (!ammoTypesJson) return [];
  try {
    const parsed = JSON.parse(ammoTypesJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Format ammo_types JSON array string to joined Japanese text (e.g. "大型拳銃用" or "散弾用 / スラッグ弾用").
 */
export function formatAmmoTypes(ammoTypesJson: string | null | undefined): string {
  const list = parseAmmoTypes(ammoTypesJson);
  if (list.length === 0) return '—';
  return list.map(formatAmmoVariety).join(' / ');
}

/**
 * Format magazine max and ammo types for detail panel.
 * Examples:
 * - 8, '["heavyPistol"]' -> "8発 (弾薬: 大型拳銃用)"
 * - null, '["heavyPistol"]' -> "弾薬: 大型拳銃用"
 * - 0, '[]' -> "—"
 */
export function formatWeaponMagazineAndAmmo(
  magazineMax: number | null | undefined,
  ammoTypesJson: string | null | undefined,
): string {
  const ammoList = parseAmmoTypes(ammoTypesJson);
  const hasAmmo = ammoList.length > 0;
  const hasMag = typeof magazineMax === 'number' && magazineMax > 0;

  if (hasMag && hasAmmo) {
    return `${magazineMax}発 (弾薬: ${formatAmmoTypes(ammoTypesJson)})`;
  }
  if (hasMag && !hasAmmo) {
    return `${magazineMax}発`;
  }
  if (!hasMag && hasAmmo) {
    return `弾薬: ${formatAmmoTypes(ammoTypesJson)}`;
  }
  return '—';
}
