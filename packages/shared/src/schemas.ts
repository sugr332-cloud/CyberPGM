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

export const CharacterSchema = z.object({
  id: z.string(),
  kind: z.enum(['pc', 'npc', 'mook']).default('pc'),
  name: z.string().min(1),
  role: z.string().min(1),
  image_id: z.string().nullable().optional(),
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
  inventory: z.array(z.unknown()).default([]),
  status: z.array(z.string()).default([]),
  crit_injuries: z.array(z.unknown()).default([]),
  eb: z.number().int().default(0),
  notes_gm: z.string().nullable().optional(),
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

export const GmLoginInputSchema = z.object({
  pin: z.string().min(1),
});

export const JoinInputSchema = z.object({
  code: z.string().min(1),
});

export const ClaimInputSchema = z.object({
  code: z.string().min(1),
  character_id: z.string().min(1),
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
});

export const WsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
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
]);
