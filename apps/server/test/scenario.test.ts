import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/index.js';
import { db, sqlite } from '../src/db/client.js';
import { scenarios, scenes, scene_links, scene_choices, random_tables } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { runDemoSeed } from '../src/db/seed-demo.js';
import { validateRandomTableRanges } from '@cyberpgm/shared';

describe('Scenario Maker API (Phase 5a)', () => {
  let gmToken: string;

  beforeAll(async () => {
    runDemoSeed();
    const gmLogin = await app.request('/api/auth/gm-token', {
      method: 'POST',
    });
    const data = await gmLogin.json();
    gmToken = data.token;
  });

  describe('Scenario CRUD, Duplicate, Export, Import', () => {
    let scenarioId: string;
    let sceneId: string;

    it('creates a scenario without template', async () => {
      const res = await app.request('/api/scenarios', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({
          title: 'ナイトシティ・ハック',
          summary: 'ネットランナーからの依頼',
          meta: { players_min: 3, players_max: 4, hours: 3 },
          use_template: false,
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.scenario.title).toBe('ナイトシティ・ハック');
      expect(data.scenario.version).toBe(1);
      expect(data.scenes.length).toBe(0);
      scenarioId = data.scenario.id;
    });

    it('adds a scene and a choice to the scenario', async () => {
      const sceneRes = await app.request(`/api/scenarios/${scenarioId}/scenes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({
          title: 'バー・アフターライフ',
          read_aloud: '紫のネオンが薄暗い店内に反射している。',
          gm_notes: 'NPCフィクサーが待っている。',
          location: 'リトル・チャイナ',
        }),
      });

      expect(sceneRes.status).toBe(201);
      const sceneData = await sceneRes.json();
      expect(sceneData.title).toBe('バー・アフターライフ');
      sceneId = sceneData.id;

      // Add choice
      const choiceRes = await app.request(`/api/scenarios/scenes/${sceneId}/choices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({
          label: 'フィクサーと交渉する',
          skill_key: 'persuasion',
          dv: 13,
          who: '全員',
          on_success: [{ kind: 'memo', text: '報酬が200eb増える' }],
          on_failure: [{ kind: 'memo', text: '基本報酬のまま' }],
        }),
      });

      expect(choiceRes.status).toBe(201);
      const choiceData = await choiceRes.json();
      expect(choiceData.label).toBe('フィクサーと交渉する');
      expect(choiceData.dv).toBe(13);
    });

    it('duplicates the scenario with fresh IDs', async () => {
      const dupRes = await app.request(`/api/scenarios/${scenarioId}/duplicate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${gmToken}`,
        },
      });

      expect(dupRes.status).toBe(201);
      const dupData = await dupRes.json();
      expect(dupData.scenario.id).not.toBe(scenarioId);
      expect(dupData.scenario.title).toBe('ナイトシティ・ハック (コピー)');
      expect(dupData.scenes.length).toBe(1);
      expect(dupData.scenes[0].id).not.toBe(sceneId);
      expect(dupData.scenes[0].title).toBe('バー・アフターライフ');
      expect(dupData.choices.length).toBe(1);
      expect(dupData.choices[0].label).toBe('フィクサーと交渉する');
    });

    it('exports and imports scenario with fresh IDs', async () => {
      // Export
      const expRes = await app.request(`/api/scenarios/${scenarioId}/export`, {
        headers: { Authorization: `Bearer ${gmToken}` },
      });
      expect(expRes.status).toBe(200);
      const exportedJson = await expRes.json();
      expect(exportedJson.scenario.title).toBe('ナイトシティ・ハック');

      // Import
      const impRes = await app.request('/api/scenarios/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify(exportedJson),
      });

      expect(impRes.status).toBe(201);
      const importedData = await impRes.json();
      expect(importedData.scenario.id).not.toBe(scenarioId);
      expect(importedData.scenario.title).toBe('ナイトシティ・ハック');
      expect(importedData.scenes.length).toBe(1);
      expect(importedData.scenes[0].id).not.toBe(sceneId);
      expect(importedData.scenes[0].title).toBe('バー・アフターライフ');
      expect(importedData.choices[0].label).toBe('フィクサーと交渉する');
    });

    it('deletes the scenario and cascades child entities', async () => {
      const delRes = await app.request(`/api/scenarios/${scenarioId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${gmToken}` },
      });
      expect(delRes.status).toBe(200);

      const checkSc = db.select().from(scenarios).where(eq(scenarios.id, scenarioId)).get();
      expect(checkSc).toBeUndefined();

      const checkScene = db.select().from(scenes).where(eq(scenes.id, sceneId)).get();
      expect(checkScene).toBeUndefined();
    });
  });

  describe('Versioning', () => {
    it('creates version snapshots, restores older version, and preserves pre-restore state', async () => {
      // 1. Create scenario
      const initRes = await app.request('/api/scenarios', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({
          title: 'バージョン管理テスト',
          summary: '初版サマリー',
        }),
      });
      const initData = await initRes.json();
      const sId = initData.scenario.id;
      expect(initData.scenario.version).toBe(1);

      // Save v2
      await app.request(`/api/scenarios/${sId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({
          title: '第2版タイトル',
          save_version: true,
        }),
      });

      // Save v3
      await app.request(`/api/scenarios/${sId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({
          title: '第3版タイトル',
          save_version: true,
        }),
      });

      // List versions -> should have 3 versions
      const versRes = await app.request(`/api/scenarios/${sId}/versions`, {
        headers: { Authorization: `Bearer ${gmToken}` },
      });
      expect(versRes.status).toBe(200);
      const versData = await versRes.json();
      expect(versData.versions.length).toBe(3);

      const v2Record = versData.versions.find((v: any) => v.version === 2);
      expect(v2Record).toBeDefined();

      // Restore v2
      const restoreRes = await app.request(`/api/scenarios/${sId}/versions/${v2Record.id}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gmToken}` },
      });
      expect(restoreRes.status).toBe(200);
      const restored = await restoreRes.json();
      expect(restored.scenario.title).toBe('第2版タイトル');

      // Check version history after restore:
      // The state before restore (v3) should have been preserved as a version snapshot
      const versAfterRes = await app.request(`/api/scenarios/${sId}/versions`, {
        headers: { Authorization: `Bearer ${gmToken}` },
      });
      const versAfterData = await versAfterRes.json();
      expect(versAfterData.versions.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Template creation', () => {
    it('creates 5 scenes, 4 sequential links, with completely empty texts', async () => {
      const res = await app.request('/api/scenarios', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({
          title: 'テンプレート調査作戦',
          use_template: true,
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.scenes.length).toBe(5);

      const titles = data.scenes.map((s: any) => s.title);
      expect(titles).toEqual(['依頼', '調査', '潜入', '戦闘', '報酬']);

      // Sequential links count should be 4
      expect(data.links.length).toBe(4);

      // Verify scenes have empty prose (no AI text!)
      for (const sc of data.scenes) {
        expect(sc.read_aloud).toBe('');
        expect(sc.gm_notes).toBe('');
      }
    });
  });

  describe('Random Tables & Range Validations', () => {
    it('creates a 2d6 table and evaluates digital roll and manual roll of 7', async () => {
      const createRes = await app.request('/api/scenarios/random-tables', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({
          title: '遭遇表 (2d6)',
          dice: '2d6',
          rows: [
            { from: 2, to: 6, text: '低脅威パトロール' },
            { from: 7, to: 7, text: '怪しい密売人' },
            { from: 8, to: 12, text: '高脅威コーポ部隊' },
          ],
        }),
      });

      expect(createRes.status).toBe(201);
      const tableData = await createRes.json();
      const tableId = tableData.id;

      // Manual roll 7
      const roll7Res = await app.request(`/api/scenarios/random-tables/${tableId}/roll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({ roll: 7 }),
      });
      expect(roll7Res.status).toBe(200);
      const roll7Data = await roll7Res.json();
      expect(roll7Data.roll).toBe(7);
      expect(roll7Data.matched_row.text).toBe('怪しい密売人');

      // Digital roll (random)
      const autoRollRes = await app.request(`/api/scenarios/random-tables/${tableId}/roll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({}),
      });
      expect(autoRollRes.status).toBe(200);
      const autoRollData = await autoRollRes.json();
      expect(autoRollData.roll).toBeGreaterThanOrEqual(2);
      expect(autoRollData.roll).toBeLessThanOrEqual(12);
      expect(autoRollData.matched_row).toBeDefined();
    });

    it('detects range overlaps and gaps correctly', () => {
      // Overlapping rows
      const overlapRows = [
        { from: 1, to: 4, text: 'A' },
        { from: 4, to: 6, text: 'B' },
      ];
      const overlapResult = validateRandomTableRanges('1d6', overlapRows);
      expect(overlapResult.valid).toBe(false);
      expect(overlapResult.warnings.some((w) => w.includes('重複'))).toBe(true);

      // Gap between rows
      const gapRows = [
        { from: 1, to: 2, text: 'A' },
        { from: 4, to: 6, text: 'B' },
      ];
      const gapResult = validateRandomTableRanges('1d6', gapRows);
      expect(gapResult.valid).toBe(false);
      expect(gapResult.warnings.some((w) => w.includes('抜け'))).toBe(true);

      // Perfect rows
      const perfectRows = [
        { from: 1, to: 3, text: 'A' },
        { from: 4, to: 6, text: 'B' },
      ];
      const perfectResult = validateRandomTableRanges('1d6', perfectRows);
      expect(perfectResult.valid).toBe(true);
      expect(perfectResult.warnings.length).toBe(0);
    });
  });

  describe('Choice Outcomes validation', () => {
    it('rejects unlisted outcome kinds with 400', async () => {
      // Get any scene
      const scene = db.select().from(scenes).get()!;

      const res = await app.request(`/api/scenarios/scenes/${scene.id}/choices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({
          label: '不正なアクション',
          on_success: [{ kind: 'unsupported_outcome_type', value: 999 }],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid choice data');
    });
  });

  describe('Save file version 5 save and restore', () => {
    it('creates a version 5 save containing scenario data and restores correctly', async () => {
      // Create a scenario to be saved
      const scRes = await app.request('/api/scenarios', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({
          title: 'セーブ復元検証シナリオ',
          summary: 'セーブテスト用',
        }),
      });
      const { scenario } = await scRes.json();

      // Create a save file
      const saveRes = await app.request('/api/saves', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify({ name: 'Phase5aシナリオセーブ' }),
      });
      expect(saveRes.status).toBe(201);
      const { save } = await saveRes.json();

      // Delete the scenario in DB
      await app.request(`/api/scenarios/${scenario.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${gmToken}` },
      });
      const checkDeleted = db.select().from(scenarios).where(eq(scenarios.id, scenario.id)).get();
      expect(checkDeleted).toBeUndefined();

      // Load save file
      const loadRes = await app.request(`/api/saves/${save.id}/load`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gmToken}` },
      });
      expect(loadRes.status).toBe(200);

      // Verify scenario is restored!
      const checkRestored = db.select().from(scenarios).where(eq(scenarios.id, scenario.id)).get();
      expect(checkRestored).toBeDefined();
      expect(checkRestored?.title).toBe('セーブ復元検証シナリオ');
    });

    it('loads older version 4 save file without scenarios successfully', async () => {
      // Construct a mock version 4 save object without scenarios
      const v4Save = {
        format: 'cpgm-save',
        version: 4,
        savedAt: Date.now(),
        name: '旧版セーブv4',
        characters: [],
        money_log: [],
        char_log: [],
        app_settings: {},
      };

      const importRes = await app.request('/api/saves/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmToken}`,
        },
        body: JSON.stringify(v4Save),
      });

      expect(importRes.status).toBe(201);
      const { save } = await importRes.json();

      // Load it
      const loadRes = await app.request(`/api/saves/${save.id}/load`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gmToken}` },
      });
      expect(loadRes.status).toBe(200);
    });
  });
});
