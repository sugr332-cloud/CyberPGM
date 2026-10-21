import { z } from 'zod';

export const CharacterStatsSchema = z.object({
  int: z.number().int().min(1).max(10),
  ref: z.number().int().min(1).max(10),
  dex: z.number().int().min(1).max(10),
  tech: z.number().int().min(1).max(10),
  cool: z.number().int().min(1).max(10),
  will: z.number().int().min(1).max(10),
  luck: z.number().int().min(0).max(10),
  move: z.number().int().min(1).max(10),
  body: z.number().int().min(1).max(10),
  emp: z.number().int().min(1).max(10),
});

export const CyberwareEntrySchema = z.object({
  item_id: z.string().optional(),
  name: z.string(),
  type: z.string().optional(),
  static_loss: z.number().int().nonnegative().optional(),
});

export const InventoryEntrySchema = z.object({
  entry_id: z.string(),
  item_id: z.string().optional(),
  name: z.string(),
  kind: z.string().optional(),
  qty: z.number().int().positive().default(1),
  equipped: z.boolean().optional(),
  ammo: z.number().int().nonnegative().optional(),
  ignore_armor_percent: z.number().nullable().optional(),
  notes: z.string().optional(),
});

export const InventoryFlexibleSchema = z.preprocess((val) => {
  if (typeof val === 'string') {
    return {
      entry_id: 'legacy-' + Math.random().toString(36).slice(2),
      name: val,
      qty: 1,
    };
  }
  return val;
}, InventoryEntrySchema);

export const CharacterInventorySchema = z.array(InventoryFlexibleSchema).default([]);

export const CharacterSchema = z.object({
  id: z.string(),
  kind: z.enum(['pc', 'npc', 'mook']).default('pc'),
  name: z.string().min(1),
  role: z.string().min(1),
  image_id: z.string().nullable().optional(),
  portrait_image_id: z.string().nullable().optional(), // 立ち絵（Phase 5e）
  stats: CharacterStatsSchema,
  skills: z.record(z.string(), z.number().int().min(0)),
  hp: z.number().int(),
  hp_max: z.number().int().positive(),
  sp_head: z.number().int().nonnegative().default(0),
  sp_body: z.number().int().nonnegative().default(0),
  humanity: z.number().int(),
  emp_max: z.number().int().positive(),
  cyberware: z.array(CyberwareEntrySchema).default([]),
  weapons: z.array(z.string()).default([]),
  inventory: z.array(InventoryFlexibleSchema).default([]),
  status: z.array(z.string()).default([]),
  crit_injuries: z.array(z.unknown()).default([]),
  eb: z.number().int().default(0),
  notes_gm: z.string().nullable().optional(),
  player_id: z.string().nullable().optional(), // 持ち主のプレイヤー（Phase 5i）
  scenario_id: z.string().nullable().optional(), // 参加中で未クリアのシナリオ（Phase 5i）
  created_at: z.number().int(),
  updated_at: z.number().int(),
});

export const CharacterCreateInputSchema = CharacterSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
}).partial({
  kind: true,
  image_id: true,
  portrait_image_id: true,
  skills: true,
  sp_head: true,
  sp_body: true,
  cyberware: true,
  weapons: true,
  inventory: true,
  status: true,
  crit_injuries: true,
  eb: true,
  notes_gm: true,
});

export const CharacterUpdateInputSchema = CharacterCreateInputSchema.partial();

export const JoinInputSchema = z.object({
  code: z.string().min(1),
  player_id: z.string().nullable().optional(), // 指定すると、その人のキャラと持ち主なしのキャラだけを返す（Phase 5i）
});

export const ClaimInputSchema = z.object({
  code: z.string().min(1),
  character_id: z.string().min(1),
  player_id: z.string().nullable().optional(), // 持ち主なしのキャラなら、この人のキャラにする（Phase 5i）
});

export const PlayerCreateInputSchema = z.object({
  code: z.string().min(1),
  name: z.string().trim().min(1).max(40),
});

export const ClaimResolveInputSchema = z.object({
  allow: z.boolean(),
});

