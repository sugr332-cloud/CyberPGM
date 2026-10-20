import { z } from 'zod';
import type { CharacterStats } from './types.js';

export type CombatActionSlot = 'move' | 'action' | 'reaction';
export type CombatActionStatus = 'confirmed' | 'unconfirmed';

export interface CombatActionDef {
  key: string;
  label: string;
  slot: CombatActionSlot;
  status: CombatActionStatus;
  issue?: number;
  desc: string;
}

export const CombatActionDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  slot: z.enum(['move', 'action', 'reaction']),
  status: z.enum(['confirmed', 'unconfirmed']),
  issue: z.number().optional(),
  desc: z.string(),
});

export interface CombatSettings {
  tieBreak: 'ref' | 'manual';
  autoRollNpc: boolean;
  autoRollPc: boolean;
  hideEnemyStats: boolean;
  [key: string]: unknown;
}

export const CombatSettingsSchema = z.object({
  tieBreak: z.enum(['ref', 'manual']).default('ref'),
  autoRollNpc: z.boolean().default(true),
  autoRollPc: z.boolean().default(false),
  hideEnemyStats: z.boolean().default(true),
}).catchall(z.unknown());

export interface CombatInitiativeRoll {
  first?: number;
  extra?: number;
  total?: number;
  needsExtra?: boolean;
}

export const CombatInitiativeRollSchema = z.object({
  first: z.number().int().min(1).max(10).optional(),
  extra: z.number().int().optional(),
  total: z.number().int().optional(),
  needsExtra: z.boolean().optional(),
});

export interface CombatParticipantState {
  inCover?: boolean;
  droppedItems?: Array<{
    item_id?: string;
    name: string;
    distance?: number;
  }>;
  statusRounds?: Record<string, number>;
  deathSavePenalty?: number;
  [key: string]: unknown;
}

export interface CombatParticipant {
  id: string;
  combat_id: string;
  character_id: string | null;
  side: 'ally' | 'enemy';
  name: string;
  initiative: number;
  initiative_roll: CombatInitiativeRoll;
  order_index: number;
  active: boolean;
  out: boolean;
  move_used: boolean;
  action_used: boolean;
  state: CombatParticipantState;
  // Hydrated character properties
  character?: {
    id: string;
    name: string;
    kind: 'pc' | 'npc' | 'mook';
    role: string;
    image_path?: string | null;
    stats: CharacterStats;
    skills: Record<string, number>;
    hp: number;
    hp_max: number;
    sp_head: number;
    sp_body: number;
    weapons: unknown[];
    inventory: unknown[];
    status: string[];
    crit_injuries: unknown[];
  } | null;
}

export const CombatParticipantSchema = z.object({
  id: z.string(),
  combat_id: z.string(),
  character_id: z.string().nullable(),
  side: z.enum(['ally', 'enemy']),
  name: z.string(),
  initiative: z.number().int().default(0),
  initiative_roll: CombatInitiativeRollSchema.default({}),
  order_index: z.number().int().default(0),
  active: z.boolean().default(true),
  out: z.boolean().default(false),
  move_used: z.boolean().default(false),
  action_used: z.boolean().default(false),
  state: z.record(z.string(), z.unknown()).default({}),
});

export interface CombatChange {
  target_id: string; // character_id or participant_id
  target_name: string;
  field:
    | 'hp'
    | 'sp_head'
    | 'sp_body'
    | 'ammo'
    | 'inventory'
    | 'status'
    | 'crit_injuries'
    | 'dropped'
    | 'out'
    | 'state'
    | 'token_position'
    | 'cover_hp'
    | 'board_drop'
    | 'board_drop_remove'
    | 'custom';
  before?: unknown;
  after?: unknown;
  desc: string;
}

export const CombatChangeSchema = z.object({
  target_id: z.string(),
  target_name: z.string(),
  field: z.enum([
    'hp',
    'sp_head',
    'sp_body',
    'ammo',
    'inventory',
    'status',
    'crit_injuries',
    'dropped',
    'out',
    'state',
    'token_position',
    'cover_hp',
    'board_drop',
    'board_drop_remove',
    'custom',
  ]),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  desc: z.string(),
});

export interface CombatLogEntry {
  id: string;
  combat_id: string;
  round: number;
  actor_id: string;
  actor_name?: string;
  action_key: string;
  action_label?: string;
  input: Record<string, unknown>;
  breakdown: Record<string, unknown>;
  changes: CombatChange[];
  undone: boolean;
  at: number;
}

export const CombatLogEntrySchema = z.object({
  id: z.string(),
  combat_id: z.string(),
  round: z.number().int(),
  actor_id: z.string(),
  action_key: z.string(),
  input: z.record(z.string(), z.unknown()).default({}),
  breakdown: z.record(z.string(), z.unknown()).default({}),
  changes: z.array(CombatChangeSchema).default([]),
  undone: z.boolean().default(false),
  at: z.number().int(),
});

