// Реализация API «сервер»: запросы к серверу-посреднику api.smartsol.pro, который берёт данные из 1С в момент запроса.
// ВНИМАНИЕ: пути и форматы — предварительные, до утверждения контракта API (см. spec/api-client.md). Все места,
// которые надо сверить с контрактом, помечены «КОНТРАКТ». Экраны ждут ответы в форме DTO из spec/api-client.md.
import { CONFIG } from '../config.js';
import { ApiError, storage, e164, maskPhone } from './core.js';

const SESSION_KEY = 'finpuls-session';
const ORG_KEY = 'finpuls-org-server';

// КОНТРАКТ: пути эндпоинтов — в одном месте.
const PATHS = {
  otpRequest: '/auth/otp/request',
  otpVerify: '/auth/otp/verify',
  logout: '/auth/logout',
  me: '/me',
  settings: '/me/settings',
  orgs: '/orgs',
  home: (org) => `/orgs/${enc(org)}/home`,
  accounts: (org) => `/orgs/${enc(org)}/accounts`,
  calendar: (org) => `/orgs/${enc(org)}/calendar`,
  requests: (org) => `/orgs/${enc(org)}/requests`,
  request: (org, id) => `/orgs/${enc(org)}/requests/${enc(id)}`,
  attachment: (org, id, att) => `/orgs/${enc(org)}/requests/${enc(id)}/attachments/${enc(att)}`,
  decision: (org, id) => `/orgs/${enc(org)}/requests/${enc(id)}/decision`,
  report: (org, kind) => `/orgs/${enc(org)}/reports/${enc(kind)}`,
  notifications: (org) => `/orgs/${enc(org)}/notifications`,
  notificationRead: (org, id) => `/orgs/${enc(org)}/notifications/${enc(id)}/read`,
  notificationsReadAll: (org) => `/orgs/${enc(org)}/notifications/read-all`,
  summary: (org) => `/orgs/${enc(org)}/summary`,
  pushConfig: '/push/config',
  pushSubscriptions: '/push/subscriptions',
};
const enc = encodeURIComponent;

// ---------- сессия: токен в памяти и в хранилище браузера (с try/catch внутри storage) ----------
let session = null; // { token, expiresAt, user }

function loadSession() {
  if (session) return session;
  const s = storage.getJSON(SESSION_KEY);
  if (s && s.token && (!s.expiresAt || Date.parse(s.expiresAt) > Date.now())) session = s;
  return session;
}

function saveSession(s) {
  session = s;
  storage.setJSON(SESSION_KEY, s);
}

export function clearSession() {
  session = null;
  storage.remove(SESSION_KEY);
  storage.remove(ORG_KEY);
}

// ---------- транспорт ----------
function codeByStatus(status) {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'already_decided';
  if (status === 429) return 'rate_limited';
  if (status === 502 || status === 503 || status === 504) return 'server_unavailable';
  return 'server_error';
}

async function request(method, path, { body, auth = true, headers = {}, raw = false } = {}) {
  const h = { Accept: raw ? '*/*' : 'application/json', ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (auth) {
    const s = loadSession();
    if (!s) throw new ApiError('unauthorized');
    h.Authorization = `Bearer ${s.token}`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.requestTimeoutMs);
  let res;
  try {
    res = await fetch(CONFIG.apiBase + path, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
      cache: 'no-store',
      credentials: 'omit', // КОНТРАКТ: если сервер выберет HttpOnly-cookie — 'include'
      mode: 'cors',
      referrerPolicy: 'no-referrer',
    });
  } catch (e) {
    throw new ApiError(e && e.name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
  if (raw && res.ok) return res;
  let data = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = null;
    }
  }
  if (res.ok) return data;
  // КОНТРАКТ: ошибка — { "error": { "code": "…", "message": "…", "details": { … } } }
  const err = (data && data.error) || {};
  const code = err.code || codeByStatus(res.status);
  const retryAfter = Number(res.headers.get('Retry-After')) || Number(err.details && err.details.retryAfter) || 0;
  if (code === 'unauthorized') clearSession();
  throw new ApiError(code, err.message || '', err.details || {}, res.status, retryAfter);
}

