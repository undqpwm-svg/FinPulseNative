// Клиент API — единственная точка доступа экранов к данным. Две реализации с одинаковыми методами:
//  demo   — выдуманные данные (data/demo.json), для показов;
//  server — сервер-посредник api.smartsol.pro → 1С клиента.
// Переключение — одной настройкой: CONFIG.defaultMode, ссылка «Посмотреть демо» / адрес #/demo (setMode).
// Экраны не знают, откуда данные: зовут api.home(org), api.decide(…) и т. д. и получают DTO из spec/api-client.md.
import { CONFIG } from '../config.js';
import { ApiError, storage } from './core.js';
import * as demo from './demo.js';
import * as server from './server.js';

export { ApiError } from './core.js';

const MODE_KEY = 'finpuls-mode';
const MODES = ['demo', 'server'];

let mode = MODES.includes(storage.get(MODE_KEY)) ? storage.get(MODE_KEY) : CONFIG.defaultMode;
const impl = () => (mode === 'demo' ? demo : server);

export const getMode = () => mode;
export const isDemo = () => mode === 'demo';

export function setMode(m) {
  if (!MODES.includes(m)) throw new Error(`Неизвестный режим ${m}`);
  mode = m;
  storage.set(MODE_KEY, m);
}

// Обёртка: любой метод возвращает Promise, синхронные исключения — тоже отказ промиса.
const call = (name, ...args) => {
  const f = impl()[name];
  if (typeof f !== 'function') return Promise.reject(new ApiError('not_supported', `Метод ${name} недоступен в режиме ${mode}`));
  try {
    return Promise.resolve(f(...args));
  } catch (e) {
    return Promise.reject(e);
  }
};

export const api = {
  init: () => call('init'),
  // вход
  session: () => impl().session_(),
  requestCode: (digits10) => call('requestCode', digits10),
  verifyCode: (p) => call('verifyCode', p),
  logout: () => call('logout'),
  logoutAll: () => call('logoutAll'),
  me: () => call('me'),
  // организация
  orgId: () => impl().orgId(),
  setOrgId: (id) => impl().setOrgId(id),
  orgs: () => call('orgs'),
  // экраны
  home: (org) => call('home', org),
  accounts: (org) => call('accounts', org),
  calendar: (org) => call('calendar', org),
  requests: (org, tab) => call('requests', org, tab),
  request: (org, id) => call('request_', org, id),
  attachment: (org, id, att) => call('attachment', org, id, att),
  decide: (org, id, p) => call('decide', org, id, p),
  report: (org, kind) => call('report', org, kind),
  notifications: (org) => call('notifications', org),
  markRead: (org, id) => call('markRead', org, id),
  markAllRead: (org) => call('markAllRead', org),
  summary: (org) => call('summary', org),
  settings: () => call('settings'),
  saveSettings: (patch) => call('saveSettings', patch),
  // push
  pushConfig: () => call('pushConfig'),
  savePushSubscription: (sub) => call('savePushSubscription', sub),
  deletePushSubscription: (endpoint) => call('deletePushSubscription', endpoint),
  // только демо
  resetDemo: () => call('resetDemo'),
};