export interface Combat {
  id: string;
  board_id?: string | null;
  status: 'setup' | 'active' | 'ended';
  round: number;
  turn_index: number;
  settings: CombatSettings;
  created_at: number;
  ended_at: number | null;
  participants: CombatParticipant[];
  logs?: CombatLogEntry[];
}

export const CombatSchema = z.object({
  id: z.string(),
  board_id: z.string().nullable().optional(),
  status: z.enum(['setup', 'active', 'ended']).default('setup'),
  round: z.number().int().default(1),
  turn_index: z.number().int().default(0),
  settings: CombatSettingsSchema.default({}),
  created_at: z.number().int(),
  ended_at: z.number().int().nullable().optional(),
});

// Request schemas
export const CreateCombatInputSchema = z.object({
  board_id: z.string().nullable().optional(),
  settings: CombatSettingsSchema.optional(),
});

export const AddParticipantInputSchema = z.object({
  character_id: z.string().nullable().optional(),
  name: z.string().min(1),
  side: z.enum(['ally', 'enemy']).default('enemy'),
  count: z.number().int().min(1).max(20).default(1),
});

export const UpdateParticipantInputSchema = z.object({
  side: z.enum(['ally', 'enemy']).optional(),
  name: z.string().optional(),
  initiative: z.number().int().optional(),
  initiative_roll: CombatInitiativeRollSchema.optional(),
  order_index: z.number().int().optional(),
  active: z.boolean().optional(),
  out: z.boolean().optional(),
  move_used: z.boolean().optional(),
  action_used: z.boolean().optional(),
  state: z.record(z.string(), z.unknown()).optional(),
});

export const SetInitiativeInputSchema = z.object({
  participants: z.array(
    z.object({
      id: z.string(),
      initiative: z.number().int(),
      initiative_roll: CombatInitiativeRollSchema.optional(),
      order_index: z.number().int(),
    }),
  ),
});

export const SingleAttackInputSchema = z.object({
  target_id: z.string().optional(),
  distance_m: z.number().optional(),
  dodge_mode: z.enum(['dv', 'dodge']).default('dv'),
  attack_roll: z.object({
    first: z.number().int().min(1).max(10),
    extra: z.number().int().optional(),
  }).optional(),
  defense_roll: z.object({
    first: z.number().int().min(1).max(10),
    extra: z.number().int().optional(),
  }).optional(),
  damage_dice: z.array(z.number().int().min(1).max(6)).optional(),
  crit_injury_roll: z.number().int().min(2).max(12).optional(),
  ignore_armor_percent: z.number().min(0).max(100).optional(),
  aimed_location: z.enum(['head', 'held_item', 'leg']).optional(),
  held_item_id: z.string().optional(),
  manual_changes: z.array(CombatChangeSchema).optional(),
});

export type SingleAttackInput = z.infer<typeof SingleAttackInputSchema>;

export const ResolveActionInputSchema = z.object({
  action_key: z.string(),
  actor_id: z.string(),
  target_id: z.string().optional(),
  distance_m: z.number().optional(),
  destination: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
  force_move: z.boolean().optional(),
  los_override: z.enum(['clear', 'cover', 'blocked']).optional(),
  hit_cover: z.boolean().optional(),
  cover_object_id: z.string().optional(),
  cover_damage: z.number().optional(),
  pickup_drop_id: z.string().optional(),
  weapon_id: z.string().optional(),
  weapon_entry_id: z.string().optional(),
  ammo_spent: z.number().int().nonnegative().optional(),
  ignore_armor_percent: z.number().min(0).max(100).optional(),
  aimed_location: z.enum(['head', 'held_item', 'leg']).optional(),
  held_item_id: z.string().optional(),
  dodge_mode: z.enum(['dv', 'dodge']).default('dv'),
  // Dice rolls
  attack_roll: z.object({
    first: z.number().int().min(1).max(10),
    extra: z.number().int().optional(),
  }).optional(),
  defense_roll: z.object({
    first: z.number().int().min(1).max(10),
    extra: z.number().int().optional(),
  }).optional(),
  damage_dice: z.array(z.number().int().min(1).max(6)).optional(),
  crit_injury_roll: z.number().int().min(2).max(12).optional(),
  death_save_roll: z.number().int().min(1).max(10).optional(),
  // Multi-attack for ROF > 1
  attacks: z.array(SingleAttackInputSchema).optional(),
  // Manual / unconfirmed adjustments
  manual_changes: z.array(CombatChangeSchema).optional(),
  manual_notes: z.string().optional(),
});

export const ApplyActionInputSchema = ResolveActionInputSchema.extend({
  // Optional pre-verified changes or override
});
