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

    // 計算するようにした行動の説明を差し替える（格闘は Phase 5l、応急手当は Phase 5m）。まだ「確認中」のままの DB だけ
    if (existing) {
      const actionsPath = path.join(root, 'docs/data/combat-actions.ja.json');
      const parsed = JSON.parse(fs.readFileSync(actionsPath, 'utf-8'));
      const fresh = (parsed.actions || parsed) as Array<{ key: string; status?: string; rev?: number }>;
      const current = JSON.parse(existing.value) as Array<{ key: string; status?: string; rev?: number }>;
      let changed = false;
      // 説明を差し替える: 格闘・応急手当は確認中のままの DB だけ（Phase 5l・5m）。rev が上がった行動はいつでも（Phase 5u）
      let next = current.map((a) => {
        const f = fresh.find((x) => x.key === a.key);
        if (['brawl', 'first_aid'].includes(a.key) && f && a.status === 'unconfirmed' && f.status === 'confirmed') {
          changed = true;
          return f;
        }
        if (f && (f.rev ?? 1) > (a.rev ?? 1)) {
          changed = true;
          return f;
        }
        return a;
      });
      // 新しく足した行動（武術・つかみなど）を、ファイルの順に入れる
      for (const [i, f] of fresh.entries()) {
        if (next.some((a) => a.key === f.key)) continue;
        const prevKey = fresh[i - 1]?.key;
        const at = prevKey ? next.findIndex((a) => a.key === prevKey) + 1 : 0;
        next = [...next.slice(0, at), f, ...next.slice(at)];
        changed = true;
      }
      if (changed) {
        dbInstance
          .update(rule_constants)
          .set({ value: JSON.stringify(next) })
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
