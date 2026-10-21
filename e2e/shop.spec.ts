import { test, expect } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';
import { devices, items } from '../apps/server/src/db/schema.js';
import { eq } from 'drizzle-orm';
import path from 'node:path';

test('Shop purchase flow: GM purchases Heavy Pistol for Viper, reflected on Player Sheet via me:update and notify', async ({ browser }) => {
  const dbPath = process.env.DATABASE_URL || 'data/test-e2e.db';
  const { db } = createDb(dbPath);

  // Clear any existing active devices before test
  db.delete(devices).run();

  // Find Heavy Pistol in DB to know its localized name
  const hpItem = db.select().from(items).where(eq(items.name_en, 'Heavy Pistol')).get();
  const pistolName = hpItem?.name_ja_override || hpItem?.name_ja || '大型拳銃';

  // 1. GM Context (1440x900)
  const gmContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const gmPage = await gmContext.newPage();
  await gmPage.goto('/gm');

  // Verify GM Dashboard and click "商店" tab
  await expect(gmPage.getByText('CYBERPGM').first()).toBeVisible();
  const shopTabBtn = gmPage.getByRole('button', { name: '商店' });
  await expect(shopTabBtn).toBeVisible();
  await shopTabBtn.click();

  // Verify Shop view components (Emojis removed)
  await expect(gmPage.getByTestId('shop-selector')).toBeVisible();
  await expect(gmPage.getByTestId('item-search-input')).toBeVisible();
  await expect(gmPage.getByTestId('shop-cart-panel')).toBeVisible();

  // Search for "Heavy Pistol"
  const searchInput = gmPage.getByTestId('item-search-input');
  await searchInput.fill('Heavy Pistol');

  // Verify Heavy Pistol card is displayed with REAL stats (3d6 · ROF 2, no dummy 1d6)
  const itemCard = gmPage
    .locator('[data-testid^="item-card-"]')
    .filter({ hasText: 'Heavy Pistol' })
    .filter({ hasText: '3d6 · ROF 2' })
    .first();
  await expect(itemCard).toBeVisible();

  // Verify item image loaded correctly (naturalWidth > 0, not broken box)
  const cardImage = itemCard.getByTestId('item-card-image');
  await expect(cardImage).toBeVisible();
  const naturalWidth = await cardImage.evaluate((img: HTMLImageElement) => img.naturalWidth);
  expect(naturalWidth).toBeGreaterThan(0);

  // Click card to open detail panel
  await itemCard.click();

  // Verify detail panel loaded
  const detailPanel = gmPage.getByTestId('item-detail-panel');
  await expect(detailPanel).toBeVisible();
  await expect(detailPanel.getByText('Heavy Pistol')).toBeVisible();
  await expect(detailPanel.getByText(/3d6 \/ ROF 2/)).toBeVisible();

  // Take Screenshot: GM Shop view with item detail (1440px)
  await gmPage.screenshot({
    path: 'docs/agy/reports/img/phase3a-shop-gm.png',
  });

  // Open "画像登録・切抜" Modal
  const openCropBtn = detailPanel.getByRole('button', { name: '画像登録・切抜' });
  await expect(openCropBtn).toBeVisible();
  await openCropBtn.click();

  const cropModal = gmPage.getByTestId('image-crop-modal');
  await expect(cropModal).toBeVisible();

  // Set file to input for interactive crop preview
  const sampleImagePath = path.resolve('docs/agy/reports/img/phase2-gm-pc.png');
  await gmPage.getByTestId('crop-file-input').setInputFiles(sampleImagePath);

  // Verify canvas and preview rendered
  await expect(gmPage.getByTestId('crop-main-canvas')).toBeVisible();
  await expect(gmPage.getByTestId('crop-preview-canvas')).toBeVisible();

  // Take Screenshot: Interactive Image Crop Modal
  await gmPage.screenshot({
    path: 'docs/agy/reports/img/phase3a-crop-modal.png',
  });

  // Close Crop Modal
  await cropModal.getByRole('button', { name: 'キャンセル' }).click();
  await expect(cropModal).not.toBeVisible();

  // Add Heavy Pistol to Cart
  const addCartBtn = itemCard.locator('button', { hasText: '＋ カート' });
  await addCartBtn.click();

  // Verify item in cart
  const cartPanel = gmPage.getByTestId('shop-cart-panel');
  await expect(cartPanel.getByText(/カート \(1\)/i)).toBeVisible();

  // Select Viper as buyer
  const buyerSelect = gmPage.getByTestId('purchase-buyer-select');
  await expect(buyerSelect).toBeVisible();
  await buyerSelect.selectOption({ index: 0 });

  // Take Screenshot: Detail & Cart before purchase
  await gmPage.screenshot({
    path: 'docs/agy/reports/img/phase3a-shop-detail.png',
  });

  // Fetch current session code via API
  const healthRes = await gmPage.request.get('/api/health');
  const healthData = await healthRes.json();
  const sessionCode = healthData.session;
  expect(sessionCode.length).toBe(6);

  // 2. Player Context (Mobile: 390x844)
  const playerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  });
  const playerPage = await playerContext.newPage();
  await playerPage.goto(`/player?join=${sessionCode}`);

  // Join as Viper
  await expect(playerPage.getByText('自分のキャラクターを選択:')).toBeVisible();
  await playerPage.getByRole('button', { name: /ヴァイパー/i }).click();

  // Verify Player Character Sheet
  await expect(playerPage.getByRole('heading', { name: 'ヴァイパー' })).toBeVisible();
  const ebElement = playerPage.getByText(/eb/i).first();
  await expect(ebElement).toBeVisible();

  // 3. GM confirms purchase
  const confirmBtn = gmPage.getByTestId('purchase-confirm-button');
  await expect(confirmBtn).toBeEnabled();
  await confirmBtn.click();

  // Verify purchase notice in GM screen
  const notice = gmPage.getByTestId('commerce-notice');
  await expect(notice).toBeVisible({ timeout: 5000 });
  await expect(notice).toContainText('購入が完了しました');

  // 4. Player Screen Real-time Verification
  // Check notification banner
  const banner = playerPage.getByTestId('notify-banner');
  await expect(banner).toBeVisible({ timeout: 5000 });
  await expect(banner).toContainText('購入完了');
  await expect(banner).toContainText('−');

  // Check inventory has the purchased pistol
  await playerPage.getByTestId('player-tab-gear').click(); // 所持品は「装備」タブ（Phase 5g）
  const invList = playerPage.getByTestId('player-inventory-list');
  await expect(invList).toBeVisible({ timeout: 5000 });
  await expect(invList).toContainText(pistolName);

  // Take Screenshot: Player Sheet with updated funds and inventory (390px)
  await playerPage.screenshot({
    path: 'docs/agy/reports/img/phase3a-shop-player.png',
  });

  // Cleanup
  await gmContext.close();
  await playerContext.close();
});
