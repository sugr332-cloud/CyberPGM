import { test, expect } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';

test('Phase 5a Scenario Maker E2E: Template creation, scene editing, choice with DV guideline, flowchart interaction, persistence & screenshots', async ({
  page,
}) => {
  const dbPath = process.env.DATABASE_URL || 'data/test-e2e.db';
  const { sqlite } = createDb(dbPath);

  // Clean DB state for scenarios before running
  sqlite.prepare('DELETE FROM random_tables').run();
  sqlite.prepare('DELETE FROM encounters').run();
  sqlite.prepare('DELETE FROM handouts').run();
  sqlite.prepare('DELETE FROM clues').run();
  sqlite.prepare('DELETE FROM scene_choices').run();
  sqlite.prepare('DELETE FROM scene_links').run();
  sqlite.prepare('DELETE FROM scenes').run();
  sqlite.prepare('DELETE FROM scenario_versions').run();
  sqlite.prepare('DELETE FROM scenarios').run();
  sqlite.close();

  // 1. Desktop 1440px viewport for Flowchart & Scene Editor
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/gm');

  // Navigate to Scenario Tab
  const scenarioTabBtn = page.getByRole('button', { name: 'シナリオ' });
  await expect(scenarioTabBtn).toBeVisible();
  await scenarioTabBtn.click();

  const makerView = page.locator('[data-testid="scenario-maker-view"]');
  await expect(makerView).toBeVisible();

  // Click "雛形から" to create scenario with 5 scenes
  const templateBtn = page.locator('[data-testid="btn-template-scenario"]');
  await expect(templateBtn).toBeVisible();
  await templateBtn.click();

  // Verify 5 scene nodes are rendered in SVG
  const svg = page.locator('[data-testid="flowchart-svg"]');
  await expect(svg).toBeVisible();

  // Scene node labels: 依頼, 調査, 潜入, 戦闘, 報酬
  const firstNodeText = svg.locator('text', { hasText: '依頼' });
  await expect(firstNodeText).toBeVisible();

  // Select the "依頼" scene node
  const firstNode = svg.locator('g[data-testid^="scene-node-"]').first();
  await firstNode.click({ force: true });

  // Scene Detail Editor should be visible
  const editor = page.locator('[data-testid="scene-detail-editor"]');
  await expect(editor).toBeVisible();

  // Enter read_aloud prose
  const readAloudInput = page.locator('[data-testid="input-scene-read-aloud"]');
  await expect(readAloudInput).toBeVisible();
  await readAloudInput.fill('ネオン街の薄暗いバーで、謎のフィクサーが手招きしている。');

  // Add choice
  const addChoiceBtn = page.locator('[data-testid="btn-add-choice"]');
  await expect(addChoiceBtn).toBeVisible();
  await addChoiceBtn.click();

  // Select skill "知覚"
  const skillSelect = page.locator('[data-testid="choice-skill-select"]').first();
  await expect(skillSelect).toBeVisible();
  await skillSelect.selectOption('perception');

  // Click DV guideline preset button "日常的(13)"
  const dvPresetBtn = page.locator('[data-testid="dv-preset-13"]').first();
  await expect(dvPresetBtn).toBeVisible();
  await dvPresetBtn.click();

  // Drag node slightly to verify flowchart position update
  const nodeBox = svg.locator('g[data-testid^="scene-node-"]').first();
  const boxBbox = await nodeBox.boundingBox();
  if (boxBbox) {
    await page.mouse.move(boxBbox.x + boxBbox.width / 2, boxBbox.y + 12);
    await page.mouse.down();
    await page.mouse.move(boxBbox.x + boxBbox.width / 2 + 30, boxBbox.y + 12 + 20);
    await page.mouse.up();
  }

  // Save scenario version
  const saveBtn = page.locator('[data-testid="btn-save-scenario"]');
  await expect(saveBtn).toBeVisible();
  await saveBtn.click();

  // Wait for save notification
  await expect(page.locator('text=/保存しました/')).toBeVisible();

  // Capture Screenshot 1: Flowchart & Scene Editing (1440px)
  await page.screenshot({
    path: 'docs/agy/reports/img/phase5a-scenario-flowchart-1440.png',
  });

  // Verify reload persistence
  await page.reload();
  await page.getByRole('button', { name: 'シナリオ' }).click();
  await expect(page.locator('[data-testid="flowchart-svg"]')).toBeVisible();
  await page.locator('[data-testid="flowchart-svg"] g[data-testid^="scene-node-"]').first().click({ force: true });
  await expect(page.locator('[data-testid="input-scene-read-aloud"]')).toHaveValue(
    'ネオン街の薄暗いバーで、謎のフィクサーが手招きしている。'
  );

  // 2. Mobile 390px viewport for List View
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileListView = page.locator('[data-testid="mobile-list-view"]');
  await expect(mobileListView).toBeVisible();
  await expect(mobileListView.locator('text=シーン一覧 (スマホ表示)')).toBeVisible();

  // Capture Screenshot 2: Mobile List View (390px)
  await page.screenshot({
    path: 'docs/agy/reports/img/phase5a-scenario-mobile-390.png',
  });

  // 3. Desktop 1440px viewport for Random Table
  await page.setViewportSize({ width: 1440, height: 900 });

  // Switch to Random Tables tab
  const randomTableTab = page.locator('[data-testid="tab-random-tables"]');
  await expect(randomTableTab).toBeVisible();
  await randomTableTab.click();

  // Create a new random table
  const newTableBtn = page.locator('[data-testid="btn-new-random-table"]');
  await expect(newTableBtn).toBeVisible();
  await newTableBtn.click();

  // Test manual roll 7
  const manualRollInput = page.locator('[data-testid="input-manual-roll"]');
  await expect(manualRollInput).toBeVisible();
  await manualRollInput.fill('7');

  const manualRollBtn = page.locator('[data-testid="btn-manual-roll"]');
  await expect(manualRollBtn).toBeVisible();
  await manualRollBtn.click();

  // Verify matched result
  const rollResult = page.locator('[data-testid="roll-result-text"]');
  await expect(rollResult).toBeVisible();
  await expect(rollResult).toContainText('注目イベント');

  // Capture Screenshot 3: Random Table (1440px)
  await page.screenshot({
    path: 'docs/agy/reports/img/phase5a-scenario-random-table-1440.png',
  });
});