const get = (path) => request('GET', path);

// ---------- вход ----------
export async function init() {}

export function session_() {
  return loadSession();
}

// Код в WhatsApp отправляет сервер. Ответ одинаковый для подключённых и неподключённых номеров.
export async function requestCode(digits10) {
  const r = await request('POST', PATHS.otpRequest, { auth: false, body: { phone: e164(digits10) } });
  return {
    requestId: r && r.requestId,
    codeLength: (r && r.codeLength) || 6,
    expiresIn: (r && r.expiresIn) || 300,
    resendIn: (r && r.resendIn) || 60,
    phoneMasked: (r && r.phoneMasked) || maskPhone(digits10),
    channel: (r && r.channel) || 'whatsapp',
  };
}

export async function verifyCode({ requestId, digits10, code }) {
  const r = await request('POST', PATHS.otpVerify, {
    auth: false,
    body: { requestId, phone: e164(digits10), code, device: { name: deviceName() } },
  });
  if (!r || !r.token) throw new ApiError('server_error', 'Сервер не выдал сессию');
  saveSession({ token: r.token, expiresAt: r.expiresAt || null, user: r.user || null });
  return session;
}

export async function logout() {
  try {
    if (loadSession()) await request('POST', PATHS.logout);
  } catch (e) {
    /* выходим в любом случае */
  }
  clearSession();
}

export async function me() {
  const r = await get(PATHS.me);
  if (session && r) saveSession({ ...session, user: r });
  return r;
}

// ---------- выбранная организация ----------
export const orgId = () => storage.get(ORG_KEY);
export const setOrgId = (id) => storage.set(ORG_KEY, id);

// ---------- данные экранов (формы ответов — spec/api-client.md) ----------
export const orgs = () => get(PATHS.orgs);
export const home = (org) => get(PATHS.home(org));
export const accounts = (org) => get(PATHS.accounts(org));
export const calendar = (org) => get(PATHS.calendar(org));
export const requests = (org, tab) => get(`${PATHS.requests(org)}?state=${tab === 'done' ? 'decided' : 'pending'}`);
export const request_ = (org, id) => get(PATHS.request(org, id));
export const report = (org, kind) => get(PATHS.report(org, kind));
export const notifications = (org) => get(PATHS.notifications(org));
export const markRead = (org, id) => request('POST', PATHS.notificationRead(org, id));
export const markAllRead = (org) => request('POST', PATHS.notificationsReadAll(org));
export const summary = (org) => get(PATHS.summary(org));
export const settings = () => get(PATHS.settings);
export const saveSettings = (patch) => request('PATCH', PATHS.settings, { body: patch });

// Вложение: PDF отдаётся с авторизацией — получаем как Blob и открываем по object URL.
export async function attachment(org, id, att) {
  const res = await request('GET', PATHS.attachment(org, id, att), { raw: true });
  const blob = await res.blob();
  return { kind: 'pdf', url: URL.createObjectURL(blob), name: att };
}

// Решение по заявке. Ключ идемпотентности — в заголовке: повтор после обрыва связи не применится дважды.
export async function decide(org, id, { decision, comment, idempotencyKey }) {
  return request('POST', PATHS.decision(org, id), {
    body: { decision, comment: comment || '' },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// ---------- push ----------
export const pushConfig = () => get(PATHS.pushConfig);
export const savePushSubscription = (sub) => request('POST', PATHS.pushSubscriptions, { body: { subscription: sub, device: deviceName() } });
export const deletePushSubscription = (endpoint) => request('DELETE', PATHS.pushSubscriptions, { body: { endpoint } });

function deviceName() {
  const ua = navigator.userAgent || '';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : 'другое';
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  return `${os}${standalone ? ', приложение' : ', браузер'}`;
}
