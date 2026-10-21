import { test, expect } from '@playwright/test';

// Phase 5f E2E: キャラ作成タブでモブを作る（能力値は空欄から、武器と防具は品目から選ぶと性能が出る）→ PC タブの詳細で装備を開く
test('Character editor: build a mook with catalog weapons and armor, then read its gear from the PC tab', async ({ page, request }) => {
  const gm = (await (await request.post('/api/auth/gm-token')).json()).token as string;
  const H = { Authorization: `Bearer ${gm}` };

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/gm');
  await page.getByRole('button', { name: 'キャラ作成' }).click();
  const editor = page.getByTestId('character-editor');
  await editor.getByRole('button', { name: '＋ モブを作る' }).click();

  // 能力値を入れるまでは作れない（決まった値は入っていない）
  await expect(editor.getByText(/未入力: 名前、ロール、INT/)).toBeVisible();
  await expect(editor.getByRole('button', { name: '作る', exact: true })).toBeDisabled();
  await expect(editor.getByLabel('INT', { exact: true })).toHaveValue('');

  await editor.getByLabel('名前').fill('E2E 用心棒');
  await editor.getByLabel('ロール').fill('ソロ');
  const stats: Record<string, string> = { INT: '4', REF: '8', DEX: '6', TECH: '3', COOL: '5', WILL: '5', LUCK: '0', MOVE: '5', BODY: '7', EMP: '3' };
  for (const [label, v] of Object.entries(stats)) await editor.getByLabel(label, { exact: true }).fill(v);
  await expect(editor.getByTestId('editor-hp-calc')).toContainText('計算値: 40');
  await expect(editor.getByLabel('最大 HP')).toHaveValue('40');
  await expect(editor.getByLabel('人間性')).toHaveValue('30');

  // 技能: 基本値 = REF 8 + 6
  await editor.getByLabel('技能を探す').fill('handgun');
  await editor.getByLabel('ハンドガン のレベル', { exact: true }).fill('6');
  await expect(editor.getByLabel('ハンドガン のレベル', { exact: true }).locator('xpath=following-sibling::span[1]')).toHaveText('14');

  // 武器: 選ぶと性能と効果が出る
  await editor.getByLabel('品目を探す').fill('Heavy Pistol');
  await editor.getByTestId('editor-item-results').getByRole('button').filter({ hasText: '大型拳銃' }).filter({ hasText: '3d6 · ROF 2' }).first().click();
  const preview = editor.getByTestId('editor-item-preview');
  await expect(preview.getByText('大型拳銃', { exact: true }).first()).toBeVisible();
  await expect(preview.getByText('ダメージ / ROF')).toBeVisible();
  await expect(preview.getByTestId('item-notes')).toBeVisible();
  await preview.getByRole('button', { name: '持たせる' }).click();

  // 防具: 持たせると SP が防具に合う
  await editor.getByLabel('品目の種類').selectOption({ label: '防具' });
  await editor.getByLabel('品目を探す').fill('Light Armorjack');
  await editor.getByTestId('editor-item-results').getByRole('button').filter({ hasText: '胴 11' }).first().click();
  await preview.getByRole('button', { name: '持たせる' }).click();
  await expect(editor.getByLabel('SP 胴')).toHaveValue('11');
  await expect(editor.getByTestId('editor-entry')).toHaveCount(2);
  await page.screenshot({ path: 'docs/agy/reports/img/phase5f-character-editor-1440.png', fullPage: true });

  await editor.getByRole('button', { name: '作る', exact: true }).click();
  await expect(editor.getByText('保存しました')).toBeVisible();

  const chars = (await (await request.get('/api/characters', { headers: H })).json()).characters as Array<any>;
  const made = chars.find((c) => c.name === 'E2E 用心棒')!;
  expect(made.kind).toBe('mook');
  expect(made.hp_max).toBe(40);
  expect(made.sp_body).toBe(11);
  expect(made.skills).toEqual({ handgun: 6 });
  expect(made.inventory.map((i: any) => i.kind)).toEqual(['weapon', 'armor']);

  // PC タブ: カードの詳細から武器を開くと性能と効果が出る
  await page.getByRole('button', { name: 'PC', exact: true }).click();
  const card = page.getByTestId('pc-card').filter({ hasText: 'E2E 用心棒' });
  await card.getByRole('button', { name: '能力値・技能・装備を見る' }).click();
  await expect(card.getByTestId('pc-detail')).toContainText('SP 頭 0 / 胴 11');
  await card.getByTestId('pc-detail-item').filter({ hasText: '大型拳銃' }).click();
  const popup = page.getByTestId('item-popup');
  await expect(popup.getByText('3d6 · ROF 2 · 装弾数 8')).toBeVisible();
  await expect(popup.getByTestId('item-notes')).toBeVisible();
  await page.screenshot({ path: 'docs/agy/reports/img/phase5f-pc-detail-1440.png' });
  await popup.getByRole('button', { name: '閉じる' }).click();

  // PC タブの「編集」はキャラ作成タブで開く
  await card.getByRole('button', { name: '編集' }).click();
  await expect(editor.getByText('E2E 用心棒 を直す（モブ）')).toBeVisible();
  await expect(editor.getByLabel('BODY', { exact: true })).toHaveValue('7');
});

