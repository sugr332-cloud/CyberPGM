import { describe, it, expect } from 'vitest';
import {
  formatWeaponType,
  formatAmmoVariety,
  formatAmmoTypes,
  formatWeaponMagazineAndAmmo,
  WEAPON_TYPES,
  AMMO_VARIETIES,
} from '../src/weapons.js';

describe('weapons localization helpers', () => {
  it('formats weapon_type into Japanese', () => {
    expect(formatWeaponType('heavyPistol')).toBe('大型拳銃');
    expect(formatWeaponType('assaultRifle')).toBe('アサルト・ライフル');
    expect(formatWeaponType('heavyMelee')).toBe('大型近接武器');
    expect(formatWeaponType(null)).toBe('—');
    expect(formatWeaponType('unknownType')).toBe('unknownType');
  });

  it('formats ammo variety into Japanese weapon-detail label', () => {
    expect(formatAmmoVariety('heavyPistol')).toBe('大型拳銃用');
    expect(formatAmmoVariety('shotgunShell')).toBe('散弾用');
    expect(formatAmmoVariety('shotgunSlug')).toBe('スラッグ弾用');
  });

  it('formats ammo_types JSON array string', () => {
    expect(formatAmmoTypes('["heavyPistol"]')).toBe('大型拳銃用');
    expect(formatAmmoTypes('["shotgunShell","shotgunSlug"]')).toBe('散弾用 / スラッグ弾用');
    expect(formatAmmoTypes('[]')).toBe('—');
    expect(formatAmmoTypes(null)).toBe('—');
    expect(formatAmmoTypes('invalid json')).toBe('—');
  });

  it('formats magazine count and ammo types together', () => {
    expect(formatWeaponMagazineAndAmmo(8, '["heavyPistol"]')).toBe('8発 (弾薬: 大型拳銃用)');
    expect(formatWeaponMagazineAndAmmo(null, '["heavyPistol"]')).toBe('弾薬: 大型拳銃用');
    expect(formatWeaponMagazineAndAmmo(0, '[]')).toBe('—');
    expect(formatWeaponMagazineAndAmmo(null, null)).toBe('—');
    expect(formatWeaponMagazineAndAmmo(30, '[]')).toBe('30発');
  });

  it('flags provisional entries properly', () => {
    expect(WEAPON_TYPES['heavyMelee'].provisional).toBe(true);
    expect(WEAPON_TYPES['heavyPistol'].provisional).toBe(false);
    expect(AMMO_VARIETIES['custom'].provisional).toBe(true);
    expect(AMMO_VARIETIES['rifle'].provisional).toBe(false);
  });
});
