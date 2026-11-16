// Реализация API «сервер» по контракту «ФинПульс: API приложения руководителя», v1 (проект от 11.11.2026).
// Это переходник: запросы — как в контракте, ответы переводятся в DTO, которые ждут экраны (spec/api-client.md).
// Экраны о контракте не знают: поменяется контракт — правится только этот файл.
import { CONFIG } from '../config.js';
import { ApiError, storage, once, forgetInflight } from './core.js';

// ---------- сессия ----------
// access-токен (15 мин) — только в памяти. refresh-токен — в cookie HttpOnly fp_refresh: приложение его не видит и
// не хранит, браузер отправляет его сам в запросы /auth/* с credentials: 'include' (контракт, 2.6).
// В хранилище браузера — только признак входа и профиль (имя для экрана), без токенов.
const SESSION_KEY = 'finpuls-session';
const ORG_KEY = 'finpuls-org-server';
const DEVICE_KEY = 'finpuls-device';

let access = null; // { token, expiresAt }
let refreshing = null; // одно обновление на все запросы сразу (контракт, 2.3)
let versionInfo = null; // ответ GET /version
let orgsCache = null; // названия организаций для счетов и сводки (сводка отдаёт и своё название)
const notEditable = new Set(); // переключатели настроек с editable: false

function stored() {
  const s = storage.getJSON(SESSION_KEY);
  return s && s.loggedIn && (!s.until || s.until > Date.now()) ? s : null;
}

function saveTokens(r, user) {
  const prev = stored() || {};
  access = { token: r.access_token, expiresAt: Date.now() + (Number(r.access_expires_in) || 900) * 1000 };
  storage.setJSON(SESSION_KEY, {
    loggedIn: true,
    until: Date.now() + (Number(r.refresh_expires_in) || 2592000) * 1000, // срок cookie; продлевается обновлением
    user: user || prev.user || null,
  });
}

export function clearSession() {
  access = null;
  orgsCache = null;
  forgetInflight();
  storage.remove(SESSION_KEY);
  storage.remove(ORG_KEY);
  storage.remove(DEVICE_KEY);
}

// ---------- транспорт ----------
// Коды контракта, у которых в приложении есть тот же смысл под другим именем.
const CODE_MAP = {
  source_unavailable: 'upstream_unavailable', // база 1С не отвечает
  source_timeout: 'timeout', // база 1С не успела за 20 с
  not_awaiting_you: 'forbidden', // решение: «заявка не на вашем этапе»
  refresh_invalid: 'unauthorized',
  internal_error: 'server_error',
  bad_request: 'server_error',
  idempotency_key_reused: 'server_error',
  idempotency_key_required: 'server_error',
};

function codeByStatus(status) {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'too_many_requests';
  if (status === 501) return 'not_implemented'; // раздел этапа 2: сервер его пока не отдаёт
  if (status === 502 || status === 503 || status === 504) return 'server_unavailable';
  return 'server_error';
}

const appHeaders = () => ({ 'X-App-Version': CONFIG.appVersion, 'X-App-Platform': 'web' });

