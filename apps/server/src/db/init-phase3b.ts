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
      const parsed = JSON.parse(raw);
      const notesJson: Record<string, string> =
        parsed && typeof parsed.notes === 'object' && parsed.notes !== null
          ? parsed.notes
          : parsed;
      const existing = dbInstance.select().from(skill_notes).all();
      const existingKeys = new Set(existing.map((n) => n.key));

      const now = Date.now();
      for (const [key, text] of Object.entries(notesJson)) {
        if (key === '_note' || typeof text !== 'string') continue;
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

  // 2. 作成方法を用意する（Phase 5t。日本語版コアルールブック p.73〜104）。
  //    ストリートラット・エッジランナー・スクラッチビルドの 3 つ。GM が値を変えたものは上書きしない。
  //    以前の仮の complete_package（値がすべて未設定）はスクラッチビルドの値にする
  try {
    const methods = [
      {
        key: 'streetrat',
        label: 'ストリートラット（テンプレート）方式',
        stat_points: null,
        stat_min: null,
        stat_max: null,
        skill_points: 86,
        skill_level_max: 6,
        basic_skill_min: 2,
        difficult_cost: 2,
        uses_starting_funds: true,
        template: 'streetrat',
        starting_funds_default: 500,
      },
      {
        key: 'edgerunner',
        label: 'エッジランナー（簡易選択）方式',
        stat_points: null,
        stat_min: null,
        stat_max: null,
        skill_points: 86,
        skill_level_max: 6,
        basic_skill_min: 2,
        difficult_cost: 2,
        uses_starting_funds: true,
        template: 'edgerunner',
        starting_funds_default: 500,
      },
      {
        key: 'complete_package',
        label: 'スクラッチビルド（自由配分）方式',
        stat_points: 62,
        stat_min: 2,
        stat_max: 8,
        skill_points: 86,
        skill_level_max: 6,
        basic_skill_min: 2,
        difficult_cost: 2,
        uses_starting_funds: true,
        template: null,
        starting_funds_default: 2550,
      },
    ];
    for (const m of methods) {
      const key = `creation_method.${m.key}`;
      const existing = dbInstance.select().from(rule_constants).where(eq(rule_constants.key, key)).get();
      let placeholder = false;
      if (existing) {
        try {
          const cur = JSON.parse(existing.value);
          placeholder = cur.label === '完全版の作成方法（仮）' && cur.stat_points === null && cur.skill_points === null;
        } catch {
          placeholder = true;
        }
      }
      if (!existing) {
        dbInstance
          .insert(rule_constants)
          .values({ key, value: JSON.stringify(m), source_page_ja: 73, note: 'Creation method (Japanese core rulebook p.73-104)' })
          .run();
      } else if (placeholder) {
        dbInstance.update(rule_constants).set({ value: JSON.stringify(m), source_page_ja: 73 }).where(eq(rule_constants.key, key)).run();
      }
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
