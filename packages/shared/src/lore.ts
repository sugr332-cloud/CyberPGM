import type { CharacterStats } from './types.js';

export interface LoreEntry {
  id: string;
  category: string;
  title: string;
  year?: string;
  pages: number[];
  summary: string;
  body: string[];
  tags: string[];
  related?: string[];
}

export interface LoreData {
  categories?: Record<string, string>;
  entries: LoreEntry[];
}

export interface NpcTemplate {
  key: string;
  name: string;
  tier: string;
  page: number;
  desc?: string;
  stats: CharacterStats;
  hp: number;
  seriously?: number;
  death_save?: number;
  armor: { name: string; head: number; body: number; penalty?: number };
  weapons: Array<{ name: string; damage: string }>;
  skills: Record<string, number>;
  role?: string;
  role_rank?: number;
  gear?: string[];
  programs?: string[];
}

export interface NpcTemplatesData {
  npcs: NpcTemplate[];
  tiers: Record<string, string>;
}

/** 資料の検索と強調表示に共通の正規化。 */
export function normalizeLoreText(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

export function loreSearchTerms(q: string): string[] {
  return normalizeLoreText(q).trim().split(/\s+/u).filter(Boolean);
}