// Запросы /auth/* — с cookie refresh-токена (credentials: 'include'), остальные — без cookie, с Bearer.
async function send(method, path, { body, token, headers = {}, cookie = path.startsWith('/auth/') } = {}) {
  const h = { Accept: 'application/json', ...appHeaders(), ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json; charset=utf-8';
  if (token) h.Authorization = `Bearer ${token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.requestTimeoutMs);
  try {
    return await fetch(CONFIG.apiBase + path, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
      cache: 'no-store',
      credentials: cookie ? 'include' : 'omit',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
    });
  } catch (e) {
    throw new ApiError(e && e.name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
}

// Ошибка контракта (раздел 10): { error, message, details } → ApiError с кодом приложения.
// Исходный код контракта сохраняется в details.contractCode, текст сервера — в message.
async function toError(res) {
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  const raw = (data && typeof data.error === 'string' && data.error) || codeByStatus(res.status);
  const details = { ...((data && data.details) || {}), contractCode: raw };
  const retryAfter = Number(details.retry_after) || Number(res.headers.get('Retry-After')) || 0;
  if (details.attempts_left !== undefined) details.attemptsLeft = details.attempts_left;
  return new ApiError(CODE_MAP[raw] || raw, (data && data.message) || '', details, res.status, retryAfter);
}

// Обновить пару токенов — одно обновление на все одновременные запросы.
function refreshTokens() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    if (!stored()) throw new ApiError('unauthorized');
    const res = await send('POST', '/auth/refresh'); // без тела и без Authorization: токен — в cookie
    if (!res.ok) {
      const e = await toError(res);
      if (e.code === 'unauthorized' || e.code === 'access_revoked') clearSession();
      throw e;
    }
    saveTokens(await res.json());
  })();
  return refreshing.finally(() => {
    refreshing = null;
  });
}

// Запрос с авторизацией: нет access-токена → обновить; 401 token_expired → обновить один раз и повторить.
async function authed(method, path, opts = {}) {
  if (!stored()) throw new ApiError('unauthorized');
  if (!access || access.expiresAt - Date.now() < 15000) await refreshTokens();
  let res = await send(method, path, { ...opts, token: access.token });
  if (res.status === 401) {
    const e = await toError(res.clone());
    if (e.details.contractCode === 'token_expired') {
      await refreshTokens();
      res = await send(method, path, { ...opts, token: access.token });
    }
  }
  if (!res.ok) {
    const e = await toError(res);
    if (e.code === 'unauthorized' || e.code === 'access_revoked') clearSession();
    throw e;
  }
  return res;
}

// Чтение: одинаковые GET склеиваются — пока первый не ответил, второй такой же в сеть не уходит (core.once).
// Экраны получают один и тот же разобранный ответ и его не меняют. POST/PUT/DELETE идут мимо, напрямую через authed.
const getJSON = (path) => once(`GET ${path}`, async () => (await authed('GET', path)).json());
const enc = encodeURIComponent;
const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${enc(v)}`).join('&');

// ---------- запуск: версия API, ключ Web Push ----------
// Ошибка связи при запуске не мешает открыть вход; устаревшая версия приложения — мешает (426 app_outdated).
export async function init() {
  if (!versionInfo) {
    try {
      versionInfo = await once('GET /version', async () => {
        const res = await send('GET', '/version');
        return res.ok ? res.json() : null;
      });
    } catch (e) {
      return;
    }
  }
  if (versionInfo && cmpVersion(CONFIG.appVersion, versionInfo.min_app_version) < 0) {
    throw new ApiError('app_outdated', 'Версия приложения устарела — обновите страницу или переустановите приложение');
  }
}

function cmpVersion(a = '0', b = '0') {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// ---------- вход (контракт, 2) ----------
function userDto(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, firstName: u.first_name, initials: u.initials, role: u.position || '', phone: formatPhone(u.phone) };
}

function formatPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 11 ? `+7 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}` : p || '';
}

export function session_() {
  const s = stored();
  return s ? { token: access && access.token, user: userDto(s.user) } : null;
}

// Начать вход (2.1): номер телефона → ссылка на бота и длина кода. Ответ одинаков для любого номера: подключён ли он
// и знакомо ли устройство, по нему узнать нельзя. Запрос идёт с cookie (как все /auth/*): по метке fp_device сервер
// узнаёт знакомое устройство и тогда бот присылает код сам. Номер уходит только в теле этого запроса.
// Самого кода в ответе нет: его присылает бот, приложение его не знает.
export async function startLogin(phone) {
  const res = await send('POST', '/auth/telegram/start', { body: { phone: String(phone || '') } });
  if (!res.ok) throw await toError(res);
  const r = await res.json();
  const dto = {
    challengeId: r.challenge_id,
    botUrl: r.bot_url, // имя бота задаёт сервер — ссылку не собираем сами; открывается только кнопкой
    codeLength: Math.max(0, Math.min(12, Math.trunc(Number(r.code_length)) || 0)),
    expiresIn: Number(r.expires_in) || 300,
    pollInterval: Math.max(1, Number(r.poll_interval) || 2),
    // known — с этого браузера номер уже входил, бот пришлёт код сам; всё остальное (new, нет поля, незнакомое
    // значение) — «новое устройство»: код сам не придёт. О самом номере поле ничего не говорит.
    device: r.device === 'known' ? 'known' : 'new',
  };
  // Без длины кода показывать нечего (так отвечал сервер прежней схемы входа): пустой экран не открываем.
  if (!dto.challengeId || !dto.codeLength) throw new ApiError('server_error', 'Сервер не сообщил, как подтвердить вход');
  return dto;
}

