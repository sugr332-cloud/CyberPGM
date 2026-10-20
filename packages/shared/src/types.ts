import { z } from 'zod';

export const ITEM_KINDS = [
  'weapon',
  'armor',
  'cyberware',
  'cyberdeck',
  'gear',
  'clothing',
  'ammo',
  'upgrade',
  'program',
  'vehicle',
  'drug',
] as const;

export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_ORIGINS = ['fvtt', 'manual', 'homebrew'] as const;
export type ItemOrigin = (typeof ITEM_ORIGINS)[number];

export const VERIFY_STATUSES = [
  'official_verified',
  'unofficial',
  'unverified',
  'homebrew',
] as const;
export type VerifyStatus = (typeof VERIFY_STATUSES)[number];

export const IMAGE_ORIGINS = ['book_scan', 'user', 'fvtt_icon'] as const;
export type ImageOrigin = (typeof IMAGE_ORIGINS)[number];

export const IMAGE_VISIBILITIES = ['gm', 'players'] as const;
export type ImageVisibility = (typeof IMAGE_VISIBILITIES)[number];

export const PRICE_CATEGORIES = [
  'cheap',
  'everyday',
  'costly',
  'premium',
  'expensive',
  'very_expensive',
  'luxury',
  'super_luxury',
] as const;
export type PriceCategory = (typeof PRICE_CATEGORIES)[number];

export interface PriceCategoryDef {
  max: number | null;
  key: PriceCategory;
  label_ja?: string;
}

export const DEFAULT_PRICE_CATEGORIES: PriceCategoryDef[] = [
  { max: 10, key: 'cheap' },
  { max: 20, key: 'everyday' },
  { max: 50, key: 'costly' },
  { max: 100, key: 'premium' },
  { max: 500, key: 'expensive' },
  { max: 1000, key: 'very_expensive' },
  { max: 5000, key: 'luxury' },
  { max: null, key: 'super_luxury' },
];

export interface Item {
  id: string;
  kind: ItemKind;
  name_en: string;
  name_ja: string | null;
  name_ja_override: string | null;
  summary_ja: string | null;
  description_en: string | null;
  price_eb: number | null;
  price_category: string | null;
  source_book: string | null;
  source_page_en: number | null;
  source_page_ja: number | null;
  origin: ItemOrigin;
  verify_status: VerifyStatus;
  fvtt_id: string | null;
  fvtt_type: string | null;
  raw_system: string | null;
  tags: string; // JSON array string
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface Weapon {
  item_id: string;
  weapon_type: string | null;
  skill: string | null;
  damage: string | null;
  rof: number | null;
  magazine_max: number | null;
  hands: number | null;
  concealable: boolean | null;
  quality: string | null;
  autofire: number | null;
  crit_fail_effect: string | null;
  dv_table_key: string | null;
  ammo_types: string | null; // JSON array string
  is_ranged: boolean | null;
}

export interface Armor {
  item_id: string;
  sp_head: number | null;
  sp_body: number | null;
  is_head: boolean | null;
  is_body: boolean | null;
  is_shield: boolean | null;
  shield_hp: number | null;
  penalty: number | null;
}

export interface Cyberware {
  item_id: string;
  cw_type: string | null;
  install_location: string | null;
  humanity_loss_roll: string | null;
  humanity_loss_static: number | null;
  is_core: boolean | null;
  slot_size: number | null;
}

export interface ImageRecord {
  id: string;
  item_id: string | null;
  path: string;
  origin: ImageOrigin;
  license: string | null;
  attribution: string | null;
  source_book: string | null;
  source_page: number | null;
  visibility: ImageVisibility;
  is_primary: boolean;
}

export interface RuleConstant {
  key: string;
  value: string; // JSON string
  source_page_ja: number | null;
  note: string | null;
}

export interface ImportRun {
  id: string;
  source: string;
  source_commit: string | null;
  started_at: number;
  finished_at: number | null;
  report: string | null; // JSON string
}

export interface ItemDetail extends Item {
  weapon?: Weapon | null;
  armor?: Armor | null;
  cyberware?: Cyberware | null;
  images: ImageRecord[];
}

export interface ItemsQueryParams {
  kind?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ImportReport {
  started_at: string;
  finished_at: string;
  counts_by_kind: Record<string, { added: number; updated: number; unchanged: number }>;
  total: { added: number; updated: number; unchanged: number };
  missing_name_ja: { id: string; fvtt_id: string; name_en: string; kind: string }[];
  missing_price: { id: string; fvtt_id: string; name_en: string; kind: string }[];
  missing_sources: { id: string; fvtt_id: string; name_en: string; kind: string }[];
  missing_images: { id: string; fvtt_id: string; name_en: string; img_path: string }[];
  missing_in_fvtt: { id: string; fvtt_id: string; name_en: string; kind: string }[];
}

export const ItemsQuerySchema = z.object({
  kind: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
});
