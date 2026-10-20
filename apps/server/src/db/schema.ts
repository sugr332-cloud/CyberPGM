import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
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
  suppressive: integer('suppressive', { mode: 'boolean' }),
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

export const characters = sqliteTable('characters', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull().default('pc'),
  name: text('name').notNull(),
  role: text('role').notNull(),
  image_id: text('image_id').references(() => images.id, { onDelete: 'set null' }),
  stats: text('stats').notNull(), // JSON: { int, ref, dex, tech, cool, will, luck, move, body, emp }
  skills: text('skills').notNull().default('{}'), // JSON: { [skillKey: string]: number }
  hp: integer('hp').notNull(),
  hp_max: integer('hp_max').notNull(),
  sp_head: integer('sp_head').notNull().default(0),
  sp_body: integer('sp_body').notNull().default(0),
  humanity: integer('humanity').notNull(),
  emp_max: integer('emp_max').notNull(),
  cyberware: text('cyberware').notNull().default('[]'), // JSON: [{ item_id, name, type, static_loss }]
  weapons: text('weapons').notNull().default('[]'), // JSON: string[] or item summary
  inventory: text('inventory').notNull().default('[]'), // JSON
  status: text('status').notNull().default('[]'), // JSON: string[]
  crit_injuries: text('crit_injuries').notNull().default('[]'), // JSON
  eb: integer('eb').notNull().default(0),
  notes_gm: text('notes_gm'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});

export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(),
  token_hash: text('token_hash').notNull().unique(),
  role: text('role').notNull(), // 'gm' | 'player'
  character_id: text('character_id').references(() => characters.id, { onDelete: 'set null' }),
  label: text('label'),
  last_seen_at: integer('last_seen_at').notNull(),
  revoked: integer('revoked', { mode: 'boolean' }).notNull().default(false),
});

export const money_log = sqliteTable('money_log', {
  id: text('id').primaryKey(),
  character_id: text('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
  reason: text('reason').notNull(),
  balance_after: integer('balance_after').notNull(),
  at: integer('at').notNull(),
});

export const char_log = sqliteTable('char_log', {
  id: text('id').primaryKey(),
  character_id: text('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  at: integer('at').notNull(),
});

export const saves = sqliteTable('saves', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('manual'), // 'manual' | 'auto'
  summary: text('summary'),
  file: text('file').notNull(), // relative path from data/saves/
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});

export const app_settings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(), // JSON
});

export const shops = sqliteTable('shops', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  price_multiplier: real('price_multiplier').notNull().default(1.0),
  buyback_rate: real('buyback_rate').notNull().default(0.5),
  categories: text('categories').notNull().default('[]'), // JSON: string[]
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});

export const shop_stock = sqliteTable('shop_stock', {
  id: text('id').primaryKey(),
  shop_id: text('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  item_id: text('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'cascade' }),
  quantity: integer('quantity'), // null = unlimited
});

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  character_id: text('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  shop_id: text('shop_id')
    .references(() => shops.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(), // 'buy' | 'sell'
  lines: text('lines').notNull(), // JSON: [{ item_id, name, qty, unit_price, overridden }]
  total_eb: integer('total_eb').notNull(),
  at: integer('at').notNull(),
});

