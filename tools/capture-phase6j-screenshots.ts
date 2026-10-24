import { chromium } from '@playwright/test';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateGoogleSitesEmbedHtml } from '../apps/web/src/utils/googleSitesExport.js';

const PORT = 8791;
const imgDir = path.resolve('docs/agy/reports/img');

async function main() {
  if (!fs.existsSync(imgDir)) {
    fs.mkdirSync(imgDir, { recursive: true });
  }

  // 1. テスト用 Google サイト埋め込み HTML を一時生成
  const tempEmbedHtml = generateGoogleSitesEmbedHtml({
    gmEmail: 'cyber-gm@example.com',
    creationMethodKey: 'complete_package',
    startingFunds: 2550,
    catalogItems: [
      { id: '1', kind: 'weapon', name_ja: 'ヘビー・ピストル', price: 100, category: 'weapon', description: '高威力の大型拳銃' },
      { id: '2', kind: 'armor', name_ja: 'ケブラー・ベスト', price: 100, category: 'armor', stats: { sp: 7 } },
      { id: '3', kind: 'cyberware', name_ja: 'ニューラル・リンク', price: 500, category: 'cyberware', stats: { humanity_loss: 7 } },
    ],
    skillNotes: {
      handgun: '拳銃で撃つ',
      evasion: '攻撃をかわす',
    },
  });

  const distDir = path.resolve('apps/web/dist');

  // 2. ポート 8791 で静的ファイルサーバーを起動
  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
    let pathname = parsedUrl.pathname;

    // テスト埋め込み HTML
    if (pathname === '/test-embed.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(tempEmbedHtml);
      return;
    }

    // API モック (画面描画用)
    if (pathname.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (pathname.includes('/auth/gm-token')) {
        res.end(JSON.stringify({ token: 'mock-gm-token-123', role: 'gm', deviceId: 'dev-1' }));
      } else if (pathname.includes('/creation-methods')) {
        res.end(JSON.stringify({
          active_method: 'complete_package',
          starting_funds: 2550,
          scenario_title: null,
          methods: [{ key: 'complete_package', label: 'スクラッチビルド (62pt / 2550eb)' }],
        }));
      } else if (pathname.includes('/skill-notes')) {
        res.end(JSON.stringify({ notes: { handgun: '拳銃で撃つ', evasion: '攻撃をかわす' } }));
      } else if (pathname.includes('/creation-templates')) {
        res.end(JSON.stringify({ gear_packages: {} }));
      } else if (pathname.includes('/character-submissions')) {
        res.end(JSON.stringify({ submissions: [] }));
      } else if (pathname.includes('/characters')) {
        res.end(JSON.stringify({ characters: [] }));
      } else if (pathname.includes('/players')) {
        res.end(JSON.stringify({ players: [] }));
      } else if (pathname.includes('/settings')) {
        res.end(JSON.stringify({ starting_funds: 2550 }));
      } else if (pathname.includes('/session')) {
        res.end(JSON.stringify({ code: '1234', active: true, devices: [] }));
      } else if (pathname.includes('/saves')) {
        res.end(JSON.stringify({ saves: [] }));
      } else if (pathname.includes('/devices')) {
        res.end(JSON.stringify({ devices: [] }));
      } else if (pathname.includes('/money-logs')) {
        res.end(JSON.stringify({ logs: [] }));
      } else if (pathname.includes('/purchase-requests')) {
        res.end(JSON.stringify({ requests: [] }));
      } else if (pathname.includes('/scenarios')) {
        res.end(JSON.stringify({ scenarios: [] }));
      } else if (pathname.includes('/items')) {
        res.end(JSON.stringify({
          items: [
            { id: '1', kind: 'weapon', name_ja: 'ヘビー・ピストル', price: 100, verify_status: 'official_verified' },
            { id: '2', kind: 'armor', name_ja: 'ケブラー・ベスト', price: 100, verify_status: 'official_verified' },
            { id: '3', kind: 'cyberware', name_ja: 'ニューラル・リンク', price: 500, verify_status: 'official_verified' },
          ],
        }));
      } else {
        res.end(JSON.stringify({}));
      }
      return;
    }

    // 静的ファイル (dist)
    let filePath = path.join(distDir, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(distDir, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.webmanifest': 'application/manifest+json',
      '.json': 'application/json',
    };

    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  console.log(`Test server running at http://localhost:${PORT}`);

  const browser = await chromium.launch({
    channel: 'chrome',
  });

  try {
    // -------------------------------------------------------------
    // A. GM 画面: Google サイト用 HTML 書き出しモーダル
    // -------------------------------------------------------------
    // PC 幅 1440px
    const pagePc = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    pagePc.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    pagePc.on('pageerror', (err) => console.error('PAGE ERROR:', err));
    await pagePc.goto(`http://localhost:${PORT}/gm`);
    await pagePc.waitForTimeout(800);

    // 「キャラ受付」サブタブを開く
    const receptionBtn = pagePc.locator('button', { hasText: 'キャラ受付' });
    if (await receptionBtn.count() > 0) {
      await receptionBtn.first().click();
      await pagePc.waitForTimeout(500);
    }

    // 「Google サイト用 HTML 書き出し」ボタンをクリック
    const exportBtn = pagePc.locator('button', { hasText: 'Google サイト用 HTML 書き出し' });
    if (await exportBtn.count() > 0) {
      await exportBtn.first().click();
      await pagePc.waitForSelector('text=Google サイト用キャラ作成 HTML 書き出し', { timeout: 3000 });
      await pagePc.waitForTimeout(400);
    }

    await pagePc.screenshot({ path: path.join(imgDir, 'phase6j-gm-export-1440.png') });
    console.log('Saved phase6j-gm-export-1440.png');

    // スマホ幅 390px
    const pageMobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await pageMobile.goto(`http://localhost:${PORT}/gm`);
    await pageMobile.waitForTimeout(800);

    const receptionBtnMob = pageMobile.locator('button', { hasText: 'キャラ受付' });
    if (await receptionBtnMob.count() > 0) {
      await receptionBtnMob.first().click();
      await pageMobile.waitForTimeout(500);
    }
    const exportBtnMob = pageMobile.locator('button', { hasText: 'Google サイト用 HTML 書き出し' });
    if (await exportBtnMob.count() > 0) {
      await exportBtnMob.first().click();
      await pageMobile.waitForSelector('text=Google サイト用キャラ作成 HTML 書き出し', { timeout: 3000 });
      await pageMobile.waitForTimeout(400);
    }
    await pageMobile.screenshot({ path: path.join(imgDir, 'phase6j-gm-export-390.png') });
    console.log('Saved phase6j-gm-export-390.png');

    // -------------------------------------------------------------
    // B. Google サイト埋め込みキャラ作成画面 (test-embed.html)
    // -------------------------------------------------------------
    await pagePc.goto(`http://localhost:${PORT}/test-embed.html`);
    await pagePc.waitForTimeout(500);
    // ハンドル名入力と Step 5 (GMに送る) への遷移
    await pagePc.fill('#input-name', 'ヴァイパー');
    await pagePc.evaluate(() => {
      // @ts-ignore
      window.switchStep(5);
    });
    await pagePc.waitForTimeout(300);
    await pagePc.screenshot({ path: path.join(imgDir, 'phase6j-character-create-1440.png') });
    console.log('Saved phase6j-character-create-1440.png');

    await pageMobile.goto(`http://localhost:${PORT}/test-embed.html`);
    await pageMobile.waitForTimeout(500);
    await pageMobile.fill('#input-name', 'ヴァイパー');
    await pageMobile.evaluate(() => {
      // @ts-ignore
      window.switchStep(5);
    });
    await pageMobile.waitForTimeout(300);
    await pageMobile.screenshot({ path: path.join(imgDir, 'phase6j-character-create-390.png') });
    console.log('Saved phase6j-character-create-390.png');

    // -------------------------------------------------------------
    // C. PWA オフラインカタログ閲覧画面 (/catalog)
    // -------------------------------------------------------------
    // スナップショットを事前設定して表示
    await pagePc.goto(`http://localhost:${PORT}/catalog`);
    await pagePc.evaluate(() => {
      localStorage.setItem('cpgm_offline_catalog_snapshot_v1', JSON.stringify({
        schemaVersion: 1,
        savedAt: new Date().toISOString(),
        itemCount: 3,
        items: [
          { id: '1', kind: 'weapon', name_ja: 'ヘビー・ピストル', price: 100, stats: { damage: '3d6', rof: 2, mag: 8 } },
          { id: '2', kind: 'armor', name_ja: 'ケブラー・ベスト', price: 100, stats: { sp: 7 } },
          { id: '3', kind: 'cyberware', name_ja: 'ニューラル・リンク', price: 500, stats: { humanity_loss: 7 } },
        ]
      }));
    });
    await pagePc.reload();
    await pagePc.waitForTimeout(500);
    await pagePc.screenshot({ path: path.join(imgDir, 'phase6j-offline-catalog-1440.png') });
    console.log('Saved phase6j-offline-catalog-1440.png');

    await pageMobile.goto(`http://localhost:${PORT}/catalog`);
    await pageMobile.evaluate(() => {
      localStorage.setItem('cpgm_offline_catalog_snapshot_v1', JSON.stringify({
        schemaVersion: 1,
        savedAt: new Date().toISOString(),
        itemCount: 3,
        items: [
          { id: '1', kind: 'weapon', name_ja: 'ヘビー・ピストル', price: 100, stats: { damage: '3d6', rof: 2, mag: 8 } },
          { id: '2', kind: 'armor', name_ja: 'ケブラー・ベスト', price: 100, stats: { sp: 7 } },
          { id: '3', kind: 'cyberware', name_ja: 'ニューラル・リンク', price: 500, stats: { humanity_loss: 7 } },
        ]
      }));
    });
    await pageMobile.reload();
    await pageMobile.waitForTimeout(500);
    await pageMobile.screenshot({ path: path.join(imgDir, 'phase6j-offline-catalog-390.png') });
    console.log('Saved phase6j-offline-catalog-390.png');

    await pagePc.close();
    await pageMobile.close();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
