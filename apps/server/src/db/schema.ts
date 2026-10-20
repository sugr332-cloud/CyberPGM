import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

export const items = sqliteTable('items', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  name_en: text('name_en').notNull(),
  name_ja: text('name_ja'),
  name_ja_override: text('name_ja_override'),
  summary_ja: text('summary_ja'),
  description_en: text('description_en'),
  price_eb: integer('price_eb'),
  price_category: text('price_category'),
  source_book: text('source_book'),
  source_page_en: integer('source_page_en'),
  source_page_ja: integer('source_page_ja'),
  origin: text('origin').notNull(),
  verify_status: text('verify_status').notNull(),
  fvtt_id: text('fvtt_id').unique(),
  fvtt_type: text('fvtt_type'),
  raw_system: text('raw_system'),
  tags: text('tags').notNull().default('[]'),
  notes: text('notes'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});

export const weapons = sqliteTable('weapons', {
  item_id: text('item_id')
    .primaryKey()
    .references(() => items.id, { onDelete: 'cascade' }),
  weapon_type: text('weapon_type'),
  skill: text('skill'),
  damage: text('damage'),
  rof: integer('rof'),
  magazine_max: integer('magazine_max'),
  hands: integer('hands'),
  concealable: integer('concealable', { mode: 'boolean' }),
  quality: text('quality'),
  autofire: integer('autofire'),
  crit_fail_effect: text('crit_fail_effect'),
  dv_table_key: text('dv_table_key'),
  ammo_types: text('ammo_types'),
  is_ranged: integer('is_ranged', { mode: 'boolean' }),
});

export const armors = sqliteTable('armors', {
  item_id: text('item_id')
    .primaryKey()
    .references(() => items.id, { onDelete: 'cascade' }),
  sp_head: integer('sp_head'),
  sp_body: integer('sp_body'),
  is_head: integer('is_head', { mode: 'boolean' }),
  is_body: integer('is_body', { mode: 'boolean' }),
  is_shield: integer('is_shield', { mode: 'boolean' }),
  shield_hp: integer('shield_hp'),
  penalty: integer('penalty'),
});

export const cyberwares = sqliteTable('cyberwares', {
  item_id: text('item_id')
    .primaryKey()
    .references(() => items.id, { onDelete: 'cascade' }),
  cw_type: text('cw_type'),
  install_location: text('install_location'),
  humanity_loss_roll: text('humanity_loss_roll'),
  humanity_loss_static: integer('humanity_loss_static'),
  is_core: integer('is_core', { mode: 'boolean' }),
  slot_size: integer('slot_size'),
});

export const images = sqliteTable('images', {
  id: text('id').primaryKey(),
  item_id: text('item_id').references(() => items.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  origin: text('origin').notNull(),
  license: text('license'),
  attribution: text('attribution'),
  source_book: text('source_book'),
  source_page: integer('source_page'),
  visibility: text('visibility').notNull().default('gm'),
  is_primary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
});

export const rule_constants = sqliteTable('rule_constants', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  source_page_ja: integer('source_page_ja'),
  note: text('note'),
});

export const import_runs = sqliteTable('import_runs', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  source_commit: text('source_commit'),
  started_at: integer('started_at').notNull(),
  finished_at: integer('finished_at'),
  report: text('report'),
});

// Relations
export const itemsRelations = relations(items, ({ one, many }) => ({
  weapon: one(weapons, {
    fields: [items.id],
    references: [weapons.item_id],
  }),
  armor: one(armors, {
    fields: [items.id],
    references: [armors.item_id],
  }),
  cyberware: one(cyberwares, {
    fields: [items.id],
    references: [cyberwares.item_id],
  }),
  images: many(images),
}));

export const weaponsRelations = relations(weapons, ({ one }) => ({
  item: one(items, {
    fields: [weapons.item_id],
    references: [items.id],
  }),
}));

export const armorsRelations = relations(armors, ({ one }) => ({
  item: one(items, {
    fields: [armors.item_id],
    references: [items.id],
  }),
}));

export const cyberwaresRelations = relations(cyberwares, ({ one }) => ({
  item: one(items, {
    fields: [cyberwares.item_id],
    references: [items.id],
  }),
}));

export const imagesRelations = relations(images, ({ one }) => ({
  item: one(items, {
    fields: [images.item_id],
    references: [items.id],
  }),
}));