export const character_submissions = sqliteTable('character_submissions', {
  id: text('id').primaryKey(),
  source: text('source').notNull(), // 'wifi' | 'file'
  status: text('status').notNull().default('pending'), // 'pending' | 'accepted' | 'rejected'
  name: text('name').notNull(),
  role: text('role').notNull(),
  image_path: text('image_path'),
  character_data: text('character_data').notNull(), // JSON string: CharacterDraft
  created_with: text('created_with').notNull(), // JSON string: { method, starting_funds }
  validation_results: text('validation_results').notNull(), // JSON string: CharacterValidationResult
  rejection_comment: text('rejection_comment'),
  accepted_character_id: text('accepted_character_id'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});

export const skill_notes = sqliteTable('skill_notes', {
  key: text('key').primaryKey(),
  text: text('text').notNull(),
  updated_at: integer('updated_at').notNull(),
});

export const combats = sqliteTable('combats', {
  id: text('id').primaryKey(),
  status: text('status').notNull().default('setup'), // 'setup' | 'active' | 'ended'
  round: integer('round').notNull().default(1),
  turn_index: integer('turn_index').notNull().default(0),
  settings: text('settings').notNull().default('{}'), // JSON
  created_at: integer('created_at').notNull(),
  ended_at: integer('ended_at'),
});

export const combat_participants = sqliteTable('combat_participants', {
  id: text('id').primaryKey(),
  combat_id: text('combat_id')
    .notNull()
    .references(() => combats.id, { onDelete: 'cascade' }),
  character_id: text('character_id').references(() => characters.id, { onDelete: 'set null' }),
  side: text('side').notNull().default('enemy'), // 'ally' | 'enemy'
  name: text('name').notNull(),
  initiative: integer('initiative').notNull().default(0),
  initiative_roll: text('initiative_roll').notNull().default('{}'), // JSON
  order_index: integer('order_index').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  out: integer('out', { mode: 'boolean' }).notNull().default(false),
  move_used: integer('move_used', { mode: 'boolean' }).notNull().default(false),
  action_used: integer('action_used', { mode: 'boolean' }).notNull().default(false),
  state: text('state').notNull().default('{}'), // JSON
});

export const combat_log = sqliteTable('combat_log', {
  id: text('id').primaryKey(),
  combat_id: text('combat_id')
    .notNull()
    .references(() => combats.id, { onDelete: 'cascade' }),
  round: integer('round').notNull(),
  actor_id: text('actor_id').notNull(),
  action_key: text('action_key').notNull(),
  input: text('input').notNull().default('{}'), // JSON
  breakdown: text('breakdown').notNull().default('{}'), // JSON
  changes: text('changes').notNull().default('[]'), // JSON
  undone: integer('undone', { mode: 'boolean' }).notNull().default(false),
  at: integer('at').notNull(),
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

export const charactersRelations = relations(characters, ({ one, many }) => ({
  image: one(images, {
    fields: [characters.image_id],
    references: [images.id],
  }),
  devices: many(devices),
  moneyLogs: many(money_log),
  charLogs: many(char_log),
  transactions: many(transactions),
}));

export const devicesRelations = relations(devices, ({ one }) => ({
  character: one(characters, {
    fields: [devices.character_id],
    references: [characters.id],
  }),
}));

export const moneyLogRelations = relations(money_log, ({ one }) => ({
  character: one(characters, {
    fields: [money_log.character_id],
    references: [characters.id],
  }),
}));

export const charLogRelations = relations(char_log, ({ one }) => ({
  character: one(characters, {
    fields: [char_log.character_id],
    references: [characters.id],
  }),
}));

export const shopsRelations = relations(shops, ({ many }) => ({
  stock: many(shop_stock),
  transactions: many(transactions),
}));

export const shopStockRelations = relations(shop_stock, ({ one }) => ({
  shop: one(shops, {
    fields: [shop_stock.shop_id],
    references: [shops.id],
  }),
  item: one(items, {
    fields: [shop_stock.item_id],
    references: [items.id],
  }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  character: one(characters, {
    fields: [transactions.character_id],
    references: [characters.id],
  }),
  shop: one(shops, {
    fields: [transactions.shop_id],
    references: [shops.id],
  }),
}));

export const combatsRelations = relations(combats, ({ many }) => ({
  participants: many(combat_participants),
  logs: many(combat_log),
}));

export const combatParticipantsRelations = relations(combat_participants, ({ one }) => ({
  combat: one(combats, {
    fields: [combat_participants.combat_id],
    references: [combats.id],
  }),
  character: one(characters, {
    fields: [combat_participants.character_id],
    references: [characters.id],
  }),
}));

export const combatLogRelations = relations(combat_log, ({ one }) => ({
  combat: one(combats, {
    fields: [combat_log.combat_id],
    references: [combats.id],
  }),
}));