export const MoneyUpdateInputSchema = z.object({
  amount: z.number().int(),
  reason: z.string().min(1),
});

export const MoneyAllInputSchema = z.object({
  amount: z.number().int(),
  reason: z.string().min(1),
});

export const MoneySplitInputSchema = z.object({
  total: z.number().int(),
  reason: z.string().min(1),
});

export const AppSettingsSchema = z.object({
  starting_funds: z.number().int().nullable().default(null),
});

export const SaveCreateInputSchema = z.object({
  name: z.string().min(1),
});

export const SaveUpdateInputSchema = z.object({
  name: z.string().min(1),
});

export const ShopSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  price_multiplier: z.number().default(1.0),
  buyback_rate: z.number().default(0.5),
  categories: z.array(z.string()).default([]),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});

export const ShopStockItemSchema = z.object({
  id: z.string(),
  shop_id: z.string(),
  item_id: z.string(),
  quantity: z.number().int().nonnegative().nullable(),
});

export const TransactionLineSchema = z.object({
  item_id: z.string(),
  name: z.string(),
  qty: z.number().int().positive(),
  unit_price: z.number().int(),
  overridden: z.boolean().optional(),
});

export const TransactionSchema = z.object({
  id: z.string(),
  character_id: z.string(),
  shop_id: z.string().nullable().optional(),
  kind: z.enum(['buy', 'sell']),
  lines: z.array(TransactionLineSchema),
  total_eb: z.number().int(),
  at: z.number().int(),
});

export const ShopCreateInputSchema = z.object({
  name: z.string().min(1),
  price_multiplier: z.number().min(0).default(1.0),
  buyback_rate: z.number().min(0).max(2).default(0.5),
  categories: z.array(z.string()).default([]),
});

export const ShopUpdateInputSchema = ShopCreateInputSchema.partial();

export const ShopStockSetInputSchema = z.object({
  item_id: z.string(),
  quantity: z.number().int().nonnegative().nullable(),
});

export const PurchaseLineInputSchema = z.object({
  item_id: z.string(),
  qty: z.number().int().positive().default(1),
  unit_price_override: z.number().int().nonnegative().optional(),
});

export const InstallCyberwareInputSchema = z.object({
  item_id: z.string(),
  humanity_loss: z.number().int().nonnegative().optional(),
});

export const PurchaseInputSchema = z.object({
  character_id: z.string(),
  shop_id: z.string().nullable().optional(),
  lines: z.array(PurchaseLineInputSchema).min(1),
  install_cyberware: z.array(InstallCyberwareInputSchema).optional(),
});

export const SellEntryInputSchema = z.object({
  entry_id: z.string(),
  qty: z.number().int().positive().default(1),
});

export const SellInputSchema = z.object({
  character_id: z.string(),
  shop_id: z.string().nullable().optional(),
  entries: z.array(SellEntryInputSchema).min(1),
});

export const ItemPatchInputSchema = z.object({
  name_ja_override: z.string().nullable().optional(),
  summary_ja: z.string().nullable().optional(),
  source_page_ja: z.number().int().nullable().optional(),
  verify_status: z.enum(['official_verified', 'unofficial', 'unverified', 'homebrew']).optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
  effect_ja: z.string().nullable().optional(),
  flavor_ja: z.string().nullable().optional(),
});

export const PriceCategoryConfigSchema = z.object({
  key: z.string(),
  max: z.number().int(),
  label_ja: z.string().optional(),
});

export const PriceCategoriesSettingSchema = z.array(PriceCategoryConfigSchema);

