/* global self, caches, fetch, Response, URL, console */
// CyberPGM Service Worker (Phase 6j PWA - Hardened Security)
// セキュリティ方針:
// - 厳格な静的許可リスト（シェル文書、マニフェスト、アイコン、ハッシュ付き/assets/*.js|css）のみキャッシュ。
// - 任意の same-origin パスやレスポンスは 200 であっても絶対にキャッシュしない。
// - /api/* は Network-Only。オフライン時は即座に 503 Service Unavailable を返却。
// - SPA ナビゲーションはオフライン時にキャッシュ済み /index.html にフォールバック。

const CACHE_NAME = 'cyberpgm-shell-v2';

// 1. 厳格な完全一致静的ファイル許可リスト
const STATIC_ALLOWLIST = new Set([
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.ico',
]);

// 2. ビルドハッシュ付きアセットの正規表現 (/assets/*.js, /assets/*.css)
const ASSET_PATH_REGEX = /^\/assets\/[\w.-]+\.(js|css)$/;

/**
 * リクエストパスが静的キャッシュ対象かを厳格に判定するホワイトリスト検査
 */
function isStaticCacheable(pathname) {
  if (STATIC_ALLOWLIST.has(pathname)) return true;
  if (ASSET_PATH_REGEX.test(pathname)) return true;
  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // プレキャッシュ（静的ホワイトリストのうち基本シェルファイル）
      const initialAssets = Array.from(STATIC_ALLOWLIST).filter((p) => p !== '/favicon.ico');
      return Promise.allSettled(
        initialAssets.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[SW] Precache skipped for ${url}:`, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log(`[SW] Purging outdated cache: ${key}`);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. セキュリティ制約: API 通信は絶対にキャッシュしない (Network-Only)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({
            error: 'オフラインのためAPIに接続できません。オフライン中は閲覧のみ利用可能です。',
            offline: true,
          }),
          {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
    );
    return;
  }

  // 2. GET 以外のメソッドは常にネットワークへパススルー
  if (event.request.method !== 'GET') {
    return;
  }

  // 3. SPA ナビゲーションリクエスト（HTML 表示）: Network-First with /index.html fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('/index.html').then((cached) => {
          return cached || new Response('Offline resource unavailable', { status: 504 });
        });
      })
    );
    return;
  }

  // 4. 静的ホワイトリストに合致するリソースのみキャッシュ対象 (Network-First)
  if (isStaticCacheable(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cachedResponse) => {
            return cachedResponse || new Response('Asset unavailable offline', { status: 504 });
          });
        })
    );
    return;
  }

  // 5. ホワイトリスト外のリクエスト（動的パス、画像、未定義ルート等）:
  //    たとえ status 200 であっても CacheStorage には絶対に保存しない (Network-Only)
  event.respondWith(fetch(event.request));
});
