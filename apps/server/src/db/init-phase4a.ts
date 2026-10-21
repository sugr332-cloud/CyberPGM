import fs from 'node:fs';
import path from 'node:path';
import { getProjectRoot } from '@cyberpgm/shared';
import { rule_constants } from './schema.js';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from './client.js';

export function initPhase4aData(dbInstance: AppDatabase) {
  const root = getProjectRoot();

  // Seed rule_constants 'combat_actions' from docs/data/combat-actions.ja.json if missing
  try {
    const existing = dbInstance
      .select()
      .from(rule_constants)
      .where(eq(rule_constants.key, 'combat_actions'))
      .get();

    // 格闘の説明を差し替える（Phase 5l で計算するようにした。古い「表の確認中」のままの DB だけ）
    if (existing && existing.value.includes('表の確認中')) {
      const actionsPath = path.join(root, 'docs/data/combat-actions.ja.json');
      const parsed = JSON.parse(fs.readFileSync(actionsPath, 'utf-8'));
      const fresh = ((parsed.actions || parsed) as Array<{ key: string }>).find((a) => a.key === 'brawl');
      const current = JSON.parse(existing.value) as Array<{ key: string }>;
      if (fresh) {
        dbInstance
          .update(rule_constants)
          .set({ value: JSON.stringify(current.map((a) => (a.key === 'brawl' ? fresh : a))) })
          .where(eq(rule_constants.key, 'combat_actions'))
          .run();
      }
    }

    if (!existing) {
      const actionsPath = path.join(root, 'docs/data/combat-actions.ja.json');
      if (fs.existsSync(actionsPath)) {
        const raw = fs.readFileSync(actionsPath, 'utf-8');
        const parsed = JSON.parse(raw);
        // store the actions array as JSON string
        const actionsData = parsed.actions || parsed;
        dbInstance
          .insert(rule_constants)
          .values({
            key: 'combat_actions',
            value: JSON.stringify(actionsData),
            note: 'Combat action buttons definition from docs/data/combat-actions.ja.json',
          })
          .run();
      }
    }
  } catch (err) {
    console.warn('[initPhase4aData] Failed to seed combat_actions:', err);
  }
}
