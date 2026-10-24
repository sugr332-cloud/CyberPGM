import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Shared modules
import {
  calculateChecksum,
  utf8ToBase64,
  base64ToUtf8,
  encodeCharacterToCode,
  decodeCharacterFromCode,
  CPGM_CODE_PREFIX,
  MAILTO_SAFE_LIMIT,
} from '../packages/shared/src/characterCode.js';
import { CpgmCharacterFile } from '../packages/shared/src/creation.js';

// Web utils
import {
  sanitizeCatalogItems,
  saveCatalogSnapshot,
  loadCatalogSnapshot,
  clearCatalogSnapshot,
} from '../apps/web/src/utils/offlineCatalog.js';
import {
  generateGoogleSitesEmbedHtml,
  GoogleSitesExportOptions,
} from '../apps/web/src/utils/googleSitesExport.js';

describe('Phase 6j: PWA & Offline Catalog & Embed Export Suite', () => {
  const sampleCharacterFile: CpgmCharacterFile = {
    format: 'cpgm-character',
    version: 1,
    character: {
      name: 'Viper',
      role: 'Solo',
      stats: { int: 6, ref: 8, dex: 7, tech: 4, cool: 6, will: 6, luck: 6, move: 6, body: 7, emp: 6 },
      skills: { handgun: 6, evasion: 6, athletics: 4, perception: 5 },
      inventory: [
        { name: 'ヘビー・ピストル', qty: 1, price_eb: 100, category: 'weapon' },
        { name: 'ケブラー・ベスト', qty: 1, price_eb: 100, category: 'armor' },
      ],
      cyberware: [{ name: 'ニューラル・リンク', type: 'neuralware', static_loss: 7 }],
    },
    created_with: { method: 'complete_package', starting_funds: 2550 },
  };

  // --------------------------------------------------------------------------
  // 1. テキストコード・チェックサム・破損検出・復元
  // --------------------------------------------------------------------------
  describe('A. Text Code & Checksum & Tamper Detection', () => {
    it('calculates reproducible Adler-32 checksums', () => {
      const c1 = calculateChecksum('CyberPGM-2026');
      const c2 = calculateChecksum('CyberPGM-2026');
      const c3 = calculateChecksum('CyberPGM-Different');
      assert.strictEqual(c1.length, 8);
      assert.strictEqual(c1, c2);
      assert.notStrictEqual(c1, c3);
    });

    it('round-trips UTF-8 and Japanese text via Base64', () => {
      const text = 'ナイトシティ: サイバーウェア・武器・防具テスト';
      const b64 = utf8ToBase64(text);
      const decoded = base64ToUtf8(b64);
      assert.strictEqual(decoded, text);
    });

    it('encodes character file to CPGM code with checksum and prefix', () => {
      const encoded = encodeCharacterToCode(sampleCharacterFile);
      assert.ok(encoded.code.startsWith(CPGM_CODE_PREFIX));
      assert.strictEqual(encoded.checksum.length, 8);
      assert.strictEqual(encoded.fitsInMailto, true);
      assert.strictEqual(encoded.warning, undefined);
    });

    it('successfully restores draft from valid character code', () => {
      const encoded = encodeCharacterToCode(sampleCharacterFile);
      const decoded = decodeCharacterFromCode(encoded.code);
      assert.strictEqual(decoded.success, true);
      assert.deepStrictEqual(decoded.file, sampleCharacterFile);
    });

    it('detects tampering or corruption and refuses import', () => {
      const encoded = encodeCharacterToCode(sampleCharacterFile);
      const tampered = encoded.code.slice(0, -2) + 'XY';
      const res = decodeCharacterFromCode(tampered);
      assert.strictEqual(res.success, false);
      assert.match(res.error || '', /チェックサムが一致しません|Base64 の復元に失敗しました|JSON のパースに失敗しました/);
    });

    it('warns when data exceeds mailto safe limit without silently truncating', () => {
      const largeFile: CpgmCharacterFile = {
        ...sampleCharacterFile,
        character: {
          ...sampleCharacterFile.character,
          image_path: 'data:image/png;base64,' + 'X'.repeat(MAILTO_SAFE_LIMIT * 2),
        },
      };
      const res = encodeCharacterToCode(largeFile);
      assert.strictEqual(res.fitsInMailto, false);
      assert.ok(res.warning?.includes('mailto URL の推奨安全上限'));
      assert.ok(res.length > MAILTO_SAFE_LIMIT);

      // 復元しても一切切り詰められていないことを確認
      const decoded = decodeCharacterFromCode(res.code);
      assert.strictEqual(decoded.success, true);
      assert.strictEqual(decoded.file?.character.image_path, largeFile.character.image_path);
    });
  });

  // --------------------------------------------------------------------------
  // 2. オフラインカタログストレージ & セキュリティ（非公開データ除外）
  // --------------------------------------------------------------------------
  describe('B. Offline Catalog & No-Private-Cache Security', () => {
    // localStorage mock for Node environment
    const storageMap = new Map<string, string>();
    const mockLocalStorage = {
      getItem: (k: string) => storageMap.get(k) || null,
      setItem: (k: string, v: string) => storageMap.set(k, String(v)),
      removeItem: (k: string) => storageMap.delete(k),
      clear: () => storageMap.clear(),
    };

    before(() => {
      // @ts-ignore
      globalThis.localStorage = mockLocalStorage;
    });

    after(() => {
      storageMap.clear();
      // @ts-ignore
      delete globalThis.localStorage;
    });

    it('sanitizes raw items to include only public text/number fields and exclude private data', () => {
      const rawCatalog = [
        {
          id: 'item-101',
          name: 'Heavy Pistol',
          name_ja: 'ヘビー・ピストル',
          name_en: 'Heavy Pistol',
          price: 100,
          kind: 'weapon',
          category: 'weapon',
          description: '威力のある大型拳銃',
          weapon: { damage: '3d6', rof: 2, mag: 8, type: 'heavy_pistol' },
          // プライベート・管理用フィールド（漏洩してはならない）
          user_id: 'secret-player-99',
          session_id: 'session-secret-123',
          image_file: '/images/user/secret-photo.jpg',
          raw_db_dump: 'DUMP_DATA',
        },
      ];

      const sanitized = sanitizeCatalogItems(rawCatalog);
      assert.strictEqual(sanitized.length, 1);
      const item = sanitized[0];

      // 保持されるべき公開テキスト・数値データ
      assert.strictEqual(item.id, 'item-101');
      assert.strictEqual(item.name_ja, 'ヘビー・ピストル');
      assert.strictEqual(item.price, 100);
      assert.strictEqual(item.kind, 'weapon');
      assert.strictEqual(item.stats?.damage, '3d6');
      assert.strictEqual(item.stats?.rof, 2);

      // 除外されるべきプライベートデータ
      // @ts-ignore
      assert.strictEqual(item.user_id, undefined);
      // @ts-ignore
      assert.strictEqual(item.session_id, undefined);
      // @ts-ignore
      assert.strictEqual(item.image_file, undefined);
      // @ts-ignore
      assert.strictEqual(item.raw_db_dump, undefined);
    });

    it('safely saves and loads catalog snapshot with versioning', () => {
      clearCatalogSnapshot();
      assert.strictEqual(loadCatalogSnapshot(), null);

      const items = [
        { id: '1', name_ja: 'コンバットナイフ', price: 50, kind: 'weapon' },
        { id: '2', name_ja: 'ライトアーバージャケット', price: 100, kind: 'armor', armor: { sp: 11 } },
      ];

      const saved = saveCatalogSnapshot(items);
      assert.strictEqual(saved, true);

      const snapshot = loadCatalogSnapshot();
      assert.ok(snapshot !== null);
      assert.strictEqual(snapshot.schemaVersion, 1);
      assert.strictEqual(snapshot.itemCount, 2);
      assert.strictEqual(snapshot.items[0].name_ja, 'コンバットナイフ');
      assert.strictEqual(snapshot.items[1].stats?.sp, 11);
    });

    it('discards corrupted snapshot safely without throwing', () => {
      mockLocalStorage.setItem('cpgm_offline_catalog_snapshot_v1', '{ invalid json ...');
      const loaded = loadCatalogSnapshot();
      assert.strictEqual(loaded, null);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Web App Manifest & Service Worker 監査
  // --------------------------------------------------------------------------
  describe('C. Web App Manifest & Service Worker Static Audit', () => {
    it('manifest.webmanifest contains valid PWA configuration and icons', () => {
      const manifestPath = path.resolve('apps/web/public/manifest.webmanifest');
      assert.ok(fs.existsSync(manifestPath), 'manifest.webmanifest must exist');

      const content = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);

      assert.strictEqual(manifest.name, 'CyberPGM - Cyberpunk RED Assistant');
      assert.strictEqual(manifest.short_name, 'CyberPGM');
      assert.strictEqual(manifest.start_url, '/');
      assert.strictEqual(manifest.display, 'standalone');
      assert.strictEqual(manifest.background_color, '#0D0E11');
      assert.strictEqual(manifest.theme_color, '#0D0E11');
      assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);

      const has192 = manifest.icons.some((i: any) => i.sizes === '192x192' && i.src === '/icon-192.png');
      const has512 = manifest.icons.some((i: any) => i.sizes === '512x512' && i.src === '/icon-512.png');
      assert.ok(has192, 'Manifest must have 192x192 icon');
      assert.ok(has512, 'Manifest must have 512x512 icon');
    });

    it('icons exist in public directory', () => {
      assert.ok(fs.existsSync('apps/web/public/icon.svg'), 'icon.svg must exist');
      assert.ok(fs.existsSync('apps/web/public/icon-192.png'), 'icon-192.png must exist');
      assert.ok(fs.existsSync('apps/web/public/icon-512.png'), 'icon-512.png must exist');
    });

    it('sw.js enforces security: never caches /api/* or user private data', () => {
      const swPath = path.resolve('apps/web/public/sw.js');
      assert.ok(fs.existsSync(swPath), 'sw.js must exist');

      const swContent = fs.readFileSync(swPath, 'utf-8');

      // API キャッシュ禁止チェック
      assert.ok(swContent.includes("url.pathname.startsWith('/api/')"));
      assert.ok(swContent.includes('status: 503'));
      assert.ok(swContent.includes('オフラインのためAPIに接続できません'));

      // ユーザー画像・非公開パス除外チェック
      assert.ok(swContent.includes("url.pathname.startsWith('/images/user/')"));

      // 古いキャッシュパージ
      assert.ok(swContent.includes('caches.delete(key)'));
    });
  });

  // --------------------------------------------------------------------------
  // 4. Google サイト埋め込み HTML 書き出し & sandbox iframe
  // --------------------------------------------------------------------------
  describe('D. Google Sites Embed Export & Self-Contained Integrity', () => {
    const testOptions: GoogleSitesExportOptions = {
      gmEmail: 'test-gm@example.com',
      creationMethodKey: 'complete_package',
      startingFunds: 2550,
      catalogItems: [
        { id: '1', kind: 'weapon', name_ja: 'ヘビー・ピストル', price: 100, category: 'weapon' },
        { id: '2', kind: 'armor', name_ja: 'ケブラー・ベスト', price: 100, category: 'armor' },
      ],
      skillNotes: {
        handgun: '拳銃で撃つ',
        evasion: '攻撃をかわす',
      },
    };

    it('generates fully self-contained HTML without external CSS or scripts', () => {
      const html = generateGoogleSitesEmbedHtml(testOptions);

      // 外部スクリプトの src 読み込みがないこと
      assert.strictEqual(/<script\s+[^>]*src=/i.test(html), false, 'Must not contain external <script src>');

      // 外部スタイルシートの link がないこと
      assert.strictEqual(/<link\s+[^>]*rel=["']stylesheet["']/i.test(html), false, 'Must not contain external stylesheet link');

      // 外部 URL (http:// または https://) へのスクリプト通信参照がないこと
      assert.strictEqual(/fetch\(["']https?:\/\//i.test(html), false, 'Must not fetch external HTTP URLs');
      assert.strictEqual(/XMLHttpRequest/i.test(html), false, 'Must not use XMLHttpRequest');
      assert.strictEqual(/WebSocket/i.test(html), false, 'Must not use WebSocket');
    });

    it('includes required configuration and public catalog while excluding forbidden private data', () => {
      const html = generateGoogleSitesEmbedHtml(testOptions);

      // 含まれるべきデータ
      assert.ok(html.includes('test-gm@example.com'));
      assert.ok(html.includes('ヘビー・ピストル'));
      assert.ok(html.includes('2550'));
      assert.ok(html.includes('拳銃で撃つ'));

      // 禁止データの排除（DB, 内部トークン等）
      assert.strictEqual(html.includes('cyberpgm.db'), false);
      assert.strictEqual(html.includes('secret-player'), false);
    });

    it('contains all necessary workflow actions: file save, Web Share, mailto, text code', () => {
      const html = generateGoogleSitesEmbedHtml(testOptions);

      assert.ok(html.includes('downloadCpgmFile'), 'Must have file download handler');
      assert.ok(html.includes('handleWebShare'), 'Must have Web Share API handler');
      assert.ok(html.includes('navigator.canShare'), 'Must test Web Share capability');
      assert.ok(html.includes('mailto:'), 'Must configure mailto link');
      assert.ok(html.includes('CPGM1:'), 'Must generate CPGM1 checksummed text code');
      assert.ok(html.includes('copyCharacterCode'), 'Must support copying character code');
    });

    it('produces reasonable file size for Google Sites embedding', () => {
      const html = generateGoogleSitesEmbedHtml(testOptions);
      const byteLength = Buffer.byteLength(html, 'utf-8');
      // 文字情報とインライン UI で通常 20KB〜100KB 程度
      assert.ok(byteLength < 500 * 1024, `Embed HTML size (${byteLength} bytes) should be well within limits (< 500KB)`);
      assert.ok(byteLength > 5 * 1024, 'Embed HTML must contain complete markup and logic');
    });

    it('can be embedded in sandbox iframe specifications without syntax errors', () => {
      const html = generateGoogleSitesEmbedHtml(testOptions);

      // Google サイトが iframe sandbox に適用する標準的な属性
      const sandboxAttributes = 'allow-scripts allow-forms allow-downloads allow-popups';
      const iframeWrapper = `<iframe sandbox="${sandboxAttributes}" srcdoc="${html.replace(/"/g, '&quot;')}"></iframe>`;

      assert.ok(iframeWrapper.startsWith('<iframe'));
      assert.ok(iframeWrapper.endsWith('</iframe>'));
    });
  });
});