export const SaveFileSchema = z.object({
  format: z.literal('cpgm-save'),
  version: z.number().int().positive(),
  savedAt: z.number().int(),
  name: z.string(),
  characters: z.array(CharacterSchema),
  money_log: z.array(
    z.object({
      id: z.string(),
      character_id: z.string(),
      amount: z.number().int(),
      reason: z.string(),
      balance_after: z.number().int(),
      at: z.number().int(),
    }),
  ),
  char_log: z.array(
    z.object({
      id: z.string(),
      character_id: z.string(),
      text: z.string(),
      at: z.number().int(),
    }),
  ),
  app_settings: z.record(z.string(), z.unknown()),
  shops: z.array(ShopSchema).optional().default([]),
  shop_stock: z.array(ShopStockItemSchema).optional().default([]),
  transactions: z.array(TransactionSchema).optional().default([]),
  character_submissions: z.array(z.unknown()).optional().default([]),
  skill_notes: z.array(z.unknown()).optional().default([]),
  combats: z.array(z.unknown()).optional().default([]),
  combat_participants: z.array(z.unknown()).optional().default([]),
  combat_log: z.array(z.unknown()).optional().default([]),
  boards: z.array(z.unknown()).optional().default([]),
  board_objects: z.array(z.unknown()).optional().default([]),
  board_tokens: z.array(z.unknown()).optional().default([]),
  board_drops: z.array(z.unknown()).optional().default([]),
  scenarios: z.array(z.unknown()).optional().default([]),
  scenario_versions: z.array(z.unknown()).optional().default([]),
  scenes: z.array(z.unknown()).optional().default([]),
  scene_links: z.array(z.unknown()).optional().default([]),
  scene_choices: z.array(z.unknown()).optional().default([]),
  clues: z.array(z.unknown()).optional().default([]),
  handouts: z.array(z.unknown()).optional().default([]),
  encounters: z.array(z.unknown()).optional().default([]),
  random_tables: z.array(z.unknown()).optional().default([]),
  scenario_sessions: z.array(z.unknown()).optional().default([]),
  session_log: z.array(z.unknown()).optional().default([]),
  story_checks: z.array(z.unknown()).optional().default([]),
  // プレイヤー（人）。Phase 5i より前の保存ファイルにはない
  players: z
    .array(z.object({ id: z.string(), name: z.string(), created_at: z.number().int(), updated_at: z.number().int() }))
    .optional()
    .default([]),
  // GM が書き換えた品目の効果とフレーバー（Phase 5c。下書きのままのものは入れない）
  item_notes: z
    .array(z.object({ fvtt_id: z.string(), effect_ja: z.string().nullable(), flavor_ja: z.string().nullable() }))
    .optional()
    .default([]),
});

export const WsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({
    type: z.literal('combat:choose'),
    payload: z.object({
      action_key: z.string(),
      target_id: z.string().optional(),
      weapon_id: z.string().optional(),
      aimed_location: z.string().optional(),
      distance_m: z.number().optional(),
    }),
  }),
  z.object({
    type: z.literal('combat:roll'),
    payload: z.object({
      roll_type: z.enum(['initiative', 'attack', 'defense', 'damage', 'crit', 'death_save']),
      first: z.number().int().optional(),
      extra: z.number().int().optional(),
      dice: z.array(z.number().int()).optional(),
    }),
  }),
]);

export const WsServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('me:update'),
    payload: z.unknown(), // CharacterSheet
  }),
  z.object({
    type: z.literal('notify'),
    payload: z.object({
      kind: z.enum(['money', 'info']),
      title: z.string(),
      body: z.string(),
    }),
  }),
  z.object({
    type: z.literal('gm:presence'),
    payload: z.object({
      devices: z.array(z.unknown()),
    }),
  }),
  z.object({
    type: z.literal('gm:claim-request'),
    payload: z.object({
      requestId: z.string(),
      character_id: z.string(),
      character_name: z.string(),
      deviceLabel: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('combat:update'),
    payload: z.unknown(), // Combat
  }),
  z.object({
    type: z.literal('combat:turn'),
    payload: z.object({
      combat_id: z.string(),
      round: z.number().int(),
      turn_index: z.number().int(),
      actor_id: z.string(),
      actor_name: z.string(),
      is_my_turn: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal('combat:result'),
    payload: z.object({
      title: z.string(),
      summary: z.string(),
      changes: z.array(z.unknown()),
      is_victim: z.boolean().optional(),
    }),
  }),
]);
