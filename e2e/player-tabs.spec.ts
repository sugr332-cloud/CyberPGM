import { test, expect } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';
import { joinAsPlayer } from './join.js';

// Phase 5g E2E: スマホの「装備」「技能」「商店」。商店は GM が出した店の在庫だけで、購入は GM に申請 → GM が承認すると買える
test('Player phone: equipment, skills, and shop purchase requests approved by the GM', async ({ browser, request }) => {
  // ほかのスペックのスマホがヴァイパーを使っていると「GM の許可待ち」になるので、接続を片付ける
  const { sqlite } = createDb(process.env.DATABASE_URL || 'data/test-e2e.db');
  sqlite.prepare('DELETE FROM devices').run();
  sqlite.close();
  const gm = (await (await request.post('/api/auth/gm-token')).json()).token as string;
  const H = { Authorization: `Bearer ${gm}` };

  const pistol = (await (await request.get('/api/items?q=Heavy%20Pistol&kind=weapon&sort=name_asc', { headers: H })).json()).items.find(
    (i: { name_en: string }) => i.name_en === 'Heavy Pistol',
  );
  const shop = await (await request.post('/api/shops', { headers: H, data: { name: 'E2E 露店', price_multiplier: 1, buyback_rate: 0.5, categories: ['weapon'] } })).json();
  await request.post(`/api/shops/${shop.id}/stock`, { headers: H, data: { item_id: pistol.id, quantity: 3 } });
  const viper = (await (await request.get('/api/characters', { headers: H })).json()).characters.find((c: { name: string }) => c.name === 'ヴァイパー');
  const ebBefore = viper.eb as number;

  // スマホ: ヴァイパーで参加
  const session = await (await request.get('/api/session', { headers: H })).json();
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
  await joinAsPlayer(phone, session.code, 'ヴァイパー');

  // 技能: 基本値の一覧
  await phone.getByTestId('player-tab-skills').click();
  await expect(phone.getByTestId('player-skill-row').first()).toBeVisible();
  await expect(phone.getByTestId('player-skill-row').filter({ hasText: '拳銃' })).toContainText(String(viper.stats.ref + viper.skills.handgun));
  await phone.screenshot({ path: 'docs/agy/reports/img/phase5g-player-skills-390.png' });

  // 商店: GM が出すまでは閉まっている
  await phone.getByTestId('player-tab-shop').click();
  await expect(phone.getByText('今は店が開いていません')).toBeVisible();

  // GM: 商店タブで店を選び「スマホに出す」
  const gmPage = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await gmPage.goto('/gm');
  await gmPage.getByRole('button', { name: '商店' }).first().click();
  await gmPage.getByTestId('shop-selector').selectOption({ label: 'E2E 露店（倍率 1x / 買取 50%）' });
  await gmPage.getByRole('button', { name: '「E2E 露店」をスマホに出す' }).click();
  await expect(gmPage.getByTestId('player-shop-status')).toContainText('「E2E 露店」を出しています');

  // スマホ: 品物を開くと性能が出る（効果・フレーバーは出ない）→ カート → 申請
  const item = phone.getByTestId('player-shop-item').filter({ hasText: '大型拳銃' });
  await expect(item).toBeVisible();
  await item.getByRole('button').first().click();
  await expect(item.getByText('ダメージ / ROF')).toBeVisible();
  await expect(item.getByTestId('item-notes')).toHaveCount(0);
  await item.getByRole('button', { name: 'カートに入れる' }).click();
  await phone.getByRole('button', { name: 'GM に購入を申請する' }).click();
  await expect(phone.getByText('GM に申請しました')).toBeVisible();
  await expect(phone.getByTestId('player-purchase-request').first()).toContainText('GM の確認待ち');
  await phone.screenshot({ path: 'docs/agy/reports/img/phase5g-player-shop-390.png', fullPage: true });

  // 申請しただけではお金は変わらない
  const mid = (await (await request.get('/api/characters', { headers: H })).json()).characters.find((c: { id: string }) => c.id === viper.id);
  expect(mid.eb).toBe(ebBefore);

  // GM: 申請が届く → 承認
  const req = gmPage.getByTestId('purchase-request').filter({ hasText: 'ヴァイパー' });
  await expect(req).toContainText('大型拳銃 ×1');
  await expect(gmPage.getByTestId('shop-request-badge')).toHaveText('1');
  await gmPage.screenshot({ path: 'docs/agy/reports/img/phase5g-gm-requests-1440.png' });
  await req.getByRole('button', { name: '承認して売る' }).click();
  await expect(gmPage.getByTestId('purchase-request')).toHaveCount(0);

  // スマホ: 買えた、お金が減り、装備タブに出る。タップで性能
  await expect(phone.getByTestId('player-purchase-request').first()).toContainText('買えました');
  const after = (await (await request.get('/api/characters', { headers: H })).json()).characters.find((c: { id: string }) => c.id === viper.id);
  expect(after.eb).toBe(ebBefore - pistol.price_eb);
  await phone.getByTestId('player-tab-gear').click();
  const bought = phone.getByTestId('player-inventory-item').filter({ hasText: '大型拳銃' }).first();
  await expect(bought).toBeVisible();
  await bought.click();
  const popup = phone.getByTestId('item-popup');
  await expect(popup.getByText('3d6 · ROF 2 · 装弾数 8')).toBeVisible();
  await expect(popup.getByTestId('item-notes')).toHaveCount(0);
  await phone.screenshot({ path: 'docs/agy/reports/img/phase5g-player-gear-390.png' });
  await popup.getByRole('button', { name: '閉じる' }).click();

  // 行動: 戦闘と探索で使う技能。押すと計算式と難易度ごとの成功率
  await phone.getByTestId('player-tab-act').click();
  const skills = phone.getByTestId('player-action-skills');
  await expect(skills.getByText('探索で使う')).toBeVisible();
  await expect(skills.getByText('戦闘で使う')).toBeVisible();
  const base = viper.stats.ref + viper.skills.handgun;
  const gun = skills.getByTestId('action-skill').filter({ hasText: '大型拳銃（拳銃）' });
  await expect(gun).toContainText(`${base} / 3d6`);
  await gun.getByRole('button').click();
  const f = gun.getByTestId('action-skill-formula');
  await expect(f).toContainText(`REF ${viper.stats.ref} + 拳銃 ${viper.skills.handgun} = 基本値 ${base}`);
  await expect(f).toContainText('難易度を上回れば成功（同じ値は失敗）');
  await expect(f).toContainText('日常的');
  await expect(f).toContainText('当たったらダメージ 3d6');
  const look = skills.getByTestId('action-skill').filter({ hasText: '知覚' });
  await look.getByRole('button').click();
  await expect(look.getByTestId('action-skill-formula')).toContainText(`INT ${viper.stats.int} + 知覚 ${viper.skills.perception}`);
  await gun.scrollIntoViewIfNeeded();
  await phone.screenshot({ path: 'docs/agy/reports/img/phase5g-player-action-skills-390.png' });
});
