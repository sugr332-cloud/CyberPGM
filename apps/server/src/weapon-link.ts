import { eq } from 'drizzle-orm';
import { generateUlid } from '@cyberpgm/shared';
import { db } from './db/client.js';
import { characters, items, weapons } from './db/schema.js';
import { WEAPON_NAME_ALIASES } from './services/combat-resolver.js';

function findWeaponItem(name: string) {
  const alias = WEAPON_NAME_ALIASES[name];
  const it =
    db.select().from(items).where(eq(items.name_ja, name)).get() ||
    db.select().from(items).where(eq(items.name_ja_override, name)).get() ||
    db.select().from(items).where(eq(items.name_en, name)).get() ||
    (alias ? db.select().from(items).where(eq(items.name_ja, alias)).get() : undefined) ||
    (alias ? db.select().from(items).where(eq(items.name_en, alias)).get() : undefined);
  if (!it) return null;
  const w = db.select().from(weapons).where(eq(weapons.item_id, it.id)).get();
  return w ? { item: it, weapon: w } : null;
}

/**
 * 文字だけで書かれた武器（characters.weapons。デモの PC など）を、品目に結び付けて持ち物に移す（Phase 5j）。
 * 戦闘で選べる武器は持ち物の武器だけなので。品目が見つからない名前は文字のまま残す。
 * 戻り値: 持ち物に足した武器の数
 */
export function linkTextWeapons(): number {
  let moved = 0;
  for (const row of db.select().from(characters).all()) {
    const names = (JSON.parse(row.weapons || '[]') as unknown[]).filter((w): w is string => typeof w === 'string');
    if (names.length === 0) continue;

    const inventory = JSON.parse(row.inventory || '[]') as Array<Record<string, unknown>>;
    const rest: string[] = [];
    for (const name of names) {
      const found = findWeaponItem(name);
      if (!found) {
        rest.push(name);
        continue;
      }
      // 同じ武器がもう持ち物にあれば、文字のほうを消すだけ（二重にしない）
      if (inventory.some((i) => i.item_id === found.item.id)) continue;
      inventory.push({
        entry_id: generateUlid(),
        item_id: found.item.id,
        name: found.item.name_ja_override || found.item.name_ja || found.item.name_en,
        kind: 'weapon',
        qty: 1,
        equipped: true,
        ...(found.weapon.magazine_max != null ? { ammo: found.weapon.magazine_max } : {}),
      });
      moved++;
    }
    if (rest.length === names.length) continue;
    db.update(characters)
      .set({ inventory: JSON.stringify(inventory), weapons: JSON.stringify(rest), updated_at: Date.now() })
      .where(eq(characters.id, row.id))
      .run();
  }
  return moved;
}
