import fs from 'node:fs';
import path from 'node:path';
import { getProjectRoot } from '@cyberpgm/shared';
import { items } from './schema.js';
import { and, eq, isNull } from 'drizzle-orm';
import type { AppDatabase } from './client.js';

export interface ItemNote {
  effect: string;
  flavor: string;
}

/** docs/data/item-notes.ja.json の下書き（キーは FVTT の id） */
export function loadItemNotes(): Record<string, ItemNote> {
  const notesPath = path.join(getProjectRoot(), 'docs/data/item-notes.ja.json');
  if (!fs.existsSync(notesPath)) return {};
  const parsed = JSON.parse(fs.readFileSync(notesPath, 'utf-8'));
  return parsed && typeof parsed.notes === 'object' && parsed.notes !== null ? parsed.notes : {};
}

/**
 * 品目の効果とフレーバーの下書きを入れる（Phase 5c）。
 * まだ入っていない品目（effect_ja が null）にだけ入れる。GM が編集した値は上書きしない。
 */
export function initPhase5cData(dbInstance: AppDatabase) {
  try {
    const notes = loadItemNotes();
    const pending = dbInstance.select().from(items).where(isNull(items.effect_ja)).all();
    for (const item of pending) {
      const note = item.fvtt_id ? notes[item.fvtt_id] : undefined;
      if (!note) continue;
      dbInstance
        .update(items)
        .set({ effect_ja: note.effect, flavor_ja: note.flavor, effect_is_draft: true, flavor_is_draft: true })
        .where(and(eq(items.id, item.id), isNull(items.effect_ja)))
        .run();
    }
  } catch (err) {
    console.warn('[initPhase5cData] Failed to seed item notes:', err);
  }
}
