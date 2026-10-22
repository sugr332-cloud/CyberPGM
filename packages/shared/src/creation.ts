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
  // ロールのテンプレートを使う方式（Phase 5t。日本語版 p.73〜99）。
  // streetrat: 能力値は表の 1 行（1d10）、技能はテンプレートどおり、武器と防具はロールのパッケージ
  // edgerunner: 能力値は表から能力値ごとに 1d10、技能はロールの 20 技能に 86 ポイント、武器と防具はパッケージ
  template: z.enum(['streetrat', 'edgerunner']).nullable().optional(),
  // GM が開始資金を決めていないときの開始資金（パッケージ方式 500eb、スクラッチビルド 2,550eb）
  starting_funds_default: z.number().int().nullable().optional(),
});

export type CreationMethodConfig = z.infer<typeof CreationMethodConfigSchema>;

/** キャラクター作成のロール別データ（Phase 5t）。手元のルール資料から読み、技能は技能キー・品目は品目 ID に直して返す */
export interface CreationGearOption {
  item_id?: string;
  name: string;
  qty: number;
  price_eb?: number;
  category?: string;
  pair?: string;
}

export interface CreationTemplates {
  stat_order: string[];
  stat_tables: Record<string, { page?: number; uncertain?: string; rows: number[][] }>;
  skill_templates: Record<string, { page?: number; skills: Record<string, number>; unsupported: Record<string, number> }>;
  gear_packages: Record<string, { page?: number; slots: CreationGearOption[][] }>;
  gear_note?: string;
}

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
