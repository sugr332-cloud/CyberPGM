import { DEFAULT_RULES, RuleConstants } from './constants.js';
import { resolveD10 } from './dice.js';

export interface InitiativeResult {
  total: number;
  needsExtra: boolean;
}

/**
 * Calculates initiative total: REF + 1d10.
 * If initiativeCrit is true, 10 and 1 triggers exploding / fumbling extra roll.
 */
export function initiativeTotal(
  ref: number,
  first: number,
  extra?: number,
  rules: RuleConstants = DEFAULT_RULES,
): InitiativeResult {
  if (rules.initiativeCrit) {
    const d10 = resolveD10(first, extra);
    return {
      total: ref + d10.value,
      needsExtra: d10.needsExtra,
    };
  }

  if (!Number.isInteger(first) || first < 1 || first > 10) {
    throw new Error(`Invalid d10 roll: ${first}. Must be between 1 and 10.`);
  }

  return {
    total: ref + first,
    needsExtra: false,
  };
}

export interface InitiativeEntry {
  id: string;
  total: number;
  ref: number;
  [key: string]: unknown;
}

export interface InitiativeEntryResult extends InitiativeEntry {
  needsReroll: boolean;
}

/**
 * Sorts initiative entries descending by total.
 * - tieBreak 'ref': higher REF breaks tie; identical REF marks needsReroll: true (order preserved).
 * - tieBreak 'manual': any tie in total marks needsReroll: true (order preserved).
 */
export function sortInitiative(
  entries: InitiativeEntry[],
  tieBreak: 'ref' | 'manual',
): InitiativeEntryResult[] {
  // Preserve original order with indices for stable tie handling
  const indexed = entries.map((e, index) => ({ ...e, originalIndex: index }));

  if (tieBreak === 'manual') {
    // Group by total
    const totalCounts = new Map<number, number>();
    for (const e of entries) {
      totalCounts.set(e.total, (totalCounts.get(e.total) ?? 0) + 1);
    }

    indexed.sort((a, b) => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      return a.originalIndex - b.originalIndex;
    });

    return indexed.map(({ originalIndex: _, ...item }) => ({
      ...item,
      needsReroll: (totalCounts.get(item.total) ?? 0) > 1,
    }));
  }

  // tieBreak === 'ref'
  // Group by (total, ref) to detect unresolvable ties
  const totalRefCounts = new Map<string, number>();
  for (const e of entries) {
    const key = `${e.total}:${e.ref}`;
    totalRefCounts.set(key, (totalRefCounts.get(key) ?? 0) + 1);
  }

  indexed.sort((a, b) => {
    if (b.total !== a.total) {
      return b.total - a.total;
    }
    if (b.ref !== a.ref) {
      return b.ref - a.ref;
    }
    return a.originalIndex - b.originalIndex;
  });

  return indexed.map(({ originalIndex: _, ...item }) => {
    const key = `${item.total}:${item.ref}`;
    return {
      ...item,
      needsReroll: (totalRefCounts.get(key) ?? 0) > 1,
    };
  });
}
