import fs from 'node:fs';
import path from 'node:path';
import { loreSearchTerms, normalizeLoreText, type LoreData, type LoreEntry } from '@cyberpgm/shared';
import { getCoreSourceDir } from '../source-data.js';

export function loadLoreData(): LoreData {
  try {
    return JSON.parse(fs.readFileSync(path.join(getCoreSourceDir(), 'lore.json'), 'utf8'));
  } catch {
    return { entries: [] };
  }
}

export function searchLore(entries: LoreEntry[], q = '', category = ''): LoreEntry[] {
  const terms = loreSearchTerms(q);
  return entries.filter((e) => {
    if (category && e.category !== category) return false;
    const text = normalizeLoreText([e.title, e.summary, ...(e.body ?? []), ...(e.tags ?? []), e.year ?? ''].join('\n'));
    return terms.every((term) => text.includes(term));
  }).sort((a, b) => {
    if (a.category === 'timeline' && b.category === 'timeline') {
      const year = (value?: string) => Number(normalizeLoreText(value ?? '').match(/\d+/)?.[0] ?? Infinity);
      const difference = year(a.year) - year(b.year);
      if (difference) return difference;
    } else if (a.category === 'timeline' || b.category === 'timeline') {
      return a.category === 'timeline' ? -1 : 1;
    }
    return Math.min(...a.pages) - Math.min(...b.pages) || a.id.localeCompare(b.id);
  });
}
