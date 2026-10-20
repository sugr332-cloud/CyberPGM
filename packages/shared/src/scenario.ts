import { z } from 'zod';

export const ChoiceOutcomeKindEnum = z.enum([
  'next_scene',
  'reveal_clue',
  'reveal_handout',
  'hp_change',
  'add_status',
  'get_item',
  'memo',
]);
export type ChoiceOutcomeKind = z.infer<typeof ChoiceOutcomeKindEnum>;

export const ChoiceOutcomeSchema = z.object({
  kind: ChoiceOutcomeKindEnum,
  scene_id: z.string().optional(),
  clue_id: z.string().optional(),
  handout_id: z.string().optional(),
  amount: z.number().optional(),
  target: z.string().optional(),
  status: z.string().optional(),
  item_name: z.string().optional(),
  item_id: z.string().optional(),
  qty: z.number().optional(),
  text: z.string().optional(),
});
export type ChoiceOutcome = z.infer<typeof ChoiceOutcomeSchema>;

export const SceneChoiceSchema = z.object({
  id: z.string(),
  scene_id: z.string(),
  label: z.string().min(1, 'ラベルを入力してください'),
  skill_key: z.string().nullable().optional(),
  dv: z.number().int().nullable().optional(),
  who: z.string().default('全員'),
  on_success: z.array(ChoiceOutcomeSchema).default([]),
  on_failure: z.array(ChoiceOutcomeSchema).default([]),
  sort_index: z.number().int().default(0),
});
export type SceneChoice = z.infer<typeof SceneChoiceSchema>;

export const SceneSchema = z.object({
  id: z.string(),
  scenario_id: z.string(),
  title: z.string().min(1, 'タイトルを入力してください'),
  read_aloud: z.string().default(''),
  gm_notes: z.string().default(''),
  location: z.string().default(''),
  npc_ids: z.array(z.string()).default([]),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 100, y: 100 }),
  background_image_id: z.string().nullable().optional(),
  board_id: z.string().nullable().optional(),
  sort_index: z.number().int().default(0),
  is_adhoc: z.boolean().default(false),
});
export type Scene = z.infer<typeof SceneSchema>;

export const SceneLinkSchema = z.object({
  id: z.string(),
  scenario_id: z.string(),
  from_scene_id: z.string(),
  to_scene_id: z.string(),
  condition: z.string().default(''),
});
export type SceneLink = z.infer<typeof SceneLinkSchema>;

export const ClueSchema = z.object({
  id: z.string(),
  scenario_id: z.string(),
  scene_id: z.string().nullable().optional(),
  title: z.string().min(1, 'タイトルを入力してください'),
  body: z.string().default(''),
  image_id: z.string().nullable().optional(),
});
export type Clue = z.infer<typeof ClueSchema>;

export const HandoutSchema = z.object({
  id: z.string(),
  scenario_id: z.string(),
  scene_id: z.string().nullable().optional(),
  title: z.string().min(1, 'タイトルを入力してください'),
  body: z.string().default(''),
  image_id: z.string().nullable().optional(),
});
export type Handout = z.infer<typeof HandoutSchema>;

export const EncounterParticipantSchema = z.object({
  character_id: z.string(),
  side: z.enum(['ally', 'enemy']).default('enemy'),
  count: z.number().int().positive().default(1),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
});
export type EncounterParticipant = z.infer<typeof EncounterParticipantSchema>;

export const EncounterSchema = z.object({
  id: z.string(),
  scenario_id: z.string(),
  scene_id: z.string().nullable().optional(),
  title: z.string().min(1, 'タイトルを入力してください'),
  participants: z.array(EncounterParticipantSchema).default([]),
  notes: z.string().default(''),
});
export type Encounter = z.infer<typeof EncounterSchema>;

export const RandomTableRowSchema = z.object({
  from: z.number().int(),
  to: z.number().int(),
  text: z.string(),
});
export type RandomTableRow = z.infer<typeof RandomTableRowSchema>;

export const RandomTableSchema = z.object({
  id: z.string(),
  scenario_id: z.string().nullable().optional(),
  title: z.string().min(1, 'タイトルを入力してください'),
  dice: z.string().min(1, 'ダイスを指定してください'),
  rows: z.array(RandomTableRowSchema).default([]),
});
export type RandomTable = z.infer<typeof RandomTableSchema>;

export const ScenarioMetaSchema = z.object({
  players_min: z.number().int().positive().optional(),
  players_max: z.number().int().positive().optional(),
  hours: z.number().positive().optional(),
  reward_note: z.string().optional(),
  tags: z.array(z.string()).default([]),
  shop_ids: z.array(z.string()).default([]),
});
export type ScenarioMeta = z.infer<typeof ScenarioMetaSchema>;

