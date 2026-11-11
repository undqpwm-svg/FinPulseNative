// Сервис-воркер: оболочка приложения (сначала сеть, без сети — кэш) и push-уведомления.
// Ответы API (api.smartsol.pro) НЕ кэшируются и не проходят через кэш: данные клиента не оседают на устройстве.
const CACHE = 'finpuls-v4';
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest', './data/demo.json',
  './js/app.js', './js/config.js', './js/screens.js', './js/store.js', './js/ui.js', './js/util.js', './js/icons.js', './js/push.js',
  './js/api/index.js', './js/api/core.js', './js/api/demo.js', './js/api/server.js',
  './icons/icon-192.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !fonts) return; // API и прочие адреса — мимо кэша
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: sameOrigin }).then((r) => r || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});

// ---------- push ----------
// КОНТРАКТ (spec/api-client.md): { "type": "request", "orgId": "…", "requestId": "…", "amount": 2300000 }.
// В событии нет названий и комментариев — только ИД заявки и сумма; подробности приложение берёт из 1С при открытии.
const NB = ' ';
const money = (n) => `${Math.round(Math.abs(Number(n) || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NB)}${NB}₸`;

function hashFor(d) {
  if (d.type === 'request' && d.requestId) return `#/requests/${encodeURIComponent(d.requestId)}${d.orgId ? `?org=${encodeURIComponent(d.orgId)}` : ''}`;
  return '#/home';
}

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch (err) {
    d = {};
  }
  const isRequest = d.type === 'request';
  const title = isRequest ? 'Новая заявка на согласование' : d.title || 'ФинПульс';
  const body = isRequest ? (d.amount != null ? `${money(d.amount)} — нажмите, чтобы открыть` : 'Нажмите, чтобы открыть') : d.body || '';
  e.waitUntil(self.registration.showNotification(title, {
    body,
    tag: isRequest && d.requestId ? `request-${d.requestId}` : undefined,
    renotify: true,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { hash: hashFor(d) },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const hash = data.hash || (data.url ? `#${String(data.url).split('#')[1] || '/home'}` : '#/home');
  const target = new URL(`./${hash}`, self.registration.scope).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = list.find((c) => c.url.startsWith(self.registration.scope));
    if (client) {
      await client.focus();
      client.postMessage({ type: 'open', hash });
      return;
    }
    await self.clients.openWindow(target);
  })());
});

// Браузер сменил подписку: приложение переотправит её на сервер при следующем открытии (push.syncPush).
self.addEventListener('pushsubscriptionchange', () => {});
