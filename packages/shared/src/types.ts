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
  suppressive?: boolean | null;
  ignore_armor_percent?: number | null;
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

export interface DvTableEntry {
  range: [number, number];
  dv: number | string;
}

export type DvTable = DvTableEntry[];

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
  price_category: z.string().optional(),
  weapon_type: z.string().optional(),
  concealable: z.coerce.boolean().optional(),
  quality: z.string().optional(),
  verify_status: z.string().optional(),
  sort: z.enum(['price_asc', 'price_desc', 'name_asc', 'name_desc', 'damage_desc', 'sp_desc']).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().min(1).max(1000).default(200),
  offset: z.coerce.number().min(0).default(0),
});

// Phase 2 Types

export interface CharacterStats {
  int: number;
  ref: number;
  dex: number;
  tech: number;
  cool: number;
  will: number;
  luck: number;
  move: number;
  body: number;
  emp: number;
}

export interface CyberwareEntry {
  item_id?: string;
  name: string;
  type?: string;
  static_loss?: number;
}

export interface InventoryEntry {
  entry_id: string;
  item_id?: string;
  name: string;
  kind?: string;
  qty: number;
  equipped?: boolean;
  ammo?: number;
  ignore_armor_percent?: number | null;
  notes?: string;
}

/**
 * キャラクターのそのほかの記録（Phase 5v〜）。DB の characters.extra（JSON）
 */
export interface CharacterExtra {
  /** このセッションで使った【運命】点。残り = 【運命】 − これ。セッションの始めに 0 に戻す（日本語版 p.130） */
  luck_used?: number;
  /** 真空にさらされて減った能力値（空気を吸えば戻る。p.180） */
  vacuum_loss?: Partial<Record<'int' | 'ref' | 'dex', number>>;
  [key: string]: unknown;
}

export interface Character {
  id: string;
  kind: 'pc' | 'npc' | 'mook';
  name: string;
  role: string;
  image_id?: string | null;
  portrait_image_id?: string | null;
  image_path?: string | null;
  stats: CharacterStats;
  skills: Record<string, number>;
  hp: number;
  hp_max: number;
  sp_head: number;
  sp_body: number;
  humanity: number;
  emp_max: number;
  cyberware: CyberwareEntry[];
  weapons: string[];
  inventory: InventoryEntry[];
  status: string[];
  crit_injuries: unknown[];
  extra?: CharacterExtra;
  eb: number;
  notes_gm?: string | null;
  player_id?: string | null; // 持ち主のプレイヤー（Phase 5i）
  scenario_id?: string | null; // 参加中で未クリアのシナリオ（Phase 5i）
  armor_penalty?: number; // 着ている防具の一番大きいペナルティ。REF・DEX・MOVE から引く（Phase 5m）
  created_at: number;
  updated_at: number;
}

export interface CharacterSheetSkillItem {
  key: string;
  name: string;
  statKey: keyof CharacterStats;
  statValue: number;
  level: number;
  base: number; // statValue + level - woundPenalty
}

export interface CharacterSheet extends Character {
  maxHumanity: number;
  currentEmp: number;
  woundState: 'ok' | 'seriously' | 'mortally' | 'dead';
  woundPenalty: number;
  skillsList: CharacterSheetSkillItem[];
}

export interface DeviceInfo {
  id: string;
  role: 'gm' | 'player';
  character_id?: string | null;
  character_name?: string | null;
  label?: string | null;
  last_seen_at: number;
  online: boolean;
}

export interface SessionInfo {
  code: string;
  joinUrl: string;
  qrSvg: string;
  devices: DeviceInfo[];
}

export interface MoneyLogEntry {
  id: string;
  character_id: string;
  character_name?: string;
  amount: number;
  reason: string;
  balance_after: number;
  at: number;
}

export interface CharLogEntry {
  id: string;
  character_id: string;
  text: string;
  at: number;
}

export interface AppSettings {
  starting_funds: number | null;
}

export interface SaveFile {
  format: 'cpgm-save';
  version: number;
  savedAt: number;
  name: string;
  characters: Character[];
  players?: Array<{ id: string; name: string; created_at: number; updated_at: number }>;
  money_log: MoneyLogEntry[];
  char_log: CharLogEntry[];
  app_settings: Record<string, unknown>;
  shops?: Shop[];
  shop_stock?: ShopStockItem[];
  transactions?: Transaction[];
  character_submissions?: unknown[];
  skill_notes?: unknown[];
  combats?: unknown[];
  combat_participants?: unknown[];
  combat_log?: unknown[];
  boards?: unknown[];
  board_objects?: unknown[];
  board_tokens?: unknown[];
  board_drops?: unknown[];
  scenarios?: unknown[];
  scenario_versions?: unknown[];
  scenes?: unknown[];
  scene_links?: unknown[];
  scene_choices?: unknown[];
  clues?: unknown[];
  handouts?: unknown[];
  encounters?: unknown[];
  random_tables?: unknown[];
  scenario_sessions?: unknown[];
  session_log?: unknown[];
  story_checks?: unknown[];
  item_notes?: Array<{ fvtt_id: string; effect_ja: string | null; flavor_ja: string | null }>;
}

export interface Shop {
  id: string;
  name: string;
  price_multiplier: number;
  buyback_rate: number;
  categories: string[];
  created_at: number;
  updated_at: number;
}

export interface ShopStockItem {
  id: string;
  shop_id: string;
  item_id: string;
  quantity: number | null; // null = unlimited
  item?: Item;
}

export interface TransactionLine {
  item_id: string;
  name: string;
  qty: number;
  unit_price: number;
  overridden?: boolean;
}

export interface Transaction {
  id: string;
  character_id: string;
  character_name?: string;
  shop_id: string | null;
  shop_name?: string | null;
  kind: 'buy' | 'sell';
  lines: TransactionLine[];
  total_eb: number;
  at: number;
}

export interface PurchaseLineInput {
  item_id: string;
  qty: number;
  unit_price_override?: number;
}

export interface InstallCyberwareInput {
  item_id: string;
  humanity_loss?: number;
}

export interface PurchaseInput {
  character_id: string;
  shop_id?: string | null;
  lines: PurchaseLineInput[];
  install_cyberware?: InstallCyberwareInput[];
}

export interface SellEntryInput {
  entry_id: string;
  qty: number;
}

export interface SellInput {
  character_id: string;
  shop_id?: string | null;
  entries: SellEntryInput[];
}

export interface PriceCategoryConfig {
  key: string;
  max: number;
  label_ja?: string;
}

export interface ItemPatchInput {
  name_ja_override?: string | null;
  summary_ja?: string | null;
  source_page_ja?: number | null;
  verify_status?: 'official_verified' | 'unofficial' | 'unverified' | 'homebrew';
  tags?: string[];
  notes?: string | null;
  effect_ja?: string | null;
  flavor_ja?: string | null;
}

export interface SaveSummary {
  id: string;
  name: string;
  kind: 'manual' | 'auto';
  summary: string | null;
  file: string;
  created_at: number;
  updated_at: number;
}

export type WsNotifyKind = 'money' | 'info';

export interface WsNotifyPayload {
  kind: WsNotifyKind;
  title: string;
  body: string;
}

export interface WsClaimRequestPayload {
  requestId: string;
  character_id: string;
  character_name: string;
  deviceLabel?: string;
}
