import { z } from 'zod';
import type { CharacterStats, CharacterExtra } from './types.js';

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

// 日本語版コアルールブック p.130「判定修正値」の不利な修正の例（GM が課す修正は累積する）
export interface SituationModifierDef {
  key: string;
  label: string;
  value: number;
}

export const SITUATION_MODIFIERS: SituationModifierDef[] = [
  { key: 'dim', label: '夜または薄暗い状況', value: -1 },
  { key: 'untrained', label: 'まったく未経験の行為をする', value: -1 },
  { key: 'complex', label: '複雑な行為', value: -2 },
  { key: 'lacking_tools', label: '道具や部品が不足している', value: -2 },
  { key: 'no_sleep', label: '前夜の睡眠が不足している', value: -2 },
  { key: 'stress', label: '極端なストレスにさらされている', value: -2 },
  { key: 'exhausted', label: '極度に疲労している', value: -4 },
  { key: 'intoxicated', label: '酒や鎮静剤を過剰に摂取している', value: -4 },
  { key: 'covert', label: '行為を秘密裏に行なう', value: -4 },
  { key: 'obscured', label: '煙や暗闇で視界が悪い', value: -4 },
];

/**
 * 手動で付け外しできる状態の一覧（Phase 6h。アプリが判定に使っている状態名だけ）
 */
export interface ManualStatusDef {
  key: string;
  label: string;
  desc: string;
}

export const MANUAL_STATUS_LIST: ManualStatusDef[] = [
  { key: '気絶', label: '気絶', desc: '行動不能。ラウンド経過で解除可能' },
  { key: '伏せ', label: '伏せ', desc: '立ち上がるまで移動不可' },
  { key: '着火（小）', label: '着火（小）', desc: 'ターン終了時に HP 直接 2 ダメージ' },
  { key: '着火（中）', label: '着火（中）', desc: 'ターン終了時に HP 直接 4 ダメージ' },
  { key: '着火（大）', label: '着火（大）', desc: 'ターン終了時に HP 直接 6 ダメージ' },
  { key: '放射線（小）', label: '放射線（小）', desc: 'ターン終了時に HP 直接 2 ダメージ' },
  { key: '放射線（大）', label: '放射線（大）', desc: 'ターン終了時に HP 直接 6 ダメージ' },
  { key: '感電', label: '感電', desc: 'ターン終了時に 6d6 ダメージ' },
  { key: '溺れ', label: '溺れ', desc: 'ターン開始時に BODY ぶん HP 直接ダメージ' },
  { key: '真空', label: '真空', desc: 'ターン終了時に INT/REF/DEX が 1d6 減少' },
  { key: '弾丸を回避できない', label: '弾丸を回避できない', desc: '弾丸の回避判定ができない' },
  { key: '回避できない', label: '回避できない', desc: '近接攻撃の回避判定ができない' },
  { key: '隠れている', label: '隠れている', desc: '盤面で敵に見えない' },
];

export interface CombatSettings {
  tieBreak: 'reroll' | 'ref' | 'manual'; // reroll: 同値は振り直す（ルール。既定）
  autoRollNpc: boolean;
  autoRollPc: boolean;
  hideEnemyStats: boolean;
  default_situations?: string[];
  default_situation_custom?: number;
  [key: string]: unknown;
}

export const CombatSettingsSchema = z.object({
  tieBreak: z.enum(['reroll', 'ref', 'manual']).default('reroll'),
  autoRollNpc: z.boolean().default(true),
  autoRollPc: z.boolean().default(false),
  hideEnemyStats: z.boolean().default(true),
  // プレイヤーのスマホに自分の残弾を見せるか（Phase 5r）。GM にはいつも見える
  playerAmmoVisible: z.boolean().default(true),
  default_situations: z.array(z.string()).optional(),
  default_situation_custom: z.number().optional(),
}).catchall(z.unknown());

export interface CombatInitiativeRoll {
  first?: number;
  extra?: number;
  total?: number;
  needsExtra?: boolean;
  tiebreak?: number[]; // 同値の振り直しの出目（Phase 5m）
}

