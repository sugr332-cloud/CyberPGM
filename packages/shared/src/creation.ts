import { z } from 'zod';
import { CharacterStatsSchema } from './schemas.js';

export const CreationMethodConfigSchema = z.object({
  key: z.string(),
  label: z.string(),
  stat_points: z.number().int().nullable().default(null),
  stat_min: z.number().int().nullable().default(null),
  stat_max: z.number().int().nullable().default(null),
  skill_points: z.number().int().nullable().default(null),
  skill_level_max: z.number().int().nullable().default(null),
  basic_skill_min: z.number().int().nullable().default(null),
  difficult_cost: z.number().int().nullable().default(null),
  uses_starting_funds: z.boolean().nullable().default(null),
});

export type CreationMethodConfig = z.infer<typeof CreationMethodConfigSchema>;

export const CharacterDraftItemSchema = z.object({
  item_id: z.string().optional(),
  name: z.string(),
  qty: z.number().int().positive().default(1),
  price_eb: z.number().int().nonnegative().optional(),
  category: z.string().optional(),
});

export type CharacterDraftItem = z.infer<typeof CharacterDraftItemSchema>;

export const CharacterDraftCyberwareSchema = z.object({
  item_id: z.string().optional(),
  name: z.string(),
  type: z.string().optional(),
  static_loss: z.number().int().nonnegative().optional(),
});

export type CharacterDraftCyberware = z.infer<typeof CharacterDraftCyberwareSchema>;

export const CharacterDraftSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  image_path: z.string().nullable().optional(),
  stats: CharacterStatsSchema,
  skills: z.record(z.string(), z.number().int().min(0)).default({}),
  inventory: z.array(CharacterDraftItemSchema).default([]),
  cyberware: z.array(CharacterDraftCyberwareSchema).default([]),
});

export type CharacterDraft = z.infer<typeof CharacterDraftSchema>;

export const CpgmCharacterFileSchema = z.object({
  format: z.literal('cpgm-character'),
  version: z.literal(1),
  character: CharacterDraftSchema,
  created_with: z.object({
    method: z.string(),
    starting_funds: z.number().int().nullable().optional(),
  }),
});

export type CpgmCharacterFile = z.infer<typeof CpgmCharacterFileSchema>;

export interface CharacterValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
  stats: {
    total: number;
    points: number | null;
    remaining: number | null;
    min: number | null;
    max: number | null;
    unconfigured: boolean;
  };
  skills: {
    totalSpent: number;
    points: number | null;
    remaining: number | null;
    levelMax: number | null;
    basicMin: number | null;
    unconfigured: boolean;
  };
  funds: {
    totalSpent: number;
    startingFunds: number | null;
    remaining: number | null;
    unconfigured: boolean;
  };
  humanity: {
    initialEmp: number;
    maxHumanity: number;
    currentHumanity: number;
    currentEmp: number;
    cyberwareCount: number;
  };
}

export const CharacterSubmissionSchema = z.object({
  id: z.string(),
  source: z.enum(['wifi', 'file']),
  status: z.enum(['pending', 'accepted', 'rejected']),
  name: z.string(),
  role: z.string(),
  image_path: z.string().nullable().optional(),
  character_data: CharacterDraftSchema,
  created_with: z.object({
    method: z.string(),
    starting_funds: z.number().int().nullable().optional(),
  }),
  validation_results: z.custom<CharacterValidationResult>(),
  rejection_comment: z.string().nullable().optional(),
  accepted_character_id: z.string().nullable().optional(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});

export type CharacterSubmission = z.infer<typeof CharacterSubmissionSchema>;