// Опрос (2.1.1): жив ли вход. Токенов не выдаёт и о том, прислал ли бот код, не сообщает: 202 pending — вход жив.
// Отказы — ApiError: challenge_rejected (details.reason: wrong_code | blocked), challenge_expired, too_many_requests,
// not_found, upstream_unavailable (503 source_unavailable — вход отменён).
export async function pollLogin(challengeId) {
  const res = await send('POST', '/auth/telegram/poll', { body: { challenge_id: challengeId } });
  if (!res.ok) throw await toError(res);
  return { status: 'pending' };
}

// Ввод кода (2.2): 200 — вход, refresh-токен пришёл в cookie (credentials: 'include' — у всех /auth/*).
// Ошибки — ApiError: code_invalid (details.attemptsLeft), code_not_sent, challenge_rejected, challenge_expired,
// access_revoked, validation_error, too_many_requests (retryAfter), not_found, upstream_unavailable.
// Код уходит только в теле этого запроса: в хранилище браузера и в журнал он не попадает.
export async function confirmLogin(challengeId, code) {
  const res = await send('POST', '/auth/telegram/confirm', { body: { challenge_id: challengeId, code: String(code) } });
  if (!res.ok) throw await toError(res);
  return signIn(await res.json());
}

function signIn(r) {
  if (!r || !r.access_token) throw new ApiError('server_error', 'Сервер не выдал сессию');
  orgsCache = null;
  forgetInflight();
  saveTokens(r, r.user);
  return { status: 'ok', session: session_() };
}

// Выход (2.4): без Authorization и без тела, по cookie; сервер удаляет cookie. Ответ всегда 204.
export async function logout() {
  try {
    await send('POST', '/auth/logout');
  } catch (e) {
    /* выходим в любом случае */
  }
  clearSession();
}

// «Выйти со всех устройств» (2.5): по cookie. refresh_invalid — пользователя не определить, просто на вход.
export async function logoutAll() {
  const res = await send('POST', '/auth/logout-all'); // нет связи — исключение, сессия остаётся, пусть повторит
  if (!res.ok) {
    const e = await toError(res);
    if (e.code !== 'unauthorized' && e.code !== 'access_revoked') throw e;
  }
  clearSession();
}

export async function me() {
  const r = await getJSON('/me');
  const s = stored();
  if (s && r && r.user) storage.setJSON(SESSION_KEY, { ...s, user: r.user });
  return userDto(r && r.user);
}

// ---------- организации (4.2) ----------
export const orgId = () => storage.get(ORG_KEY);
export const setOrgId = (id) => storage.set(ORG_KEY, id);

// Отчёты организации (4.2, поле reports): имена сервера → вкладки приложения, в порядке, который прислал сервер.
// Незнакомые имена пропускаем: это новый отчёт, который эта версия показывать не умеет. Поля нет (база до 1.16.2
// или сервер прежней версии) — отчётов нет.
const REPORT_TABS = { 'cash-flow': 'dds', 'plan-fact': 'plan', debtors: 'debtors', projects: 'projects' };
function reportTabs(names) {
  const out = [];
  (Array.isArray(names) ? names : []).forEach((n) => {
    const tab = REPORT_TABS[n];
    if (tab && !out.includes(tab)) out.push(tab);
  });
  return out;
}

function orgDto(o) {
  return {
    id: o.id,
    reports: reportTabs(o.reports),
    name: o.name,
    short: o.short_name || o.name,
    initials: o.initials,
    city: null, // в v1 city и activity приходят null — не выводим
    activity: null,
    summary: {
      money: o.money_total,
      pending: o.pending_requests,
      gap: o.gap ? { date: o.gap.date, deficit: o.gap.shortage } : null,
    },
  };
}

export async function orgs() {
  const r = await getJSON('/orgs'); // список перечитываем при каждом открытии экрана (4.2)
  orgsCache = (r.items || []).map(orgDto);
  return { items: orgsCache, partial: r.partial === true }; // partial: учёт части компаний не ответил
}

async function orgInfo(id) {
  if (!orgsCache || !orgsCache.some((o) => o.id === id)) await orgs();
  return orgsCache.find((o) => o.id === id) || { id, name: '', short: '', initials: '' };
}

// Какие отчёты показывать на вкладке «Отчёты» у этой организации. Список организаций уже загружен — без запроса.
export async function reportList(id) {
  return (await orgInfo(id)).reports || [];
}