// 以前のデータの「名前だけの武器」: PC タブでは結び付いていないと出し、キャラ作成タブで品目に置き換えられる
test('Character editor: replace a name-only weapon with a catalog item', async ({ page, request }) => {
  const gm = (await (await request.post('/api/auth/gm-token')).json()).token as string;
  const H = { Authorization: `Bearer ${gm}` };
  const npc = (
    await (
      await request.post('/api/characters', {
        headers: H,
        data: {
          kind: 'npc',
          name: 'E2E 古い NPC',
          role: 'ソロ',
          stats: { int: 4, ref: 6, dex: 5, tech: 3, cool: 4, will: 4, luck: 0, move: 4, body: 6, emp: 3 },
          skills: {},
          hp: 35,
          hp_max: 35,
          humanity: 30,
          emp_max: 3,
          weapons: ['ヘビー・ピストル'],
        },
      })
    ).json()
  ).character;

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/gm');
  const card = page.getByTestId('pc-card').filter({ hasText: 'E2E 古い NPC' });
  await card.getByRole('button', { name: '能力値・技能・装備を見る' }).click();
  await card.getByTestId('pc-detail-item').filter({ hasText: 'ヘビー・ピストル' }).click();
  await expect(page.getByTestId('item-popup')).toContainText('品目と結び付いていない');
  await page.getByTestId('item-popup').getByRole('button', { name: '閉じる' }).click();

  await card.getByRole('button', { name: '編集' }).click();
  const editor = page.getByTestId('character-editor');
  await editor.getByRole('button', { name: '品目から探す' }).click();
  await expect(editor.getByText('「ヘビー・ピストル」の代わりに持たせる武器を選んでください')).toBeVisible();
  await editor.getByLabel('品目を探す').fill('Heavy Pistol');
  await editor.getByTestId('editor-item-results').getByRole('button').filter({ hasText: '大型拳銃' }).filter({ hasText: '3d6 · ROF 2' }).first().click();
  await editor.getByTestId('editor-item-preview').getByRole('button', { name: '持たせる' }).click();
  await editor.getByRole('button', { name: '保存する' }).click();
  await expect(editor.getByText('保存しました')).toBeVisible();

  const after = (await (await request.get('/api/characters', { headers: H })).json()).characters.find((c: { id: string }) => c.id === npc.id);
  expect(after.weapons).toEqual([]);
  expect(after.inventory).toHaveLength(1);
  expect(after.inventory[0]).toMatchObject({ kind: 'weapon', equipped: true, name: '大型拳銃' });
});
