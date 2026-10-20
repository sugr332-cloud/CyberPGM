import fs from 'node:fs';
import path from 'node:path';
import { getProjectRoot } from '@cyberpgm/shared';
import { skill_notes, rule_constants, app_settings } from './schema.js';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from './client.js';

export function initPhase3bData(dbInstance: AppDatabase) {
  const root = getProjectRoot();

  // 1. Seed skill_notes from docs/data/skill-notes.ja.json if missing
  const notesPath = path.join(root, 'docs/data/skill-notes.ja.json');
  if (fs.existsSync(notesPath)) {
    try {
      const raw = fs.readFileSync(notesPath, 'utf-8');
      const notesJson: Record<string, string> = JSON.parse(raw);
      const existing = dbInstance.select().from(skill_notes).all();
      const existingKeys = new Set(existing.map((n) => n.key));

      const now = Date.now();
      for (const [key, text] of Object.entries(notesJson)) {
        if (!existingKeys.has(key)) {
          dbInstance
            .insert(skill_notes)
            .values({
              key,
              text,
              updated_at: now,
            })
            .run();
        }
      }
    } catch (err) {
      console.warn('[initPhase3bData] Failed to seed skill-notes:', err);
    }
  }

  // 2. Seed default creation_method.complete_package in rule_constants if missing
  try {
    const existingMethod = dbInstance
      .select()
      .from(rule_constants)
      .where(eq(rule_constants.key, 'creation_method.complete_package'))
      .get();

    if (!existingMethod) {
      const defaultMethod = {
        key: 'complete_package',
        label: '完全版の作成方法（仮）',
        stat_points: null,
        stat_min: null,
        stat_max: null,
        skill_points: null,
        skill_level_max: null,
        basic_skill_min: null,
        difficult_cost: null,
        uses_starting_funds: true,
      };

      dbInstance
        .insert(rule_constants)
        .values({
          key: 'creation_method.complete_package',
          value: JSON.stringify(defaultMethod),
          source_page_ja: null,
          note: 'Default creation method (values null until verified, Issue #7)',
        })
        .run();
    }
  } catch (err) {
    console.warn('[initPhase3bData] Failed to seed creation_method in rule_constants:', err);
  }

  // 3. Seed active creation method in app_settings if missing
  try {
    const activeSetting = dbInstance
      .select()
      .from(app_settings)
      .where(eq(app_settings.key, 'creation_method_active'))
      .get();

    if (!activeSetting) {
      dbInstance
        .insert(app_settings)
        .values({
          key: 'creation_method_active',
          value: JSON.stringify('complete_package'),
        })
        .run();
    }
  } catch (err) {
    console.warn('[initPhase3bData] Failed to seed creation_method_active in app_settings:', err);
  }
}
