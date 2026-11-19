// Сервис-воркер: оболочка приложения (сначала сеть, без сети — кэш) и push-уведомления.
// Ответы API (api.smartsol.pro) НЕ кэшируются и не проходят через кэш: данные клиента не оседают на устройстве.
const CACHE = 'finpuls-v23';
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest', './data/demo.json', './data/projects.json',
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
// Контракт v1, 9.3: { type, title, body, org_id, request_id, notification_id, sent_at }; 13.22 — то же с
// type: "counterparty_request" и counterparty_request_id вместо request_id; request_batch — пачка новых заявок:
// { type, title, body, org_id, count, notification_id, sent_at }, без request_id.
// В push нет сумм и контрагентов — детали приложение запрашивает у сервера при открытии.
function hashFor(d) {
  if (d.type === 'request' && d.request_id) {
    const q = [d.org_id ? `org=${encodeURIComponent(d.org_id)}` : '', d.notification_id ? `n=${encodeURIComponent(d.notification_id)}` : ''].filter(Boolean).join('&');
    return `#/requests/${encodeURIComponent(d.request_id)}${q ? `?${q}` : ''}`;
  }
  // Пачка новых заявок (request_batch, с 1.3.1): Посредник склеивает push за 30 с — список «Ждут решения» организации.
  if (d.type === 'request_batch') {
    const q = [d.org_id ? `org=${encodeURIComponent(d.org_id)}` : '', d.notification_id ? `n=${encodeURIComponent(d.notification_id)}` : ''].filter(Boolean).join('&');
    return `#/requests${q ? `?${q}` : ''}`;
  }
  // Запрос контрагента (13.22): карточка запроса; нет идентификатора — список запросов.
  if (d.type === 'counterparty_request') {
    const q = [d.org_id ? `org=${encodeURIComponent(d.org_id)}` : '', d.notification_id ? `n=${encodeURIComponent(d.notification_id)}` : ''].filter(Boolean).join('&');
    return `#/cr${d.counterparty_request_id ? `/${encodeURIComponent(d.counterparty_request_id)}` : ''}${q ? `?${q}` : ''}`;
  }
  return '#/notifications'; // неизвестный type — список уведомлений
}

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch (err) {
    d = {};
  }
  const title = d.title || (d.type === 'request' ? 'Новая заявка на согласование' : d.type === 'request_batch' ? 'Новые заявки на согласование' : d.type === 'counterparty_request' ? 'Запрос контрагента' : 'ФинПульс');
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || 'Откройте, чтобы посмотреть',
    // Пачка — своё уведомление на каждый push, прежнее не заменяется: если пачка разорвалась на две, на экране
    // останутся «4 заявки» и «2 заявки», в сумме верно (решение основной сессии 19.11).
    tag: d.type === 'request_batch' ? `batch-${d.notification_id || `${d.org_id || ''}-${d.sent_at || Date.now()}`}` : d.request_id ? `request-${d.request_id}` : d.counterparty_request_id ? `cr-${d.counterparty_request_id}` : d.notification_id || undefined,
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