const orgPath = (id, rest = '') => `/orgs/${enc(id)}${rest}`;
const dateOf = (iso) => (iso ? String(iso).slice(0, 10) : almatyToday());
function almatyToday() {
  return new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
}

// ---------- главная (5.1) — одним запросом ----------
export async function home(id) {
  const s = await getJSON(orgPath(id, '/summary'));
  const known = orgsCache && orgsCache.find((o) => o.id === id);
  const org = { id, name: s.org_name || '', short: s.org_short_name || s.org_name || '', initials: known ? known.initials : initialsOf(s.org_short_name || s.org_name) };
  const rec = s.receivables || { total: 0, aging: {} };
  const st = stored();
  return {
    today: s.date,
    asOf: s.updated_at,
    horizonDays: 28,
    user: userDto(st && st.user),
    org,
    money: { total: s.money.total, bank: s.money.bank, cash: s.money.cash },
    threshold: s.threshold || 0,
    forecast: { start: s.money.total, days: (s.forecast || []).map((d) => ({ date: d.date, end: d.closing })) },
    gap: s.gap ? { date: s.gap.date, deficit: s.gap.shortage, outflow: s.gap.outflow, articles: s.gap.top_articles || [] } : null,
    minBalance: s.min_day ? { date: s.min_day.date, amount: s.min_day.closing } : null,
    approvals: { count: s.pending.count, sum: s.pending.amount, overLimit: s.pending.over_limit_count },
    week: ((s.week && s.week.days) || []).map((d) => ({ date: d.date, in: d.inflow, out: d.outflow, end: d.closing })),
    receivables: { total: rec.total, aging: agingDto(rec.aging), oldest: null }, // самого старого должника в сводке нет
    unread: s.unread_count || 0,
  };
}

// Инициалы для аватара, если списка организаций ещё нет: «Альфа Логистик» → «АЛ».
function initialsOf(name) {
  const w = String(name || '').replace(/^(ТОО|АО|ИП|КХ)\s+/, '').replace(/[^A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі\s-]/g, ' ').split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase();
}

const agingDto = (a) => ({ days_0_30: (a && a.days_0_30) || 0, days_31_60: (a && a.days_31_60) || 0, days_over_60: (a && a.days_over_60) || 0 });

// ---------- счета (5.2) ----------
// «Итого» — total_kzt сервера как есть: та же цифра, что «Деньги на сегодня» на главной. Депозиты (deposit: true)
// в неё не входят и идут отдельным списком под итогом; их сумма — deposits_kzt, а если сервер поля не прислал, складываем сами.
// Остатки — на момент ответа (updated_at, время компании), как отчёт «Баланс» в 1С.
// Порядок внутри списков — как прислал сервер, только кассы после банковских счетов.
export async function accounts(id) {
  const [r, org] = await Promise.all([getJSON(orgPath(id, '/accounts')), orgInfo(id)]);
  const all = (r.items || []).map((a) => ({
    name: a.name || (a.type === 'cash' ? 'Касса' : 'Счёт'),
    note: [a.note, a.number_masked, a.currency && a.currency !== 'KZT' ? `${fmt(a.balance)} ${a.currency}` : null].filter(Boolean).join(' · '),
    type: a.type === 'cash' ? 'cash' : 'bank',
    amount: Number(a.balance_kzt ?? a.balance) || 0,
    deposit: a.deposit === true,
  }));
  const byType = (list) => [...list.filter((a) => a.type === 'bank'), ...list.filter((a) => a.type === 'cash')];
  const deposits = byType(all.filter((a) => a.deposit));
  return {
    orgName: org.name,
    asOf: r.updated_at || null,
    total: r.total_kzt,
    items: byType(all.filter((a) => !a.deposit)),
    deposits,
    depositsTotal: typeof r.deposits_kzt === 'number' ? r.deposits_kzt : deposits.reduce((t, a) => t + a.amount, 0),
  };
}

// Сумма в валюте счёта или позиции: целая — без копеек, дробная — с двумя знаками (1 234,56).
const fmt = (n) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const [int, frac] = (Number.isInteger(v) ? String(v) : v.toFixed(2)).split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (frac ? `,${frac}` : '');
};

