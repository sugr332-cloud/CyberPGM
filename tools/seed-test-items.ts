import { createDb } from '../apps/server/src/db/client.js';
import { items, weapons, armors, cyberwares, images } from '../apps/server/src/db/schema.js';
import { eq } from 'drizzle-orm';

const { db } = createDb('data/test-e2e.db');
const now = Date.now();

// 0. Image for Heavy Pistol
const imageId = 'img-test-pistol-01';
const existingImg = db.select().from(images).where(eq(images.id, imageId)).get();
if (!existingImg) {
  db.insert(images).values({
    id: imageId,
    item_id: 'heavy-pistol-catalog-01',
    path: 'fvtt/compendium/weapons/test_pistol.svg',
    origin: 'fvtt_icon',
    visibility: 'players',
    created_at: now,
  }).run();
}

// 1. Heavy Pistol
const existingPistol = db.select().from(items).where(eq(items.name_en, 'Heavy Pistol')).get();
if (existingPistol) {
  db.update(items)
    .set({ fvtt_id: 'Y433cjlB1uVHPysk', image_id: imageId })
    .where(eq(items.name_en, 'Heavy Pistol'))
    .run();
} else {
  const id = 'heavy-pistol-catalog-01';
  db.insert(items).values({
    id,
    kind: 'weapon',
    name_en: 'Heavy Pistol',
    name_ja: '大型拳銃',
    fvtt_id: 'Y433cjlB1uVHPysk',
    image_id: imageId,
    price_eb: 100,
    price_category: 'everyday',
    origin: 'official_verified',
    verify_status: 'official_verified',
    created_at: now,
    updated_at: now,
  }).run();
  db.insert(weapons).values({
    item_id: id,
    weapon_type: 'heavyPistol',
    skill: 'handgun',
    damage: '3d6',
    rof: 2,
    magazine_max: 8,
    hands: 1,
    concealable: true,
    quality: 'standard',
    autofire: 0,
    dv_table_key: 'dv_pistol',
    ammo_types: JSON.stringify(['heavyPistol']),
    is_ranged: true,
  }).run();
}

// 1b. Assault Rifle
const existingRifle = db.select().from(items).where(eq(items.name_en, 'Assault Rifle')).get();
if (!existingRifle) {
  const id = 'assault-rifle-catalog-01';
  db.insert(items).values({
    id,
    kind: 'weapon',
    name_en: 'Assault Rifle',
    name_ja: 'アサルト・ライフル',
    price_eb: 500,
    price_category: 'expensive',
    origin: 'official_verified',
    verify_status: 'official_verified',
    created_at: now,
    updated_at: now,
  }).run();
  db.insert(weapons).values({
    item_id: id,
    weapon_type: 'assaultRifle',
    skill: 'shoulder_arms',
    damage: '5d6',
    rof: 1,
    magazine_max: 25,
    hands: 2,
    concealable: false,
    quality: 'standard',
    autofire: 4,
    dv_table_key: 'dv_rifle',
    ammo_types: JSON.stringify(['rifle']),
    is_ranged: true,
  }).run();
}

// 2. Kevlar Armor
const existingArmor = db.select().from(items).where(eq(items.name_en, 'Kevlar Vest')).get();
if (!existingArmor) {
  const id = 'kevlar-vest-catalog-01';
  db.insert(items).values({
    id,
    kind: 'armor',
    name_en: 'Kevlar Vest',
    name_ja: 'ケブラー・ベスト',
    price_eb: 100,
    price_category: 'everyday',
    origin: 'official_verified',
    verify_status: 'official_verified',
    created_at: now,
    updated_at: now,
  }).run();
  db.insert(armors).values({
    item_id: id,
    sp_head: 0,
    sp_body: 7,
    is_head: false,
    is_body: true,
    is_shield: false,
    shield_hp: 0,
    penalty: 0,
  }).run();
}

// 3. Borgware
const existingBorg = db.select().from(items).where(eq(items.name_en, 'Linear Frame Beta')).get();
if (!existingBorg) {
  const id = 'borgware-catalog-01';
  db.insert(items).values({
    id,
    kind: 'cyberware',
    name_en: 'Linear Frame Beta',
    name_ja: 'リニア・フレーム・ベータ',
    price_eb: 1000,
    price_category: 'luxury',
    origin: 'official_verified',
    verify_status: 'official_verified',
    created_at: now,
    updated_at: now,
  }).run();
  db.insert(cyberwares).values({
    item_id: id,
    cw_type: 'borgware',
    install_location: 'body',
    humanity_loss_roll: '4d6',
    humanity_loss_static: 14,
    slots: 1,
    requires: JSON.stringify([]),
  }).run();
}

// 4. CyberEye
const existingEye = db.select().from(items).where(eq(items.name_en, 'Cybereye')).get();
if (!existingEye) {
  const id = 'cybereye-catalog-01';
  db.insert(items).values({
    id,
    kind: 'cyberware',
    name_en: 'Cybereye',
    name_ja: 'サイバーアイ',
    price_eb: 500,
    price_category: 'expensive',
    origin: 'official_verified',
    verify_status: 'official_verified',
    created_at: now,
    updated_at: now,
  }).run();
  db.insert(cyberwares).values({
    item_id: id,
    cw_type: 'cyberEye',
    install_location: 'head',
    humanity_loss_roll: '2d6',
    humanity_loss_static: 7,
    slots: 1,
    requires: JSON.stringify([]),
  }).run();
}

// 5. Upgrade category items (51 items for shop catalog test)
const currentUpgrades = db.select().from(items).where(eq(items.kind, 'upgrade')).all();
const neededUpgrades = 51 - currentUpgrades.length;
for (let i = 0; i < neededUpgrades; i++) {
  const id = `upgrade-catalog-${String(i + 1).padStart(2, '0')}`;
  db.insert(items).values({
    id,
    kind: 'upgrade',
    name_en: `Weapon Upgrade ${i + 1}`,
    name_ja: `武器アップグレード ${i + 1}`,
    price_eb: 100,
    price_category: 'everyday',
    origin: 'official_verified',
    verify_status: 'official_verified',
    created_at: now,
    updated_at: now,
  }).run();
}

// 6. Clean up test_ fixtures dummy fvtt_id that are not in item-notes.ja.json
db.update(items)
  .set({ fvtt_id: null })
  .where(eq(items.fvtt_id, 'test_pistol'))
  .run();
db.update(items)
  .set({ fvtt_id: null })
  .where(eq(items.fvtt_id, 'test_melee'))
  .run();
db.update(items)
  .set({ fvtt_id: null })
  .where(eq(items.fvtt_id, 'test_eye'))
  .run();
db.update(items)
  .set({ fvtt_id: null })
  .where(eq(items.fvtt_id, 'test_vest'))
  .run();

console.log('Seed catalog items completed.');
