const STATIC_CACHE = 'daily-qt-static-v30';
const DATA_CACHE = 'daily-qt-data-v30';

const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css?v=30',
  './app.js?v=30',
  './data/fallback-data.js?v=30',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/badge-96.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== DATA_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 오디오 스트리밍(Range 요청, .m4a)은 브라우저 기본 미디어 캐시에 맡김 (iOS Safari 호환)
  if (request.headers.has('range') || url.pathname.includes('/data/audio/')) {
    return;
  }

  const isDailyData = url.pathname.includes('/data/') && url.pathname.endsWith('.json');
  const isHtmlNav = request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/');

  // 매일 새로운 큐티 본문과 OG 태그가 즉시 반영되도록 Network-First 사용
  if (isDailyData || isHtmlNav) {
    event.respondWith(networkFirst(request, isDailyData ? DATA_CACHE : STATIC_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
});

// Web Push 수신: 매일 그날 본문에 맞춘 따뜻한 권유 알림 표시
self.addEventListener('push', (event) => {
  let payload = {
    title: 'New Song 오늘의 발견',
    body: '잠시 숨을 고르고, 오늘 말씀 안에서 주님의 음성을 들어볼까요?',
    url: './',
    tag: 'qt-daily-reminder'
  };
  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    } catch (_err) {
      const text = event.data.text();
      if (text) payload.body = text;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: './icons/icon-192.png',
      badge: './icons/badge-96.png',
      tag: payload.tag || 'qt-daily-reminder',
      renotify: true,
      data: { url: payload.url || './' }
    })
  );
});

// 알림 터치 시 오늘 큐티 화면으로 바로 열기
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client && targetUrl !== './') {
            client.navigate(targetUrl).catch(() => {});
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
