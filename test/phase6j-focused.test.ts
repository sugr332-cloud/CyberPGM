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
  validateAndSanitizeGmEmail,
  sanitizePublicStats,
} from '../apps/web/src/utils/googleSitesExport.js';

describe('Phase 6j: PWA & Offline Catalog & Embed Export Suite (Security Hardened)', () => {
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

      const decoded = decodeCharacterFromCode(res.code);
      assert.strictEqual(decoded.success, true);
      assert.strictEqual(decoded.file?.character.image_path, largeFile.character.image_path);
    });
  });

  // --------------------------------------------------------------------------
  // 2. オフラインカタログストレージ & セキュリティ（非公開データ除外）
  // --------------------------------------------------------------------------
  describe('B. Offline Catalog & No-Private-Cache Security', () => {
    const storageMap = new Map<string, string>();
    const mockLocalStorage = {
      getItem: (k: string) => storageMap.get(k) || null,
      setItem: (k: string, v: string) => storageMap.set(k, String(v)),
      removeItem: (k: string) => storageMap.delete(k),
      clear: () => storageMap.clear(),
    };

    before(() => {
      (globalThis as any).localStorage = mockLocalStorage;
    });

    after(() => {
      storageMap.clear();
      delete (globalThis as any).localStorage;
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
          user_id: 'secret-player-99',
          session_id: 'session-secret-123',
          image_file: '/images/user/secret-photo.jpg',
          raw_db_dump: 'DUMP_DATA',
        },
      ];

      const sanitized = sanitizeCatalogItems(rawCatalog);
      assert.strictEqual(sanitized.length, 1);
      const item = sanitized[0];

      assert.strictEqual(item.id, 'item-101');
      assert.strictEqual(item.name_ja, 'ヘビー・ピストル');
      assert.strictEqual(item.price, 100);
      assert.strictEqual(item.kind, 'weapon');
      assert.strictEqual(item.stats?.damage, '3d6');
      assert.strictEqual(item.stats?.rof, 2);

      assert.strictEqual((item as any).user_id, undefined);
      assert.strictEqual((item as any).session_id, undefined);
      assert.strictEqual((item as any).image_file, undefined);
      assert.strictEqual((item as any).raw_db_dump, undefined);
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
  // 3. Web App Manifest & Service Worker 厳格静的ホワイトリスト監査
  // --------------------------------------------------------------------------
  describe('C. Web App Manifest & Service Worker Static Allowlist Audit', () => {
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

    it('sw.js enforces strict static allowlist and NEVER caches arbitrary or dynamic GET routes', () => {
      const swPath = path.resolve('apps/web/public/sw.js');
      assert.ok(fs.existsSync(swPath), 'sw.js must exist');

      const swContent = fs.readFileSync(swPath, 'utf-8');

      // 1. 静的許可ホワイトリストの存在チェック
      assert.ok(swContent.includes('STATIC_ALLOWLIST'), 'Must define STATIC_ALLOWLIST');
      assert.ok(swContent.includes('ASSET_PATH_REGEX'), 'Must define ASSET_PATH_REGEX');
      assert.ok(swContent.includes('isStaticCacheable'), 'Must define isStaticCacheable check');

      // 2. API は Network-Only (503 on offline)
      assert.ok(swContent.includes("url.pathname.startsWith('/api/')"));
      assert.ok(swContent.includes('status: 503'));

      // 3. SPA ナビゲーションの index.html フォールバック
      assert.ok(swContent.includes("event.request.mode === 'navigate'"));
      assert.ok(swContent.includes("caches.match('/index.html')"));

      // 4. ホワイトリスト外パスの cache.put 拒絶を正規表現＆ロジックで検証
      const STATIC_ALLOWLIST = new Set([
        '/',
        '/index.html',
        '/manifest.webmanifest',
        '/icon.svg',
        '/icon-192.png',
        '/icon-512.png',
        '/favicon.ico',
      ]);
      const ASSET_PATH_REGEX = /^\/assets\/[\w.-]+\.(js|css)$/;
      const isAllowed = (p: string) => STATIC_ALLOWLIST.has(p) || ASSET_PATH_REGEX.test(p);

      // 許可されるべきパス
      assert.strictEqual(isAllowed('/'), true);
      assert.strictEqual(isAllowed('/index.html'), true);
      assert.strictEqual(isAllowed('/manifest.webmanifest'), true);
      assert.strictEqual(isAllowed('/icon.svg'), true);
      assert.strictEqual(isAllowed('/assets/index-CS2UVSh9.css'), true);
      assert.strictEqual(isAllowed('/assets/index-sb9BT0tQ.js'), true);

      // 拒絶されるべきプライベート・動的・未知のパス（200 OK でもキャッシュ不可）
      assert.strictEqual(isAllowed('/images/user/secret-photo.jpg'), false, 'Private user images must NOT be cacheable');
      assert.strictEqual(isAllowed('/data/cyberpgm.db'), false, 'DB files must NOT be cacheable');
      assert.strictEqual(isAllowed('/data/backups/dump.sqlite'), false, 'DB dumps must NOT be cacheable');
      assert.strictEqual(isAllowed('/api/characters'), false, 'API routes must NOT be cacheable');
      assert.strictEqual(isAllowed('/player/secret-sheet'), false, 'Dynamic player routes must NOT be cacheable');
      assert.strictEqual(isAllowed('/gm/combat'), false, 'GM routes must NOT be cacheable');
      assert.strictEqual(isAllowed('/assets/malicious.exe'), false, 'Non-js/css assets must NOT be cacheable');
      assert.strictEqual(isAllowed('/random/path'), false, 'Arbitrary paths must NOT be cacheable');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Google サイト埋め込み HTML 書き出し & セキュリティ強化検査
  // --------------------------------------------------------------------------
  describe('D. Google Sites Embed Export Security & Hardening', () => {
    const validOptions: GoogleSitesExportOptions = {
      gmEmail: 'test-gm@example.com',
      creationMethodKey: 'complete_package',
      startingFunds: 2550,
      catalogItems: [
        {
          id: '1',
          kind: 'weapon',
          name_ja: 'ヘビー・ピストル',
          price: 100,
          category: 'weapon',
          stats: { damage: '3d6', rof: 2, mag: 8, forbidden_internal_token: 'SECRET_123' },
        },
        {
          id: '2',
          kind: 'armor',
          name_ja: 'ケブラー・ベスト',
          price: 100,
          category: 'armor',
          stats: { sp: 7, penalty: 0, admin_note: 'PRIVATE' },
        },
      ],
      skillNotes: {
        handgun: '拳銃で撃つ',
        evasion: '攻撃をかわす',
      },
    };

    it('validates GM email and strictly rejects CRLF injection and invalid format', () => {
      // 正常なメールアドレス
      assert.strictEqual(validateAndSanitizeGmEmail('gm@example.com'), 'gm@example.com');
      assert.strictEqual(validateAndSanitizeGmEmail('  user.name+tag@sub.domain.co.jp  '), 'user.name+tag@sub.domain.co.jp');

      // CRLF ヘッダインジェクション攻撃
      assert.throws(() => validateAndSanitizeGmEmail('gm@example.com\r\nBcc: victim@example.com'), /不正な制御文字/);
      assert.throws(() => validateAndSanitizeGmEmail('gm@example.com\nSubject: Injected'), /不正な制御文字/);
      assert.throws(() => validateAndSanitizeGmEmail('gm@example.com\x00admin'), /不正な制御文字/);

      // 不正なメール形式
      assert.throws(() => validateAndSanitizeGmEmail('invalid-email'), /形式が不正/);
      assert.throws(() => validateAndSanitizeGmEmail(''), /指定されていません/);
      assert.throws(() => validateAndSanitizeGmEmail('gm@'), /形式が不正/);
    });

    it('sanitizes public stats fields with strict whitelist and discards arbitrary objects', () => {
      const raw = {
        damage: '3d6',
        rof: 2,
        mag: 8,
        weapon_type: 'heavy_pistol',
        sp: 11,
        penalty: 0,
        install: 'clinic',
        humanity_loss: 7,
        // 許可外フィールド
        secret_hash: 'abc123456',
        internal_db_row: { table: 'items', id: 42 },
        sql_query: 'SELECT * FROM players',
      };

      const sanitized = sanitizePublicStats(raw);
      // 許可された公開フィールドのみ保持
      assert.strictEqual(sanitized.damage, '3d6');
      assert.strictEqual(sanitized.rof, 2);
      assert.strictEqual(sanitized.mag, 8);
      assert.strictEqual(sanitized.sp, 11);
      assert.strictEqual(sanitized.install, 'clinic');
      assert.strictEqual(sanitized.humanity_loss, 7);

      // 許可外フィールドは排除
      assert.strictEqual((sanitized as any).secret_hash, undefined);
      assert.strictEqual((sanitized as any).internal_db_row, undefined);
      assert.strictEqual((sanitized as any).sql_query, undefined);
    });

    it('generates fully self-contained HTML without external CSS or scripts', () => {
      const html = generateGoogleSitesEmbedHtml(validOptions);

      // 外部リソース・通信の非存在
      assert.strictEqual(/<script\s+[^>]*src=/i.test(html), false, 'Must not contain external <script src>');
      assert.strictEqual(/<link\s+[^>]*rel=["']stylesheet["']/i.test(html), false, 'Must not contain external stylesheet link');
      assert.strictEqual(/fetch\(["']https?:\/\//i.test(html), false, 'Must not fetch external HTTP URLs');
      assert.strictEqual(/XMLHttpRequest/i.test(html), false, 'Must not use XMLHttpRequest');
      assert.strictEqual(/WebSocket/i.test(html), false, 'Must not use WebSocket');
    });

    it('uses safe DOM textContent and event binding, avoiding innerHTML interpolation and inline handlers', () => {
      const html = generateGoogleSitesEmbedHtml(validOptions);

      // innerHTML による補間がないこと（DOM textContent / append の使用）
      assert.strictEqual(html.includes('.innerHTML ='), false, 'Must NOT use innerHTML interpolation');

      // 文字列補間によるインラインハンドラ (onclick="addToCart('...')") がないこと
      assert.strictEqual(html.includes('onclick="addToCart'), false, 'Must NOT use inline onclick handler for addToCart');
      assert.strictEqual(html.includes('onclick="adjustSkill'), false, 'Must NOT use inline onclick handler for adjustSkill');
      assert.strictEqual(html.includes('onclick="adjustStat'), false, 'Must NOT use inline onclick handler for adjustStat');

      // mailto URL が encodeURIComponent されていること
      assert.ok(html.includes("mailto:' + encodeURIComponent(CONFIG.gmEmail)"));
    });

    it('safely neutralizes malicious XSS payloads in catalog names, descriptions, and skill notes', () => {
      const maliciousOptions: GoogleSitesExportOptions = {
        gmEmail: 'clean-gm@example.com',
        creationMethodKey: 'complete_package',
        startingFunds: 2550,
        catalogItems: [
          {
            id: 'xss-item-1',
            kind: 'weapon',
            name_ja: '<script>alert("xss-name")</script>',
            name_en: '"><img src=x onerror=alert(1)>',
            price: 100,
            category: 'weapon" onclick="alert(2)"',
            description: '<svg onload=alert("xss-desc")>',
          },
        ],
        skillNotes: {
          handgun: '</script><script>alert("injected-script")</script>',
        },
      };

      const html = generateGoogleSitesEmbedHtml(maliciousOptions);

      // 1. スクリプトタグブレイクアウトの防止 (<script> が閉じられていないこと)
      // JSON 内の <, >, & は \\u003c, \\u003e, \\u0026 にエスケープされるため </script> にならない
      assert.strictEqual(html.includes('</script><script>alert("injected-script")</script>'), false);
      assert.ok(html.includes('\\u003c/script\\u003e\\u003cscript\\u003e'));

      // 2. インライン属性 XSS の防止
      assert.strictEqual(html.includes('onclick="alert(2)"'), false);

      // 3. 有効な HTML 構造とサイズ
      assert.ok(html.startsWith('<!DOCTYPE html>'));
      assert.ok(html.endsWith('</html>'));
    });

    it('produces reasonable file size for Google Sites embedding', () => {
      const html = generateGoogleSitesEmbedHtml(validOptions);
      const byteLength = Buffer.byteLength(html, 'utf-8');
      assert.ok(byteLength < 500 * 1024, `Embed HTML size (${byteLength} bytes) should be well within limits (< 500KB)`);
      assert.ok(byteLength > 5 * 1024, 'Embed HTML must contain complete markup and logic');
    });

    it('can be safely embedded in sandbox iframe specification', () => {
      const html = generateGoogleSitesEmbedHtml(validOptions);
      const sandboxAttributes = 'allow-scripts allow-forms allow-downloads allow-popups';
      const iframeWrapper = `<iframe sandbox="${sandboxAttributes}" srcdoc="${html.replace(/"/g, '&quot;')}"></iframe>`;

      assert.ok(iframeWrapper.startsWith('<iframe'));
      assert.ok(iframeWrapper.endsWith('</iframe>'));
    });
  });
});
