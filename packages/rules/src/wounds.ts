import { DEFAULT_RULES, RuleConstants } from './constants.js';

export type WoundState = 'ok' | 'seriously' | 'mortally' | 'dead';

/**
 * Determines wound state based on current and maximum HP.
 * - hp < 1: mortally wounded
 * - hp < ceil(maxHp / 2): seriously wounded
 * - otherwise: ok
 * Note: 'dead' is not returned by HP alone (it is triggered by failed death save).
 */
export function woundState(hp: number, maxHp: number): WoundState {
  if (hp < 1) {
    return 'mortally';
  }
  if (hp < Math.ceil(maxHp / 2)) {
    return 'seriously';
  }
  return 'ok';
}

/**
 * Returns modifier penalty for a wound state (0, -2, or -4).
 */
export function woundPenalty(
  state: WoundState,
  rules: RuleConstants = DEFAULT_RULES,
): number {
  switch (state) {
    case 'seriously':
      return rules.seriousWoundPenalty;
    case 'mortally':
    case 'dead':
      return rules.mortalWoundPenalty;
    case 'ok':
    default:
      return 0;
  }
}

export interface DeathSaveInput {
  roll: number;
  penalty?: number;
  body: number;
}

export interface DeathSaveResult {
  success: boolean;
  nextPenalty: number;
}

/**
 * Resolves a death save.
 * Roll of 10 always fails.
 * Success if (roll + penalty) < body.
 * On success, next penalty is incremented by 1.
 */
export function deathSave(input: DeathSaveInput): DeathSaveResult {
  if (!Number.isInteger(input.roll) || input.roll < 1 || input.roll > 10) {
    throw new Error(`Invalid death save roll: ${input.roll}. Must be an integer between 1 and 10.`);
  }

  const penalty = input.penalty ?? 0;

  // A natural roll of 10 is an automatic failure
  if (input.roll === 10) {
    return {
      success: false,
      nextPenalty: penalty,
    };
  }

  const total = input.roll + penalty;
  const success = total < input.body;

  return {
    success,
    nextPenalty: success ? penalty + 1 : penalty,
  };
}

/**
 * Max HP from BODY and WILL (FVTT cpr-actor.js: 10 + 5 * ceil((WILL + BODY) / 2)).
 */
export function hpMaxFromStats(body: number, will: number): number {
  return 10 + 5 * Math.ceil((body + will) / 2);
}

/**
 * 死亡セーヴ修正値の基本値を 1 増やす致命的損傷（日本語版 p.187・188）。2d6 の目で表す。
 * 身体: 片腕喪失・片手喪失・肺損傷・脊椎損傷・片脚喪失。頭部: 片目喪失・脳損傷・頸椎損傷・頭蓋損傷・気管損傷・片耳喪失
 */
export const DEATH_SAVE_BASE_INJURIES: Record<'body' | 'head', number[]> = {
  body: [2, 3, 4, 10, 12],
  head: [2, 3, 8, 9, 11, 12],
};

/** 頭部への致命的損傷「頭蓋損傷」の 2d6 の目。頭部への狙い撃ちが 3 倍になる（p.188） */
export const CRACKED_SKULL_ROLL = 9;

export interface InjuryRef {
  range?: [number, number];
  table?: 'body' | 'head';
  sources?: Array<{ page?: number }> | unknown;
}

/**
 * 致命的損傷がどちらの表のものか。table が無い古いデータは出典のページ（187 身体、188 頭部）で見分ける
 */
export function injuryTable(injury: InjuryRef): 'body' | 'head' | null {
  if (injury.table) return injury.table;
  const pages = Array.isArray(injury.sources) ? (injury.sources as Array<{ page?: number }>).map((s) => s?.page) : [];
  if (pages.includes(188)) return 'head';
  if (pages.includes(187)) return 'body';
  return null;
}

/** 受けている致命的損傷から、死亡セーヴ修正値の基本値を数える */
export function deathSaveBase(injuries: InjuryRef[] | null | undefined): number {
  return (injuries ?? []).filter((inj) => {
    const table = injuryTable(inj);
    return table !== null && inj.range !== undefined && DEATH_SAVE_BASE_INJURIES[table].includes(inj.range[0]);
  }).length;
}

/** 「頭蓋損傷」を受けているか */
export function hasCrackedSkull(injuries: InjuryRef[] | null | undefined): boolean {
  return (injuries ?? []).some((inj) => injuryTable(inj) === 'head' && inj.range?.[0] === CRACKED_SKULL_ROLL);
}