export const ScenarioSchema = z.object({
  id: z.string(),
  title: z.string().min(1, 'タイトルを入力してください'),
  summary: z.string().default(''),
  meta: ScenarioMetaSchema.default({}),
  version: z.number().int().default(1),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export const ScenarioVersionSchema = z.object({
  id: z.string(),
  scenario_id: z.string(),
  version: z.number().int(),
  snapshot: z.string(), // JSON of ScenarioFull
  saved_at: z.number().int(),
});
export type ScenarioVersion = z.infer<typeof ScenarioVersionSchema>;

export const ScenarioFullSchema = z.object({
  scenario: ScenarioSchema,
  scenes: z.array(SceneSchema).default([]),
  links: z.array(SceneLinkSchema).default([]),
  choices: z.array(SceneChoiceSchema).default([]),
  clues: z.array(ClueSchema).default([]),
  handouts: z.array(HandoutSchema).default([]),
  encounters: z.array(EncounterSchema).default([]),
  random_tables: z.array(RandomTableSchema).default([]),
});
export type ScenarioFull = z.infer<typeof ScenarioFullSchema>;

// Helpers for dice expressions and random table validation
export function parseDiceExpression(dice: string): { count: number; sides: number; min: number; max: number } | null {
  const trimmed = dice.trim().toLowerCase();
  const match = trimmed.match(/^(\d*)d(\d+)$/);
  if (!match) return null;
  const count = match[1] ? parseInt(match[1], 10) : 1;
  const sides = parseInt(match[2], 10);
  if (count <= 0 || sides <= 0) return null;
  return {
    count,
    sides,
    min: count,
    max: count * sides,
  };
}

export function rollDiceExpression(dice: string): number {
  const parsed = parseDiceExpression(dice);
  if (!parsed) return 1;
  let sum = 0;
  for (let i = 0; i < parsed.count; i++) {
    sum += Math.floor(Math.random() * parsed.sides) + 1;
  }
  return sum;
}

export function validateRandomTableRanges(
  dice: string,
  rows: RandomTableRow[]
): { valid: boolean; warnings: string[]; minDice?: number; maxDice?: number } {
  const warnings: string[] = [];
  const parsed = parseDiceExpression(dice);
  const minDice = parsed?.min;
  const maxDice = parsed?.max;

  if (rows.length === 0) {
    warnings.push('行が設定されていません');
    return { valid: false, warnings, minDice, maxDice };
  }

  // Check individual row validity (from <= to)
  for (const row of rows) {
    if (row.from > row.to) {
      warnings.push(`無効な範囲: 開始値 (${row.from}) が終了値 (${row.to}) より大きくなっています`);
    }
  }

  // Sort rows by from
  const sorted = [...rows].sort((a, b) => a.from - b.from);

  // Check overlap
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    if (cur.to >= next.from) {
      warnings.push(`範囲の重複: [${cur.from}〜${cur.to}] と [${next.from}〜${next.to}] が重複しています`);
    }
  }

  // Check gaps between rows
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    if (next.from > cur.to + 1) {
      warnings.push(`範囲の抜け: 出目 ${cur.to + 1}〜${next.from - 1} が未定義です`);
    }
  }

  // Check bounds with dice min/max if dice expression is recognized
  if (minDice !== undefined && sorted[0].from > minDice) {
    warnings.push(`最小出目 ${minDice}〜${sorted[0].from - 1} が未定義です`);
  }
  if (maxDice !== undefined && sorted[sorted.length - 1].to < maxDice) {
    warnings.push(`最大出目 ${sorted[sorted.length - 1].to + 1}〜${maxDice} が未定義です`);
  }

  return {
    valid: warnings.length === 0,
    warnings,
    minDice,
    maxDice,
  };
}

export function evaluateRandomTableRoll(rows: RandomTableRow[], roll: number): RandomTableRow | null {
  return rows.find((r) => r.from <= roll && roll <= r.to) || null;
}

// ==========================================
// Phase 5b Scenario Play Schemas & Types
// ==========================================

export const RevealedDataSchema = z.object({
  clue_ids: z.array(z.string()).default([]),
  handout_ids: z.array(z.string()).default([]),
});
export type RevealedData = z.infer<typeof RevealedDataSchema>;

export const ScenarioSessionSchema = z.object({
  id: z.string(),
  scenario_id: z.string(),
  current_scene_id: z.string().nullable().optional(),
  started_at: z.number(),
  ended_at: z.number().nullable().optional(),
  revealed: RevealedDataSchema.default({ clue_ids: [], handout_ids: [] }),
});
export type ScenarioSession = z.infer<typeof ScenarioSessionSchema>;

export const SessionLogKindEnum = z.enum([
  'note',
  'scene',
  'check',
  'combat',
  'transaction',
  'money',
  'reveal',
]);
export type SessionLogKind = z.infer<typeof SessionLogKindEnum>;

export const SessionLogEntrySchema = z.object({
  id: z.string(),
  scenario_session_id: z.string(),
  at: z.number(),
  kind: SessionLogKindEnum,
  text: z.string(),
  ref: z.record(z.any()).nullable().optional(),
});
export type SessionLogEntry = z.infer<typeof SessionLogEntrySchema>;

export const OpposedCheckInfoSchema = z.object({
  target_character_id: z.string(),
  skill_key: z.string().optional(),
  roll: z.number().optional(),
  rolls: z.array(z.number()).optional(),
});
export type OpposedCheckInfo = z.infer<typeof OpposedCheckInfoSchema>;

export const StoryCheckSchema = z.object({
  id: z.string(),
  scenario_session_id: z.string(),
  scene_id: z.string().nullable().optional(),
  choice_id: z.string().nullable().optional(),
  actor_character_id: z.string(),
  skill_key: z.string().nullable().optional(),
  dv: z.number().int().nullable().optional(),
  opposed: OpposedCheckInfoSchema.nullable().optional(),
  rolls: z.array(z.number()).default([]),
  result: z.enum(['success', 'failure', 'draw']).nullable().optional(),
  applied_log_id: z.string().nullable().optional(),
});
export type StoryCheck = z.infer<typeof StoryCheckSchema>;