// ---------- календарь (5.3) ----------
// Заголовок позиции без контрагента (зарплата, налог): статья, а если и её нет — по источнику позиции.
const SOURCE_TITLE = { request: 'Заявка на оплату', supplier_invoice: 'Счёт поставщика', planned_payment: 'Плановый платёж', salary: 'Зарплата', tax: 'Налоги', expected_receipt: 'Ожидаемая оплата' };

export async function calendar(id) {
  const r = await getJSON(orgPath(id, '/calendar'));
  return {
    today: r.from,
    threshold: r.threshold || 0,
    // Первый кассовый разрыв — как его посчитал сервер: то же число, что на главной (5.1).
    gap: r.gap ? { date: r.gap.date, deficit: r.gap.shortage } : null,
    days: (r.days || []).map((d) => ({
      date: d.date,
      start: d.opening,
      end: d.closing,
      in: d.inflow,
      out: d.outflow,
      items: (d.items || []).map((i) => {
        const inTotals = i.in_totals !== false; // false — просроченное поступление: в итоги и остаток дня не входит
        return {
          dir: i.direction === 'in' ? 'in' : 'out',
          who: i.counterparty || i.article || SOURCE_TITLE[i.source] || 'Без контрагента',
          article: i.counterparty ? i.article || '' : '', // без контрагента статья уже стоит в заголовке
          note: [i.note, i.late && inTotals ? 'дата прошла' : null, i.preliminary ? 'дата предварительная' : null,
            i.currency && i.currency !== 'KZT' ? `${fmt(i.amount)} ${i.currency}` : null].filter(Boolean).join(' · '),
          amount: i.amount_kzt != null ? i.amount_kzt : i.amount, // в тенге, как дневные итоги
          requestId: i.request_id || null,
          inTotals,
        };
      }),
    })),
  };
}

// ---------- заявки (6) ----------
// Статус для экрана — с точки зрения пользователя (my_action): ждёт решения / согласовал / отклонил / вернул.
function screenStatus(r) {
  if (r.my_action === 'required') return 'pending';
  if (r.my_action === 'approved' || r.my_action === 'rejected' || r.my_action === 'returned') return r.my_action;
  return { approved: 'approved', rejected: 'rejected', draft: 'returned', closed: 'approved' }[r.status] || 'pending';
}

function reqDto(r) {
  return {
    id: r.id,
    num: r.number,
    contractor: r.counterparty || '',
    amount: r.amount_kzt != null ? r.amount_kzt : r.amount,
    currency: r.currency || 'KZT',
    article: r.article || '',
    purpose: r.purpose || '',
    initiator: { name: (r.initiator && r.initiator.name) || '', initials: (r.initiator && r.initiator.initials) || '', role: (r.initiator && r.initiator.position) || '' },
    due: r.pay_by,
    overLimit: r.over_limit || 0,
    status: screenStatus(r),
    decidedAt: r.my_decision_at || null,
  };
}

export async function requests(id, tab) {
  const items = [];
  let cursor = null;
  let updatedAt = null;
  for (let page = 0; page < 5; page++) { // не больше 500 заявок
    const r = await getJSON(orgPath(id, `/requests?${qs({ tab: tab === 'done' ? 'decided' : 'pending', limit: 100, cursor })}`));
    updatedAt = updatedAt || r.updated_at;
    items.push(...(r.items || []));
    cursor = r.next_cursor;
    if (!cursor) break;
  }
  return { today: dateOf(updatedAt), items: items.map(reqDto) };
}

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const monthName = (ym) => (ym ? MONTHS[Number(String(ym).slice(5, 7)) - 1] || ym : '');