export const CombatInitiativeRollSchema = z.object({
  first: z.number().int().min(1).max(10).optional(),
  extra: z.number().int().optional(),
  total: z.number().int().optional(),
  needsExtra: z.boolean().optional(),
  tiebreak: z.array(z.number().int().min(1).max(10)).optional(),
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
    cyberware?: Array<{ item_id?: string; name: string; type?: string; static_loss?: number }>;
    status: string[];
    crit_injuries: unknown[];
    extra?: CharacterExtra; // 【運命】点・環境の状態など（Phase 5v）
    armor_penalty?: number; // 重い防具のペナルティ（REF・DEX・MOVE から引く。Phase 5m）
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
    | 'extra'
    | 'stats'
    | 'humanity'
    | 'initiative_top'
    | 'dropped'
    | 'out'
    | 'state'
    | 'token_position'
    | 'cover_hp'
    | 'board_drop'
    | 'board_drop_remove'
    | 'participant_join'
    | 'net_architecture'
    | 'turn'
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
    'extra',
    'stats',
    'humanity',
    'initiative_top',
    'dropped',
    'out',
    'state',
    'token_position',
    'cover_hp',
    'board_drop',
    'board_drop_remove',
    'participant_join',
    'net_architecture',
    'turn',
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
  // 瀕死中の被弾と 6 が 2 個のクリティカルが重なったときの 2 つ目の致命傷表の出目（Phase 5r。日本語版 p.186・187）
  extra_crit_injury_roll: z.number().int().min(2).max(12).optional(),
  ignore_armor_percent: z.number().min(0).max(100).optional(),
  aimed_location: z.enum(['head', 'held_item', 'leg', 'weakpoint']).optional(),
  held_item_id: z.string().optional(),
  situations: z.array(z.string()).optional(),
  situation_custom: z.number().optional(),
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
  cover_current_hp: z.number().int().nonnegative().nullable().optional(),
  cover_damage: z.number().optional(),
  pickup_drop_id: z.string().optional(),
  weapon_id: z.string().optional(),
  weapon_entry_id: z.string().optional(),
  suppressive_facing: z.enum(['N','NE','E','SE','S','SW','W','NW']).optional(),
  suppressive_targets: z.array(z.object({
    participant_id: z.string(),
    resistance_roll: z.object({ first: z.number().int().min(1).max(10), extra: z.number().int().optional() }).optional(),
  })).optional(),
  ammo_spent: z.number().int().nonnegative().optional(),
  ignore_armor_percent: z.number().min(0).max(100).optional(),
  aimed_location: z.enum(['head', 'held_item', 'leg', 'weakpoint']).optional(),
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
  // 瀕死中の被弾と 6 が 2 個のクリティカルが重なったときの 2 つ目の致命傷表の出目（Phase 5r。日本語版 p.186・187）
  extra_crit_injury_roll: z.number().int().min(2).max(12).optional(),
  death_save_roll: z.number().int().min(1).max(10).optional(),
  // 武術・つかみ（Phase 5u。日本語版 p.177〜180）
  martial_style: z.string().optional(), // 使う〈武術〉の技能キー（例: martial_arts:空手）
  technique: z.enum(['kip_up', 'disarm', 'iron_grip', 'armor_break', 'bone_break', 'dodge_throw', 'arm_counter', 'pressure_point', 'flying_kick']).optional(),
  grab_mode: z.enum(['hold', 'item']).optional(), // つかむ: 相手を拘束する／持ち物を奪う
  aim_head: z.boolean().optional(), // 骨砕き・点穴撃で頭部を狙う（−8）
  luck_spent: z.number().int().min(0).max(10).optional(), // 使う【運命】点（Phase 5v。p.130）
  // 環境ダメージ（Phase 5v。p.180〜181）
  hazard: z.enum(['fire', 'radiation', 'electric', 'drown', 'vacuum', 'fall', 'poison', 'drug', 'weather']).optional(),
  hazard_level: z.enum(['small', 'medium', 'large']).optional(),
  fall_m: z.number().min(0).optional(),
  hazard_status: z.string().optional(), // 終わらせる環境の状態（hazard_end）
  // 物を投げる（Phase 5v。p.177〜178）
  throw_entry_id: z.string().optional(),
  // ドラッグ・薬品を使う（Phase 5w。p.150・227）
  drug_entry_id: z.string().optional(),
  unwilling: z.boolean().optional(), // 同意しない相手（エアハイポで近接攻撃）
  // ソロ《コンバット・アウェアネス》の割り振り直し（Phase 5x。p.146）
  solo_alloc: z.record(z.string(), z.number().int().min(0)).optional(),
  // ヴィークル（Phase 5y。p.189〜193）。どのキャラのどのヴィークルか
  vehicle_ref: z.object({ owner_id: z.string(), vehicle_id: z.string() }).optional(),
  target_vehicle: z.object({ owner_id: z.string(), vehicle_id: z.string() }).optional(),
  maneuver: z.string().optional(),
  as_driver: z.boolean().optional(),
  // ネットランニング（Phase 5z。p.196〜218）
  net: z.object({
    sub_action: z.enum([
      'jack_in',
      'jack_out',
      'unsafe_jack_out',
      'descend',
      'activate',
      'rez',
      'derez',
      'deactivate',
      'zap',
      'program',
      'attack',
      'backdoor',
      'cloak',
      'control',
      'operate_node',
      'eyedee',
      'eye_dee',
      'pathfinder',
      'slide',
      'virus',
    ]).optional(),
    arch_id: z.string().optional(),
    target_floor: z.number().int().optional(),
    program_key: z.string().optional(),
    copy_index: z.number().int().optional(),
    deactivate: z.boolean().optional(),
    target_ice_id: z.string().optional(),
    target_program_key: z.string().optional(),
    virus_desc: z.string().optional(),
    virus_dv: z.number().int().optional(),
    virus_actions: z.number().int().optional(),
    scanner_dv: z.number().int().optional(),
    ice_rolls: z.array(z.object({
      ice_roll: z.object({ first: z.number().int().min(1).max(10), extra: z.number().int().optional() }).optional(),
      runner_roll: z.object({ first: z.number().int().min(1).max(10), extra: z.number().int().optional() }).optional(),
      attack_roll: z.object({ first: z.number().int().min(1).max(10), extra: z.number().int().optional() }).optional(),
      defense_roll: z.object({ first: z.number().int().min(1).max(10), extra: z.number().int().optional() }).optional(),
      damage_dice: z.array(z.number().int().min(1).max(6)).optional(),
    })).optional(),
  }).optional(),
  // Multi-attack for ROF > 1
  attacks: z.array(SingleAttackInputSchema).optional(),
  // 状況修正（Phase 6h。日本語版コアルールブック p.130）
  situations: z.array(z.string()).optional(),
  situation_custom: z.number().optional(),
  // Manual / unconfirmed adjustments
  manual_changes: z.array(CombatChangeSchema).optional(),
  manual_notes: z.string().optional(),
});

export const ApplyActionInputSchema = ResolveActionInputSchema.extend({
  // Optional pre-verified changes or override
});
