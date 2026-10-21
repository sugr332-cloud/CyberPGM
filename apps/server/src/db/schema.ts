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
  // 効果とフレーバー（docs/data/item-notes.ja.json の下書きから入れ、GM が書き換えられる。2026-10-21 ユーザー決定）
  effect_ja: text('effect_ja'),
  flavor_ja: text('flavor_ja'),
  effect_is_draft: integer('effect_is_draft', { mode: 'boolean' }).notNull().default(false),
  flavor_is_draft: integer('flavor_is_draft', { mode: 'boolean' }).notNull().default(false),
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
  ignore_armor_percent: integer('ignore_armor_percent'),
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
  title: text('title'),
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
  portrait_image_id: text('portrait_image_id').references(() => images.id, { onDelete: 'set null' }), // 立ち絵（Phase 5e）
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

export const boards = sqliteTable('boards', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  background_image_id: text('background_image_id').references(() => images.id, { onDelete: 'set null' }),
  grid: text('grid').notNull().default('{}'), // JSON: { show, cell_m, origin_x, origin_y, cell_px, cols, rows }
  fog: text('fog').notNull().default('[]'), // JSON array: { x: number, y: number }[]
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});

export const board_objects = sqliteTable('board_objects', {
  id: text('id').primaryKey(),
  board_id: text('board_id')
    .notNull()
    .references(() => boards.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // 'wall' | 'crate' | 'container' | 'vehicle' | 'other'
  label: text('label').notNull(),
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  w: integer('w').notNull(),
  h: integer('h').notNull(),
  rotation: integer('rotation').notNull().default(0), // 0 | 90 | 180 | 270
  passable: integer('passable', { mode: 'boolean' }).notNull().default(true),
  blocks_los: text('blocks_los').notNull().default('none'), // 'none' | 'partial' | 'full'
  cover_hp: integer('cover_hp'),
  cover_hp_max: integer('cover_hp_max'),
});

export const board_tokens = sqliteTable('board_tokens', {
  id: text('id').primaryKey(),
  board_id: text('board_id')
    .notNull()
    .references(() => boards.id, { onDelete: 'cascade' }),
  character_id: text('character_id').references(() => characters.id, { onDelete: 'set null' }),
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  gm_only: integer('gm_only', { mode: 'boolean' }).notNull().default(false),
});

export const board_drops = sqliteTable('board_drops', {
  id: text('id').primaryKey(),
  board_id: text('board_id')
    .notNull()
    .references(() => boards.id, { onDelete: 'cascade' }),
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  inventory_entry: text('inventory_entry').notNull(), // JSON
  from_character_id: text('from_character_id').references(() => characters.id, { onDelete: 'set null' }),
});

export const combats = sqliteTable('combats', {
  id: text('id').primaryKey(),
  board_id: text('board_id').references(() => boards.id, { onDelete: 'set null' }),
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

// Phase 5a Scenario Maker Tables
export const scenarios = sqliteTable('scenarios', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  meta: text('meta').notNull().default('{}'), // JSON: { players_min?, players_max?, hours?, reward_note?, tags?: [], shop_ids?: [] }
  version: integer('version').notNull().default(1),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});

export const scenario_versions = sqliteTable('scenario_versions', {
  id: text('id').primaryKey(),
  scenario_id: text('scenario_id')
    .notNull()
    .references(() => scenarios.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  snapshot: text('snapshot').notNull(), // JSON
  saved_at: integer('saved_at').notNull(),
});

export const scenes = sqliteTable('scenes', {
  id: text('id').primaryKey(),
  scenario_id: text('scenario_id')
    .notNull()
    .references(() => scenarios.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  read_aloud: text('read_aloud').notNull().default(''),
  gm_notes: text('gm_notes').notNull().default(''),
  location: text('location').notNull().default(''),
  npc_ids: text('npc_ids').notNull().default('[]'), // JSON array of character IDs
  position: text('position').notNull().default('{"x":100,"y":100}'), // JSON: { x: number, y: number }
  background_image_id: text('background_image_id').references(() => images.id, { onDelete: 'set null' }),
  board_id: text('board_id').references(() => boards.id, { onDelete: 'set null' }),
  sort_index: integer('sort_index').notNull().default(0),
  is_adhoc: integer('is_adhoc', { mode: 'boolean' }).notNull().default(false),
  stage: text('stage').notNull().default('{}'), // JSON: 立ち絵の配置 { portraits: StagePortrait[] }（Phase 5e）
  bgm: text('bgm'), // JSON: { audio_id, loop, volume }（Phase 5e）
});

export const scene_links = sqliteTable('scene_links', {
  id: text('id').primaryKey(),
  scenario_id: text('scenario_id')
    .notNull()
    .references(() => scenarios.id, { onDelete: 'cascade' }),
  from_scene_id: text('from_scene_id')
    .notNull()
    .references(() => scenes.id, { onDelete: 'cascade' }),
  to_scene_id: text('to_scene_id')
    .notNull()
    .references(() => scenes.id, { onDelete: 'cascade' }),
  condition: text('condition').notNull().default(''),
});

export const scene_choices = sqliteTable('scene_choices', {
  id: text('id').primaryKey(),
  scene_id: text('scene_id')
    .notNull()
    .references(() => scenes.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  skill_key: text('skill_key'),
  dv: integer('dv'),
  who: text('who').notNull().default('全員'),
  on_success: text('on_success').notNull().default('[]'), // JSON array of ChoiceOutcome
  on_failure: text('on_failure').notNull().default('[]'), // JSON array of ChoiceOutcome
  sort_index: integer('sort_index').notNull().default(0),
});

export const clues = sqliteTable('clues', {
  id: text('id').primaryKey(),
  scenario_id: text('scenario_id')
    .notNull()
    .references(() => scenarios.id, { onDelete: 'cascade' }),
  scene_id: text('scene_id').references(() => scenes.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  image_id: text('image_id').references(() => images.id, { onDelete: 'set null' }),
});

export const handouts = sqliteTable('handouts', {
  id: text('id').primaryKey(),
  scenario_id: text('scenario_id')
    .notNull()
    .references(() => scenarios.id, { onDelete: 'cascade' }),
  scene_id: text('scene_id').references(() => scenes.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  image_id: text('image_id').references(() => images.id, { onDelete: 'set null' }),
});

export const encounters = sqliteTable('encounters', {
  id: text('id').primaryKey(),
  scenario_id: text('scenario_id')
    .notNull()
    .references(() => scenarios.id, { onDelete: 'cascade' }),
  scene_id: text('scene_id').references(() => scenes.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  participants: text('participants').notNull().default('[]'), // JSON array: { character_id, side, count, x?, y? }[]
  notes: text('notes').notNull().default(''),
});

export const random_tables = sqliteTable('random_tables', {
  id: text('id').primaryKey(),
  scenario_id: text('scenario_id').references(() => scenarios.id, { onDelete: 'cascade' }), // null for global/common tables
  title: text('title').notNull(),
  dice: text('dice').notNull(), // 'd6', 'd10', '2d6', etc.
  rows: text('rows').notNull().default('[]'), // JSON array: { from, to, text }[]
});

// Phase 5b Scenario Play Tables
export const scenario_sessions = sqliteTable('scenario_sessions', {
  id: text('id').primaryKey(),
  scenario_id: text('scenario_id')
    .notNull()
    .references(() => scenarios.id, { onDelete: 'cascade' }),
  current_scene_id: text('current_scene_id').references(() => scenes.id, { onDelete: 'set null' }),
  started_at: integer('started_at').notNull(),
  ended_at: integer('ended_at'),
  revealed: text('revealed').notNull().default('{"clue_ids":[],"handout_ids":[]}'), // JSON: { clue_ids: string[], handout_ids: string[] }
});

export const session_log = sqliteTable('session_log', {
  id: text('id').primaryKey(),
  scenario_session_id: text('scenario_session_id')
    .notNull()
    .references(() => scenario_sessions.id, { onDelete: 'cascade' }),
  at: integer('at').notNull(),
  kind: text('kind').notNull(), // 'note' | 'scene' | 'check' | 'combat' | 'transaction' | 'money' | 'reveal'
  text: text('text').notNull(),
  ref: text('ref'), // JSON string: { combat_id?: string, check_id?: string, scene_id?: string, transaction_id?: string, ... }
});

export const story_checks = sqliteTable('story_checks', {
  id: text('id').primaryKey(),
  scenario_session_id: text('scenario_session_id')
    .notNull()
    .references(() => scenario_sessions.id, { onDelete: 'cascade' }),
  scene_id: text('scene_id').references(() => scenes.id, { onDelete: 'set null' }),
  choice_id: text('choice_id').references(() => scene_choices.id, { onDelete: 'set null' }),
  actor_character_id: text('actor_character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  skill_key: text('skill_key'),
  dv: integer('dv'),
  opposed: text('opposed'), // JSON: { target_character_id: string, skill_key?: string, roll?: number, rolls?: number[] }
  rolls: text('rolls').notNull().default('[]'), // JSON number[]
  result: text('result'), // 'success' | 'failure'（出目がそろうまでは null）
  applied_log_id: text('applied_log_id'),
  action_label: text('action_label'), // プレイヤーが選んだ行動（選択肢の名前・一般的な行動・自由記述）
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

export const boardsRelations = relations(boards, ({ one, many }) => ({
  backgroundImage: one(images, {
    fields: [boards.background_image_id],
    references: [images.id],
  }),
  objects: many(board_objects),
  tokens: many(board_tokens),
  drops: many(board_drops),
  combats: many(combats),
}));

export const boardObjectsRelations = relations(board_objects, ({ one }) => ({
  board: one(boards, {
    fields: [board_objects.board_id],
    references: [boards.id],
  }),
}));

export const boardTokensRelations = relations(board_tokens, ({ one }) => ({
  board: one(boards, {
    fields: [board_tokens.board_id],
    references: [boards.id],
  }),
  character: one(characters, {
    fields: [board_tokens.character_id],
    references: [characters.id],
  }),
}));

export const boardDropsRelations = relations(board_drops, ({ one }) => ({
  board: one(boards, {
    fields: [board_drops.board_id],
    references: [boards.id],
  }),
  fromCharacter: one(characters, {
    fields: [board_drops.from_character_id],
    references: [characters.id],
  }),
}));

export const combatsRelations = relations(combats, ({ one, many }) => ({
  board: one(boards, {
    fields: [combats.board_id],
    references: [boards.id],
  }),
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

export const scenariosRelations = relations(scenarios, ({ many }) => ({
  versions: many(scenario_versions),
  scenes: many(scenes),
  links: many(scene_links),
  clues: many(clues),
  handouts: many(handouts),
  encounters: many(encounters),
  random_tables: many(random_tables),
}));

export const scenarioVersionsRelations = relations(scenario_versions, ({ one }) => ({
  scenario: one(scenarios, {
    fields: [scenario_versions.scenario_id],
    references: [scenarios.id],
  }),
}));

export const scenesRelations = relations(scenes, ({ one, many }) => ({
  scenario: one(scenarios, {
    fields: [scenes.scenario_id],
    references: [scenarios.id],
  }),
  backgroundImage: one(images, {
    fields: [scenes.background_image_id],
    references: [images.id],
  }),
  board: one(boards, {
    fields: [scenes.board_id],
    references: [boards.id],
  }),
  choices: many(scene_choices),
  clues: many(clues),
  handouts: many(handouts),
  encounters: many(encounters),
  incomingLinks: many(scene_links, { relationName: 'incomingLinks' }),
  outgoingLinks: many(scene_links, { relationName: 'outgoingLinks' }),
}));

export const sceneLinksRelations = relations(scene_links, ({ one }) => ({
  scenario: one(scenarios, {
    fields: [scene_links.scenario_id],
    references: [scenarios.id],
  }),
  fromScene: one(scenes, {
    fields: [scene_links.from_scene_id],
    references: [scenes.id],
    relationName: 'outgoingLinks',
  }),
  toScene: one(scenes, {
    fields: [scene_links.to_scene_id],
    references: [scenes.id],
    relationName: 'incomingLinks',
  }),
}));

export const sceneChoicesRelations = relations(scene_choices, ({ one }) => ({
  scene: one(scenes, {
    fields: [scene_choices.scene_id],
    references: [scenes.id],
  }),
}));

export const cluesRelations = relations(clues, ({ one }) => ({
  scenario: one(scenarios, {
    fields: [clues.scenario_id],
    references: [scenarios.id],
  }),
  scene: one(scenes, {
    fields: [clues.scene_id],
    references: [scenes.id],
  }),
  image: one(images, {
    fields: [clues.image_id],
    references: [images.id],
  }),
}));

export const handoutsRelations = relations(handouts, ({ one }) => ({
  scenario: one(scenarios, {
    fields: [handouts.scenario_id],
    references: [scenarios.id],
  }),
  scene: one(scenes, {
    fields: [handouts.scene_id],
    references: [scenes.id],
  }),
  image: one(images, {
    fields: [handouts.image_id],
    references: [images.id],
  }),
}));

export const encountersRelations = relations(encounters, ({ one }) => ({
  scenario: one(scenarios, {
    fields: [encounters.scenario_id],
    references: [scenarios.id],
  }),
  scene: one(scenes, {
    fields: [encounters.scene_id],
    references: [scenes.id],
  }),
}));

export const randomTablesRelations = relations(random_tables, ({ one }) => ({
  scenario: one(scenarios, {
    fields: [random_tables.scenario_id],
    references: [scenarios.id],
  }),
}));

export const scenarioSessionsRelations = relations(scenario_sessions, ({ one, many }) => ({
  scenario: one(scenarios, {
    fields: [scenario_sessions.scenario_id],
    references: [scenarios.id],
  }),
  currentScene: one(scenes, {
    fields: [scenario_sessions.current_scene_id],
    references: [scenes.id],
  }),
  logs: many(session_log),
  checks: many(story_checks),
}));

export const sessionLogRelations = relations(session_log, ({ one }) => ({
  session: one(scenario_sessions, {
    fields: [session_log.scenario_session_id],
    references: [scenario_sessions.id],
  }),
}));

export const storyChecksRelations = relations(story_checks, ({ one }) => ({
  session: one(scenario_sessions, {
    fields: [story_checks.scenario_session_id],
    references: [scenario_sessions.id],
  }),
  scene: one(scenes, {
    fields: [story_checks.scene_id],
    references: [scenes.id],
  }),
  choice: one(scene_choices, {
    fields: [story_checks.choice_id],
    references: [scene_choices.id],
  }),
  actorCharacter: one(characters, {
    fields: [story_checks.actor_character_id],
    references: [characters.id],
  }),
}));

// 音声ファイル（シーンの BGM。Phase 5e）。ファイルは data/audio/user/ に置き、git に入れない
export const audio = sqliteTable('audio', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  path: text('path').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  duration_sec: real('duration_sec'),
  created_at: integer('created_at').notNull(),
});