function sizeText(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1).replace('.', ',')} МБ`;
  return `${Math.max(1, Math.round(n / 1024))} КБ`;
}

function routeStep(s) {
  let status;
  if (s.kind === 'created') status = 'created';
  else if (s.state === 'current') status = 'pending';
  else if (s.state === 'waiting') status = 'waiting';
  else if (s.state === 'skipped') status = 'skipped';
  else status = { approved: 'approved', rejected: 'rejected', returned: 'returned', sent: 'created' }[s.decision] || 'pending';
  const who = (s.approver && s.approver.name) || '';
  return {
    name: s.on_behalf_of ? `${who} (за ${s.on_behalf_of})` : who,
    role: s.kind === 'created' ? 'Инициатор' : [s.approver && s.approver.is_group ? 'группа согласующих' : null, `этап ${s.stage}`].filter(Boolean).join(' · '),
    me: !!s.is_me,
    status,
    at: s.at || null,
    comment: s.comment || '',
  };
}

function cardDto(r) {
  const b = (r.budgets || []).find((x) => x.article === r.article) || (r.budgets || [])[0];
  return {
    today: dateOf(r.updated_at),
    ...reqDto(r),
    payFrom: r.pay_from ? [r.pay_from.name, r.pay_from.number_masked].filter(Boolean).join(' · ') : null,
    createdAt: r.created_at,
    comment: r.comment || '',
    // Бюджет основной статьи (контракт, 6.2). «Израсходовано» на экране — spent + approved_requests.
    // request — доля этой заявки по статье (this_request): у заявки с несколькими статьями она меньше суммы заявки.
    // overBy — превышение, как его посчитал учёт (over_by); нет поля — экран считает сам от доли.
    budget: b && b.has_limit ? {
      article: b.article || r.article || '',
      period: monthName(b.month),
      limit: b.limit,
      used: (b.spent || 0) + (b.approved_requests || 0),
      request: b.this_request != null ? b.this_request : null,
      overBy: b.over_by != null ? b.over_by : null,
    } : null,
    articles: (r.lines || []).length,
    impact: r.impact ? { date: r.impact.date, before: r.impact.closing_before, after: r.impact.closing_after, inCalendar: !!r.impact.in_calendar } : null,
    attachments: (r.files || []).map((f) => ({ id: f.id, name: f.name, size: sizeText(f.size), kind: 'pdf', contentType: f.content_type })),
    route: (r.route || []).map(routeStep),
    canDecide: r.my_action === 'required',
  };
}

const getCard = (id, reqId) => getJSON(orgPath(id, `/requests/${enc(reqId)}`));
export const request_ = async (id, reqId) => cardDto(await getCard(id, reqId));

// Файл вложения (6.3) — потоком с авторизацией → object URL для просмотра.
export async function attachment(id, reqId, fileId) {
  const path = orgPath(id, `/requests/${enc(reqId)}/files/${enc(fileId)}`);
  // Повторное нажатие, пока файл едет из 1С, второго скачивания не запускает.
  const f = await once(`GET ${path}`, async () => {
    const res = await authed('GET', path, { headers: { Accept: '*/*' } });
    const blob = await res.blob();
    const disp = res.headers.get('Content-Disposition') || '';
    const m = disp.match(/filename\*=UTF-8''([^;]+)/i);
    let name = fileId;
    try {
      if (m) name = decodeURIComponent(m[1]);
    } catch (e) {
      /* имя как есть */
    }
    return { blob, name };
  });
  return { kind: 'pdf', url: URL.createObjectURL(f.blob), name: f.name };
}

// Решение (6.4–6.7): approve / reject / return. Ответ — обновлённая карточка.
const ACTION_PATH = { approve: 'approve', reject: 'reject', return: 'return' };

export async function decide(id, reqId, { decision, comment, idempotencyKey }) {
  const action = ACTION_PATH[decision];
  if (!action) throw new ApiError('server_error', `Неизвестное решение ${decision}`);
  let res;
  try {
    res = await authed('POST', orgPath(id, `/requests/${enc(reqId)}/${action}`), {
      body: comment ? { comment } : {},
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  } catch (e) {
    // «Уже решено»: кто и когда — в details (6.4).
    if (e.code === 'already_decided') {
      e.details = { ...e.details, status: e.details.decision || 'approved', by: e.details.decided_by || '', at: e.details.decided_at || null };
    }
    throw e;
  }
  const card = await res.json();
  const next = (card.route || []).find((s) => s.kind === 'approval' && (s.state === 'current' || s.state === 'waiting'));
  return {
    decision: { approve: 'approved', reject: 'rejected', return: 'returned' }[decision],
    requestStatus: card.status === 'on_approval' ? 'in_approval' : card.status,
    paymentDate: card.status === 'approved' ? card.pay_by : null,
    nextApprover: next && next.approver ? next.approver.name : null,
    replayed: res.headers.get('Idempotent-Replayed') === 'true',
  };
}

// ---------- отчёты (7) ----------
const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function weekFull(w) {
  const a = Number(String(w.from).slice(8, 10));
  const b = Number(String(w.to).slice(8, 10));
  return `${a}–${b} ${MONTH_GEN[Number(String(w.to).slice(5, 7)) - 1] || ''}`;
}

export async function report(id, kind) {
  if (kind === 'plan') {
    const r = await getJSON(orgPath(id, '/reports/plan-fact'));
    const row = (x) => ({ article: x.article, plan: x.plan == null ? null : x.plan, fact: x.fact || 0 });
    return { period: r.title, hasPlan: r.has_plan !== false, income: (r.income || []).map(row), expense: (r.expense || []).map(row) };
  }
  if (kind === 'debtors') {
    const r = await getJSON(orgPath(id, `/reports/debtors?${qs({ limit: 5 })}`));
    const top = (r.items || []).map((d) => ({ name: d.counterparty, amount: d.amount, aging: agingDto(d.aging), days: d.oldest_days || 0 }));
    const topSum = top.reduce((s, d) => s + d.amount, 0);
    return { asOf: r.date, total: r.total, aging: agingDto(r.aging), top, rest: Math.max(0, r.total - topSum) };
  }
  const r = await getJSON(orgPath(id, '/reports/cash-flow'));
  return { period: r.title, weeks: (r.weeks || []).map((w) => ({ label: w.label, full: weekFull(w), in: w.inflow, out: w.outflow })) };
}

// ---------- проекты (7.4, 7.5) — общий проход отчётов: /orgs/{org}/reports/{имя} и /{имя}/{id} ----------
// Отборы, сортировку и итоги делает сервер; приложение передаёт параметры и показывает ответ.
// 403 report_unavailable — отчёт этому пользователю недоступен: экран перечитывает /orgs. 404 — карточки больше нет.
const projectDto = (p) => ({
  id: p.id,
  projectId: p.project_id || null,
  withoutId: !!p.without_id,
  saleNumber: p.sale_number || null,
  orderDate: p.order_date || null,
  closedDate: p.closed_date || null,
  customer: p.customer || '',
  manager: p.manager || null,
  description: p.description || '',
  category: p.category || null,
  status: p.status || '',
  revenue: Number(p.revenue) || 0,
  costs: Number(p.costs) || 0,
  margin: Number(p.margin) || 0,
  marginPct: Number(p.margin_pct) || 0,
  paid: Number(p.paid) || 0,
  debt: Number(p.debt) || 0,
  salesCount: Number(p.sales_count) || 0,
});

export async function projects(id, f = {}) {
  const r = await getJSON(orgPath(id, `/reports/projects?${qs({
    from: f.from, to: f.to, status: f.status,
    debt_only: f.debtOnly ? 'true' : null, without_id: f.withoutId ? 'true' : null,
    sort: f.sort && f.sort !== 'date' ? f.sort : null, limit: f.limit || 50, cursor: f.cursor,
  })}`));
  const t = r.totals || {};
  return {
    updatedAt: r.updated_at || null,
    from: r.from || null,
    to: r.to || null,
    moneyNote: r.money_note || '',
    totals: {
      count: Number(t.count) || 0, withoutId: Number(t.without_id) || 0,
      revenue: Number(t.revenue) || 0, costs: Number(t.costs) || 0, margin: Number(t.margin) || 0, marginPct: Number(t.margin_pct) || 0,
      paid: Number(t.paid) || 0, debt: Number(t.debt) || 0,
    },
    items: (r.items || []).map(projectDto),
    nextCursor: r.next_cursor || null,
  };
}

export async function project(id, projectId) {
  const r = await getJSON(orgPath(id, `/reports/projects/${enc(projectId)}`));
  const f = r.finance || {};
  return {
    ...projectDto({ ...r, ...f }),
    updatedAt: r.updated_at || null,
    purchasesTotal: f.purchases_total == null ? null : Number(f.purchases_total) || 0,
    paymentsTotal: f.payments_total == null ? null : Number(f.payments_total) || 0,
    sales: (r.sales || []).map((x) => ({ date: x.date, number: x.number || '', posted: x.posted !== false, service: x.service || '', account: x.account || '', amount: Number(x.amount_net) || 0, kind: x.kind || '' })),
    // у проекта без ID поступления по ID не подбираются — null
    purchases: r.purchases == null ? null : r.purchases.map((x) => ({ date: x.date, number: x.number || '', supplier: x.supplier || '', amount: Number(x.amount) || 0, posted: x.posted !== false, note: x.note || '' })),
    payments: (r.payments || []).map((x) => ({ date: x.date, article: x.article || '', comment: x.comment || '', account: x.account || '', amount: Number(x.amount) || 0, link: x.link || '', note: x.note || '' })),
    unassigned: Number(r.unassigned_count) || 0,
    truncated: r.truncated === true,
    hint: r.hint || '',
    moneyNote: r.money_note || '',
  };
}

// ---------- уведомления (8) ----------
const N_TYPE = { payment_corrected: 'payment', payment_cancelled: 'payment', decision: 'approved', limit: 'gap', balances: 'summary' };

function linkStr(l) {
  if (!l) return null;
  if (l.kind === 'request' && l.request_id) return `request:${l.request_id}`;
  if (l.kind === 'calendar' && l.date) return `calendar:${l.date}`;
  if (l.kind === 'summary') return 'summary';
  if (l.kind === 'debtors') return 'reports:debtors';
  return null;
}

export async function notifications(id) {
  const r = await getJSON(`/notifications?${qs({ org_id: id, unread_only: false, limit: 50 })}`);
  return {
    today: almatyToday(),
    unread: r.unread_count || 0,
    items: (r.items || []).map((n) => ({
      id: n.id,
      type: N_TYPE[n.type] || n.type,
      at: n.created_at,
      title: n.title,
      text: n.text,
      read: !!n.read,
      link: linkStr(n.link),
    })),
  };
}

export const markRead = (id, nId) => authed('POST', '/notifications/read', { body: { ids: [nId], org_id: id } });
export const markAllRead = (id) => authed('POST', '/notifications/read', { body: { all: true, org_id: id } });

// Утренняя сводка — те же данные главной (link.kind = summary).
export async function summary(id) {
  const s = await getJSON(orgPath(id, '/summary'));
  return {
    asOf: s.updated_at,
    orgName: s.org_name || '',
    money: s.money,
    today: { in: s.today.inflow, out: s.today.outflow },
    gap: s.gap ? { date: s.gap.date, deficit: s.gap.shortage } : null,
    approvals: { count: s.pending.count, sum: s.pending.amount },
    over60: (s.receivables && s.receivables.aging && s.receivables.aging.days_over_60) || 0,
  };
}

// ---------- настройки (4.3) ----------
const SETTING_KEYS = ['summary', 'requests', 'payments', 'gaps', 'whatsapp'];

function settingsDto(r) {
  const n = (r && r.notifications) || {};
  const toggles = {};
  notEditable.clear();
  SETTING_KEYS.forEach((k) => {
    toggles[k] = !!(n[k] && n[k].enabled);
    if (n[k] && n[k].editable === false) notEditable.add(k);
  });
  return {
    toggles,
    locked: [...notEditable],
    info: {
      summaryTime: (n.summary && n.summary.time) || null,
      paymentsMin: n.payments && n.payments.min_amount != null ? n.payments.min_amount : null,
      gapsDays: n.gaps && n.gaps.days_ahead != null ? n.gaps.days_ahead : null,
    },
  };
}

export const settings = async () => settingsDto(await getJSON('/me/settings'));

export async function saveSettings(patch) {
  const notifications = {};
  for (const [k, v] of Object.entries(patch)) {
    if (notEditable.has(k)) throw new ApiError('forbidden', 'Этот переключатель настраивает администратор компании');
    notifications[k] = { enabled: !!v };
  }
  return settingsDto(await (await authed('PUT', '/me/settings', { body: { notifications } })).json());
}

// ---------- push (9) ----------
export async function pushConfig() {
  if (!versionInfo) {
    try {
      await init();
    } catch (e) {
      /* версия проверится при следующем запуске */
    }
  }
  return { vapidPublicKey: (versionInfo && versionInfo.webpush_public_key) || null };
}

export async function savePushSubscription(sub) {
  const r = await (await authed('POST', '/devices', {
    body: { platform: 'web', provider: 'webpush', subscription: sub, app_version: CONFIG.appVersion },
  })).json();
  if (r && r.device_id) storage.set(DEVICE_KEY, r.device_id);
  return r;
}

// Выключить push на этом устройстве. При выходе подписка удаляется сервером вместе с сессией (9.2).
export async function deletePushSubscription() {
  const dev = storage.get(DEVICE_KEY);
  if (!dev) return;
  try {
    await authed('DELETE', `/devices/${enc(dev)}`);
  } finally {
    storage.remove(DEVICE_KEY);
  }
}
