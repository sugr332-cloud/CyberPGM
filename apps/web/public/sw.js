/* global self, caches, fetch, Response, URL, console */
// CyberPGM Service Worker (Phase 6j PWA)
// セキュリティ方針:
// - アプリケーションシェル（HTML, CSS, JS, アイコン）のみキャッシュ。
// - /api/*, /images/user/*, プレイヤー/セッション/キャラクター/シナリオ等の動的データは絶対にキャッシュしない。
// - オフライン時の API 呼び出しは即座に 503 Service Unavailable を返却し、偽の成功やキュー積みを防止。

const CACHE_NAME = 'cyberpgm-shell-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // プレキャッシュ（エラーが発生してもインストール中断しないよう個別に試行）
      return Promise.allSettled(
        STATIC_ASSETS.map((url) =>
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

  // 2. ユーザーアップロード画像・動的プライベート画像はキャッシュしない
  if (url.pathname.startsWith('/images/user/') || url.pathname.startsWith('/data/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 3. GET リクエスト以外のメソッド（POST/PUT/DELETE等）はネットワークへパススルー
  if (event.request.method !== 'GET') {
    return;
  }

  // 4. アプリケーションシェル（静的アセット）: Network-First (with Cache Fallback)
  // オンライン時は最新のコードを取得し、オフライン時はキャッシュされた UI を表示
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // 正常な 200 レスポンスかつ同一オリジンまたは静的リソースの場合はキャッシュ更新
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
          if (cachedResponse) {
            return cachedResponse;
          }
          // SPA ナビゲーションリクエスト（HTML）の場合は /index.html にフォールバック
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('Offline resource unavailable', {
            status: 504,
            statusText: 'Gateway Timeout',
          });
        });
      })
  );
});
