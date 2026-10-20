import { z } from 'zod';

export interface BoardGrid {
  show: boolean;
  cell_m: number;
  origin_x: number;
  origin_y: number;
  cell_px: number;
  cols: number;
  rows: number;
}

export const BoardGridSchema = z.object({
  show: z.boolean().default(true),
  cell_m: z.number().default(2),
  origin_x: z.number().default(0),
  origin_y: z.number().default(0),
  cell_px: z.number().default(40),
  cols: z.number().int().positive().default(20),
  rows: z.number().int().positive().default(15),
});

export type BoardObjectKind = 'wall' | 'crate' | 'container' | 'vehicle' | 'other';
export type BlocksLos = 'none' | 'partial' | 'full';

export interface BoardObject {
  id: string;
  board_id: string;
  kind: BoardObjectKind;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number; // 0 | 90 | 180 | 270
  passable: boolean;
  blocks_los: BlocksLos;
  cover_hp: number | null;
  cover_hp_max: number | null;
}

export const BoardObjectSchema = z.object({
  id: z.string(),
  board_id: z.string(),
  kind: z.enum(['wall', 'crate', 'container', 'vehicle', 'other']),
  label: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  rotation: z.number().int().default(0),
  passable: z.boolean().default(true),
  blocks_los: z.enum(['none', 'partial', 'full']).default('none'),
  cover_hp: z.number().int().nullable().optional(),
  cover_hp_max: z.number().int().nullable().optional(),
});

export interface BoardToken {
  id: string;
  board_id: string;
  character_id: string | null;
  x: number;
  y: number;
  gm_only: boolean;
  name?: string | null;
  side?: 'ally' | 'enemy' | null;
  wound_state?: 'ok' | 'seriously' | 'mortally' | 'dead' | null;
  hp?: number | null;
  hp_max?: number | null;
}

export const BoardTokenSchema = z.object({
  id: z.string(),
  board_id: z.string(),
  character_id: z.string().nullable().optional(),
  x: z.number().int(),
  y: z.number().int(),
  gm_only: z.boolean().default(false),
  name: z.string().nullable().optional(),
  side: z.enum(['ally', 'enemy']).nullable().optional(),
  wound_state: z.enum(['ok', 'seriously', 'mortally', 'dead']).nullable().optional(),
  hp: z.number().int().nullable().optional(),
  hp_max: z.number().int().nullable().optional(),
});

export interface BoardDrop {
  id: string;
  board_id: string;
  x: number;
  y: number;
  inventory_entry: unknown;
  from_character_id: string | null;
}

export const BoardDropSchema = z.object({
  id: z.string(),
  board_id: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  inventory_entry: z.unknown(),
  from_character_id: z.string().nullable().optional(),
});

export interface Board {
  id: string;
  name: string;
  background_image_id: string | null;
  grid: BoardGrid;
  created_at: number;
  updated_at: number;
  fog?: { x: number; y: number }[];
  objects?: BoardObject[];
  tokens?: BoardToken[];
  drops?: BoardDrop[];
  background_image_path?: string | null;
  background_image_visibility?: string | null;
}

export const BoardSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  background_image_id: z.string().nullable().optional(),
  grid: BoardGridSchema,
  created_at: z.number().int(),
  updated_at: z.number().int(),
  fog: z.array(z.object({ x: z.number().int(), y: z.number().int() })).optional().default([]),
  objects: z.array(BoardObjectSchema).optional(),
  tokens: z.array(BoardTokenSchema).optional(),
  drops: z.array(BoardDropSchema).optional(),
  background_image_path: z.string().nullable().optional(),
  background_image_visibility: z.string().nullable().optional(),
});

export const BoardCreateInputSchema = z.object({
  name: z.string().min(1),
  background_image_id: z.string().nullable().optional(),
  grid: BoardGridSchema.partial().optional(),
});

export const BoardUpdateInputSchema = BoardCreateInputSchema.partial();

export const BoardObjectCreateInputSchema = z.object({
  kind: z.enum(['wall', 'crate', 'container', 'vehicle', 'other']),
  label: z.string().default(''),
  x: z.number().int().default(0),
  y: z.number().int().default(0),
  w: z.number().int().positive().default(1),
  h: z.number().int().positive().default(1),
  rotation: z.number().int().default(0),
  passable: z.boolean().default(true),
  blocks_los: z.enum(['none', 'partial', 'full']).default('none'),
  cover_hp: z.number().int().nullable().optional(),
  cover_hp_max: z.number().int().nullable().optional(),
});

export const BoardObjectUpdateInputSchema = BoardObjectCreateInputSchema.partial();

export const BoardTokenCreateInputSchema = z.object({
  character_id: z.string().nullable().optional(),
  x: z.number().int(),
  y: z.number().int(),
  gm_only: z.boolean().default(false),
});

export const BoardTokenUpdateInputSchema = BoardTokenCreateInputSchema.partial();

export const BoardDropCreateInputSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  inventory_entry: z.unknown(),
  from_character_id: z.string().nullable().optional(),
});
