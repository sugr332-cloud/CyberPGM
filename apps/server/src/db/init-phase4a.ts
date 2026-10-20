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
