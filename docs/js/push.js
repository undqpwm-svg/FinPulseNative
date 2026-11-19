// Web push: разрешение, подписка, отправка подписки на сервер. Ключ VAPID (открытый) приходит с сервера — в коде его нет.
// iOS: push работает только у приложения, добавленного на экран «Домой» (iOS 16.4+).
import { api, isDemo } from './api/index.js';
import { storage } from './api/core.js';
import { isTestEnv } from './config.js';

const ASKED_KEY = 'finpuls-push-asked';

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;

// Состояние для экранов:
//  unsupported   — браузер не умеет push;
//  needs-install — iPhone в Safari: сначала «На экран Домой»;
//  default       — ещё не спрашивали;
//  granted       — разрешено;
//  denied        — запрещено (включается только в настройках телефона).
export function pushState() {
  // Тестовый сервер (?api=test, с 1.3.2): push только на компьютере. На iPhone push есть лишь у приложения на экране
  // «Домой», а оно всегда открывается на рабочем сервере. Подписка браузера одна на сайт (на профиль Chrome):
  // тестовая вкладка регистрирует её и на тестовом сервере, но никогда не отменяет и не заменяет рабочую (ниже).
  if (isTestEnv() && isIOS()) return 'unsupported';
  if (isIOS() && !isStandalone()) return 'needs-install';
  if (!supported()) return 'unsupported';
  return Notification.permission;
}

// Показать предложение включить уведомления — один раз после входа (повтор — не раньше чем через 7 дней).
export function shouldOfferPush() {
  if (pushState() !== 'default') return false;
  const last = Number(storage.get(ASKED_KEY) || 0);
  return Date.now() - last > 7 * 86400e3;
}

export function markPushOffered() {
  storage.set(ASKED_KEY, String(Date.now()));
}

function keyToUint8(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const b64 = (base64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Ключ VAPID, которым сделана подписка (base64url без «=»), или null, если браузер его не сообщает.
function keyOf(sub) {
  try {
    const k = sub && sub.options && sub.options.applicationServerKey;
    if (!k) return null;
    const bytes = new Uint8Array(k);
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch (e) {
    return null;
  }
}
const sameKey = (a, b) => String(a || '').replace(/=+$/, '') === String(b || '').replace(/=+$/, '');

// Для подписки: дождаться активного service worker (не дольше 4 с).
async function registration() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 4000))]);
  return reg;
}

// Для выхода и синхронизации: уже зарегистрированный service worker, без ожидания.
async function existing() {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.getRegistration) return null;
  try {
    return (await navigator.serviceWorker.getRegistration()) || null;
  } catch (e) {
    return null;
  }
}

// Включить уведомления. Вызывать только из нажатия пользователя (иначе браузер не покажет запрос).
// Возвращает { ok, reason } — reason: 'needs-install', 'unsupported', 'denied', 'no-key', 'other-key', 'error'.
// Подписка сделана другим ключом VAPID (у рабочего и тестового серверов ключи могут быть разные):
//  - рабочий сервер — старая подписка снимается и делается новая (её ключом push от рабочего сервера не дойдёт);
//  - тестовая вкладка — ничего не трогаем, 'other-key': рабочая подписка этого профиля браузера дороже теста.
export async function enablePush() {
  const st = pushState();
  if (st === 'needs-install' || st === 'unsupported') return { ok: false, reason: st };
  markPushOffered();
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'denied' };
  if (isDemo()) return { ok: true, demo: true };
  try {
    const cfg = await api.pushConfig();
    if (!cfg || !cfg.vapidPublicKey) return { ok: false, reason: 'no-key' }; // ЗАГЛУШКА: ключ VAPID выдаст сервер
    const reg = await registration();
    if (!reg) return { ok: false, reason: 'unsupported' };
    let sub = await reg.pushManager.getSubscription();
    const have = keyOf(sub);
    if (sub && have && !sameKey(have, cfg.vapidPublicKey)) {
      if (isTestEnv()) return { ok: false, reason: 'other-key' };
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToUint8(cfg.vapidPublicKey) });
    await api.savePushSubscription(sub.toJSON());
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'error', error: e };
  }
}

// После входа: если разрешение уже есть — переотправить подписку (сервер мог её потерять, ключ мог смениться).
export async function syncPush() {
  if (isDemo() || pushState() !== 'granted') return;
  try {
    const reg = await existing();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (!sub) return;
    // Подписка сделана другим ключом (её завела тестовая вкладка этого профиля браузера): тестовая вкладка её не
    // трогает; рабочий сервер важнее — подписка заменяется на сделанную его ключом (разрешение уже есть).
    let fresh = sub;
    const have = keyOf(sub);
    if (have) {
      const cfg = await api.pushConfig();
      if (cfg && cfg.vapidPublicKey && !sameKey(have, cfg.vapidPublicKey)) {
        if (isTestEnv()) return;
        await sub.unsubscribe();
        fresh = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToUint8(cfg.vapidPublicKey) });
      }
    }
    await api.savePushSubscription(fresh.toJSON());
  } catch (e) {
    /* не критично: подписка обновится при следующем входе */
  }
}

// При выходе: перестать получать push этого пользователя на этом устройстве.
export async function disablePush() {
  try {
    // Тестовая вкладка: устройство снимается только на тестовом сервере, подписка браузера остаётся — она же у
    // рабочего сервера.
    if (isTestEnv()) {
      await api.deletePushSubscription().catch(() => {});
      return;
    }
    const reg = await existing();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (!sub) return;
    if (!isDemo()) await api.deletePushSubscription(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  } catch (e) {
    /* нечего отписывать */
  }
}

// Демо: показать, как выглядит уведомление о новой заявке (локально, без сервера). Нажатие открывает заявку.
export async function demoNotification(requestId, amountText) {
  const reg = await registration();
  if (!reg || Notification.permission !== 'granted') return false;
  await reg.showNotification('Новая заявка на согласование', {
    body: `${amountText} — нажмите, чтобы открыть`,
    tag: `request-${requestId}`,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: `./#/requests/${requestId}` },
  });
  return true;
}
