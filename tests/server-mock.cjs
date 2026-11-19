// Проверка режима «сервер» по контракту «ФинПульс: API приложения руководителя» v1 (11.11.2026) без настоящего сервера:
// ответы API подменяются в браузере (page.route) по формам и кодам ошибок контракта.
// Сценарии: версия API и заголовки; вход — номер в приложении, код из Telegram (start с номером → экран кода с
// нейтральным текстом и кнопкой бота → poll: 202 pending, отказы → confirm: 200, code_invalid, code_not_sent,
// challenge_rejected wrong_code/blocked, challenge_expired, too_many_requests, source_unavailable, обрыв связи);
// ответ сервера прежней схемы (match_code) — понятная ошибка; тестовый сервер (?api=test); залпы одинаковых запросов;
// заявка с двумя статьями; вкладка «Отчёты» по списку reports из /orgs; «Проекты» и «Отчёт по проекту» (7.4–7.5);
// выбор организации (несколько, partial, 503 source_unavailable, одна); обновление токенов
// (одно на все запросы, refresh_invalid, access_revoked); «1С недоступна»; решения (успех, already_decided,
// not_awaiting_you, action_failed, обрыв связи и повтор с тем же Idempotency-Key); настройки; уведомления; push.
// Версия контракта: refresh-токен — в cookie HttpOnly fp_refresh (2.6), CORS с credentials, сводка главной одним
// запросом (org_name, unread_count, threshold), already_decided с decided_by/decided_at, amount_kzt в календаре.
// Запуск: node tests/server-mock.cjs [--shots]
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DOCS = path.join(__dirname, '..', 'docs');
// адрес API и версия приложения — из конфига сборки
const CONFIG_JS = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'config.js'), 'utf8');
const API = /apiBase:\s*'([^']+)'/.exec(CONFIG_JS)[1];
const API_TEST = /apiBaseTest:\s*'([^']+)'/.exec(CONFIG_JS)[1];
const APP_VERSION = /appVersion:\s*'([^']+)'/.exec(CONFIG_JS)[1];
const API_HOSTS = [API, API_TEST].map((u) => new URL(u).host);
const BOT = 'https://t.me/finpulse_smartsol_bot';
// Текст на экране ввода кода — дословно от заказчика, один для любого номера (контракт, 2).
const NOTE = 'Если номер подключён, код придёт в Telegram в течение минуты. Не пришёл — нажмите „Войти через Telegram“ или обратитесь к администратору вашей компании.';
// Экран нового устройства (device: new) — «Подтвердите вход в Telegram»: до нажатия «Войти через Telegram» и после.
const NEW_NOTE = 'С этого устройства вход нужно один раз подтвердить в Telegram. Нажмите кнопку — бот пришлёт код.';
const NEW_DONE = 'Нажмите на код в сообщении бота — он скопируется. Вернитесь сюда и вставьте его.';
const SHOTS = path.join(__dirname, '..', 'screenshots', 'server');
const SAVE = process.argv.includes('--shots');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(DOCS, p);
      if (!f.startsWith(DOCS) || !fs.existsSync(f)) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, () => resolve(srv));
  });
}

let failures = 0;
const ok = (c, m) => {
  console.log(`  ${c ? '✓' : '✗'} ${m}`);
  if (!c) failures++;
};
const norm = (t) => String(t).replace(/ /g, ' ');
const settle = (p, ms = 500) => p.waitForTimeout(ms);
const shot = async (page, name) => {
  if (!SAVE) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

// ---------- данные ответов — по примерам контракта (выдуманные) ----------
const TODAY = '2026-11-11';
const day = (i) => new Date(Date.UTC(2026, 10, 11 + i)).toISOString().slice(0, 10);
const T = (d, t) => `${d}T${t}:00+05:00`;
const USER = { id: 'u_test', name: 'Тест Руководитель', first_name: 'Тест', initials: 'ТР', position: null, phone: '+77000000001' };
const ORG = { id: 'org_test', reports: ['cash-flow', 'plan-fact', 'debtors'], name: 'ТОО «Тест»', short_name: 'Тест', initials: 'ТТ', city: null, activity: null, money_total: 5000000, pending_requests: 1, gap: null, updated_at: T(TODAY, '10:15') };
// организация от сервера прежней версии (база до 1.16.2): поля reports нет совсем
const ORG_OLD = (({ reports, ...rest }) => rest)(ORG);
// демо-ответы отчёта «Проекты» в формате API (7.4–7.5): список и две карточки
const PRJ = JSON.parse(fs.readFileSync(path.join(DOCS, 'data', 'projects.json'), 'utf8'));
const ORG2 = { id: 'org_two', name: 'ТОО «Второй»', short_name: 'Второй', initials: 'ВТ', city: null, activity: null, money_total: 1200000, pending_requests: 0, gap: { date: '2026-11-13', shortage: 300000 }, updated_at: T(TODAY, '10:15') };

function calDays() {
  return Array.from({ length: 28 }, (_, i) => {
    const opening = 5000000 - i * 10000;
    return {
      date: day(i), opening, inflow: i % 3 ? 300000 : 0, outflow: 310000, closing: opening - 10000 - (i % 3 ? 0 : 300000) + (i % 3 ? 0 : 300000), gap: false,
      items: [{ direction: 'out', counterparty: 'ТОО «Тест Поставщик»', article: 'Аренда', note: null, amount: i === 0 ? 600 : 310000, currency: i === 0 ? 'USD' : 'KZT', amount_kzt: 310000, source: 'planned_payment', request_id: null, late: false, preliminary: false }],
    };
  });
}

function card(over = {}) {
  return {
    updated_at: T(TODAY, '10:15'), id: 'req_1', number: '901', request_code: null, status: 'on_approval', my_action: 'required', my_decision_at: null,
    counterparty: 'ТОО «Тест Поставщик»', amount: 1500000, currency: 'KZT', amount_kzt: 1500000, article: 'Аренда',
    purpose: 'Аренда склада за декабрь', comment: 'Как обычно', pay_by: day(3),
    pay_from: { account_id: 'acc_1', type: 'bank', name: 'Тест Банк', number_masked: 'KZ•• 0001' },
    priority: 'medium', cost_center: null, created_at: T(TODAY, '09:00'),
    initiator: { name: 'Тест Инициатор', initials: 'ТИ', position: null },
    lines: [{ article: 'Аренда', cost_center: null, amount: 1500000, comment: null }],
    budgets: [{ article: 'Аренда', cost_center: null, month: '2026-11', has_limit: true, limit: 2000000, spent: 300000, approved_requests: 200000, available: 1500000, this_request: 1500000, over_by: 0 }],
    impact: { date: day(3), closing_before: 4960000, closing_after: 3460000, creates_gap: false, in_calendar: false },
    invoice: null,
    files: [{ id: 'f_1', name: 'Счёт № 77.pdf', size: 186368, content_type: 'application/pdf', added_at: T(TODAY, '08:59') }],
    route: [
      { stage: 0, kind: 'created', approver: { name: 'Тест Инициатор', initials: 'ТИ', position: null, is_group: false }, is_me: false, state: 'done', decision: 'sent', at: T(TODAY, '09:00'), comment: null, on_behalf_of: null, due_at: null },
      { stage: 1, kind: 'approval', approver: { name: 'Тест Руководитель', initials: 'ТР', position: null, is_group: false }, is_me: true, state: 'current', decision: null, at: null, comment: null, on_behalf_of: null, due_at: null },
      { stage: 2, kind: 'approval', approver: { name: 'Финотдел', initials: 'ФО', position: null, is_group: true }, is_me: false, state: 'waiting', decision: null, at: null, comment: null, on_behalf_of: null, due_at: null },
    ],
    ...over,
  };
}

// Заявка с двумя статьями (контракт, 6.2): лимит считается по доле статьи (this_request), а не по всей сумме заявки.
// Аренда: лимит 2 000 000, израсходовано 1 000 000 + 300 000, доступно 700 000, доля заявки 900 000 → over_by 200 000.
// Если считать от всей суммы заявки (1 500 000), вышло бы 800 000 — так считало приложение до исправления.
const MULTI = card({
  id: 'req_2', number: '902', counterparty: 'ТОО «Тест Арендодатель»', purpose: 'Аренда и коммунальные услуги за декабрь',
  lines: [{ article: 'Аренда', cost_center: null, amount: 900000, comment: null }, { article: 'Коммунальные услуги', cost_center: null, amount: 600000, comment: null }],
  budgets: [
    { article: 'Аренда', cost_center: null, month: '2026-11', has_limit: true, limit: 2000000, spent: 1000000, approved_requests: 300000, available: 700000, this_request: 900000, over_by: 200000 },
    { article: 'Коммунальные услуги', cost_center: null, month: '2026-11', has_limit: false, limit: null, spent: null, approved_requests: null, available: null, this_request: 600000, over_by: 0 },
  ],
});

// Запросы контрагентов (контракт 13.17–13.21): карточки для имитатора. Данные вымышленные.
function crCard(over = {}) {
  return {
    updated_at: T(TODAY, '10:15'), id: 'cr_1', kind: 'answer', status: 'pending', intent: 'act', title: 'Акт сверки за 01.01.2026–11.11.2026',
    counterparty: { name: 'ТОО «Тест Контрагент»', bin: '123456789012' }, contact: { name: 'Тест Контакт' },
    phone_masked: '+7 701 ***-**-67', known_phone: true,
    question: 'Скиньте акт сверки за этот год', text: 'Акт сверки с ТОО «Тест Контрагент» за 01.01.2026–11.11.2026 — во вложении.',
    files: [{ id: 'cf_1', name: 'Акт сверки Тест Контрагент.pdf', content_type: 'application/pdf', size: 48211 }],
    created_at: T(TODAY, '09:12'), decision: null,
    history: [{ at: T(TODAY, '09:12'), event: 'created', by: null, comment: null }],
    ...over,
  };
}
const crItems = () => [
  crCard(),
  crCard({ id: 'cr_2', kind: 'unknown', intent: 'balance', title: 'Сальдо на 11.11.2026', counterparty: { name: 'ТОО «Тест Незнакомый»', bin: '210987654321' }, contact: null, phone_masked: '+7 705 ***-**-12', known_phone: false, question: 'Это бухгалтерия, сколько мы должны?', text: 'Задолженность на 11.11.2026 — 640 000 ₸.', files: [], created_at: T(TODAY, '09:40'), history: [{ at: T(TODAY, '09:40'), event: 'created', by: null, comment: null }] }),
  crCard({ id: 'cr_3', kind: 'task', intent: null, title: 'Новые реквизиты', counterparty: null, contact: null, phone_masked: '+7 702 ***-**-88', known_phone: false, question: 'У нас новый счёт, письмо во вложении', text: null, files: [], created_at: T(TODAY, '10:02'), history: [{ at: T(TODAY, '10:02'), event: 'created', by: null, comment: null }] }),
  crCard({ id: 'cr_4', status: 'sent', intent: 'requisites', title: 'Реквизиты компании', created_at: T(day(-1), '15:20'), decided_at: T(day(-1), '15:34'), files: [],
    decision: { action: 'sent', by: { name: 'Тест Коллега', initials: 'ТК' }, at: T(day(-1), '15:34'), comment: null },
    history: [{ at: T(day(-1), '15:20'), event: 'created', by: null, comment: null }, { at: T(day(-1), '15:34'), event: 'sent', by: { name: 'Тест Коллега', initials: 'ТК' }, comment: null }, { at: T(day(-1), '15:34'), event: 'delivered', by: null, comment: null }, { at: T(day(-1), '15:41'), event: 'read', by: null, comment: null }] }),
];

const listItem = (c) => ({ id: c.id, number: c.number, status: c.status, my_action: c.my_action, counterparty: c.counterparty, amount: c.amount, currency: c.currency, amount_kzt: c.amount_kzt, article: c.article, purpose: c.purpose, pay_by: c.pay_by, created_at: c.created_at, initiator: { name: 'Тест Инициатор', initials: 'ТИ' }, over_limit: Math.max(0, ...(c.budgets || []).map((x) => x.over_by || 0)), my_decision_at: c.my_decision_at });

function summary() {
  const d = calDays();
  return {
    org_id: 'org_test', org_name: 'ТОО «Тест»', org_short_name: 'Тест', date: TODAY, updated_at: T(TODAY, '10:15'),
    unread_count: 2, threshold: 4950000,
    money: { bank: 4800000, cash: 200000, total: 5000000 }, today: { inflow: 0, outflow: 310000 },
    forecast: d.slice(0, 14).map((x) => ({ date: x.date, closing: x.closing })),
    gap: null, min_day: { date: day(27), closing: d[27].closing },
    week: { inflow: 1500000, outflow: 2170000, days: d.slice(0, 7).map((x) => ({ date: x.date, inflow: x.inflow, outflow: x.outflow, closing: x.closing, gap: false })) },
    pending: { count: 1, amount: 1500000, over_limit_count: 0 },
    receivables: { total: 3000000, aging: { days_0_30: 2000000, days_31_60: 500000, days_over_60: 500000 } },
  };
}

// ---------- поддельный сервер ----------
async function mockApi(page, ctl) {
  ctl.calls = [];
  // code — код, который «прислал бот»;
  // known: true — знакомое устройство (device: known): бот присылает код сам сразу после start (sent); false —
  // новое (device: new): код появится, когда тест выставит sent (человек открыл бота). noDevice: true — сервер
  // без поля device в ответе start. queue / confirmQueue — исходы очередных опросов и вводов кода;
  // delay — задержка ответов на GET, мс (медленная 1С).
  ctl.state = { cookie: false, access: 'at_1', decided: false, orgs: [ORG], partial: false, queue: [], confirmQueue: [], starts: 0, known: true, code: '483921', sent: false, tries: 5, delay: 0, settings: { requests: true, summary: true, payments: true, gaps: true, whatsapp: false }, ...ctl.state };
  await page.route(/^https:\/\/api(-test)?\.smartsol\.pro\/api\/v1\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (!API_HOSTS.includes(url.host)) return route.abort('failed');
    const p = url.pathname.replace('/api/v1', '');
    let body = null;
    try {
      body = req.postDataJSON();
    } catch (e) {
      body = null;
    }
    const call = { method: req.method(), host: url.host, path: p, query: Object.fromEntries(url.searchParams), body, headers: req.headers() };
    if (req.method() !== 'OPTIONS') ctl.calls.push(call);
    // CORS по контракту: точный origin, credentials, заголовки, которые приложение может читать
    const cors = {
      'Access-Control-Allow-Origin': req.headers().origin || '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Idempotency-Key, X-App-Version, X-App-Platform, Content-Type',
      'Access-Control-Expose-Headers': 'Idempotent-Replayed, Retry-After, Content-Disposition',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (status, data, headers = {}) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', headers: { ...cors, ...headers }, body: data === null ? '' : JSON.stringify(data) });
    const err = (status, error, message = '', details = undefined, headers = {}) => json(status, { error, message, ...(details ? { details } : {}) }, headers);
    const st = ctl.state;
    if (ctl.override && ctl.override(call, { json, err, route, st })) return undefined;

    if (p === '/version') return json(200, { api_version: '1.0', min_app_version: '1.0.0', server_time: T(TODAY, '10:00'), webpush_public_key: 'BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5cW8OCzVI3YvMClY4f3hHsqeY3m6Iyjn6CbsXzc' });
    const user = st.user || USER;
    const tokens = () => {
      st.cookie = true; // сервер выставил fp_refresh (HttpOnly) — в мок-сервере держим его состояние сами
      return json(200, { access_token: st.access, access_expires_in: 900, refresh_expires_in: 2592000, token_type: 'Bearer', user }, { 'Set-Cookie': 'fp_refresh=rt_x; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=2592000' });
    };
    const blocked = () => err(409, 'challenge_rejected', 'Слишком много попыток входа. Попробуйте через 15 мин.', { reason: 'blocked', retry_after: 900 });
    const revoked = () => err(403, 'access_revoked', 'Доступ к приложению выключен. Обратитесь к администратору ФинПульса в вашей компании.', { reason: 'revoked' });
    const expired = () => err(410, 'challenge_expired', 'Время входа вышло. Начните вход заново.');
    const sourceDown = () => err(503, 'source_unavailable', 'Нет связи с учётом компании', undefined, { 'Retry-After': '60' });
    if (p === '/auth/telegram/start') {
      if (st.startLimited) return err(429, 'too_many_requests', 'Слишком много входов с этого адреса', { retry_after: 600 }, { 'Retry-After': '600' });
      // новая схема: в теле — номер; пробелы, скобки и дефисы сервер убирает, «8 701…» понимает как +7. Не номер — 422.
      // Ответ 200 одинаков для любого номера.
      let d = String((body && body.phone) || '').replace(/\D/g, '');
      if (d.length === 11 && d[0] === '8') d = `7${d.slice(1)}`;
      if (d.length !== 11) return err(422, 'validation_error', 'Проверьте поля запроса.', { fields: { phone: 'Не номер' } });
      st.starts++;
      st.challenge = `ch_${st.starts}`;
      st.sent = !!st.known; // знакомое устройство: бот прислал код сам
      st.tries = 5;
      return json(200, { challenge_id: st.challenge, bot_url: `${BOT}?start=n_${st.starts}`, code_length: 6, expires_in: 300, poll_interval: 1, ...(st.noDevice ? {} : { device: st.known ? 'known' : 'new' }) });
    }
    if (p === '/auth/telegram/poll') {
      if (!body || body.challenge_id !== st.challenge) return err(404, 'not_found', 'Вход не найден');
      // исход очередного опроса задаёт тест (st.queue); очередь пуста — состояние не меняется
      const o = st.queue.length ? st.queue.shift() : 'same';
      if (o === 'abort') return route.abort('failed');
      if (o === 'rate') return err(429, 'too_many_requests', 'Слишком часто', { retry_after: 1 }, { 'Retry-After': '1' });
      if (o === 'blocked') return blocked();
      if (o === 'expired') return expired();
      if (o === 'source') return sourceDown();
      // опрос токенов не выдаёт и о том, отправлен ли код, не сообщает — всегда 202 pending
      return json(202, { status: 'pending' });
    }
    if (p === '/auth/telegram/confirm') {
      if (!body || body.challenge_id !== st.challenge) return err(404, 'not_found', 'Вход не найден');
      const o = st.confirmQueue.length ? st.confirmQueue.shift() : '';
      if (o === 'abort') return route.abort('failed');
      if (o === 'rate') return err(429, 'too_many_requests', 'Слишком много попыток входа. Попробуйте позже.', { retry_after: 30 }, { 'Retry-After': '30' });
      if (o === 'blocked') return blocked();
      if (o === 'expired') return expired();
      if (o === 'source') return sourceDown();
      if (o === 'revoked') return revoked();
      const code = String(body.code == null ? '' : body.code).replace(/[\s-]/g, '');
      if (!/^\d{6}$/.test(code)) return err(422, 'validation_error', 'Проверьте поля запроса.', { fields: { code: 'Код — 6 цифр' } });
      if (!st.sent) return err(409, 'code_not_sent', 'Код ещё не отправлен. Откройте Telegram — бот пришлёт код.');
      if (code !== st.code) {
        st.tries--;
        if (st.tries > 0) return err(422, 'code_invalid', `Неверный код. Осталось попыток: ${st.tries}.`, { attempts_left: st.tries });
        st.challenge = null;
        return err(409, 'challenge_rejected', 'Код введён неверно несколько раз. Начните вход заново.', { reason: 'wrong_code' });
      }
      st.challenge = null; // код одноразовый
      return tokens();
    }
    if (p === '/auth/refresh') {
      if (st.revokeOnRefresh) return err(403, 'access_revoked', 'Администратор выключил вам доступ к приложению');
      if (!st.cookie || body || req.headers().authorization) return err(401, 'refresh_invalid', 'Сессия закончилась');
      st.refreshCount = (st.refreshCount || 0) + 1;
      st.access = `at_${st.refreshCount + 1}`;
      return json(200, { access_token: st.access, access_expires_in: 900, refresh_expires_in: 2592000, token_type: 'Bearer' });
    }
    if (p === '/auth/logout' || p === '/auth/logout-all') {
      if (p === '/auth/logout-all' && !st.cookie) return err(401, 'refresh_invalid', 'Сессия закончилась');
      st.cookie = false;
      return route.fulfill({ status: 204, headers: { ...cors, 'Set-Cookie': 'fp_refresh=; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=0' } });
    }
    // всё дальше — с авторизацией
    const auth = req.headers().authorization || '';
    if (st.expireAccess && auth === `Bearer ${st.expireAccess}`) return err(401, 'token_expired', 'Токен истёк');
    if (auth !== `Bearer ${st.access}`) return err(401, 'unauthorized', 'Нет авторизации');
    if (st.delay && req.method() === 'GET') await new Promise((r) => setTimeout(r, st.delay)); // медленная 1С
    if (p === '/me') return json(200, { user });
    if (p === '/me/settings' && req.method() === 'GET') return json(200, settingsBody(st));
    if (p === '/me/settings' && req.method() === 'PUT') {
      const n = (body && body.notifications) || {};
      for (const [k, v] of Object.entries(n)) {
        if (k === 'whatsapp') return err(422, 'validation_error', 'Переключатель настраивает администратор');
        st.settings[k] = !!v.enabled;
      }
      return json(200, settingsBody(st));
    }
    if (p === '/orgs') {
      if (st.orgsDown) return err(503, 'source_unavailable', 'Нет связи с учётом компании', undefined, { 'Retry-After': '30' });
      return json(200, { items: st.orgs, partial: !!st.partial });
    }
    if (p === '/devices' && req.method() === 'POST') return json(201, { device_id: 'dev_1' });
    if (p.startsWith('/devices/') && req.method() === 'DELETE') return route.fulfill({ status: 204, headers: cors });
    if (p === '/notifications') {
      return json(200, {
        unread_count: 1,
        items: [
          { id: 'n_1', org_id: 'org_test', type: 'request', created_at: T(TODAY, '10:00'), title: 'Новая заявка на согласование', text: 'ТОО «Тест Поставщик» · 1 500 000 ₸', link: { kind: 'request', request_id: 'req_1' }, read: false },
          { id: 'n_2', org_id: 'org_test', type: 'limit', created_at: T(TODAY, '09:00'), title: 'Превышен лимит', text: 'Аренда', link: { kind: 'none' }, read: true },
        ],
        next_cursor: null,
      });
    }
    if (p === '/notifications/read') return json(200, { unread_count: 0 });
    if (p === '/orgs/org_test/summary') return json(200, summary());
    if (p === '/orgs/org_test/accounts') return json(200, { updated_at: T(TODAY, '10:15'), date: TODAY, items: [{ id: 'acc_1', type: 'bank', name: 'Тест Банк', note: null, number_masked: 'KZ•• 0001', currency: 'KZT', balance: 4800000, balance_kzt: 4800000, deposit: false }, { id: 'acc_2', type: 'cash', name: 'Касса', note: null, number_masked: null, currency: 'KZT', balance: 200000, balance_kzt: 200000, deposit: false }], total_kzt: 5000000 });
    if (p === '/orgs/org_test/calendar') return json(200, { updated_at: T(TODAY, '10:15'), from: TODAY, to: day(27), opening: 5000000, threshold: 0, gap: null, days: calDays() });
    // ---- массовое согласование: st.bulk = { items, plan: { id: [исход 1-й попытки, 2-й, …] }, delay } ----
    // Исходы: ok, next (ушла на следующий этап), decided (409), stage (409 not_awaiting_you), failed (422),
    // 503, 504 (решение не применено), 504-applied (применено, ответ потерян), abort (обрыв связи).
    if (st.bulk && /^\/orgs\/org_test\/requests\/req_b\d+$/.test(p)) {
      const c = st.bulk.items.find((x) => x.id === p.split('/')[4]);
      return c ? json(200, c) : err(404, 'not_found', 'Заявка не найдена');
    }
    if (st.bulk && (p === '/orgs/org_test/requests' || /^\/orgs\/org_test\/requests\/req_b\d+\/approve$/.test(p))) {
      const B = st.bulk;
      B.gone = B.gone || new Set();
      B.tries = B.tries || {};
      B.applied = B.applied || new Set();
      B.log = B.log || [];
      if (p === '/orgs/org_test/requests') {
        return json(200, { updated_at: T(TODAY, '10:15'), items: url.searchParams.get('tab') === 'decided' ? [] : B.items.filter((c) => !B.gone.has(c.id)).map(listItem), next_cursor: null });
      }
      const id = p.split('/')[4];
      const c = B.items.find((x) => x.id === id);
      const key = call.headers['idempotency-key'];
      B.tries[id] = (B.tries[id] || 0) + 1;
      B.active = (B.active || 0) + 1;
      B.maxActive = Math.max(B.maxActive || 0, B.active);
      B.log.push({ id, key, body, attempt: B.tries[id] });
      await new Promise((r) => setTimeout(r, B.delay || 120));
      B.active -= 1;
      const how = (B.plan[id] || [])[B.tries[id] - 1] || 'ok';
      const done = (over, replay) => {
        B.applied.add(key);
        B.gone.add(id);
        return json(200, { ...c, status: 'approved', my_action: 'approved', my_decision_at: T(TODAY, '10:20'), ...over }, replay ? { 'Idempotent-Replayed': 'true' } : {});
      };
      if (B.applied.has(key)) return done({}, true); // повтор с тем же ключом: второго решения нет
      if (how === 'next') return done({ status: 'on_approval', route: c.route.map((x) => (x.stage === 1 ? { ...x, state: 'done', decision: 'approved', at: T(TODAY, '10:20') } : x.stage === 2 ? { ...x, state: 'current' } : x)) });
      if (how === 'decided') {
        B.gone.add(id);
        return err(409, 'already_decided', 'Заявку уже согласовал Самат Ахметов 11.11.2026 в 10:12', { decided_by: 'Самат Ахметов', decided_at: T(TODAY, '10:12'), decision: 'approved' });
      }
      if (how === 'stage') return err(409, 'not_awaiting_you', 'Заявка сейчас не на вашем этапе');
      if (how === 'failed') return err(422, 'action_failed', 'Заявка заблокирована другим пользователем: Бекова Г. Т.');
      if (how === 'reused') return err(422, 'idempotency_key_reused', 'Ключ уже использован для другого решения');
      if (how === '503') return err(503, 'source_unavailable', 'Нет связи с учётом компании', undefined, { 'Retry-After': '30' });
      if (how === '504') return err(504, 'source_timeout', 'Учёт не успел ответить');
      if (how === '504-applied') {
        B.applied.add(key);
        B.gone.add(id);
        return err(504, 'source_timeout', 'Учёт не успел ответить');
      }
      if (how === 'abort') return route.abort('failed');
      return done({});
    }
    // ---- запросы контрагентов (13.17–13.21): st.cr = { items: [карточки], plan: [исходы решений] } ----
    // Нет st.cr — экрана у пользователя нет (403). Исходы POST: ok, send-failed (200, status failed), decided (409),
    // wrong (422 action_failed), long (422 validation_error), 503, 504-applied (применено, ответ потерян), abort.
    if (/^\/orgs\/org_test\/counterparty-requests(\/|$)/.test(p)) {
      const C = st.cr;
      if (!C) return err(403, 'forbidden', 'Раздел недоступен');
      C.log = C.log || [];
      C.applied = C.applied || new Set();
      const [crId, sub, fileId] = p.split('/').slice(4);
      if (!crId) {
        const done = url.searchParams.get('tab') === 'done';
        const rows = C.items.filter((c) => (c.status !== 'pending') === done);
        return json(200, { updated_at: T(TODAY, '10:15'), items: rows.map((c) => ({ id: c.id, kind: c.kind, status: c.status, intent: c.intent, title: c.title, counterparty: c.counterparty ? c.counterparty.name : null, phone_masked: c.phone_masked, created_at: c.created_at, decided_at: c.decided_at || null })), next_cursor: null });
      }
      const c = C.items.find((x) => x.id === crId);
      if (!c) return err(404, 'not_found', 'Запрос не найден');
      if (!sub) return json(200, c);
      if (sub === 'files') {
        if (!c.files.some((f) => f.id === fileId)) return err(404, 'not_found', 'Файл не найден');
        return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/pdf', 'Content-Disposition': "inline; filename*=UTF-8''akt.pdf" }, body: Buffer.from('%PDF-1.4\n% имитатор\n') });
      }
      const key = call.headers['idempotency-key'];
      const how = (C.plan || []).shift() || 'ok';
      C.log.push({ id: crId, action: sub, key, body, how });
      const apply = (status) => {
        const at = T(TODAY, '10:20');
        const by = { name: 'Тест Руководитель', initials: 'ТР' };
        c.status = status;
        c.decided_at = at;
        if (sub === 'send' && body && body.text) c.text = body.text;
        c.decision = { action: status === 'failed' ? 'sent' : status, by, at, comment: (body && body.comment) || null };
        c.history = [...c.history, { at, event: status === 'failed' ? 'send_failed' : status, by, comment: (body && body.comment) || null }];
        C.applied.add(key);
      };
      if (C.applied.has(key)) return json(200, { ...c, replayed: true }, { 'Idempotent-Replayed': 'true' });
      if (how === 'decided') return err(409, 'already_decided', 'Запрос уже решил Тест Коллега', { decided_by: 'Тест Коллега', decided_at: T(TODAY, '10:05'), decision: 'sent' });
      if (how === 'wrong') return err(422, 'action_failed', 'Контрагент помечен на удаление');
      if (how === 'long') return err(422, 'validation_error', 'Проверьте поля запроса.', { fields: { text: 'Не длиннее 4000 символов' } });
      if (how === '503') return err(503, 'source_unavailable', 'Нет связи с учётом компании', undefined, { 'Retry-After': '30' });
      if (how === 'abort') return route.abort('failed');
      if (c.status !== 'pending') return err(409, 'already_decided', 'Запрос уже решён', { decided_by: c.decision.by.name, decided_at: c.decision.at, decision: c.decision.action });
      if (sub === 'reject' && !(body && String(body.comment || '').trim())) return err(422, 'comment_required', 'Укажите причину');
      if ((sub === 'done') !== (c.kind === 'task')) return err(422, 'action_failed', 'Действие не подходит к запросу');
      apply(how === 'send-failed' ? 'failed' : { send: 'sent', reject: 'rejected', done: 'done' }[sub]);
      if (how === '504-applied') return err(504, 'source_timeout', 'Учёт не успел ответить');
      return json(200, c);
    }
    // ---- доп. согласование директором (6.8, 1С 1.16.8): st.dir = { viewer: 'approver' | 'director', plan: [исходы] } ----
    // approver — пользователь последний в маршруте и может отправить заявку директору; director — он сам директор и
    // получил заявку на доп. согласование. Исходы POST …/to-director: ok, long (422 validation_error), failed (422),
    // stage (409 not_awaiting_you), decided (409), 503, 504-applied (применено, ответ потерян), abort (обрыв связи).
    if (st.dir && (p === '/orgs/org_test/requests' || p === '/orgs/org_test/requests/req_1' || p === '/orgs/org_test/requests/req_1/to-director')) {
      const Dd = st.dir;
      Dd.applied = Dd.applied || new Set();
      Dd.log = Dd.log || [];
      const base = card();
      const created = base.route[0];
      const stage = (over) => ({ ...base.route[1], sent_to_director: false, ...over });
      const dirRow = (over) => ({ stage: 2, kind: 'director', approver: { name: 'Нурлан Абенов', initials: 'НА', position: null, is_group: false }, is_me: false, state: 'current', decision: null, sent_to_director: false, at: null, comment: null, on_behalf_of: null, due_at: null, ...over });
      let c;
      if (Dd.viewer === 'director') {
        c = card({ can_send_to_director: false, director: null, route: [created, stage({ approver: { name: 'Айгуль Сеитова', initials: 'АС', position: null, is_group: false }, is_me: false, state: 'done', decision: 'approved', sent_to_director: true, at: T(TODAY, '10:05'), comment: 'Сумма большая — на усмотрение директора' }), dirRow({ is_me: true })] });
      } else if (Dd.sent) {
        c = card({ my_action: 'approved', my_decision_at: T(TODAY, '10:20'), can_send_to_director: false, director: null, route: [created, stage({ state: 'done', decision: 'approved', sent_to_director: true, at: T(TODAY, '10:20'), comment: Dd.comment || null }), dirRow({})] });
      } else {
        c = card({ can_send_to_director: true, director: { name: 'Нурлан Абенов', initials: 'НА' }, route: [created, stage({})] });
      }
      if (p === '/orgs/org_test/requests') {
        const decidedTab = url.searchParams.get('tab') === 'decided';
        const mine = Dd.viewer === 'director' ? !decidedTab : decidedTab === !!Dd.sent;
        return json(200, { updated_at: T(TODAY, '10:15'), items: mine ? [{ ...listItem(c), director_approval: Dd.viewer === 'director' }] : [], next_cursor: null });
      }
      if (p === '/orgs/org_test/requests/req_1') return json(200, c);
      const key = call.headers['idempotency-key'];
      const how = (Dd.plan || []).shift() || 'ok';
      Dd.log.push({ key, body, how });
      const done = (replay) => {
        if (!Dd.sent) Dd.comment = (body && body.comment) || null;
        Dd.sent = true;
        Dd.applied.add(key);
        const after = card({ my_action: 'approved', my_decision_at: T(TODAY, '10:20'), can_send_to_director: false, director: null, route: [created, stage({ state: 'done', decision: 'approved', sent_to_director: true, at: T(TODAY, '10:20'), comment: Dd.comment }), dirRow({})] });
        return json(200, after, replay ? { 'Idempotent-Replayed': 'true' } : {});
      };
      if (Dd.applied.has(key)) return done(true); // повтор с тем же ключом: второй отправки нет
      if (how === 'long') return err(422, 'validation_error', 'Проверьте поля запроса.', { fields: { comment: 'Не длиннее 1000 символов' } });
      if (how === 'failed') return err(422, 'action_failed', 'Директор для дополнительного согласования не задан в настройках');
      if (how === 'stage') return err(409, 'not_awaiting_you', 'Заявка сейчас не на вашем этапе');
      if (how === 'decided') return err(409, 'already_decided', 'Заявку уже согласовал Самат Ахметов 11.11.2026 в 10:12', { decided_by: 'Самат Ахметов', decided_at: T(TODAY, '10:12'), decision: 'approved' });
      if (how === '503') return err(503, 'source_unavailable', 'Нет связи с учётом компании', undefined, { 'Retry-After': '30' });
      if (how === '504-applied') {
        Dd.comment = (body && body.comment) || null;
        Dd.sent = true;
        Dd.applied.add(key);
        return err(504, 'source_timeout', 'Учёт не успел ответить');
      }
      if (how === 'abort') return route.abort('failed');
      return done(false);
    }
    if (p === '/orgs/org_test/requests') {
      const c = card();
      if (url.searchParams.get('tab') === 'decided') return json(200, { updated_at: T(TODAY, '10:15'), items: st.decided ? [listItem(card({ my_action: 'approved', my_decision_at: T(TODAY, '10:20') }))] : [], next_cursor: null });
      return json(200, { updated_at: T(TODAY, '10:15'), items: [...(st.decided ? [] : [listItem(c)]), ...(st.multi ? [listItem(MULTI)] : [])], next_cursor: null });
    }
    if (p === '/orgs/org_test/requests/req_2' && st.multi) return json(200, MULTI);
    if (p === '/orgs/org_test/requests/req_1') return json(200, st.decided ? card({ my_action: 'approved', status: 'approved', my_decision_at: T(TODAY, '10:20') }) : card());
    if (p === '/orgs/org_test/requests/req_1/approve') {
      st.decided = true;
      return json(200, card({ status: 'approved', my_action: 'approved', my_decision_at: T(TODAY, '10:20') }));
    }
    if (p === '/orgs/org_test/requests/req_1/reject') {
      if (!body || !String(body.comment || '').trim()) return err(422, 'comment_required', 'Укажите причину');
      st.decided = true;
      return json(200, card({ status: 'rejected', my_action: 'rejected', my_decision_at: T(TODAY, '10:20') }));
    }
    if (p === '/orgs/org_test/requests/req_1/return') {
      if (!body || !String(body.comment || '').trim()) return err(422, 'comment_required', 'Укажите, что исправить');
      st.decided = true;
      return json(200, card({ status: 'draft', my_action: 'returned', my_decision_at: T(TODAY, '10:20') }));
    }
    if (st.rep501 && /^\/orgs\/org_test\/reports\/(cash-flow|plan-fact|debtors)$/.test(p)) return err(501, 'not_implemented', 'Раздел появится позже');
    if (p === '/orgs/org_test/reports/plan-fact' && st.noPlan) return json(200, { updated_at: T(TODAY, '10:15'), month: '2026-10', title: 'Октябрь 2026', has_plan: false, income: [{ article: 'Оплата от покупателей', plan: null, fact: 68750000 }], expense: [{ article: 'Аренда', plan: null, fact: 1900000 }, { article: 'Связь', plan: null, fact: 50000 }] });
    if (p === '/orgs/org_test/reports/cash-flow') return json(200, { updated_at: T(TODAY, '10:15'), month: '2026-10', title: 'Октябрь 2026', inflow: 24000000, outflow: 21650000, weeks: [{ label: '1–4', from: '2026-10-01', to: '2026-10-04', inflow: 9800000, outflow: 8450000 }, { label: '5–11', from: '2026-10-05', to: '2026-10-11', inflow: 14200000, outflow: 13200000 }] });
    if (p === '/orgs/org_test/reports/plan-fact') return json(200, { updated_at: T(TODAY, '10:15'), month: '2026-10', title: 'Октябрь 2026', has_plan: true, income: [{ article: 'Оплата от покупателей', plan: 72000000, fact: 68750000 }], expense: [{ article: 'Аренда', plan: 1800000, fact: 1900000 }, { article: 'Связь', plan: null, fact: 50000 }] });
    if (p === '/orgs/org_test/reports/debtors') return json(200, { updated_at: T(TODAY, '10:15'), date: TODAY, total: 3000000, aging: { days_0_30: 2000000, days_31_60: 500000, days_over_60: 500000 }, items: [{ counterparty: 'ТОО «Должник»', amount: 1200000, aging: { days_0_30: 200000, days_31_60: 500000, days_over_60: 500000 }, oldest_days: 74 }] });
    // ---- отчёт «Проекты» (общий проход): отборы, сортировка, итоги и порции — как на сервере ----
    if (p === '/orgs/org_test/reports/projects' || p.startsWith('/orgs/org_test/reports/projects/')) {
      if (st.prj403) return err(403, 'report_unavailable', 'Отчёт недоступен');
      if (p !== '/orgs/org_test/reports/projects') {
        if (st.prjCard503) return err(503, 'source_unavailable', 'Нет связи с учётом компании', undefined, { 'Retry-After': '30' });
        const c = PRJ.cards[decodeURIComponent(p.split('/').pop())];
        return c ? json(200, c) : err(404, 'not_found', 'Проект не найден');
      }
      const q = url.searchParams;
      if (st.prj422 && q.get('from')) return err(422, 'validation_error', 'Проверьте параметры запроса.', { fields: { from: 'Период — не длиннее 3 лет' } });
      let items = st.prjMany
        ? Array.from({ length: st.prjMany }, (_, i) => ({ ...PRJ.list.items[i % 4], id: `project_many_${i}`, project_id: `PS-2026-${1000 + i}`, status: 'in_work' }))
        : PRJ.list.items;
      if (st.prjEmpty) items = [];
      // категории (1С с 1.16.7): st.prjCats = [{ id, name }]; не задано — база старше: поля categories нет, параметр
      // category незнаком (422 без details.fields, как отвечает посредник). st.prjCatsLax — неизвестный id не 422, а молча.
      const catOf = (x) => ({ Проектная: 'cat_p', Регулярная: 'cat_r' }[x.category] || null); // у проекта category — наименование категории
      const cat = q.get('category');
      if (cat && !st.prjCats) return err(422, 'validation_error', 'Неизвестный параметр: category');
      if (cat && !st.prjCats.some((c) => c.id === cat) && !st.prjCatsLax) return err(422, 'validation_error', 'Проверьте параметры запроса.', { fields: { category: 'Неизвестная категория' } });
      const filtered = !!(q.get('status') || q.get('debt_only') || q.get('without_id') || cat || st.prjMany || st.prjEmpty);
      items = items.filter((x) => (!q.get('status') || x.status === q.get('status')) && (q.get('debt_only') !== 'true' || x.debt > 0) && (q.get('without_id') !== 'true' || x.without_id));
      const categories = st.prjCats ? st.prjCats.map((c) => ({ ...c, count: items.filter((x) => catOf(x) === c.id).length })) : undefined;
      if (cat) items = items.filter((x) => catOf(x) === cat);
      const by = { debt: (x) => x.debt, margin: (x) => x.margin, revenue: (x) => x.revenue }[q.get('sort')];
      items = [...items].sort((a, b) => Number(a.without_id) - Number(b.without_id) || (by ? by(b) - by(a) : (a.order_date < b.order_date ? 1 : a.order_date > b.order_date ? -1 : 0)));
      const sumOf = (f) => items.reduce((t, x) => t + f(x), 0);
      const revenue = sumOf((x) => x.revenue);
      const costs = sumOf((x) => x.costs);
      const totals = filtered
        ? { count: items.length, without_id: items.filter((x) => x.without_id).length, revenue, costs, margin: revenue - costs, margin_pct: revenue ? Math.round(((revenue - costs) / revenue) * 1000) / 10 : 0, paid: sumOf((x) => x.paid), debt: sumOf((x) => x.debt) }
        : PRJ.list.totals;
      const limit = Number(q.get('limit')) || 50;
      const start = Number(q.get('cursor')) || 0;
      return json(200, { ...PRJ.list, from: q.get('from') || PRJ.list.from, to: q.get('to') || PRJ.list.to, totals, ...(categories ? { categories } : {}), items: items.slice(start, start + limit), next_cursor: start + limit < items.length ? String(start + limit) : null });
    }
    return err(404, 'not_found', 'Не найдено');
  });
}

function settingsBody(st) {
  const s = st.settings;
  return { notifications: { requests: { enabled: s.requests, editable: true }, summary: { enabled: s.summary, editable: true, time: '08:30' }, payments: { enabled: s.payments, editable: true, min_amount: 500000 }, gaps: { enabled: s.gaps, editable: true, days_ahead: 3 }, whatsapp: { enabled: s.whatsapp, editable: false } } };
}

// Вход: номер → «Получить код» → экран кода (знакомое устройство: бот прислал код сам) → ввод кода → 200.
async function login(page, ctl, { expect = '#/home' } = {}) {
  await page.locator('.screen:not(.leaving) #login-phone').fill('7015551234');
  await page.locator('.screen:not(.leaving) [data-act="tg-start"]').click();
  await page.locator('.screen:not(.leaving) [data-tg-input]').waitFor({ timeout: 12000 });
  await page.locator('.screen:not(.leaving) [data-tg-input]').fill(ctl.state.code); // последняя цифра — код уходит сам
  await page.waitForFunction((h) => location.hash === h, expect, { timeout: 12000 });
  await settle(page, 700);
}

// Push на компьютере с ключом VAPID (1.3.2): у подписки есть options.applicationServerKey. preset.key — подписка, которая
// уже есть в профиле браузера (ключ base64url), preset.perm — разрешение. Подписка, разрешение и счётчики subscribe /
// unsubscribe живут в localStorage — общие для всех вкладок контекста, как у одного профиля Chrome.
const PUSH_STUB_KEYS = (preset) => {
  const LS = '__push_stub';
  const load = () => JSON.parse(localStorage.getItem(LS) || 'null');
  if (!load()) localStorage.setItem(LS, JSON.stringify({ perm: preset.perm || 'default', sub: preset.key ? { endpoint: 'https://push.example.org/send/prod-1', key: preset.key } : null, subs: 0, unsubs: 0 }));
  const st = () => load();
  const put = (f) => { const s = load(); f(s); localStorage.setItem(LS, JSON.stringify(s)); };
  Object.defineProperty(window, '__subs', { configurable: true, get: () => st().subs });
  Object.defineProperty(window, '__unsubs', { configurable: true, get: () => st().unsubs });
  Object.defineProperty(window, '__subKeyB64', { configurable: true, get: () => (st().sub ? st().sub.key : null) });
  Object.defineProperty(Notification, 'permission', { configurable: true, get: () => st().perm });
  Notification.requestPermission = async () => { put((s) => { s.perm = 'granted'; }); return 'granted'; };
  const toBuf = (b64u) => {
    const pad = '='.repeat((4 - (b64u.length % 4)) % 4);
    const raw = atob((b64u + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))).buffer;
  };
  const toB64 = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const make = (s) => (s ? {
    endpoint: s.endpoint, options: { applicationServerKey: toBuf(s.key) },
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BExampleP256dhKey', auth: 'ExampleAuth' } }; },
    unsubscribe: async () => { put((x) => { x.unsubs += 1; x.sub = null; }); return true; },
  } : null);
  const reg = { pushManager: { getSubscription: async () => make(st().sub), subscribe: async (o) => { put((x) => { x.subs += 1; x.sub = { endpoint: `https://push.example.org/send/new-${x.subs}`, key: toB64(o.applicationServerKey) }; }); return make(st().sub); } } };
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(reg), getRegistration: async () => reg, register: async () => reg, addEventListener() {} } });
};
const KEY_PROD = 'BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5cW8OCzVI3YvMClY4f3hHsqeY3m6Iyjn6CbsXzc';
const KEY_TEST = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';

// Push в headless-браузере: служба уведомлений недоступна — подменяем подписку и разрешение, проверяем логику приложения.
const PUSH_STUB = () => {
  window.__perm = 'default';
  Object.defineProperty(Notification, 'permission', { configurable: true, get: () => window.__perm });
  Notification.requestPermission = async () => (window.__perm = 'granted');
  const sub = { endpoint: 'https://push.example.org/send/abc123', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BExampleP256dhKey', auth: 'ExampleAuth' } }; }, unsubscribe: async () => true };
  let current = null;
  const reg = { pushManager: { getSubscription: async () => current, subscribe: async (o) => { window.__subOpts = o; current = sub; return sub; } } };
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(reg), getRegistration: async () => reg, register: async () => reg, addEventListener() {} } });
};

(async () => {
  const srv = await serve();
  const BASE = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch();
  const newCtx = async (opts = devices['iPhone 13'], state = {}) => {
    const ctx = await browser.newContext({ ...opts, locale: 'ru-RU', timezoneId: 'Asia/Almaty', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date('2026-11-11T10:30:00+05:00'));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|status of [45]\d\d|net::ERR_FAILED/.test(m.text())) errors.push(m.text());
    });
    await ctx.addInitScript(() => {
      window.__cred = [];
      const f = window.fetch;
      window.fetch = (u, o = {}) => { window.__cred.push({ url: String(u), credentials: o.credentials || 'same-origin' }); return f(u, o); };
    });
    const ctl = { state, popups: [] };
    // окно Telegram: bot_url не открываем по-настоящему, только запоминаем адрес
    await ctx.route(/^https:\/\/t\.me\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>Telegram</title>' }));
    ctx.on('page', (p) => p !== page && ctl.popups.push(p));
    await mockApi(page, ctl);
    return { ctx, page, errors, ctl };
  };
  const noErrors = (errors) => ok(errors.length === 0, `нет ошибок в консоли${errors.length ? `: ${errors.join(' | ')}` : ''}`);

  try {
    // ---------- 1. вход ----------
    console.log('\n▶ Вход: номер в приложении, код из Telegram (контракт, 2)');
    {
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { orgs: [ORG, ORG2], partial: true, known: false });
      const st = ctl.state;
      await page.goto(BASE);
      await settle(page, 900);
      ok((await page.evaluate(() => location.hash)) === '#/login', 'по умолчанию — настоящий вход');
      ok(API === 'https://api.smartsol.pro/api/v1', 'сборка ходит на рабочий сервер api.smartsol.pro');
      ok(ctl.calls.every((c) => c.host === 'api.smartsol.pro') && (await page.locator('.env-bar').count()) === 0, 'без параметра адреса — только рабочий сервер, плашки «ТЕСТ» нет');
      const ver = ctl.calls.find((c) => c.path === '/version');
      ok(ver && ver.headers['x-app-version'] === APP_VERSION && ver.headers['x-app-platform'] === 'web', `при запуске GET /version с X-App-Version ${APP_VERSION} и X-App-Platform`);
      const phone = () => page.locator('.screen:not(.leaving) #login-phone');
      const startBtn = () => page.locator('.screen:not(.leaving) [data-act="tg-start"]');
      const loginErr = () => page.locator('.screen:not(.leaving) #login-err').innerText().then(norm);
      const starts = () => ctl.calls.filter((c) => c.path === '/auth/telegram/start');
      ok(norm(await startBtn().innerText()).includes('Получить код') && (await page.locator('[data-tg-input]').count()) === 0, 'экран входа: кнопка «Получить код», поля кода нет');
      ok((await phone().getAttribute('type')) === 'tel' && (await phone().getAttribute('inputmode')) === 'tel' && (await phone().getAttribute('autocomplete')) === 'tel', 'поле номера: type="tel", inputmode="tel", autocomplete="tel"');
      ok((await phone().inputValue()) === '' && (await phone().getAttribute('placeholder')) === '+7 700 000 00 00', 'поле номера пустое, подсказка формата +7 700 000 00 00');
      await shot(page, '01-vhod');
      const tgErr = () => page.locator('.screen:not(.leaving) #tg-err').innerText().then(norm);
      const codeErr = () => page.locator('.screen:not(.leaving) #tg-code-err').innerText().then(norm);
      const waitErr = () => page.waitForSelector('.screen:not(.leaving) #tg-err:not([hidden])', { timeout: 8000 });
      const waitCodeErr = (kind) => page.waitForSelector(`.screen:not(.leaving) #tg-code-err[data-kind="${kind}"]:not([hidden])`, { timeout: 8000 });
      const input = () => page.locator('.screen:not(.leaving) [data-tg-input]');
      const confirms = () => ctl.calls.filter((c) => c.path === '/auth/telegram/confirm');
      const polls = () => ctl.calls.filter((c) => c.path === '/auth/telegram/poll');
      // Начать вход с экрана входа: номер → «Получить код» → экран после start (на новом устройстве поля кода ещё нет)
      const begin = async (number = '7015551234') => {
        await phone().fill(number);
        await startBtn().click();
        await page.locator('.screen:not(.leaving) [data-tg-open]').waitFor({ timeout: 8000 });
      };
      // «Начать заново» на экране кода: тот же номер, новый экран кода
      const restart = async () => {
        const n = st.starts;
        await page.locator('[data-restart]').click();
        await page.waitForFunction(() => !!document.querySelector('.screen:not(.leaving) [data-tg-input]:not([disabled])'), null, { timeout: 8000 });
        ok(st.starts === n + 1 && starts().slice(-1)[0].body.phone === '+77015551234', '«Начать заново» — новый start с тем же номером');
      };

      // проверка номера до отправки
      await startBtn().click();
      await settle(page, 400);
      ok((await loginErr()).includes('Введите номер телефона') && starts().length === 0, 'пустой номер — «Введите номер телефона», запрос не уходит');
      await phone().fill('701555');
      ok((await phone().inputValue()) === '+7 701 555', 'маска номера: «701555» → «+7 701 555»');
      await startBtn().click();
      await settle(page, 400);
      ok((await loginErr()).includes('Введите номер полностью: +7 и десять цифр') && starts().length === 0, 'неполный номер — «Введите номер полностью», запрос не уходит');
      for (const [typed, what] of [['87015551234', '«8 701…»'], ['+7 (701) 555-12-34', '«+7 (701) 555-12-34»'], ['77015551234', '«7701…»'], ['7015551234', '«701…»']]) {
        await phone().fill(typed);
        ok((await phone().inputValue()) === '+7 701 555 12 34', `номер ${what} приводится к «+7 701 555 12 34»`);
      }
      ok(await page.locator('.screen:not(.leaving) #login-err').isHidden(), 'ошибка номера убрана при вводе');

      // 422 на start: сервер не признал номер
      ctl.override = (call, { err }) => (call.path === '/auth/telegram/start' ? (err(422, 'validation_error', 'Проверьте поля запроса.', { fields: { phone: 'Не номер' } }), true) : false);
      await startBtn().click();
      await settle(page, 700);
      ok((await loginErr()).includes('Проверьте номер') && (await phone().evaluate((e) => e.classList.contains('invalid'))), 'start: 422 validation_error — поле номера подсвечено');
      ctl.override = null;

      // 429 на start: текст и таймер на кнопке, повторные нажатия запросов не шлют
      st.startLimited = true;
      await startBtn().click();
      await settle(page, 700);
      ok((await loginErr()).includes('Слишком много попыток входа с этого адреса. Повторите через 10 минут'), 'start: 429 too_many_requests — понятный текст с временем');
      ok(/Вход снова через (10:00|9:\d\d)/.test(norm(await startBtn().innerText())) && (await startBtn().isDisabled()), 'start: 429 — таймер по Retry-After на кнопке, кнопка неактивна');
      const limited = starts().length;
      await startBtn().click({ force: true });
      await settle(page, 400);
      ok(starts().length === limited, 'пока идёт пауза, start повторно не уходит');
      st.startLimited = false;
      await page.evaluate(() => localStorage.removeItem('finpuls-tg-blocked')); // часы в тесте стоят — снимаем паузу вручную
      await page.reload();
      await settle(page, 900);

      // start → device: new → экран «Подтвердите вход в Telegram» (от номера не зависит)
      await begin();
      await settle(page, 900);
      const start = starts().slice(-1)[0];
      ok(start.method === 'POST' && JSON.stringify(start.body) === JSON.stringify({ phone: '+77015551234' }) && !start.headers.authorization, 'POST /auth/telegram/start {phone: "+77015551234"}, без Authorization');
      ok((await page.evaluate(() => window.__cred)).filter((c) => c.url.includes('/auth/telegram/start')).every((c) => c.credentials === 'include'), 'start — с credentials: include (метка знакомого устройства в cookie)');
      ok(ctl.popups.length === 0, 'bot_url сразу не открывается');
      ok((await page.locator('[data-tg-device]').getAttribute('data-tg-device')) === 'new' && norm(await page.locator('.login-title').innerText()) === 'Подтвердите вход в Telegram', 'device: new → экран «Подтвердите вход в Telegram»');
      ok((await input().isHidden()) && (await page.locator('[data-tg-paste]').isHidden()) && (await page.locator('[data-tg-submit]').isHidden()), 'до нажатия кнопки поля кода, «Вставить код» и «Войти» на экране нет');
      ok(norm(await page.locator('[data-tg-phone]').innerText()) === '+7 701 555 12 34' && norm(await page.locator('[data-tg-change]').innerText()) === 'Изменить номер', 'на экране — введённый номер и «Изменить номер»');
      ok((await page.locator('[data-tg-code]').count()) === 0, 'числа для выбора на экране нет');
      ok((await page.locator('.tg-cells i').count()) === 6, 'поле кода — по code_length (6 цифр)');
      ok((await input().getAttribute('inputmode')) === 'numeric' && (await input().getAttribute('autocomplete')) === 'one-time-code', 'поле: inputmode="numeric", autocomplete="one-time-code"');
      ok(await page.locator('[data-tg-submit]').isDisabled(), '«Войти» неактивна, пока код не введён целиком');
      ok(norm(await page.locator('[data-tg-note]').innerText()) === NEW_NOTE, 'новое устройство: текст заказчика — вход нужно один раз подтвердить в Telegram');
      const openBtn = page.locator('.screen:not(.leaving) [data-tg-open]');
      ok(norm(await openBtn.innerText()).includes('Войти через Telegram') && (await openBtn.getAttribute('href')) === `${BOT}?start=n_${st.starts}` && (await openBtn.getAttribute('target')) === '_blank', 'кнопка «Войти через Telegram» — ссылка bot_url этого входа');
      ok(await openBtn.evaluate((e) => e.classList.contains('btn-primary')), 'новое устройство: «Войти через Telegram» — главная кнопка');
      ok(await page.evaluate(() => {
        const help = document.querySelector('.screen:not(.leaving) [data-tg-help]');
        const field = document.querySelector('.screen:not(.leaving) [data-tg-field]');
        return !!(help.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING);
      }), 'новое устройство: поле кода — ниже кнопки бота');
      ok(!/не подключ/i.test(norm(await page.locator('.screen:not(.leaving)').innerText())), 'сообщения «номер не подключён» на экране нет');
      await shot(page, '02a-podtverdite-vhod');
      await settle(page, 1300);
      ok(polls().length >= 1 && polls().every((c) => c.body.challenge_id === st.challenge && !c.headers.authorization), 'POST /auth/telegram/poll с challenge_id, без Authorization');
      ok((await page.locator('#tg-err').isHidden()) && (await page.evaluate(() => location.hash)) === '#/telegram' && confirms().length === 0, '202 pending — вход жив, экран не меняется');
      // «Войти через Telegram» открывает бота и новый вход не начинает
      const startsBefore = st.starts;
      await openBtn.click();
      await settle(page, 800);
      ok(ctl.popups.some((p) => p.url().startsWith(`${BOT}?start=n_${st.starts}`)) && st.starts === startsBefore && (await page.evaluate(() => location.hash)) === '#/telegram', '«Войти через Telegram» открывает bot_url, новый start не уходит');
      ok(norm(await page.locator('.login-title').innerText()) === 'Введите код из Telegram' && norm(await page.locator('[data-tg-note]').innerText()) === NEW_DONE, 'после нажатия экран — про ввод кода: «нажмите на код… вернитесь сюда и вставьте»');
      ok(norm(await openBtn.innerText()).includes('Открыть Telegram ещё раз') && !(await openBtn.evaluate((e) => e.classList.contains('btn-primary'))), 'кнопка бота стала запасной: «Открыть Telegram ещё раз»');
      ok((await input().isVisible()) && (await page.locator('[data-tg-paste]').isVisible()) && (await page.locator('[data-tg-submit]').isVisible()), 'после нажатия появились поле кода, «Вставить код» и «Войти»');
      ok(norm(await page.locator('[data-tg-status]').innerText()) === 'Код действует 5 минут' && (await page.locator('[data-tg-left]').count()) === 0, '«Код действует 5 минут» — подсказка без таймера');
      await shot(page, '02b-posle-knopki-vvedite-kod');

      // неполный код не отправляется
      await input().fill('12345');
      await settle(page, 500);
      ok(confirms().length === 0 && (await page.locator('[data-tg-submit]').isDisabled()), 'неполный код не отправляется');
      // код введён раньше, чем бот его прислал → 409 code_not_sent, поле остаётся
      await input().fill('123456');
      await waitCodeErr('not_sent');
      ok((await codeErr()).includes('Бот ещё не прислал код. Откройте Telegram — бот пришлёт код'), '409 code_not_sent — «Откройте Telegram — бот пришлёт код»');
      ok((await input().inputValue()) === '123456' && (await page.evaluate(() => location.hash)) === '#/telegram', 'поле кода остаётся, вход не отменён');
      const c1 = confirms()[0];
      ok(c1 && c1.method === 'POST' && c1.body.challenge_id === st.challenge && c1.body.code === '123456' && !c1.headers.authorization, 'POST /auth/telegram/confirm {challenge_id, code}, без Authorization; код отправлен сам при шестой цифре');
      ok((await page.evaluate(() => window.__cred)).filter((c) => c.url.includes('/auth/telegram/confirm')).every((c) => c.credentials === 'include'), 'ввод кода — с credentials: include (ответ ставит cookie)');
      // тот же код сам собой второй раз не уходит (лишняя цифра сверх длины) — лимиты ввода не выбираются
      await input().press('End');
      await input().press('7');
      await input().press('8');
      await settle(page, 700);
      ok(confirms().length === 1 && (await input().inputValue()) === '123456', 'лишние цифры сверх длины тот же код заново не отправляют');

      // бот прислал код (приложению об этом не сообщается); «Войти» отправляет код из поля
      st.sent = true;
      await page.locator('[data-tg-submit]').click();
      await waitCodeErr('code_invalid');
      ok((await codeErr()).includes('Неверный код. Осталось попыток: 4'), '422 code_invalid — «Неверный код. Осталось попыток: 4»');
      ok((await input().inputValue()) === '' && (await page.evaluate(() => location.hash)) === '#/telegram', 'поле очищено, можно вводить снова');
      await shot(page, '03-nevernyy-kod');
      // вставка из буфера: берутся только цифры, всё сообщение бота целиком тоже подходит
      await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.setData('text', 'Код для входа в ФинПульс: 222 222\nДействует 5 минут.');
        document.querySelector('[data-tg-input]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      });
      await page.waitForFunction(() => /попыток: 3/.test(document.querySelector('#tg-code-err')?.textContent || ''), null, { timeout: 8000 });
      ok(confirms().slice(-1)[0].body.code === '222222', 'вставка из буфера: из текста взяты цифры кода, отправлено сразу');
      // 429 на вводе кода — пауза с таймером
      st.confirmQueue = ['rate'];
      await input().fill('333333');
      await waitCodeErr('rate');
      ok(/Слишком много попыток\. Повторите через 0:[0-3]\d/.test(await codeErr()) && (await page.locator('[data-tg-submit]').isDisabled()), '429 на вводе кода — «Повторите через 0:30», «Войти» неактивна');
      // «Изменить номер» → экран входа, номер на месте
      await page.locator('[data-tg-change]').click();
      await page.waitForFunction(() => location.hash === '#/login');
      await settle(page, 700);
      ok((await phone().inputValue()) === '+7 701 555 12 34', '«Изменить номер» — назад на вход, номер в поле (из памяти вкладки)');
      st.known = true; // дальше — знакомое устройство: бот присылает код сам, сразу после start
      await begin('7015551234');
      await settle(page, 700); // прежний экран уходит с анимацией — ждём, чтобы на странице остался один
      ok((await page.locator('[data-tg-device]').getAttribute('data-tg-device')) === 'known' && norm(await page.locator('.login-title').innerText()) === 'Введите код из Telegram', 'device: known → экран «Введите код из Telegram»');
      ok(norm(await page.locator('[data-tg-note]').innerText()) === NOTE, 'знакомое устройство: нейтральный текст — дословно');
      const spare = page.locator('.screen:not(.leaving) [data-tg-open]');
      ok(norm(await spare.innerText()).includes('Войти через Telegram') && !(await spare.evaluate((e) => e.classList.contains('btn-primary'))) && (await page.evaluate(() => {
        const help = document.querySelector('.screen:not(.leaving) [data-tg-help]');
        const field = document.querySelector('.screen:not(.leaving) [data-tg-field]');
        return !!(field.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING);
      })), 'знакомое устройство: «Войти через Telegram» — запасная кнопка под полем кода');
      ok(!/не подключ/i.test(norm(await page.locator('.screen:not(.leaving)').innerText()).replace(NOTE, '')), 'сообщения «номер не подключён» нет и здесь');
      await shot(page, '02c-znakomoe-ustroystvo');
      // обрыв связи на вводе кода — код остаётся в поле, «Войти» отправляет его ещё раз
      st.confirmQueue = ['abort'];
      await input().fill('444444');
      await waitCodeErr('network');
      ok((await codeErr()).includes('Нет связи с сервером') && (await input().inputValue()) === '444444', 'обрыв связи на вводе кода — код остаётся в поле');
      const before = confirms().length;
      await page.locator('[data-tg-submit]').click();
      await waitCodeErr('code_invalid');
      ok(confirms().length === before + 1 && confirms().slice(-1)[0].body.code === '444444', '«Войти» отправляет код ещё раз');
      // пятый неверный код → 409 challenge_rejected wrong_code: вход отклонён (так же выглядит и вход с неподключённым номером)
      for (const [i, c] of ['555555', '666666', '777777'].entries()) {
        await input().fill(c);
        await page.waitForFunction((n) => new RegExp(`попыток: ${n}`).test(document.querySelector('#tg-code-err')?.textContent || ''), 3 - i, { timeout: 8000 });
      }
      await input().fill('888888');
      await waitErr();
      ok((await tgErr()).includes('Код введён неверно несколько раз. Начните вход заново.'), 'пятый неверный код — 409 challenge_rejected wrong_code: «Начните вход заново»');
      ok(norm(await page.locator('[data-restart]').innerText()) === 'Начать заново' && (await page.locator('[data-restart]').isEnabled()) && (await input().isDisabled()) && (await page.locator('[data-tg-help]').isHidden()), 'вход отклонён: поле кода выключено, кнопка «Начать заново»');
      const pollsAfter = polls().length;
      await settle(page, 1500);
      ok(polls().length === pollsAfter, 'после отказа опрос остановлен');
      await shot(page, '04-vhod-otklonen');

      // заново → 409 blocked с таймером
      await restart();
      st.queue = ['blocked'];
      await waitErr();
      ok((await tgErr()).includes('Слишком много попыток входа. Попробуйте через 15 мин.'), '409 blocked — текст message');
      ok(/Начать заново через 1[45]:\d\d/.test(norm(await page.locator('[data-restart]').innerText())) && (await page.locator('[data-restart]').isDisabled()), 'blocked — таймер по retry_after, кнопка неактивна');
      await shot(page, '05-blokirovka');
      await page.locator('.topbar [data-back]').click();
      await settle(page, 700);
      ok(/Вход снова через 1[45]:\d\d/.test(norm(await startBtn().innerText())) && (await startBtn().isDisabled()), 'блокировка видна и на экране входа');
      await page.evaluate(() => localStorage.removeItem('finpuls-tg-blocked')); // часы в тесте стоят — снимаем блокировку вручную
      await page.reload();
      await settle(page, 900);
      ok((await phone().inputValue()) === '', 'после перезагрузки страницы номера в поле нет — он нигде не сохранён');

      // 403 access_revoked на вводе кода: доступ выключили уже после отправки кода
      await begin();
      st.confirmQueue = ['revoked'];
      await input().fill(st.code);
      await waitErr();
      ok((await tgErr()).includes('Доступ к приложению выключен. Обратитесь к администратору ФинПульса в вашей компании'), '403 access_revoked — текст message и «Начать заново»');
      await shot(page, '06-dostup-vyklyuchen');

      // 410 challenge_expired
      await restart();
      st.queue = ['expired'];
      await waitErr();
      ok((await tgErr()).includes('Время входа вышло. Начните вход заново — бот пришлёт новый код'), '410 challenge_expired — «Время входа вышло. Начните вход заново»');
      await shot(page, '07-srok-vyshel');

      // 503 source_unavailable — вход отменён, заново через минуту
      await restart();
      st.queue = ['source'];
      await waitErr();
      ok((await tgErr()).includes('Нет связи с учётом компании'), '503 source_unavailable — «Нет связи с учётом компании»');
      ok(/через [01]:\d\d/.test(norm(await page.locator('[data-restart]').innerText())), '«Начать заново» — через минуту (Retry-After)');
      await shot(page, '08-net-svyazi-s-uchetom');

      // обрыв связи и 429 на опросе — опрос продолжается; затем код из буфера кнопкой «Вставить код» → вход
      await page.locator('.topbar [data-back]').click();
      await settle(page, 700);
      st.queue = ['abort', 'rate'];
      await begin();
      const p0 = polls().length;
      await settle(page, 8500);
      ok(polls().length >= p0 + 3 && (await page.locator('#tg-err').isHidden()) && (await page.evaluate(() => location.hash)) === '#/telegram', 'обрыв связи и 429 при опросе — опрос продолжается, экран не меняется');
      await page.evaluate((code) => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => `${code.slice(0, 3)}-${code.slice(3)}` } });
      }, st.code);
      await page.locator('[data-tg-paste]').click();
      await page.waitForFunction(() => location.hash === '#/orgs', null, { timeout: 15000 });
      await settle(page, 900);
      ok(confirms().slice(-1)[0].body.code === st.code, '«Вставить код» — код из буфера («483-921» → цифры), отправлен сразу');
      ok(st.cookie, '200 на confirm — refresh-cookie выставлена сервером');

      // /orgs: partial
      ok(await page.locator('.org-card').count() === 2, 'организаций две → экран выбора');
      ok(norm(await page.locator('.partial-note').innerText()).includes('Часть организаций недоступна'), 'partial: true → плашка «Часть организаций недоступна»');
      await shot(page, '09-chast-organizaciy-nedostupna');
      const storageDump = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
      ok(storageDump.includes('loggedIn') && !/rt_|at_\d|refresh/i.test(storageDump.replace(/refresh_expires/g, '')), 'в хранилище браузера нет ни refresh-, ни access-токена');
      ok(!storageDump.includes(st.code) && !/ch_\d/.test(storageDump), 'в хранилище браузера нет ни кода, ни challenge_id');
      ok(!storageDump.replace(/\D/g, '').includes('7015551234'), 'введённого номера в хранилище браузера нет');
      const cred = await page.evaluate(() => window.__cred);
      ok(cred.filter((c) => c.url.includes('/orgs')).every((c) => c.credentials === 'omit'), 'запросы данных — без cookie (credentials: omit)');
      await page.locator('[data-act="pick-org"][data-id="org_test"]').click();
      await settle(page, 900);
      ok((await page.evaluate(() => location.hash)) === '#/home', 'выбрали организацию → главная');
      ok(norm(await page.locator('.hero').innerText()).includes('5 000 000'), 'главная из GET /orgs/{id}/summary');
      const homeCalls = ctl.calls.filter((c) => c.path.startsWith('/orgs/org_test') || c.path === '/notifications');
      ok(homeCalls.length === 1 && homeCalls[0].path === '/orgs/org_test/summary', 'главная — одним запросом (без /notifications)');
      ok((await page.locator('.icon-badge').innerText()) === '2', 'колокольчик — unread_count из сводки');
      ok(await page.locator('.wk-col.neg').count() > 0, 'красные дни недели — по threshold из сводки');
      ok(ctl.calls.some((c) => c.path === '/orgs/org_test/summary' && c.headers.authorization === 'Bearer at_1'), 'запросы данных с Bearer access-токеном');
      noErrors(errors);
      await ctx.close();
    }

    console.log('\n▶ Пустое имя пользователя (first_name: "")');
    {
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { user: { ...USER, name: 'Руководитель Т.Т.', first_name: '' } });
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      const greet = norm(await page.locator('.greet h1').innerText());
      ok(/^Добр\S+ \S+$/.test(greet) && !greet.includes(',') && !greet.includes('Руководитель'), `first_name пустой — приветствие без имени («${greet}»)`);
      noErrors(errors);
      await ctx.close();
    }

    console.log('\n▶ Ответ start без поля device — считаем устройство новым');
    {
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { noDevice: true });
      await page.goto(BASE);
      await settle(page, 800);
      await page.locator('#login-phone').fill('7015551234');
      await page.locator('[data-act="tg-start"]').click();
      await page.locator('.screen:not(.leaving) [data-tg-open]').waitFor({ timeout: 8000 });
      await settle(page, 700);
      ok((await page.locator('[data-tg-device]').getAttribute('data-tg-device')) === 'new' && norm(await page.locator('.login-title').innerText()) === 'Подтвердите вход в Telegram', 'нет поля device → экран «Подтвердите вход в Telegram»');
      await page.locator('.screen:not(.leaving) [data-tg-open]').click();
      await settle(page, 600);
      await page.locator('.screen:not(.leaving) [data-tg-input]').fill(ctl.state.code);
      await page.waitForFunction(() => location.hash === '#/home', null, { timeout: 12000 });
      ok(true, 'код с этого экрана принимается → вход выполнен');
      noErrors(errors);
      await ctx.close();
    }

    // ---------- 1а. ответ сервера прежней схемы входа ----------
    console.log('\n▶ Сервер ответил по-старому (match_code, без code_length) — понятная ошибка, экрана с числом нет');
    {
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13']);
      ctl.override = (call, { json }) => (call.path === '/auth/telegram/start'
        ? (json(200, { challenge_id: 'ch_old', bot_url: `${BOT}?start=n_old`, match_code: '47', expires_in: 300, poll_interval: 1 }), true) : false);
      await page.goto(BASE);
      await settle(page, 800);
      await page.locator('#login-phone').fill('7015551234');
      await page.locator('[data-act="tg-start"]').click();
      await settle(page, 900);
      ok((await page.evaluate(() => location.hash)) === '#/login' && norm(await page.locator('#login-err').innerText()).includes('Не удалось начать вход. Повторите через минуту'), 'старый ответ start — «Не удалось начать вход», остаёмся на экране входа');
      ok((await page.locator('[data-tg-code]').count()) === 0 && !ctl.calls.some((c) => c.path === '/auth/telegram/poll'), 'экрана с числом нет, опрос не начинается');
      ok(await page.locator('[data-act="tg-start"]').isEnabled(), 'кнопка «Получить код» снова доступна');
      noErrors(errors);
      await ctx.close();
    }

    // ---------- 1б. тестовый сервер ----------
    console.log('\n▶ Тестовый сервер: ?api=test — только эта вкладка, плашка «ТЕСТ»');
    {
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13']);
      await ctx.addInitScript(PUSH_STUB);
      await page.goto(`${BASE}?api=test`);
      await settle(page, 900);
      const bar = page.locator('.env-bar');
      ok((await bar.isVisible()) && norm(await bar.innerText()).includes('ТЕСТ') && norm(await bar.innerText()).includes('api-test.smartsol.pro'), 'плашка «ТЕСТ» с адресом тестового сервера');
      ok(ctl.calls.length > 0 && ctl.calls.every((c) => c.host === 'api-test.smartsol.pro'), 'запросы идут на api-test.smartsol.pro');
      await login(page, ctl);
      await settle(page, 1500);
      ok((await page.evaluate(() => location.hash)) === '#/home' && (await bar.isVisible()), 'после входа плашка «ТЕСТ» на месте');
      ok(ctl.calls.every((c) => c.host === 'api-test.smartsol.pro'), 'вход и данные — только с тестового сервера');
      const box = await bar.boundingBox();
      const top = await page.locator('.screen:not(.leaving) .org-pill').boundingBox();
      ok(box && top && top.y >= box.y + box.height - 1, 'плашка не закрывает экран: содержимое сдвинуто вниз');
      ok((await page.evaluate(() => localStorage.getItem('finpuls-session'))) === null && !!(await page.evaluate(() => sessionStorage.getItem('finpuls-session'))), 'признак входа тестовой вкладки — в sessionStorage; рабочий localStorage не тронут');
      ok((await page.locator('.sheet .push-offer').count()) === 0 && !ctl.calls.some((c) => c.path === '/devices'), 'push в тестовой вкладке на iPhone не предлагается и не регистрируется');
      await shot(page, '10-test-plashka');
      await page.locator('.tabbar .tab[data-go="#/requests"]').click();
      await settle(page, 800);
      await page.reload();
      await settle(page, 1200);
      ok((await bar.isVisible()) && (await page.evaluate(() => location.hash)) === '#/requests' && ctl.calls.every((c) => c.host === 'api-test.smartsol.pro'), 'переходы и перезагрузка вкладки — режим «ТЕСТ» сохраняется');
      // соседняя вкладка без параметра — рабочий сервер
      const ctl2 = { state: {}, popups: [] };
      const page2 = await ctx.newPage();
      await mockApi(page2, ctl2);
      await page2.goto(BASE);
      await settle(page2, 900);
      ok((await page2.locator('.env-bar').count()) === 0 && ctl2.calls.length > 0 && ctl2.calls.every((c) => c.host === 'api.smartsol.pro'), 'соседняя вкладка без параметра — рабочий сервер, без плашки');
      ok((await page2.evaluate(() => location.hash)) === '#/login', 'вход тестовой вкладки на рабочую не распространяется');
      await page2.close();
      // «Выйти» на плашке — обратно на рабочий сервер
      const mark = ctl.calls.length;
      await bar.locator('button').click();
      await page.waitForFunction(() => !location.search && location.hash === '#/login', null, { timeout: 8000 });
      await settle(page, 900);
      ok((await page.locator('.env-bar').count()) === 0 && ctl.calls.slice(mark).length > 0 && ctl.calls.slice(mark).every((c) => c.host === 'api.smartsol.pro'), '«Выйти» на плашке — вкладка снова на рабочем сервере, плашки нет');
      await page.goto(`${BASE}?api=https://evil.example/api/v1`);
      await settle(page, 900);
      ok((await page.locator('.env-bar').count()) === 0 && ctl.calls.slice(mark).every((c) => c.host === 'api.smartsol.pro'), 'чужой адрес в параметре не принимается: значение сверяется только со словом test');
      noErrors(errors);
      await ctx.close();
    }

    console.log('\n▶ Тестовый сервер на компьютере: push с api-test, рабочая подписка не страдает (1.3.2)');
    const DESK = { viewport: { width: 1280, height: 900 } };
    const testHost = (c) => c.host === 'api-test.smartsol.pro';
    const devPosts = (ctl, host) => ctl.calls.filter((c) => c.path === '/devices' && c.method === 'POST' && c.host === host);
    const openProfile = async (page) => {
      await page.evaluate(() => { location.hash = '#/profile'; });
      await settle(page, 900);
    };
    {
      // ключи одинаковые, рабочая подписка уже есть: тестовая вкладка регистрирует её на api-test и ничего не меняет
      const { ctx, page, errors, ctl } = await newCtx(DESK);
      await ctx.addInitScript(PUSH_STUB_KEYS, { perm: 'granted', key: KEY_PROD });
      await page.goto(`${BASE}?api=test`);
      await settle(page, 900);
      await login(page, ctl);
      await settle(page, 1200);
      const p1 = devPosts(ctl, 'api-test.smartsol.pro');
      ok(p1.length === 1 && p1[0].body.subscription.endpoint === 'https://push.example.org/send/prod-1', 'ключи одинаковые: после входа та же подписка зарегистрирована на api-test (POST /devices)');
      ok(ctl.calls.every(testHost) && (await page.evaluate(() => [window.__subs, window.__unsubs].join())) === '0,0', 'новая подписка не делается, рабочая не отменяется, на рабочий сервер запросов нет');
      await openProfile(page);
      const row = norm(await page.locator('.li-push').innerText());
      ok(row.includes('Разрешены') && row.includes('подключить тестовый сервер') && (await page.locator('.li-push').getAttribute('data-act')) === 'push-enable', 'профиль: «Разрешены · нажмите, чтобы подключить тестовый сервер»');
      await shot(page, '43-test-push-profil');
      await page.locator('.li-push').click();
      await page.waitForSelector('.toast.show', { timeout: 6000 });
      ok(norm(await page.locator('.toast').innerText()).includes('Уведомления включены') && devPosts(ctl, 'api-test.smartsol.pro').length === 2, 'нажатие — повторная регистрация на api-test, «Уведомления включены»');
      // выход из тестовой вкладки: устройство снимается на api-test, подписка браузера остаётся
      await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 8000 });
      await page.locator('[data-act="logout"]').click();
      await page.waitForFunction(() => location.hash === '#/login', null, { timeout: 8000 });
      await settle(page, 600);
      ok(ctl.calls.some((c) => c.method === 'DELETE' && c.path === '/devices/dev_1' && testHost(c)) && (await page.evaluate(() => window.__unsubs)) === 0, 'выход из тестовой вкладки: DELETE /devices на api-test, подписка браузера не отменена');
      noErrors(errors);
      await ctx.close();
    }
    {
      // ключи разные, в профиле рабочая подписка: тест её не трогает и честно говорит, что нужен отдельный профиль
      const { ctx, page, errors, ctl } = await newCtx(DESK);
      await ctx.addInitScript(PUSH_STUB_KEYS, { perm: 'granted', key: KEY_PROD });
      ctl.override = (call, { json }) => (call.path === '/version' && testHost(call) ? (json(200, { api_version: '1.0', min_app_version: '1.0.0', server_time: T(TODAY, '10:00'), webpush_public_key: KEY_TEST }), true) : false);
      await page.goto(`${BASE}?api=test`);
      await settle(page, 900);
      await login(page, ctl);
      await settle(page, 1200);
      ok(devPosts(ctl, 'api-test.smartsol.pro').length === 0, 'ключи разные: подписку с рабочим ключом на api-test не отправляем');
      await openProfile(page);
      await page.locator('.li-push').click();
      await page.waitForSelector('.toast.show', { timeout: 6000 });
      const t = norm(await page.locator('.toast').innerText());
      ok(t.includes('уже подключены к рабочему серверу') && t.includes('отдельный профиль Chrome'), 'нажатие — подсказка: уведомления профиля у рабочего сервера, для теста — отдельный профиль Chrome');
      ok((await page.evaluate(() => [window.__subs, window.__unsubs].join())) === '0,0' && devPosts(ctl, 'api-test.smartsol.pro').length === 0, 'рабочая подписка не отменена и не заменена');
      noErrors(errors);
      await ctx.close();
    }
    {
      // ключи разные, профиль чистый (отдельный профиль Chrome): подписка ключом api-test
      const { ctx, page, errors, ctl } = await newCtx(DESK);
      await ctx.addInitScript(PUSH_STUB_KEYS, { perm: 'default' });
      ctl.override = (call, { json }) => (call.path === '/version' && testHost(call) ? (json(200, { api_version: '1.0', min_app_version: '1.0.0', server_time: T(TODAY, '10:00'), webpush_public_key: KEY_TEST }), true) : false);
      await page.goto(`${BASE}?api=test`);
      await settle(page, 900);
      await login(page, ctl);
      await settle(page, 1500);
      ok(norm(await page.locator('.sheet .push-offer').innerText()).includes('Уведомления о новых заявках'), 'отдельный профиль: после входа — предложение включить уведомления');
      await page.locator('.sheet [data-act="push-enable"]').click();
      await page.waitForSelector('.toast.show', { timeout: 6000 });
      const key = await page.evaluate(() => window.__subKeyB64);
      const p = devPosts(ctl, 'api-test.smartsol.pro');
      ok(key === KEY_TEST && p.length === 1 && p[0].body.subscription.endpoint === 'https://push.example.org/send/new-1', 'подписка ключом api-test и регистрация на api-test');
      noErrors(errors);
      // рабочая вкладка в том же профиле: подписку с тестовым ключом рабочему серверу не отправляет; «Включить» — новая подписка
      const ctl2 = { state: {}, popups: [] };
      const page2 = await ctx.newPage();
      await mockApi(page2, ctl2);
      await page2.goto(BASE);
      await settle(page2, 900);
      await login(page2, ctl2);
      await settle(page2, 1200);
      const p2 = devPosts(ctl2, 'api.smartsol.pro');
      ok(p2.length === 1 && p2[0].body.subscription.endpoint === 'https://push.example.org/send/new-2', 'рабочая вкладка в том же профиле: подписка с тестовым ключом заменена рабочей, на рабочий сервер ушла новая');
      ok((await page2.evaluate((kp) => [window.__unsubs, window.__subKeyB64 === kp].join(), KEY_PROD)) === '1,true', 'тестовая подписка снята, новая — рабочим ключом: у рабочего сервера приоритет');
      await page2.close();
      await ctx.close();
    }

    // ---------- 1в. залпы одинаковых запросов ----------
    console.log('\n▶ Один экран — один запрос каждого вида (без залпов)');
    {
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { orgs: [ORG, ORG2] });
      const st = ctl.state;
      const gets = (p, from = 0) => ctl.calls.slice(from).filter((c) => c.method === 'GET' && c.path === p).length;
      const tabBtn = (h) => page.locator(`.tabbar .tab[data-go="${h}"]`);
      const hammer = async (h, n = 5) => {
        for (let i = 0; i < n; i++) await tabBtn(h).click();
      };
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl, { expect: '#/orgs' });
      await page.locator('[data-act="pick-org"][data-id="org_test"]').click();
      await settle(page, 900);
      ok((await page.evaluate(() => location.hash)) === '#/home', 'вход → главная');
      ok(gets('/orgs/org_test/summary') === 1 && gets('/orgs') === 1, `открытие главной: один summary и один orgs (было ${gets('/orgs/org_test/summary')} и ${gets('/orgs')})`);
      // возврат во вкладку браузера и в приложение из фона
      let mark = ctl.calls.length;
      await page.evaluate(() => {
        for (let i = 0; i < 4; i++) {
          document.dispatchEvent(new Event('visibilitychange'));
          window.dispatchEvent(new Event('focus'));
          window.dispatchEvent(new Event('pageshow'));
          window.dispatchEvent(new Event('online'));
        }
      });
      await settle(page, 900);
      ok(ctl.calls.length === mark, `возврат на вкладку (visibilitychange, focus) не даёт ни одного запроса (было ${ctl.calls.length - mark})`);
      // медленный сервер: 1С отвечает секунду — нетерпеливые нажатия не плодят запросы
      st.delay = 900;
      await tabBtn('#/requests').click();
      await page.waitForSelector('.screen:not(.leaving) .req-list', { timeout: 8000 });
      mark = ctl.calls.length;
      await hammer('#/home');
      await page.waitForSelector('.screen:not(.leaving) .hero', { timeout: 8000 });
      await settle(page, 400);
      ok(gets('/orgs/org_test/summary', mark) === 1, `5 нажатий на «Главная», пока она грузится, — один summary (было ${gets('/orgs/org_test/summary', mark)})`);
      mark = ctl.calls.length;
      await hammer('#/requests');
      await page.waitForSelector('.screen:not(.leaving) .req-list', { timeout: 8000 });
      await settle(page, 400);
      ok(gets('/orgs/org_test/requests', mark) === 1, `5 нажатий на «Заявки» — один requests (было ${gets('/orgs/org_test/requests', mark)})`);
      mark = ctl.calls.length;
      await hammer('#/profile');
      await page.waitForSelector('.screen:not(.leaving) .me-card', { timeout: 8000 });
      await settle(page, 400);
      ok(gets('/me', mark) === 1 && gets('/orgs', mark) === 1 && gets('/me/settings', mark) === 1, `5 нажатий на «Профиль» — по одному /me, /orgs, /me/settings (было ${gets('/me', mark)}, ${gets('/orgs', mark)}, ${gets('/me/settings', mark)})`);
      // переключение организации в профиле — без перечитывания профиля
      mark = ctl.calls.length;
      await page.locator('[data-act="switch-org"][data-id="org_two"]').click();
      await settle(page, 600);
      ok(ctl.calls.length === mark, `переключение организации в профиле — без запросов (было ${ctl.calls.length - mark})`);
      ok((await page.locator('[data-act="switch-org"][data-id="org_two"] .li-check').count()) === 1 && (await page.locator('[data-act="switch-org"][data-id="org_test"] .li-radio').count()) === 1, 'отметка выбранной организации переставлена');
      await page.locator('[data-act="switch-org"][data-id="org_test"]').click();
      await settle(page, 300);
      // «Назад» браузера: popstate и hashchange приходят парой — загрузка одна
      mark = ctl.calls.length;
      await page.goBack();
      await page.waitForSelector('.screen:not(.leaving) .req-list', { timeout: 8000 });
      await settle(page, 1200);
      ok(gets('/orgs/org_test/requests', mark) === 1, `«Назад» браузера — один requests (было ${gets('/orgs/org_test/requests', mark)})`);
      mark = ctl.calls.length;
      await page.evaluate(() => { location.hash = '#/home'; });
      await page.waitForSelector('.screen:not(.leaving) .hero', { timeout: 8000 });
      await settle(page, 1200);
      ok(gets('/orgs/org_test/summary', mark) === 1, `смена адреса (hashchange) — один summary (было ${gets('/orgs/org_test/summary', mark)})`);
      // «Обновить» на экране ошибки, пока ответ ещё идёт, — один запрос
      ctl.override = (call, { err }) => (call.path === '/orgs/org_test/summary' ? (err(503, 'source_unavailable', 'Учёт компании не отвечает'), true) : false);
      await tabBtn('#/requests').click();
      await page.waitForSelector('.screen:not(.leaving) .req-list', { timeout: 8000 });
      await tabBtn('#/home').click();
      await page.waitForSelector('.screen:not(.leaving) .err-state', { timeout: 8000 });
      ctl.override = null;
      mark = ctl.calls.length;
      for (let i = 0; i < 4; i++) await page.locator('.screen:not(.leaving) [data-act="retry"]').click();
      await page.waitForSelector('.screen:not(.leaving) .hero', { timeout: 8000 });
      await settle(page, 400);
      ok(gets('/orgs/org_test/summary', mark) === 1, `4 нажатия «Обновить» после ошибки — один summary (было ${gets('/orgs/org_test/summary', mark)})`);
      // слой API: два одинаковых GET одновременно — один запрос; POST не склеиваются
      mark = ctl.calls.length;
      const same = await page.evaluate(async () => {
        const { api } = await import('./js/api/index.js');
        const org = api.orgId();
        const [a, b, c] = await Promise.all([api.home(org), api.summary(org), api.home(org)]);
        const p = await Promise.allSettled([api.markRead(org, 'n_a'), api.markRead(org, 'n_a')]);
        return { ok: a.money.total === c.money.total && b.money.total === a.money.total, posts: p.length };
      });
      ok(same.ok && gets('/orgs/org_test/summary', mark) === 1, `слой API: три одновременных чтения сводки — один GET (было ${gets('/orgs/org_test/summary', mark)})`);
      ok(ctl.calls.slice(mark).filter((c) => c.method === 'POST' && c.path === '/notifications/read').length === 2, 'слой API: POST не склеиваются — ушли оба');
      mark = ctl.calls.length;
      await page.evaluate(async () => {
        const { api } = await import('./js/api/index.js');
        await api.home(api.orgId());
        await api.home(api.orgId());
      });
      ok(gets('/orgs/org_test/summary', mark) === 2, 'слой API: ответ не запоминается — следующий запрос после ответа идёт в сеть');
      noErrors(errors);
      await ctx.close();
    }

    // ---------- 1д. вкладка «Отчёты» по списку сервера ----------
    console.log('\n▶ Вкладка «Отчёты» собирается из reports в /orgs');
    {
      // порядок — как прислал сервер; незнакомое имя пропускается
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { orgs: [{ ...ORG, reports: ['debtors', 'brand-new-report', 'cash-flow'] }] });
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      ok((await page.locator('.screen:not(.leaving) [data-go="#/reports/debtors"]').count()) === 1, 'debtors есть в списке — «Нам должны» на главной ведёт в «Должники»');
      await page.locator('.tabbar .tab[data-go="#/reports"]').click();
      await settle(page, 900);
      const segs = (await page.locator('.screen:not(.leaving) .seg-btn').allInnerTexts()).map((x) => norm(x).trim());
      ok(JSON.stringify(segs) === JSON.stringify(['Должники', 'ДДС']), `переключатель — в порядке сервера, незнакомый отчёт пропущен (${segs.join(' · ')})`);
      ok(norm(await page.locator('.screen:not(.leaving) .rep-body').innerText()).includes('ТОО «Должник»'), 'открыт первый отчёт списка — «Должники»');
      await page.evaluate(() => { location.hash = '#/reports/plan'; });
      await settle(page, 900);
      ok((await page.evaluate(() => location.hash)) === '#/reports' && !ctl.calls.some((c) => c.path.endsWith('/reports/plan-fact')), 'отчёта нет в списке — адрес ведёт на первый отчёт, запрос не уходит');
      noErrors(errors);
      await ctx.close();
    }
    {
      // поля reports нет (сервер прежней версии, база до 1.16.2) — заглушка, запросов отчётов нет
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { orgs: [ORG_OLD] });
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      ok((await page.locator('.screen:not(.leaving) [data-go="#/reports/debtors"]').count()) === 0 && norm(await page.locator('.screen:not(.leaving) .rec-card').innerText()).includes('Долг по возрасту'), 'нет debtors в списке — «Нам должны» на главной без ссылки');
      await page.locator('.tabbar .tab[data-go="#/reports"]').click();
      await settle(page, 900);
      const txt = norm(await page.locator('.screen:not(.leaving) .scroll').innerText());
      ok(txt.includes('Раздел появится в следующей версии') && txt.includes('Сейчас в приложении — главная и согласование заявок.') && (await page.locator('.screen:not(.leaving) .seg').count()) === 0, 'списка отчётов нет — заглушка «Раздел появится в следующей версии»');
      ok(!ctl.calls.some((c) => /\/reports\//.test(c.path)), 'запросы отчётов не уходят');
      noErrors(errors);
      await ctx.close();
    }

    // ---------- 1е. проекты ----------
    console.log('\n▶ «Проекты» и «Отчёт по проекту» (общий проход: /orgs/{org}/reports/projects)');
    {
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { orgs: [{ ...ORG, reports: ['projects'] }] });
      const st = ctl.state;
      const prjCalls = (from = 0) => ctl.calls.slice(from).filter((c) => c.method === 'GET' && c.path === '/orgs/org_test/reports/projects');
      const last = () => prjCalls().slice(-1)[0];
      const rows = () => page.locator('.screen:not(.leaving) .prj');
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      ok((await page.locator('.screen:not(.leaving) [data-go="#/reports/debtors"]').count()) === 0, 'в списке только projects — «Нам должны» без ссылки');
      await page.locator('.tabbar .tab[data-go="#/reports"]').click();
      await page.waitForSelector('.screen:not(.leaving) [data-prj-totals]', { timeout: 8000 });
      await settle(page, 500);
      ok((await page.locator('.screen:not(.leaving) .seg').count()) === 0 && norm(await page.locator('.screen:not(.leaving) .page-over').innerText()) === 'Отчёты' && norm(await page.locator('.screen:not(.leaving) .page-title').innerText()) === 'Проекты', 'один отчёт — без переключателя: «Отчёты» / «Проекты»');
      ok(prjCalls().length === 1 && JSON.stringify(last().query) === JSON.stringify({ limit: '50' }) && last().headers.authorization === 'Bearer at_1', 'GET /orgs/{org}/reports/projects?limit=50 — без from/to (период по умолчанию ставит сервер)');
      const T0 = PRJ.list.totals;
      const tot = norm(await page.locator('[data-prj-totals]').innerText());
      ok(tot.includes('8 проектов') && tot.includes('1 без ID') && tot.includes('468 389 086') && tot.includes('325,8 млн') && tot.includes('142,6 млн') && tot.includes('30,4%') && tot.includes('420,4 млн') && tot.includes('96,2 млн'), `итоги — из totals ответа (${T0.count} проектов, стоимость ${T0.revenue})`);
      ok((await rows().count()) === 8 && (await page.locator('.screen:not(.leaving) .prj.noid').count()) === 1, '8 строк, одна — без ID');
      const noId = norm(await page.locator('.screen:not(.leaving) .prj.noid').innerText());
      ok(noId.includes('Реализация № 412') && noId.includes('Без ID') && norm(await page.locator('[data-prj-noid]').innerText()).includes('допишите ID в комментарий реализации'), 'реализация без ID — последней, с номером, меткой и подсказкой бухгалтеру');
      ok(await rows().last().evaluate((e) => e.classList.contains('noid')), 'без ID — в конце списка');
      const r1 = norm(await page.locator('.prj[data-prj="prj_demo_7d4c"]').innerText());
      ok(r1.includes('PS-2026-04') && r1.includes('В работе') && r1.includes('заказ 27.07.26') && r1.includes('ТОО «Бирлик Трейд»') && r1.includes('42,1 млн') && r1.includes('14,3 млн') && r1.includes('34%') && r1.includes('Долг 11,3 млн'), 'строка проекта: ID, статус, дата заказа, заказчик, стоимость, маржа и %, долг');
      ok(norm(await page.locator('.prj[data-prj="prj_demo_9f6a"]').innerText()).includes('Оплачен полностью'), 'проект без долга — «Оплачен полностью»');
      ok(norm(await page.locator('.screen:not(.leaving) .prj-note').innerText()).includes('Стоимость, расходы и маржа — без НДС; оплачено и долг — с НДС') && norm(await page.locator('.screen:not(.leaving) .prj-stamp').innerText()).includes('Данные 1С на 15 ноября, 10:20'), 'подписи про НДС и время данных — из ответа');
      ok(norm(await page.locator('[data-prj-period]').innerText()).includes('1 янв — 30 ноя 2026'), 'плашка периода — из from/to ответа');
      ok((await page.locator('.screen:not(.leaving) [data-prj-cats]').count()) === 0, 'в ответе нет categories (база до 1.16.7) — ряда категорий нет');
      ok((await page.locator('[data-prj-period] svg').count()) === 2 && norm(await page.locator('[data-prj-period]').getAttribute('aria-label')).startsWith('Период: 1 янв — 30 ноя 2026'), 'кнопка периода — со значком календаря и подписью «Период: …» для экранного диктора');
      await shot(page, '14-proekty-spisok');

      // отборы чипами — параметрами запроса, итоги и строки из нового ответа
      await page.locator('.screen:not(.leaving) [data-act="prj-chip"][data-v="in_work"]').click();
      await page.waitForFunction(() => document.querySelectorAll('.screen:not(.leaving) .prj').length === 4, null, { timeout: 8000 });
      ok(last().query.status === 'in_work' && !last().query.debt_only && norm(await page.locator('[data-prj-totals]').innerText()).includes('4 проекта'), 'чип «В работе» → status=in_work; итоги по отбору');
      await page.locator('.screen:not(.leaving) [data-act="prj-chip"][data-k="debtOnly"]').click();
      await settle(page, 700);
      ok(last().query.status === 'in_work' && last().query.debt_only === 'true', 'чип «Есть долг» → debt_only=true, сочетается со статусом');
      await page.locator('.screen:not(.leaving) [data-act="prj-chip"][data-v=""]').click();
      await settle(page, 500);
      await page.locator('.screen:not(.leaving) [data-act="prj-chip"][data-k="debtOnly"]').click();
      await settle(page, 500);
      await page.locator('.screen:not(.leaving) [data-act="prj-chip"][data-k="withoutId"]').click();
      await page.waitForFunction(() => document.querySelectorAll('.screen:not(.leaving) .prj').length === 1, null, { timeout: 8000 });
      ok(last().query.without_id === 'true' && !last().query.status && !last().query.debt_only, 'чип «Без ID» → without_id=true');
      await page.locator('.screen:not(.leaving) [data-act="prj-chip"][data-k="withoutId"]').click();
      await settle(page, 600);

      // шторка: период и сортировка — запрос только по «Показать»
      const before = prjCalls().length;
      await page.locator('[data-prj-period]').click();
      await settle(page, 450);
      ok(norm(await page.locator('.sheet').innerText()).includes('Период — по дате реализаций') && (await page.locator('.sheet input[type="search"], .sheet [data-search]').count()) === 0, 'шторка «Отборы и сортировка»: «Период — по дате реализаций», поиска нет');
      ok(norm(await page.locator('.sheet [data-act="prj-draft"][data-k="period"][data-v="custom"]').innerText()) === 'Выбрать даты' && !norm(await page.locator('.sheet').innerText()).includes('Свой'), 'произвольный период в шторке называется «Выбрать даты»');
      await shot(page, '15-proekty-otbory');
      await page.locator('.sheet [data-act="prj-draft"][data-k="sort"][data-v="debt"]').click();
      await page.locator('.sheet [data-act="prj-draft"][data-k="period"][data-v="prev"]').click();
      await page.locator('.sheet [data-act="prj-draft"][data-k="debtOnly"]').click();
      await settle(page, 300);
      ok(prjCalls().length === before, 'выбор в шторке запросов не шлёт');
      await page.locator('.sheet [data-act="prj-apply"]').click();
      await settle(page, 900);
      ok(prjCalls().length === before + 1 && last().query.sort === 'debt' && last().query.from === '2026-10-01' && last().query.to === '2026-10-31' && last().query.debt_only === 'true', '«Показать» → один запрос: sort=debt, from/to прошлого месяца, debt_only=true');
      ok(norm(await page.locator('.screen:not(.leaving) .prj-sum').innerText()).includes('По долгу'), 'подпись сортировки — «По долгу»');
      // свой период: проверка до запроса
      await page.locator('[data-prj-period]').click();
      await settle(page, 400);
      await page.locator('.sheet [data-act="prj-draft"][data-k="period"][data-v="custom"]').click();
      await page.locator('.sheet [data-prj-from]').fill('2020-01-01');
      await page.locator('.sheet [data-prj-to]').fill('2026-11-11');
      const b2 = prjCalls().length;
      await page.locator('.sheet [data-act="prj-apply"]').click();
      await settle(page, 400);
      ok(norm(await page.locator('.sheet [data-prj-err]').innerText()).includes('не длиннее трёх лет') && prjCalls().length === b2, 'свой период длиннее трёх лет — сообщение в шторке, запрос не уходит');
      await page.locator('.sheet [data-prj-from]').fill('2026-07-01');
      await page.locator('.sheet [data-prj-to]').fill('2026-09-30');
      await page.locator('.sheet [data-act="prj-apply"]').click();
      await settle(page, 900);
      ok(last().query.from === '2026-07-01' && last().query.to === '2026-09-30', 'свой период → from/to как ввели');
      // 422 от сервера на период — возврат к периоду по умолчанию с объяснением
      st.prj422 = true;
      await page.locator('[data-prj-period]').click();
      await settle(page, 400);
      await page.locator('.sheet [data-prj-from]').fill('2026-01-01');
      await page.locator('.sheet [data-act="prj-apply"]').click();
      await settle(page, 1100);
      st.prj422 = false;
      ok(norm(await page.locator('.toast').innerText()).includes('Период не подошёл') && !last().query.from && (await rows().count()) > 0, '422 на период — подсказка и список за период по умолчанию');
      await page.locator('[data-prj-period]').click();
      await settle(page, 400);
      await page.locator('.sheet [data-act="prj-reset"]').click();
      await settle(page, 900);
      ok(JSON.stringify(last().query) === JSON.stringify({ limit: '50' }) && (await rows().count()) === 8, '«Сбросить» — отбор по умолчанию');

      // пустой отбор
      st.prjEmpty = true;
      await page.locator('.screen:not(.leaving) [data-act="prj-chip"][data-v="done"]').click();
      await page.waitForSelector('.screen:not(.leaving) [data-prj-empty]', { timeout: 8000 });
      ok(norm(await page.locator('[data-prj-empty]').innerText()).includes('Проектов не найдено') && (await page.locator('[data-prj-empty] [data-act="prj-reset"]').count()) === 1, 'отбор ничего не нашёл — «Проектов не найдено» и «Сбросить отборы»');
      st.prjEmpty = false;
      await page.locator('[data-prj-empty] [data-act="prj-reset"]').click();
      await page.waitForFunction(() => document.querySelectorAll('.screen:not(.leaving) .prj').length === 8, null, { timeout: 8000 });

      // карточка проекта
      const cardCalls = () => ctl.calls.filter((c) => c.method === 'GET' && c.path.startsWith('/orgs/org_test/reports/projects/'));
      const listBefore = prjCalls().length;
      await page.locator('.prj[data-prj="prj_demo_7d4c"]').click();
      await page.waitForSelector('.screen:not(.leaving) [data-project="prj_demo_7d4c"]', { timeout: 8000 });
      await settle(page, 600);
      ok(cardCalls().length === 1 && cardCalls()[0].path === '/orgs/org_test/reports/projects/prj_demo_7d4c', 'GET /orgs/{org}/reports/projects/{id}');
      ok((await page.evaluate(() => location.hash)) === '#/reports/projects/prj_demo_7d4c' && norm(await page.locator('.screen:not(.leaving) .tb-title').innerText()) === 'Проект PS-2026-04', 'экран «Проект PS-2026-04»');
      const card = norm(await page.locator('.screen:not(.leaving) .scroll').innerText());
      ok(card.includes('В работе') && card.includes('ТОО «Бирлик Трейд»') && card.includes('42 085 759') && card.includes('Стоимость проекта, без НДС'), 'шапка: статус, заказчик, стоимость без НДС');
      const mar = norm(await page.locator('[data-prj-margin]').innerText());
      const pay = norm(await page.locator('[data-prj-pay]').innerText());
      ok(mar.includes('рентабельность 34%') && mar.includes('27 778 000 ₸') && mar.includes('14 307 759 ₸'), '«Маржа»: расходы 27 778 000, маржа 14 307 759, рентабельность 34%');
      ok(pay.includes('Оплата заказчика') && pay.includes('с НДС') && pay.includes('37 540 000 ₸') && pay.includes('11 279 480 ₸'), '«Оплата заказчика»: оплачено и долг из ответа');
      ok(card.includes('Сапарова Мадина') && card.includes('Регулярная') && card.includes('27 июля 2026'), 'реквизиты: ответственный, категория, дата заказа');
      ok(norm(await page.locator('[data-pt="sales"] .pt-head').innerText()).replace(/\s+/g, ' ').includes('Реализации 8 42 085 759 ₸') && norm(await page.locator('[data-pt="purchases"] .pt-head').innerText()).replace(/\s+/g, ' ').includes('Поступления по ID 3 20 030 000 ₸') && norm(await page.locator('[data-pt="payments"] .pt-head').innerText()).replace(/\s+/g, ' ').includes('Оплаты поставщикам 4 19 200 000 ₸'), 'три таблицы: число строк и суммы (расходы 27,8 млн и поступления 20,0 млн — разные числа)');
      ok((await page.locator('[data-pt="sales"] .pt-body').isHidden()) && (await page.locator('[data-pt="payments"] .pt-body').isHidden()), 'таблицы свёрнуты');
      await shot(page, '16-proekt-kartochka');
      const callsBefore = ctl.calls.length;
      await page.locator('[data-pt="sales"] .pt-head').click();
      await page.locator('[data-pt="purchases"] .pt-head').click();
      await page.locator('[data-pt="payments"] .pt-head').click();
      await settle(page, 300);
      const sales = norm(await page.locator('[data-pt="sales"] .pt-body').innerText());
      ok(ctl.calls.length === callsBefore && (await page.locator('[data-pt="sales"] .pt-row').count()) === 8, 'таблицы раскрываются на месте, без запросов');
      ok(sales.includes('доход') && sales.includes('расход') && sales.includes('счёт 6010') && sales.includes('счёт 1274') && sales.includes('31 июля · № 187') && sales.includes('6 740 000 ₸'), 'реализации: строки дохода (6010) и расхода (1274) со счётом, номером и суммой');
      ok(norm(await page.locator('[data-pt="purchases"] .pt-body').innerText()).includes('ТОО «Ирбис Карго»') && norm(await page.locator('[data-pt="purchases"] .pt-body').innerText()).includes('доля 60 %'), 'поступления по ID: поставщик и примечание о доле');
      const pays = norm(await page.locator('[data-pt="payments"] .pt-body').innerText());
      ok(pays.includes('Оплата ЖТ-552 по PS-2026-04') && pays.includes('по ID') && pays.includes('вручную') && pays.includes('Аренда склада'), 'оплаты поставщикам: комментарий, статья, «по ID» / «вручную»');
      ok(norm(await page.locator('[data-prj-unassigned]').innerText()).includes('1 документ с несколькими ID без сумм') && norm(await page.locator('[data-prj-unassigned]').innerText()).includes('разнести в 1С вручную'), 'unassigned_count → строка про документы, которые нужно разнести в 1С');
      await page.evaluate(() => { const s = document.querySelector('.screen:not(.leaving) .scroll'); s.scrollTop = document.querySelector('[data-pt="sales"]').offsetTop - 12; });
      await settle(page, 300);
      await shot(page, '17-proekt-tablicy');
      await page.locator('.screen:not(.leaving) .topbar [data-back]').click();
      await page.waitForSelector('.screen:not(.leaving) [data-prj-totals]', { timeout: 8000 });
      await settle(page, 500);
      ok(prjCalls().length === listBefore && (await rows().count()) === 8, '«Назад» — к списку без повторного запроса');

      // карточка без ID
      await page.locator('.screen:not(.leaving) .prj.noid').click();
      await page.waitForSelector('.screen:not(.leaving) [data-project="prj_demo_b188"]', { timeout: 8000 });
      await settle(page, 500);
      const nc = norm(await page.locator('.screen:not(.leaving) .scroll').innerText());
      ok(norm(await page.locator('.screen:not(.leaving) .tb-title').innerText()) === 'Реализация № 412' && nc.includes('Без ID заявки') && norm(await page.locator('[data-prj-hint]').innerText()).includes('Бухгалтеру: дописать ID'), 'реализация без ID: заголовок с номером и подсказка из hint');
      ok(nc.includes('Без ID заявки поступления не подбираются') && nc.includes('Оплат, отнесённых к проекту, нет'), 'purchases: null → «не подбираются»; оплат нет');
      await shot(page, '18-proekt-bez-id');

      // 404 — карточки больше нет
      await page.evaluate(() => { location.hash = '#/reports/projects/project_gone'; });
      await page.waitForSelector('.screen:not(.leaving) [data-prj-missing]', { timeout: 8000 });
      ok(norm(await page.locator('[data-prj-missing]').innerText()).includes('Проект не найден'), '404 на карточке — «Проект не найден»');
      const lb = prjCalls().length;
      await page.locator('[data-prj-missing] [data-go="#/reports/projects"]').click();
      await page.waitForSelector('.screen:not(.leaving) [data-prj-totals]', { timeout: 8000 });
      await settle(page, 400);
      ok(prjCalls().length === lb + 1, '«К списку проектов» — список перечитан');

      // учёт не ответил на карточке (на бою так приходит и «проекта нет»: 503 вместо 404) — два выхода, не «нет связи» на весь экран
      st.prjCard503 = true;
      await page.locator('.screen:not(.leaving) .prj[data-prj="prj_demo_7d4c"]').click();
      await page.waitForSelector('.screen:not(.leaving) [data-prj-failed]', { timeout: 8000 });
      await settle(page, 400);
      const failed = norm(await page.locator('.screen:not(.leaving) [data-prj-failed]').innerText());
      ok(failed.includes('Не удалось открыть проект') && failed.includes('Повторить') && failed.includes('К списку проектов') && (await page.locator('.screen:not(.leaving) .err-state').count()) === 0, '503 на карточке — «Не удалось открыть проект», кнопки «Повторить» и «К списку проектов»');
      await shot(page, '20-proekt-ne-otkrylsya');
      st.prjCard503 = false;
      await page.locator('.screen:not(.leaving) [data-prj-failed] [data-act="retry"]').click();
      await page.waitForSelector('.screen:not(.leaving) [data-project="prj_demo_7d4c"]', { timeout: 8000 });
      ok(true, '«Повторить» — карточка открылась');
      await page.locator('.topbar [data-back]').click();
      await page.waitForSelector('.screen:not(.leaving) [data-prj-totals]', { timeout: 8000 });
      await settle(page, 400);

      // порции: 120 проектов, страница 50
      st.prjMany = 120;
      await page.locator('.screen:not(.leaving) [data-act="prj-chip"][data-v="in_work"]').click();
      await page.waitForFunction(() => document.querySelectorAll('.screen:not(.leaving) .prj').length === 50, null, { timeout: 8000 });
      ok(norm(await page.locator('[data-prj-totals]').innerText()).includes('120 проектов') && norm(await page.locator('[data-act="prj-more"]').innerText()).includes('Показать ещё 50'), 'первая порция — 50 строк, итоги по всему отбору (120), «Показать ещё 50»');
      await page.locator('[data-act="prj-more"]').click();
      await page.waitForFunction(() => document.querySelectorAll('.screen:not(.leaving) .prj').length === 100, null, { timeout: 8000 });
      ok(last().query.cursor === '50' && last().query.status === 'in_work' && norm(await page.locator('[data-act="prj-more"]').innerText()).includes('Показать ещё 20'), 'вторая порция — запрос с cursor и тем же отбором, осталось 20');
      await page.locator('[data-act="prj-more"]').click();
      await page.waitForFunction(() => document.querySelectorAll('.screen:not(.leaving) .prj').length === 120, null, { timeout: 8000 });
      ok((await page.locator('[data-act="prj-more"]').count()) === 0, 'третья порция — все 120, кнопки больше нет');
      st.prjMany = 0;
      noErrors(errors);
      await ctx.close();
    }
    {
      // 403 report_unavailable: перечитать /orgs; пункт пропал — вкладка перестраивается
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { orgs: [{ ...ORG, reports: ['projects', 'debtors'] }] });
      const st = ctl.state;
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      await page.locator('.tabbar .tab[data-go="#/reports"]').click();
      await page.waitForSelector('.screen:not(.leaving) [data-prj-totals]', { timeout: 8000 });
      ok((await page.locator('.screen:not(.leaving) .seg-btn').allInnerTexts()).map((x) => norm(x).trim()).join('·') === 'Проекты·Должники', 'два отчёта — переключатель «Проекты · Должники»');
      // отчёт выключили в 1С: сервер отвечает 403, а в /orgs проектов больше нет
      st.prj403 = true;
      st.orgs = [{ ...ORG, reports: ['debtors'] }];
      const mark = ctl.calls.length;
      await page.locator('.screen:not(.leaving) [data-act="prj-chip"][data-v="in_work"]').click(); // новый запрос списка → 403
      await page.waitForFunction(() => (document.querySelector('.screen:not(.leaving) .page-title')?.textContent || '').includes('Должники'), null, { timeout: 8000 });
      await settle(page, 600);
      ok(ctl.calls.slice(mark).some((c) => c.path === '/orgs' && c.method === 'GET'), '403 report_unavailable → приложение перечитало /orgs');
      ok((await page.locator('.screen:not(.leaving) .seg').count()) === 0 && norm(await page.locator('.screen:not(.leaving) .page-title').innerText()) === 'Должники' && (await page.evaluate(() => location.hash)) === '#/reports', 'проектов в списке больше нет — вкладка перестроилась: остались «Должники», без переключателя');
      // отчёт всё ещё в списке, но недоступен — честное «недоступно»
      st.orgs = [{ ...ORG, reports: ['projects', 'debtors'] }];
      await page.reload();
      await page.waitForSelector('.screen:not(.leaving) [data-error="report_unavailable"]', { timeout: 10000 });
      const gone = norm(await page.locator('.screen:not(.leaving) [data-error="report_unavailable"]').innerText());
      ok(gone.includes('Проекты сейчас недоступны') && gone.includes('Доступ к отчётам в приложении включает администратор ФинПульса в 1С вашей компании.') && !/руководител|1\.16\.2/.test(gone), 'отчёт в списке, но сервер отвечает 403 — «Проекты сейчас недоступны. Доступ к отчётам… включает администратор…», роль не названа');
      ok((await page.locator('.screen:not(.leaving) .seg-btn').count()) === 2, 'переключатель на месте — можно уйти в другой отчёт');
      await shot(page, '19-proekty-nedostupny');
      // 501 у отчёта из списка — то же, что 403: «недоступен» и перечитанный /orgs
      st.rep501 = true;
      const m501 = ctl.calls.length;
      await page.locator('.screen:not(.leaving) .seg-btn[data-go="#/reports/debtors"]').click();
      await page.waitForFunction(() => (document.querySelector('.screen:not(.leaving) [data-error="report_unavailable"] b')?.textContent || '').includes('Должники'), null, { timeout: 8000 });
      const gone501 = norm(await page.locator('.screen:not(.leaving) [data-error="report_unavailable"]').innerText());
      ok(gone501.includes('Должники сейчас недоступны') && gone501.includes('включает администратор ФинПульса') && ctl.calls.slice(m501).some((c) => c.path === '/orgs' && c.method === 'GET'), '501 у отчёта из списка — «Должники сейчас недоступны», /orgs перечитан');
      st.rep501 = false;
      noErrors(errors);
      await ctx.close();
    }

    // ---------- 1г. заявка с несколькими статьями ----------
    console.log('\n▶ Заявка с двумя статьями: превышение лимита — по доле статьи (over_by), не по всей сумме');
    {
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { multi: true });
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      await page.locator('.tabbar .tab[data-go="#/requests"]').click();
      await settle(page, 800);
      ok((await page.locator('.screen:not(.leaving) .req-card').count()) === 2 && (await page.locator('.screen:not(.leaving) .tag-warn').count()) === 1, 'в списке две заявки, «Сверх лимита» — по over_limit из ответа');
      await page.locator('.req-card[data-go="#/requests/req_2"]').click();
      await settle(page, 800);
      const b = MULTI.budgets[0];
      const bud = page.locator('.screen:not(.leaving) [data-budget]');
      const txt = norm(await bud.innerText());
      ok(txt.includes('Превышение лимита на 200 000 ₸') && Number(await bud.getAttribute('data-over')) === b.over_by, `превышение на экране = over_by из ответа (${b.over_by}), а не по всей сумме заявки (800 000)`);
      ok(txt.includes('По статье') && txt.includes('900 000 ₸') && Number(await bud.getAttribute('data-part')) === b.this_request, '«По статье» — доля this_request (900 000), не вся сумма (1 500 000)');
      ok(txt.includes('+10% к бюджету статьи'), 'процент превышения — от доли статьи (+10%)');
      ok(norm(await page.locator('[data-bud-split]').innerText()).includes('из 1 500 000 ₸ приходится 900 000 ₸'), 'пояснение: в заявке несколько статей');
      const w = await page.locator('.screen:not(.leaving) .bud-req').evaluate((e) => parseFloat(e.style.width));
      ok(Math.abs(w - (900000 / 2200000) * 100) < 0.02, `полоска заявки — по доле статьи (${w}%)`);
      await shot(page, '11-zayavka-dve-stati');
      await page.locator('.screen:not(.leaving) [data-act="approve"]').click();
      await settle(page, 500);
      ok(norm(await page.locator('.sheet .over-note').innerText()).includes('Сверх лимита на 200 000 ₸'), 'подтверждение согласования — то же превышение (200 000)');
      await page.locator('.sheet [data-act="sheet-close"]').click();
      await settle(page, 400);
      // заявка с одной статьёй — как раньше
      await page.evaluate(() => { location.hash = '#/requests/req_1'; });
      await settle(page, 800);
      const one = norm(await page.locator('.screen:not(.leaving) [data-budget]').innerText());
      ok(one.includes('Эта заявка') && one.includes('1 500 000 ₸') && one.includes('В пределах лимита') && (await page.locator('[data-bud-split]').count()) === 0, 'заявка с одной статьёй — без изменений');
      noErrors(errors);
      await ctx.close();
    }

    console.log('\n▶ Организации: 503 и одна организация');
    {
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { orgsDown: true });
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl, { expect: '#/orgs' });
      ok(norm(await page.locator('.err-state').innerText()).includes('Нет связи с учётом компании'), '/orgs 503 source_unavailable → «Нет связи с учётом компании»');
      ok(norm(await page.locator('.err-state [data-act="retry"]').innerText()).includes('Повторить'), 'кнопка «Повторить»');
      await shot(page, '08-organizacii-net-svyazi');
      ctl.state.orgsDown = false;
      await page.locator('.err-state [data-act="retry"]').click();
      await page.waitForFunction(() => location.hash === '#/home', null, { timeout: 8000 });
      ok(true, '«Повторить» → одна организация, partial: false → сразу главная');
      noErrors(errors);
      await ctx.close();
    }

    // ---------- 2. токены ----------
    console.log('\n▶ Обновление токенов (контракт, 2.3)');
    {
      const { ctx, page, errors, ctl } = await newCtx();
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      // access-токен истёк: все запросы главной получают 401 token_expired — обновление должно быть одно
      ctl.state.expireAccess = ctl.state.access;
      ctl.state.access = 'at_never';
      const before = ctl.calls.length;
      ctl.override = (call, { json, st }) => {
        if (call.path === '/auth/refresh' && st.cookie && !call.body && !call.headers.authorization) {
          st.refreshCount = (st.refreshCount || 0) + 1;
          st.access = 'at_new';
          json(200, { access_token: 'at_new', access_expires_in: 900, refresh_expires_in: 2592000, token_type: 'Bearer' });
          return true;
        }
        return false;
      };
      await page.locator('.tabbar .tab[data-go="#/calendar"]').click();
      await settle(page, 300);
      await page.locator('.tabbar .tab[data-go="#/home"]').click();
      await settle(page, 1200);
      const refreshes = ctl.calls.slice(before).filter((c) => c.path === '/auth/refresh');
      ok(refreshes.length === 1, `одно обновление на все запросы (было ${refreshes.length})`);
      ok(ctl.calls.slice(before).some((c) => c.path === '/orgs/org_test/summary' && c.headers.authorization === 'Bearer at_new'), 'запрос повторён с новым access-токеном');
      const rc = (await page.evaluate(() => window.__cred)).filter((c) => c.url.includes('/auth/refresh'));
      ok(rc.length > 0 && rc.every((c) => c.credentials === 'include'), 'POST /auth/refresh — по cookie (credentials: include), без тела и Authorization');
      ok(norm(await page.locator('.hero').innerText()).includes('5 000 000'), 'главная открылась без выхода');
      // refresh_invalid → вход
      ctl.override = null;
      ctl.state.expireAccess = 'at_new';
      ctl.state.access = 'at_other';
      ctl.state.cookie = false; // cookie просрочена или отозвана
      await page.locator('.tabbar .tab[data-go="#/reports"]').click();
      await settle(page, 1200);
      ok((await page.evaluate(() => location.hash)) === '#/login', 'refresh_invalid → экран входа');
      ok(norm(await page.locator('.toast').innerText()).includes('Сессия истекла'), '«Сессия истекла — войдите снова»');
      ok(!(await page.evaluate(() => localStorage.getItem('finpuls-session'))), 'токены удалены');
      noErrors(errors);
      await ctx.close();
    }
    {
      const { ctx, page, errors, ctl } = await newCtx();
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      ctl.state.expireAccess = ctl.state.access;
      ctl.state.access = 'at_never';
      ctl.state.revokeOnRefresh = true;
      await page.locator('.tabbar .tab[data-go="#/calendar"]').click();
      await settle(page, 1200);
      ok((await page.evaluate(() => location.hash)) === '#/login', 'access_revoked при обновлении → экран входа');
      ok(norm(await page.locator('#login-err').innerText()).includes('Администратор выключил вам доступ'), 'на входе — текст message');
      noErrors(errors);
      await ctx.close();
    }

    // ---------- массовое согласование заявок ----------
    console.log('\n▶ Массовое согласование: выбор галочками, подтверждение, итог по каждой заявке');
    const bulkItems = (n) => Array.from({ length: n }, (_, i) => card({
      id: `req_b${i + 1}`, number: String(911 + i), counterparty: `ТОО «Поставщик ${i + 1}»`, amount: 100000 * (i + 1), amount_kzt: 100000 * (i + 1), purpose: `Оплата по счёту № ${i + 1}`,
      budgets: [{ article: 'Аренда', cost_center: null, month: '2026-11', has_limit: true, limit: 2000000, spent: 300000, approved_requests: 200000, available: 1500000, this_request: 100000 * (i + 1), over_by: i === 0 ? 200000 : 0 }],
    }));
    const scrB = '.screen:not(.leaving)';
    const openRequests = async (page) => {
      await page.locator('.tabbar .tab[data-go="#/requests"]').click();
      await page.waitForSelector(`${scrB} .req-list`, { timeout: 8000 });
      await settle(page, 500);
    };
    const sheetText = async (page) => norm(await page.locator('.sheet-wrap').innerText());
    const waitResult = (page) => page.waitForSelector('.sheet-wrap [data-bulk-result]', { timeout: 20000 });
    {
      const { ctx, page, errors, ctl } = await newCtx();
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      await openRequests(page);
      ok((await page.locator(`${scrB} [data-act="bulk-start"]`).count()) === 0, 'одна заявка на решении — кнопки «Выбрать» нет');
      ctl.state.bulk = { items: bulkItems(6), plan: { req_b2: ['next'], req_b3: ['decided'], req_b4: ['stage'], req_b5: ['503'], req_b6: ['failed'] } };
      const B = ctl.state.bulk;
      await page.locator('.tabbar .tab[data-go="#/home"]').click();
      await settle(page, 600);
      await openRequests(page);
      ok((await page.locator(`${scrB} .req-card`).count()) === 6 && (await page.locator(`${scrB} [data-act="bulk-start"]`).isVisible()), 'шесть заявок — есть «Выбрать»');
      ok((await page.locator(`${scrB} .req-check`).first().isHidden()) && (await page.locator(`${scrB} .bulk-bar`).isHidden()) && (await page.locator(`${scrB} .req-solo`).first().isHidden()), 'до «Выбрать» галочек, панели и подписи «только по одной» нет');
      await page.locator(`${scrB} [data-act="bulk-start"]`).click();
      await settle(page, 400);
      const go = page.locator(`${scrB} [data-bulk-go]`);
      ok((await page.locator(`${scrB} .req-check`).count()) === 6 && (await go.isDisabled()) && norm(await go.innerText()).includes('Выберите заявки') && (await page.evaluate(() => document.getElementById('app').classList.contains('nav-hidden'))), 'режим выбора: галочки у строк, внизу панель вместо вкладок, пока ничего не выбрано — кнопка неактивна');
      const solo = page.locator(`${scrB} .req-wrap.unpickable`);
      ok((await solo.count()) === 1 && (await solo.getAttribute('data-id')) === 'req_b1' && norm(await solo.innerText()).includes('только по одной'), 'заявка сверх лимита: галочка неактивна, подпись «только по одной»');
      await solo.click();
      await settle(page, 300);
      ok(norm(await page.locator('.toast').innerText()).includes('Сверх лимита — согласуйте из карточки') && (await page.locator(`${scrB} .req-wrap.picked`).count()) === 0 && (await page.evaluate(() => location.hash)) === '#/requests', 'нажатие на неё — подсказка, в выбор не попадает, карточка не открывается');
      await page.locator(`${scrB} .req-wrap[data-id="req_b2"]`).click();
      await settle(page, 200);
      ok((await page.locator(`${scrB} .req-wrap.picked`).count()) === 1 && norm(await go.innerText()).includes('Согласовать (1) · 200 000 ₸') && (await page.evaluate(() => location.hash)) === '#/requests', 'нажатие на строку ставит галочку: «Согласовать (1) · 200 000 ₸», карточка не открывается');
      await page.locator(`${scrB} .req-wrap[data-id="req_b2"]`).click();
      ok((await page.locator(`${scrB} .req-wrap.picked`).count()) === 0 && (await go.isDisabled()), 'повторное нажатие снимает галочку');
      await page.locator(`${scrB} [data-act="bulk-all"]`).click();
      await settle(page, 200);
      ok((await page.locator(`${scrB} .req-wrap.picked`).count()) === 5 && norm(await page.locator(`${scrB} [data-bulk-count]`).innerText()) === 'Выбрано 5 из 5' && norm(await go.innerText()).includes('Согласовать (5) · 2 000 000 ₸') && norm(await page.locator(`${scrB} [data-act="bulk-all"]`).innerText()) === 'Снять все', '«Выбрать все» — пять заявок (без той, что сверх лимита), сумма 2 000 000 ₸');
      await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 6000 });
      await settle(page, 600); // подсказка доигрывает исчезновение
      await shot(page, '23-zayavki-vybor');
      await go.click();
      await settle(page, 500);
      let sh = await sheetText(page);
      ok(sh.includes('Согласовать 5 заявок на 2 000 000 ₸?') && (await page.locator('.sheet-wrap .bk-row').count()) === 5 && sh.includes('№ 912 · ТОО «Поставщик 2»') && sh.includes('600 000 ₸') && sh.includes('Согласовать 5') && sh.includes('Отмена'), 'подтверждение: список из пяти заявок — номер, контрагент, сумма — и общая сумма');
      await shot(page, '24-zayavki-podtverzhdenie');
      await page.locator('.sheet-wrap .btn[data-act="sheet-close"]').click();
      await settle(page, 500);
      ok((await page.locator('.sheet-wrap').count()) === 0 && (await page.locator(`${scrB} .req-wrap.picked`).count()) === 5 && !(B.log || []).length, '«Отмена» — шторка закрыта, выбор на месте, ни одного запроса не ушло');
      await go.click();
      await settle(page, 400);
      B.delay = 500;
      await page.locator('.sheet-wrap [data-act="bulk-send"]').click();
      await page.waitForFunction(() => /Согласование: [1-4] из 5/.test(document.querySelector('.sheet-wrap [data-bulk-title]')?.textContent || ''), null, { timeout: 8000 });
      ok((await page.locator('.sheet-wrap [data-act="bulk-stop"]').isVisible()) && (await page.locator('.sheet-wrap .bk-row[data-st="ok"]').count()) >= 1, 'отправка: счётчик «Согласование: N из 5», у заявок — состояние, есть «Остановить»');
      await shot(page, '25-zayavki-otpravka');
      await page.locator('.sheet-backdrop').click({ position: { x: 20, y: 20 }, force: true });
      ok((await page.locator('.sheet-wrap').count()) === 1, 'пока идёт отправка, шторка нажатием мимо не закрывается');
      B.delay = 120;
      await waitResult(page);
      await settle(page, 300);
      sh = await sheetText(page);
      const keys = B.log.map((x) => x.key);
      ok(B.log.map((x) => x.id).join(' ') === 'req_b2 req_b3 req_b4 req_b5' && B.maxActive === 1, `запросы уходят по одной, по порядку списка, после 503 очередь остановлена (${B.log.map((x) => x.id).join(' ')})`);
      ok(keys.every((k) => /^[0-9a-f-]{36}$/.test(k || '')) && new Set(keys).size === keys.length && B.log.every((x) => x.body && Object.keys(x.body).length === 0), 'у каждой заявки свой Idempotency-Key, тело запроса — {}');
      ok(sh.includes('Согласовано 1 из 5') && sh.includes('На 200 000 ₸'), 'итог: «Согласовано 1 из 5», сумма согласованных');
      ok(sh.includes('Согласована · дальше Финотдел'), 'согласована, но этап не последний — «дальше Финотдел»');
      ok(/Уже согласована: Самат Ахметов, .*10:12/.test(sh), '409 already_decided — «Уже согласована: Самат Ахметов, …, 10:12» (кто и когда — из details)');
      ok(sh.includes('Сейчас не на вашем этапе — решение не отправлено'), '409 not_awaiting_you — «не на вашем этапе»');
      ok(sh.includes('Не принято: 1С сейчас недоступна') && sh.includes('Не отправлялась'), '503 — «не принято», следующая заявка не отправлялась');
      ok(norm(await page.locator('.sheet-wrap [data-act="bulk-retry"]').innerText()).includes('Повторить неудачные (2)'), 'кнопка «Повторить неудачные (2)» — только то, что можно повторить');
      await shot(page, '26-zayavki-itog');
      const key5 = B.log.find((x) => x.id === 'req_b5').key;
      const before = B.log.length;
      await page.locator('.sheet-wrap [data-act="bulk-retry"]').click();
      await waitResult(page);
      await settle(page, 300);
      sh = await sheetText(page);
      const again = B.log.slice(before);
      ok(again.map((x) => x.id).join(' ') === 'req_b5 req_b6' && again[0].key === key5, 'повтор: только неудачные, у повторяемой заявки тот же Idempotency-Key');
      ok(sh.includes('Согласовано 2 из 5') && sh.includes('Заявка заблокирована другим пользователем: Бекова Г. Т.') && (await page.locator('.sheet-wrap [data-act="bulk-retry"]').count()) === 0, '422 action_failed — текст учёта как есть; повторять больше нечего');
      const m = ctl.calls.length;
      await page.locator('.sheet-wrap [data-act="bulk-done"]').click();
      await settle(page, 1200);
      ok(ctl.calls.slice(m).some((c) => c.path === '/orgs/org_test/requests' && c.query.tab === 'pending'), '«Готово» — список заявок перечитан');
      ok((await page.locator(`${scrB} .req-card`).count()) === 3 && (await page.locator(`${scrB} .scroll.selecting`).count()) === 0 && (await page.locator('.tabbar').isVisible()) && !(await page.evaluate(() => document.getElementById('app').classList.contains('nav-hidden'))), 'согласованные ушли из списка (осталось 3), режим выбора снят, вкладки на месте');
      // «Отмена» в режиме выбора возвращает обычный список
      await page.locator(`${scrB} [data-act="bulk-start"]`).click();
      await page.locator(`${scrB} .req-wrap.pickable`).first().click();
      await page.locator(`${scrB} [data-act="bulk-cancel"]`).click();
      await settle(page, 300);
      ok((await page.locator(`${scrB} .scroll.selecting`).count()) === 0 && (await page.locator(`${scrB} .req-wrap.picked`).count()) === 0 && (await page.locator(`${scrB} .req-card[data-go]`).count()) === 3 && (await page.locator('.tabbar').isVisible()), '«Отмена» — выбор снят, строки снова открывают карточку');
      noErrors(errors);
      await ctx.close();
    }
    {
      // нет ответа: 504 и обрыв — повтор с тем же ключом (6.4)
      const { ctx, page, errors, ctl } = await newCtx();
      ctl.state.bulk = { items: bulkItems(4), plan: { req_b2: ['504-applied'], req_b3: ['abort', 'abort'] } };
      const B = ctl.state.bulk;
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      await openRequests(page);
      await page.locator(`${scrB} [data-act="bulk-start"]`).click();
      await page.locator(`${scrB} [data-act="bulk-all"]`).click();
      await page.locator(`${scrB} [data-bulk-go]`).click();
      await settle(page, 400);
      await page.locator('.sheet-wrap [data-act="bulk-send"]').click();
      await waitResult(page);
      await settle(page, 300);
      let sh = await sheetText(page);
      const of = (id) => B.log.filter((x) => x.id === id);
      ok(of('req_b2').length === 2 && of('req_b2')[0].key === of('req_b2')[1].key && sh.includes('№ 912 · ТОО «Поставщик 2»') && (await page.locator('.sheet-wrap .bk-row[data-bk="req_b2"]').getAttribute('data-st')) === 'ok', '504 без ответа: повтор с тем же ключом — заявка согласована один раз');
      ok(of('req_b3').length === 2 && of('req_b3')[0].key === of('req_b3')[1].key && sh.includes('Нет ответа — неизвестно, принято ли решение') && of('req_b4').length === 0 && sh.includes('Не отправлялась'), 'обрыв связи дважды: «нет ответа», очередь остановлена, следующая заявка не отправлялась');
      ok(sh.includes('Согласовано 1 из 3') && norm(await page.locator('.sheet-wrap [data-act="bulk-retry"]').innerText()).includes('Повторить неудачные (2)'), 'итог «Согласовано 1 из 3», повторить можно две');
      const key3 = of('req_b3')[0].key;
      await page.locator('.sheet-wrap [data-act="bulk-retry"]').click();
      await waitResult(page);
      await settle(page, 300);
      sh = await sheetText(page);
      ok(of('req_b3').length === 3 && of('req_b3')[2].key === key3 && of('req_b4').length === 1 && sh.includes('Согласовано: 3') && sh.includes('Все выбранные заявки согласованы') && (await page.locator('.sheet-wrap [data-act="bulk-retry"]').count()) === 0, 'повтор после обрыва — тем же ключом; итог «Согласовано: 3»');
      await page.locator('.sheet-wrap [data-act="bulk-done"]').click();
      await settle(page, 1200);
      ok((await page.locator(`${scrB} .req-card`).count()) === 1 && (await page.locator(`${scrB} [data-act="bulk-start"]`).count()) === 0, 'в списке осталась одна заявка (сверх лимита) — «Выбрать» больше нет');
      noErrors(errors);
      await ctx.close();
    }
    {
      // «Остановить»: текущая заявка дойдёт, остальные не отправляются
      const { ctx, page, errors, ctl } = await newCtx();
      ctl.state.bulk = { items: bulkItems(5), plan: {}, delay: 900 };
      const B = ctl.state.bulk;
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      await openRequests(page);
      await page.locator(`${scrB} [data-act="bulk-start"]`).click();
      await page.locator(`${scrB} [data-act="bulk-all"]`).click();
      await page.locator(`${scrB} [data-bulk-go]`).click();
      await settle(page, 400);
      await page.locator('.sheet-wrap [data-act="bulk-send"]').click();
      await page.waitForSelector('.sheet-wrap .bk-row[data-st="run"]', { timeout: 8000 });
      await page.locator('.sheet-wrap [data-act="bulk-stop"]').click();
      ok(norm(await page.locator('.sheet-wrap [data-act="bulk-stop"]').innerText()).includes('Остановится после текущей заявки'), '«Остановить» — «Остановится после текущей заявки»');
      await waitResult(page);
      await settle(page, 300);
      const sh = await sheetText(page);
      ok(B.log.length === 1 && sh.includes('Согласовано 1 из 4') && (await page.locator('.sheet-wrap .bk-row[data-st="skip"]').count()) === 3 && norm(await page.locator('.sheet-wrap [data-act="bulk-retry"]').innerText()).includes('(3)'), 'после остановки: одна согласована, три не отправлялись и их можно отправить');
      // итог закрыли нажатием мимо шторки — то же, что «Готово»: список перечитан, режим выбора снят
      const m = ctl.calls.length;
      await page.locator('.sheet-backdrop').click({ position: { x: 20, y: 20 }, force: true });
      await settle(page, 1200);
      ok((await page.locator('.sheet-wrap').count()) === 0 && ctl.calls.slice(m).some((c) => c.path === '/orgs/org_test/requests') && (await page.locator(`${scrB} .req-card`).count()) === 4 && (await page.locator(`${scrB} .scroll.selecting`).count()) === 0, 'итог закрыт нажатием мимо шторки — список перечитан (осталось 4), режим выбора снят');
      noErrors(errors);
      await ctx.close();
    }
    const runSeries = async (page) => {
      await page.locator(`${scrB} [data-act="bulk-start"]`).click();
      await page.locator(`${scrB} [data-act="bulk-all"]`).click();
      await page.locator(`${scrB} [data-bulk-go]`).click();
      await settle(page, 400);
      await page.locator('.sheet-wrap [data-act="bulk-send"]').click();
      await waitResult(page);
      await settle(page, 300);
    };
    {
      // один ключ на заявку, пока нет окончательного ответа: новая серия и карточка шлют тот же ключ
      const { ctx, page, errors, ctl } = await newCtx();
      ctl.state.bulk = { items: bulkItems(5), plan: { req_b2: ['failed'], req_b3: ['503'] } };
      const B = ctl.state.bulk;
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      await openRequests(page);
      await runSeries(page);
      const of = (id) => B.log.filter((x) => x.id === id);
      ok(of('req_b2').length === 1 && of('req_b3').length === 1 && of('req_b4').length === 0, 'первая серия: 422 по одной заявке серию не останавливает, 503 — останавливает');
      const [k2, k3] = [of('req_b2')[0].key, of('req_b3')[0].key];
      await page.locator('.sheet-wrap [data-act="bulk-done"]').click();
      await settle(page, 1200);
      ok((await page.evaluate(() => Object.keys(JSON.parse(sessionStorage.getItem('finpuls-approve-keys') || '{}')).join(','))) === 'org_test/req_b3', 'после серии в памяти остался ключ только той заявки, по которой нет окончательного ответа');
      await page.reload();
      await settle(page, 1500);
      await openRequests(page);
      await runSeries(page);
      ok(of('req_b3').length === 2 && of('req_b3')[1].key === k3, 'новая серия (даже после обновления страницы): заявка без окончательного ответа уходит с прежним ключом');
      ok(of('req_b2').length === 2 && of('req_b2')[1].key !== k2, 'заявка с окончательным отказом (422) в новой серии — с новым ключом');
      ok((await sheetText(page)).includes('Согласовано: 4') && (await page.evaluate(() => sessionStorage.getItem('finpuls-approve-keys'))) === '{}', 'все согласованы — ключей в памяти не осталось');
      noErrors(errors);
      await ctx.close();
    }
    {
      // после обрыва в серии ту же заявку согласуют из карточки — тем же ключом
      const { ctx, page, errors, ctl } = await newCtx();
      ctl.state.bulk = { items: bulkItems(3), plan: { req_b2: ['abort', 'abort'] } };
      const B = ctl.state.bulk;
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      await openRequests(page);
      await runSeries(page);
      const key = B.log[0].key;
      ok(B.log.length === 2 && B.log[1].key === key, 'обрыв: автоматический повтор — с тем же ключом');
      await page.locator('.sheet-wrap [data-act="bulk-done"]').click();
      await settle(page, 1200);
      await page.locator(`${scrB} .req-card[data-go="#/requests/req_b2"]`).click();
      await page.waitForSelector(`${scrB} [data-act="approve"]`, { timeout: 8000 });
      await settle(page, 500);
      await page.locator(`${scrB} [data-act="approve"]`).click();
      await settle(page, 500);
      await page.locator('.sheet-wrap [data-act="approve-confirm"]').click();
      await page.waitForFunction(() => location.hash === '#/requests', null, { timeout: 12000 });
      ok(B.log.length === 3 && B.log[2].id === 'req_b2' && B.log[2].key === key, 'согласование той же заявки из карточки — с тем же ключом, что в серии');
      await settle(page, 2200);
      ok((await page.evaluate(() => sessionStorage.getItem('finpuls-approve-keys'))) === '{}', 'после ответа 200 ключ снят');
      noErrors(errors);
      await ctx.close();
    }
    {
      // токен истёк посреди серии: обновление и повтор той же заявки с тем же ключом, серия идёт дальше
      const { ctx, page, errors, ctl } = await newCtx();
      ctl.state.bulk = { items: bulkItems(4), plan: {} };
      const B = ctl.state.bulk;
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      await openRequests(page);
      let expired = false;
      ctl.override = (call, { st }) => {
        if (!expired && call.path === '/orgs/org_test/requests/req_b3/approve') {
          expired = true;
          st.expireAccess = st.access;
          st.access = 'at_series';
        }
        return false;
      };
      await runSeries(page);
      const b3 = ctl.calls.filter((c) => c.path === '/orgs/org_test/requests/req_b3/approve');
      ok(b3.length === 2 && b3[0].headers['idempotency-key'] === b3[1].headers['idempotency-key'] && b3[0].headers.authorization !== b3[1].headers.authorization && ctl.calls.filter((c) => c.path === '/auth/refresh').length === 1, '401 token_expired посреди серии: одно обновление токена, повтор той же заявки с тем же ключом');
      ok((await sheetText(page)).includes('Согласовано: 3') && B.log.map((x) => x.id).join(' ') === 'req_b2 req_b3 req_b4' && B.maxActive === 1, 'серия дошла до конца: согласованы все три, запросы шли по одному');
      ctl.override = null;
      noErrors(errors);
      await ctx.close();
    }
    {
      // 504, решение не применено: повтор с тем же ключом выполняет его; 422 idempotency_key_reused — «повторите», новый ключ
      const { ctx, page, errors, ctl } = await newCtx();
      ctl.state.bulk = { items: bulkItems(4), plan: { req_b2: ['504'], req_b3: ['reused'] } };
      const B = ctl.state.bulk;
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      await openRequests(page);
      await runSeries(page);
      const of = (id) => B.log.filter((x) => x.id === id);
      const sh = await sheetText(page);
      ok(of('req_b2').length === 2 && of('req_b2')[0].key === of('req_b2')[1].key && (await page.locator('.sheet-wrap .bk-row[data-bk="req_b2"]').getAttribute('data-st')) === 'ok', '504 source_timeout: повтор с тем же ключом — заявка согласована');
      ok(sh.includes('Не удалось отправить решение — повторите') && of('req_b4').length === 1 && sh.includes('Согласовано 2 из 3'), '422 idempotency_key_reused — «Не удалось отправить решение — повторите», серия идёт дальше');
      await page.locator('.sheet-wrap [data-act="bulk-retry"]').click();
      await waitResult(page);
      await settle(page, 300);
      ok(of('req_b3').length === 2 && of('req_b3')[1].key !== of('req_b3')[0].key && (await sheetText(page)).includes('Согласовано: 3'), 'повтор после idempotency_key_reused — с новым ключом, заявка согласована');
      noErrors(errors);
      await ctx.close();
    }
    {
      // переключатель политики лимита (config.js, bulkOverLimit): заявки сверх лимита выбираются наравне с остальными
      const { ctx, page, errors, ctl } = await newCtx();
      await page.route('**/js/config.js', async (r) => {
        const resp = await r.fetch();
        const text = await resp.text();
        await r.fulfill({ response: resp, body: text.replace('bulkOverLimit: false', 'bulkOverLimit: true') });
      });
      ctl.state.bulk = { items: bulkItems(3), plan: {} };
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      await openRequests(page);
      await page.locator(`${scrB} [data-act="bulk-start"]`).click();
      await page.locator(`${scrB} [data-act="bulk-all"]`).click();
      await settle(page, 200);
      ok((await page.locator(`${scrB} .req-wrap.unpickable`).count()) === 0 && (await page.locator(`${scrB} .req-wrap.picked`).count()) === 3, 'bulkOverLimit: true — заявка сверх лимита выбирается вместе с остальными');
      await page.locator(`${scrB} [data-bulk-go]`).click();
      await settle(page, 400);
      const sh = await sheetText(page);
      ok(/Согласовать 3 заявки на [\d ]+ ₸\?/.test(sh) && sh.includes('Сверх лимита: 1 из 3') && sh.includes('Превышение — 200 000 ₸'), 'в подтверждении — «Сверх лимита: 1 из 3», превышение 200 000 ₸');
      noErrors(errors);
      await ctx.close();
    }

    // ---------- календарь по контракту 5.3: просрочка, заявка, разрыв ----------
    console.log('\n▶ Календарь: просроченные поступления, позиция по заявке, разрыв (5.3)');
    {
      const { ctx, page, errors, ctl } = await newCtx();
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      const it = (direction, counterparty, article, amount, o = {}) => ({ direction, counterparty, article, note: null, amount, currency: 'KZT', amount_kzt: amount, source: direction === 'in' ? 'expected_receipt' : 'planned_payment', request_id: null, late: false, in_totals: true, preliminary: false, ...o });
      const late = Array.from({ length: 12 }, (_, k) => it('in', `ТОО «Покупатель ${k + 1}»`, 'Оплата от покупателей', 100000 * (k + 1), { late: true, in_totals: false }));
      const plan = [
        [it('in', 'ТОО «Агро Трейд»', 'Оплата от покупателей', 400000), ...late,
          it('out', null, 'Зарплата', 900000, { source: 'salary' }), it('out', null, null, 200000, { source: 'tax' }),
          it('out', 'ТОО «Тест Поставщик»', 'Материалы', 1500000, { source: 'request', request_id: 'req_1' })],
        [it('out', 'ТОО «Лизинг»', 'Лизинг', 3000000)],
        [it('out', 'ТОО «Склад»', 'Аренда', 300000)],
        [it('in', 'ТОО «Агро Трейд»', 'Оплата от покупателей', 2000000)],
      ];
      let opening = 5000000;
      const days = Array.from({ length: 28 }, (_, i) => {
        const items = plan[i] || [];
        const inflow = items.filter((x) => x.direction === 'in' && x.in_totals).reduce((t, x) => t + x.amount_kzt, 0);
        const outflow = items.filter((x) => x.direction === 'out').reduce((t, x) => t + x.amount_kzt, 0);
        const d = { date: day(i), opening, inflow, outflow, closing: opening + inflow - outflow, gap: opening + inflow - outflow < 0, items };
        opening = d.closing;
        return d;
      });
      // разрыв: во второй день не хватает 200 000, на третий — уже 500 000; сервер называет первый день и его сумму
      ctl.override = (call, { json }) => (call.path === '/orgs/org_test/calendar'
        ? (json(200, { updated_at: T(TODAY, '10:15'), from: TODAY, to: day(27), opening: 5000000, threshold: 0, gap: { date: day(1), shortage: 200000 }, overdue_receipts: { amount: 7800000, count: 12 }, days }), true) : false);
      await page.locator('.tabbar .tab[data-go="#/calendar"]').click();
      await page.waitForSelector('.screen:not(.leaving) .day-card', { timeout: 8000 });
      await settle(page, 500);
      const scr = '.screen:not(.leaving)';
      const strip = norm(await page.locator(`${scr} .gap-strip`).innerText());
      ok(strip.includes('не хватит 200 000 ₸') && (await page.locator(`${scr} .gap-strip`).getAttribute('data-go')) === `#/calendar/${day(1)}`, 'плашка разрыва — день и сумма из gap ответа (200 000 ₸), как на главной');
      const dayTxt = norm(await page.locator(`${scr} .day-card`).innerText());
      ok(dayTxt.includes('+400 000 ₸') && (await page.locator(`${scr} [data-flows="in"] .flow`).count()) === 1 && dayTxt.includes('2 800 000 ₸'), 'просроченные поступления не входят в «Поступления» и в остаток на конец дня');
      const off = page.locator(`${scr} [data-flows="off"]`);
      const offTxt = norm(await off.innerText());
      ok(offTxt.includes('Просроченные поступления') && offTxt.includes('7 800 000 ₸') && offTxt.includes('12 оплат — срок прошёл, деньги не пришли. В остаток дня не входят.') && !offTxt.includes('+'), 'блок «Просроченные поступления»: сумма, число оплат, «в остаток дня не входят», без «+»');
      ok((await off.locator('.flow').count()) === 12 && (await off.locator('.flow:not([hidden])').count()) === 5 && norm(await off.locator('[data-act="flow-more"]').innerText()).includes('Показать все 12'), 'длинный список: пять самых крупных и «Показать все 12»');
      ok(dayTxt.includes('Зарплата') && dayTxt.includes('Налоги') && !dayTxt.includes('Без контрагента'), 'позиция без контрагента: в заголовке статья или вид платежа («Зарплата», «Налоги»)');
      await page.locator(`${scr} .day-card`).evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await shot(page, '21-kalendar-den');
      await off.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await shot(page, '22-kalendar-prosrochka');
      await off.locator('[data-act="flow-more"]').click();
      ok((await off.locator('.flow:not([hidden])').count()) === 12 && (await off.locator('[data-act="flow-more"]').count()) === 0, '«Показать все 12» раскрывает список');
      // позиция по заявке ведёт в карточку заявки, «Назад» — обратно в календарь
      const reqRow = page.locator(`${scr} [data-flow-req]`);
      ok((await reqRow.count()) === 1 && norm(await reqRow.innerText()).includes('по заявке'), 'позиция с request_id — кнопка с меткой «по заявке»');
      const before = ctl.calls.length;
      await reqRow.click();
      await page.waitForFunction(() => location.hash === '#/requests/req_1', null, { timeout: 8000 });
      await settle(page, 900);
      ok(ctl.calls.slice(before).some((c) => c.path === '/orgs/org_test/requests/req_1') && (await page.locator(`${scr} .err-state`).count()) === 0, 'нажатие открывает карточку заявки (GET /requests/req_1)');
      await page.locator('.topbar [data-back]').click();
      await settle(page, 900);
      ok((await page.evaluate(() => location.hash)) === '#/calendar', '«Назад» из заявки возвращает в календарь');
      // день разрыва: «Не хватает» — та же сумма, что в плашке
      await page.locator(`${scr} .gap-strip`).click();
      await settle(page, 700);
      ok(norm(await page.locator(`${scr} .day-card`).innerText()).includes('Не хватает 200 000 ₸'), 'день разрыва: «Не хватает 200 000 ₸» — как в плашке');
      noErrors(errors);
      await ctx.close();
    }
    {
      // 403 от общего прохода — про календарь, без слова «отчёт»
      const { ctx, page, errors, ctl } = await newCtx();
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      const scr = '.screen:not(.leaving)';
      ctl.override = (call, { err }) => (call.path === '/orgs/org_test/calendar' ? (err(403, 'report_unavailable', 'Отчёт недоступен'), true) : false);
      await page.locator('.tabbar .tab[data-go="#/calendar"]').click();
      await page.waitForSelector(`${scr} .err-state`, { timeout: 8000 });
      const gone = norm(await page.locator(`${scr} .err-state`).innerText());
      ok(gone.includes('Календарь сейчас недоступен') && gone.includes('включает администратор ФинПульса') && !/[Оо]тчёт/.test(gone), '403 на календаре — «Календарь сейчас недоступен», без слова «отчёт»');
      ctl.override = null;
      await page.locator(`${scr} .err-state [data-act="retry"]`).click();
      await settle(page, 900);
      ok(await page.locator(`${scr} .wk-table`).isVisible(), '«Обновить» → календарь открылся');
      noErrors(errors);
      await ctx.close();
    }

    // ---------- 1е-2. проекты: отбор по категории ----------
    console.log('\n▶ «Проекты»: отбор по категории (поле categories, параметр category)');
    {
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { orgs: [{ ...ORG, reports: ['projects', 'debtors'] }] });
      const st = ctl.state;
      const scr = '.screen:not(.leaving)';
      const BOTH = [{ id: 'cat_p', name: 'Проектная' }, { id: 'cat_r', name: 'Регулярная' }];
      st.prjCats = BOTH;
      const prjCalls = () => ctl.calls.filter((c) => c.method === 'GET' && c.path === '/orgs/org_test/reports/projects');
      const last = () => prjCalls().slice(-1)[0];
      const rows = () => page.locator(`${scr} .prj`);
      const catTexts = async () => (await page.locator(`${scr} [data-prj-cats] .chip`).allInnerTexts()).map((x) => norm(x).replace(/\s+/g, ' ').trim());
      const catOn = async () => norm(await page.locator(`${scr} [data-prj-cats] .chip.on`).innerText()).replace(/\s+/g, ' ').trim();
      const cat = (id) => page.locator(`${scr} [data-prj-cat="${id}"]`);
      const statusChip = (v) => page.locator(`${scr} .chips:not([data-prj-cats]) [data-act="prj-chip"][data-k="status"][data-v="${v}"]`);
      const waitRows = (k) => page.waitForFunction((n) => document.querySelectorAll('.screen:not(.leaving) .prj').length === n, k, { timeout: 8000 });
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      await page.locator('.tabbar .tab[data-go="#/reports"]').click();
      await page.waitForSelector(`${scr} [data-prj-totals]`, { timeout: 8000 });
      await settle(page, 500);
      ok(JSON.stringify(await catTexts()) === JSON.stringify(['Все', 'Проектная 2', 'Регулярная 5']) && (await catOn()) === 'Все', `ряд категорий из ответа: «Все» и категории с числом проектов (${(await catTexts()).join(' · ')})`);
      ok(JSON.stringify(last().query) === JSON.stringify({ limit: '50' }), 'первый запрос — без category');
      const order = await page.evaluate(() => {
        const y = (q) => document.querySelector(`.screen:not(.leaving) ${q}`).getBoundingClientRect();
        const cats = y('[data-prj-cats]');
        const st2 = y('.chips:not([data-prj-cats])');
        return cats.bottom <= y('[data-prj-totals]').top && y('[data-prj-totals]').bottom <= st2.top && y('.seg').bottom <= cats.top;
      });
      ok(order, 'ряд категорий — под переключателем отчётов и над итогами; ряд статусов — под итогами');
      const fits = await page.evaluate(() => {
        const r = document.querySelector('.screen:not(.leaving) [data-prj-cats]');
        return r.scrollWidth <= r.clientWidth + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
      });
      ok(fits, 'три чипа категорий помещаются в ширину экрана, горизонтальной прокрутки страницы нет');

      await cat('cat_p').click();
      await waitRows(2);
      ok(last().query.category === 'cat_p' && !last().query.status && (await catOn()) === 'Проектная 2' && norm(await page.locator('[data-prj-totals]').innerText()).includes('2 проекта'), 'чип «Проектная» → category=cat_p; строки и итоги — по категории');
      await shot(page, '29-proekty-kategoriya');
      await statusChip('done').click();
      await settle(page, 800);
      ok(last().query.category === 'cat_p' && last().query.status === 'done' && JSON.stringify(await catTexts()) === JSON.stringify(['Все', 'Проектная 2', 'Регулярная 2']), `категория сочетается со статусом; числа в чипах — по текущему отбору без категории (${(await catTexts()).join(' · ')})`);
      await page.locator(`${scr} [data-act="prj-chip"][data-k="debtOnly"]`).click();
      await settle(page, 800);
      ok(last().query.category === 'cat_p' && last().query.status === 'done' && last().query.debt_only === 'true', 'категория сочетается с «Есть долг»');
      await page.locator(`${scr} [data-act="prj-chip"][data-k="debtOnly"]`).click();
      await settle(page, 700);
      await statusChip('').click();
      await settle(page, 700);
      await page.locator(`${scr} [data-act="prj-chip"][data-k="withoutId"]`).click();
      await page.waitForSelector(`${scr} [data-prj-empty]`, { timeout: 8000 });
      ok(last().query.category === 'cat_p' && last().query.without_id === 'true' && norm(await page.locator('[data-prj-empty]').innerText()).includes('Проектов не найдено'), 'категория сочетается с «Без ID»; пусто — «Проектов не найдено»');
      await page.locator('[data-prj-empty] [data-act="prj-reset"]').click();
      await waitRows(8);
      ok(JSON.stringify(last().query) === JSON.stringify({ limit: '50' }) && (await catOn()) === 'Все', '«Сбросить отборы» снимает и категорию');

      // категория переживает шторку (период, сортировка), «Сбросить» в шторке её снимает
      await cat('cat_r').click();
      await waitRows(5);
      ok((await page.locator(`${scr} .prj.noid`).count()) === 1 && (await page.locator(`${scr} .prj[data-prj="prj_demo_6c3d"]`).count()) === 0, 'реализация без ID участвует в категории наравне с проектами; проекта без категории в ней нет');
      await page.locator('[data-prj-period]').click();
      await settle(page, 450);
      ok((await page.locator('.sheet [data-prj-cat], .sheet [data-k="category"]').count()) === 0, 'в шторке «Отборы и сортировка» категории нет — она выбирается чипами на экране');
      await page.locator('.sheet [data-act="prj-draft"][data-k="sort"][data-v="revenue"]').click();
      await page.locator('.sheet [data-act="prj-apply"]').click();
      await settle(page, 900);
      ok(last().query.category === 'cat_r' && last().query.sort === 'revenue' && (await catOn()) === 'Регулярная 5', 'после «Показать» в шторке категория остаётся выбранной');
      await cat('cat_r').click();
      await waitRows(8);
      ok(!last().query.category && (await catOn()) === 'Все', 'повторное нажатие на выбранную категорию возвращает «Все»');
      await page.locator('[data-prj-period]').click();
      await settle(page, 450);
      await page.locator('.sheet [data-act="prj-reset"]').click();
      await settle(page, 900);

      // выбранную категорию удалили в 1С: сервер отвечает 422 по category — сброс на «Все» с сообщением
      await cat('cat_r').click();
      await waitRows(5);
      st.prjCats = [BOTH[0]];
      let mark = prjCalls().length;
      await statusChip('in_work').click();
      await page.waitForFunction(() => document.querySelector('.toast.show'), null, { timeout: 8000 });
      await settle(page, 600);
      let after = prjCalls().slice(mark);
      ok(after.length === 2 && after[0].query.category === 'cat_r' && !after[1].query.category && after[1].query.status === 'in_work', '422 по category → повтор запроса без категории, остальные отборы сохранены');
      ok(norm(await page.locator('.toast').innerText()).includes('Категория недоступна. Показаны все проекты.') && (await catOn()) === 'Все' && JSON.stringify(await catTexts()) === JSON.stringify(['Все', 'Проектная 0']), `сообщение «Категория недоступна…», выбрано «Все», ряд — по новому списку (${(await catTexts()).join(' · ')})`);
      ok((await page.locator(`${scr} .err-state`).count()) === 0 && (await rows().count()) === 4, 'экрана ошибки нет, список показан');
      await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 6000 });

      // сервер принял запрос (200), но выбранной категории в списке уже нет
      st.prjCats = BOTH;
      await statusChip('').click();
      await waitRows(8);
      await cat('cat_r').click();
      await waitRows(5);
      st.prjCats = [BOTH[0]];
      st.prjCatsLax = true;
      mark = prjCalls().length;
      await statusChip('done').click();
      await page.waitForFunction(() => document.querySelector('.toast.show'), null, { timeout: 8000 });
      await settle(page, 600);
      after = prjCalls().slice(mark);
      ok(after.length === 2 && !after[1].query.category && norm(await page.locator('.toast').innerText()).includes('Этой категории больше нет. Показаны все проекты.') && (await catOn()) === 'Все', 'категории нет в списке ответа → «Этой категории больше нет…», запрос повторён без неё');
      st.prjCatsLax = false;
      await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 6000 });

      // база откатилась на версию без категорий: 422 «Неизвестный параметр» без details.fields — сброс, ряд исчезает
      st.prjCats = BOTH;
      await statusChip('').click();
      await waitRows(8);
      await cat('cat_p').click();
      await waitRows(2);
      st.prjCats = undefined;
      mark = prjCalls().length;
      await statusChip('done').click();
      await page.waitForFunction(() => document.querySelector('.toast.show'), null, { timeout: 8000 });
      await settle(page, 600);
      after = prjCalls().slice(mark);
      ok(after.length === 2 && after[0].query.category === 'cat_p' && !after[1].query.category && (await page.locator(`${scr} [data-prj-cats]`).count()) === 0 && (await rows().count()) === 4, '422 «Неизвестный параметр» → категория сброшена, ряда категорий нет, список показан');
      mark = prjCalls().length;
      await statusChip('').click();
      await waitRows(8);
      ok(prjCalls().slice(mark).every((c) => !('category' in c.query)), 'дальше параметр category не уходит');

      // 422 на период при выбранной категории: виноваты даты — категория остаётся
      st.prjCats = BOTH;
      await statusChip('in_work').click();
      await waitRows(4);
      await statusChip('').click();
      await waitRows(8);
      await cat('cat_r').click();
      await waitRows(5);
      await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 6000 });
      st.prj422 = true;
      await page.locator('[data-prj-period]').click();
      await settle(page, 400);
      await page.locator('.sheet [data-act="prj-draft"][data-k="period"][data-v="custom"]').click();
      await page.locator('.sheet [data-prj-from]').fill('2026-07-01');
      await page.locator('.sheet [data-prj-to]').fill('2026-09-30');
      await page.locator('.sheet [data-act="prj-apply"]').click();
      await settle(page, 1200);
      st.prj422 = false;
      ok(norm(await page.locator('.toast').innerText()).includes('Период не подошёл') && last().query.category === 'cat_r' && (await catOn()) === 'Регулярная 5' && (await rows().count()) === 5 && norm(await page.locator('[data-prj-period]').innerText()).includes('1 янв — 30 ноя 2026'), '422 по датам при выбранной категории — сброшен период, категория осталась, список по ней');

      // весь справочник: категория с нулём проектов приглушена, но остаётся в ряду и нажимается; выбранная не приглушается
      await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 6000 });
      st.prjCats = [...BOTH, { id: 'cat_c', name: 'Консалтинг' }];
      await page.locator('[data-prj-period]').click();
      await settle(page, 400);
      await page.locator('.sheet [data-act="prj-reset"]').click();
      await settle(page, 600);
      await statusChip('in_work').click();
      await waitRows(4);
      const zero = async () => (await page.locator(`${scr} [data-prj-cats] .chip.zero`).allInnerTexts()).map((x) => norm(x).replace(/\s+/g, ' ').trim());
      ok(JSON.stringify(await catTexts()) === JSON.stringify(['Все', 'Проектная 0', 'Регулярная 3', 'Консалтинг 0']) && JSON.stringify(await zero()) === JSON.stringify(['Проектная 0', 'Консалтинг 0']), `категории с нулём в текущем отборе остаются в ряду, приглушены (${(await catTexts()).join(' · ')})`);
      await cat('cat_c').click();
      await page.waitForSelector(`${scr} [data-prj-empty]`, { timeout: 8000 });
      const seen = async (sel) => page.evaluate((q) => {
        const c = document.querySelector(`.screen:not(.leaving) ${q}`).getBoundingClientRect();
        return c.left >= 0 && c.right <= document.documentElement.clientWidth;
      }, sel);
      ok(await seen('[data-prj-cats] .chip.on'), 'выбранный чип за правым краем ряда после перерисовки прокручен в видимую часть');
      ok(last().query.category === 'cat_c' && (await catOn()) === 'Консалтинг 0' && JSON.stringify(await zero()) === JSON.stringify(['Проектная 0']) && (await page.locator('.toast.show').count()) === 0, 'категория с нулём выбирается: «Проектов не найдено», выбранный чип не приглушён и не сброшен');
      noErrors(errors);
      await ctx.close();
    }

    // ---------- 2б. лист «Счета» (5.2) ----------
    console.log('\n▶ Лист «Счета»: счета и кассы, итого, депозиты отдельно (5.2)');
    {
      // отчёты accounts и calendar в списке reports — вкладка «Отчёты» их не показывает и сама не запрашивает
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { orgs: [{ ...ORG, reports: ['cash-flow', 'accounts', 'calendar', 'debtors'] }] });
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      const scr = '.screen:not(.leaving)';
      const acc = (o) => ({ note: null, number_masked: null, currency: 'KZT', deposit: false, balance_kzt: o.balance, ...o });
      // порядок сервера нарочно перемешан: касса, депозит, счёт, валютный счёт, валютный депозит
      const full = {
        updated_at: T(TODAY, '10:15'), date: TODAY, total_kzt: 5000000, deposits_kzt: 20000250,
        items: [
          acc({ id: 'a1', type: 'cash', name: 'Касса офиса', balance: 200000 }),
          acc({ id: 'a2', type: 'bank', name: 'Halyk Bank', note: 'Депозит до востребования', number_masked: 'KZ•• 7001', balance: 10000000, deposit: true }),
          acc({ id: 'a3', type: 'bank', name: 'Тест Банк', note: 'Основной счёт', number_masked: 'KZ•• 0001', balance: 3300000 }),
          acc({ id: 'a4', type: 'bank', name: 'Тест Банк', number_masked: 'KZ•• 0840', currency: 'USD', balance: 3000, balance_kzt: 1500000 }),
          acc({ id: 'a5', type: 'bank', name: 'ForteBank', number_masked: 'KZ•• 7002', currency: 'USD', balance: 20000.5, balance_kzt: 10000250, deposit: true }),
        ],
      };
      let answer = (h) => h.json(200, full);
      let delay = 0;
      ctl.override = (call, h) => {
        if (call.path !== '/orgs/org_test/accounts') return false;
        if (delay) setTimeout(() => answer(h), delay);
        else answer(h);
        return true;
      };
      const open = async () => {
        await page.locator(`${scr} .hero`).click();
        await settle(page, 700);
      };
      const close = async () => {
        await page.locator('.sheet-wrap .btn[data-act="sheet-close"]').click();
        await settle(page, 500);
      };
      const sheetText = async () => norm(await page.locator('.sheet-wrap .sheet-body').innerText());

      await open();
      const main = (await page.locator('.sheet-wrap [data-acc="main"] .acc-row').allInnerTexts()).map((x) => norm(x).replace(/\s+/g, ' ').trim());
      ok(main.length === 3 && main[0].startsWith('Тест Банк Основной счёт') && main[1].includes('3 000 USD') && main[2].startsWith('Касса офиса'), `обычные счета: сначала банковские, затем касса; депозитов среди них нет (${main.join(' | ')})`);
      ok(main[1].includes('1 500 000 ₸') && main[1].includes('KZ•• 0840'), 'валютный счёт: сумма в тенге, в подписи — остаток в валюте счёта и хвост номера');
      ok(norm(await page.locator('.sheet-wrap .acc-total').innerText()).replace(/\s+/g, ' ').includes('Итого 5 000 000 ₸'), '«Итого» = total_kzt (5 000 000 ₸), депозиты в него не входят');
      ok(norm(await page.locator(`${scr} .hero`).innerText()).includes('5 000 000'), '«Итого» в листе — та же цифра, что «Деньги на сегодня» на главной');
      const dep = page.locator('.sheet-wrap [data-acc="deposits"]');
      const depRows = (await dep.locator('.acc-row').allInnerTexts()).map((x) => norm(x).replace(/\s+/g, ' ').trim());
      ok(depRows.length === 2 && depRows[0].startsWith('Halyk Bank') && depRows[1].startsWith('ForteBank') && depRows[1].includes('20 000,50 USD'), `депозиты — отдельным блоком, в порядке сервера (${depRows.join(' | ')})`);
      ok(norm(await dep.locator('.acc-dep-head').innerText()).replace(/\s+/g, ' ').includes('Депозиты 20 000 250 ₸') && norm(await dep.innerText()).includes('В итог и в «Деньги на сегодня» не входят'), 'у блока — сумма депозитов (20 000 250 ₸) и подпись, что в итог они не входят');
      const order = await page.evaluate(() => {
        const y = (q) => document.querySelector(q).getBoundingClientRect().top;
        return y('.sheet-wrap [data-acc="main"]') < y('.sheet-wrap .acc-total') && y('.sheet-wrap .acc-total') < y('.sheet-wrap [data-acc="deposits"]');
      });
      ok(order, 'порядок в листе: счета и кассы → «Итого» → «Депозиты»');
      ok(!/депозит(?! до востребования)/.test((await sheetText()).replace('Депозиты', '')), 'слово «депозит» к подписи счёта больше не дописывается');
      ok(norm(await page.locator('.sheet-wrap [data-acc-sub]').innerText()).trim() === 'На 10:15 · ТОО «Тест»', 'под заголовком — «На 10:15» (время ответа, updated_at) и организация');
      await shot(page, '27-scheta-s-depozitami');
      await close();

      // сервер без поля deposits_kzt — сумму депозитов приложение складывает само
      answer = (h) => h.json(200, { ...full, deposits_kzt: undefined });
      await open();
      ok(norm(await page.locator('.sheet-wrap .acc-dep-head').innerText()).replace(/\s+/g, ' ').includes('Депозиты 20 000 250 ₸'), 'поля deposits_kzt нет — сумма депозитов сложена из счетов (20 000 250 ₸)');
      await close();

      // без депозитов — блока нет
      // время компании +03:00, телефон в Алматы (+05:00): в подписи — время из ответа, без пересчёта; валюта null
      answer = (h) => h.json(200, { ...full, updated_at: `${TODAY}T08:15:00+03:00`, deposits_kzt: 0, items: full.items.filter((a) => !a.deposit).map((a) => (a.id === 'a3' ? { ...a, currency: null } : a)) });
      await open();
      ok((await page.locator('.sheet-wrap [data-acc="deposits"]').count()) === 0 && (await page.locator('.sheet-wrap .acc-row').count()) === 3, 'депозитов нет (deposits_kzt: 0) — блока «Депозиты» нет');
      ok(norm(await page.locator('.sheet-wrap [data-acc-at]').innerText()) === 'На 08:15', 'время в подписи — время компании из ответа (08:15 при +03:00), не пояс телефона');
      const nocur = norm(await page.locator('.sheet-wrap [data-acc="main"] .acc-row').first().innerText()).replace(/\s+/g, ' ').trim();
      ok(nocur === 'Тест Банк Основной счёт · KZ•• 0001 3 300 000 ₸', `currency: null — подпись без валюты и без «null» (${nocur})`);
      await close();

      // счетов нет совсем
      answer = (h) => h.json(200, { updated_at: T(TODAY, '10:15'), date: TODAY, items: [], total_kzt: 0 });
      await open();
      ok((await sheetText()).includes('Счетов и касс с остатком нет') && norm(await page.locator('.sheet-wrap .acc-total').innerText()).replace(/\s+/g, ' ').includes('Итого 0 ₸'), 'пустой список — «Счетов и касс с остатком нет», итого 0 ₸');
      await close();

      // 501: база остатков ещё не отдаёт — спокойный текст в листе, не ошибка
      answer = (h) => h.err(501, 'not_implemented', 'Раздел будет позже');
      await open();
      let off = await sheetText();
      ok((await page.locator('.sheet-wrap [data-acc-off="later"]').count()) === 1 && off.includes('Остатки по счетам появятся после обновления базы'), '501 → «Остатки по счетам появятся после обновления базы»');
      ok((await page.locator('.toast.show').count()) === 0 && (await page.locator('.sheet-wrap .acc-row, .sheet-wrap .acc-total').count()) === 0 && !/ошибк/i.test(off), '501: без всплывающей ошибки, без пустого списка и «Итого»');
      await shot(page, '28-scheta-posle-obnovleniya-bazy');
      await close();

      // 403: раздел выключен в 1С или нет прав
      answer = (h) => h.err(403, 'report_unavailable', 'Отчёт недоступен');
      await open();
      off = await sheetText();
      ok((await page.locator('.sheet-wrap [data-acc-off="off"]').count()) === 1 && off.includes('Остатки по счетам сейчас недоступны') && off.includes('включает администратор ФинПульса') && !/[Оо]тчёт/.test(off), '403 report_unavailable → «Остатки по счетам сейчас недоступны», без слова «отчёт»');
      ok((await page.locator('.toast.show').count()) === 0, '403: без всплывающей ошибки');
      await close();

      // 503 — как раньше: всплывающая ошибка, лист не открывается
      answer = (h) => h.err(503, 'source_unavailable', 'Нет связи с учётом компании', undefined, { 'Retry-After': '60' });
      await open();
      ok((await page.locator('.sheet-wrap').count()) === 0 && norm(await page.locator('.toast').innerText()).includes('1С сейчас недоступна'), '503 → всплывающее «1С сейчас недоступна», лист не открывается');
      await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 6000 });

      // учёт отвечает не сразу: два нажатия подряд — один запрос
      answer = (h) => h.json(200, full);
      delay = 900;
      const before = ctl.calls.length;
      await page.locator(`${scr} .hero`).click();
      await page.locator(`${scr} .hero`).click();
      await page.waitForSelector('.sheet-wrap [data-acc="main"]', { timeout: 8000 });
      await settle(page, 400);
      ok(ctl.calls.slice(before).filter((c) => c.path === '/orgs/org_test/accounts').length === 1, 'два нажатия, пока учёт отвечает, — один запрос /accounts');
      await close();
      delay = 0;
      ctl.override = null;

      // вкладка «Отчёты»: accounts и calendar из списка reports пропущены
      await page.locator('.tabbar .tab[data-go="#/reports"]').click();
      await settle(page, 900);
      const segs = (await page.locator(`${scr} .seg-btn`).allInnerTexts()).map((x) => norm(x).trim());
      ok(JSON.stringify(segs) === JSON.stringify(['ДДС', 'Должники']), `accounts и calendar в reports — на вкладке «Отчёты» только известные отчёты (${segs.join(' · ')})`);
      ok((await page.locator(`${scr} .err-state`).count()) === 0 && !ctl.calls.some((c) => /\/reports\/(accounts|calendar)/.test(c.path)), 'пустой или сломанной плитки нет, запросы /reports/accounts и /reports/calendar не уходят');
      noErrors(errors);
      await ctx.close();
    }
    {
      // в списке reports только accounts и calendar — вкладка «Отчёты» как без отчётов: заглушка, не пустой переключатель
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { orgs: [{ ...ORG, reports: ['accounts', 'calendar'] }] });
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      await page.locator('.tabbar .tab[data-go="#/reports"]').click();
      await settle(page, 900);
      const txt = norm(await page.locator('.screen:not(.leaving) .scroll').innerText());
      ok(txt.includes('Раздел появится в следующей версии') && (await page.locator('.screen:not(.leaving) .seg').count()) === 0 && !ctl.calls.some((c) => /\/reports\//.test(c.path)), 'в reports только accounts и calendar — заглушка вкладки, запросов отчётов нет');
      // обычный ответ имитатора (без депозитов) — лист как раньше
      await page.locator('.tabbar .tab[data-go="#/home"]').click();
      await settle(page, 700);
      await page.locator('.screen:not(.leaving) .hero').click();
      await settle(page, 700);
      ok((await page.locator('.sheet-wrap .acc-row').count()) === 2 && (await page.locator('.sheet-wrap [data-acc="deposits"]').count()) === 0, 'ответ без депозитов — два счёта и «Итого», как раньше');
      noErrors(errors);
      await ctx.close();
    }

    // ---------- 3. 1С недоступна ----------
    console.log('\n▶ Учёт недоступен (503, 504, сеть)');
    {
      const { ctx, page, errors, ctl } = await newCtx();
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      ctl.override = (call, { err }) => (call.path === '/orgs/org_test/calendar' ? (err(503, 'source_unavailable', 'Учёт компании не отвечает', undefined, { 'Retry-After': '30' }), true) : false);
      await page.locator('.tabbar .tab[data-go="#/calendar"]').click();
      await settle(page, 900);
      ok(norm(await page.locator('.err-state').innerText()).includes('1С сейчас недоступна'), '503 source_unavailable — «1С сейчас недоступна» и «Обновить»');
      await shot(page, '06-1s-nedostupna');
      ctl.override = null;
      await page.locator('.err-state [data-act="retry"]').click();
      await settle(page, 900);
      ok(await page.locator('.wk-table').isVisible(), '«Обновить» → календарь из GET /calendar');
      const dayTxt = norm(await page.locator('.screen:not(.leaving) .day-card').innerText());
      ok(dayTxt.includes('−310 000 ₸') && dayTxt.includes('600 USD') && !dayTxt.includes('сумма в'), 'валютная позиция — в тенге (amount_kzt), валюта в подписи');
      ctl.override = (call, { err }) => (call.path === '/orgs/org_test/reports/cash-flow' ? (err(504, 'source_timeout', 'Учёт не успел ответить'), true) : false);
      await page.locator('.tabbar .tab[data-go="#/reports"]').click();
      await settle(page, 900);
      ok(norm(await page.locator('.err-state').innerText()).includes('Сервер долго не отвечает'), '504 source_timeout — «долго не отвечает» и «Обновить»');
      ctl.override = (call, { route }) => (call.path === '/orgs/org_test/summary' ? (route.abort('failed'), true) : false);
      await page.locator('.tabbar .tab[data-go="#/home"]').click();
      await settle(page, 900);
      ok(norm(await page.locator('.err-state').innerText()).includes('Нет связи'), 'обрыв связи — «Нет связи»');
      noErrors(errors);
      await ctx.close();
    }

    // ---------- 4. решения ----------
    console.log('\n▶ Решения по заявке (контракт, 6.4–6.7)');
    {
      const { ctx, page, errors, ctl } = await newCtx();
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      const open = async () => {
        await page.evaluate(() => { location.hash = '#/requests/req_1'; });
        await settle(page, 800);
      };
      const approve = async () => {
        await page.locator('.screen:not(.leaving) [data-act="approve"]').click();
        await settle(page, 400);
        await page.locator('.sheet [data-act="approve-confirm"]').click();
      };
      await open();
      const txt = norm(await page.locator('.screen:not(.leaving)').innerText());
      ok(txt.includes('Израсходовано') && txt.includes('500 000 ₸'), 'бюджет: «Израсходовано» = spent + approved_requests');
      ok(txt.includes('Ещё не дошла очередь') && txt.includes('группа согласующих'), 'маршрут: этап «waiting» и этап группы');
      ok(txt.includes('Тест Банк · KZ•• 0001'), 'счёт оплаты из pay_from');
      // already_decided — кто и когда приходят в details, карточку не перечитываем
      ctl.override = (call, { err }) => (call.path.endsWith('/approve')
        ? (err(409, 'already_decided', 'Заявку уже согласовал Тест Заместитель 11.11.2026 в 10:05', { decided_by: 'Тест Заместитель', decided_at: T(TODAY, '10:05'), decision: 'approved' }), true) : false);
      const cardReads = () => ctl.calls.filter((c) => c.method === 'GET' && c.path === '/orgs/org_test/requests/req_1').length;
      const readsBefore = cardReads();
      await approve();
      await settle(page, 900);
      ok(norm(await page.locator('.decision-state').innerText()).includes('Заявка уже согласована: Тест Заместитель, сегодня, 10:05'), '409 already_decided — кто и когда из details.decided_by / decided_at');
      ok(cardReads() === readsBefore, 'карточка после 409 не перечитывается');
      await shot(page, '07-uzhe-soglasovano');
      await page.locator('.sheet [data-act="decision-to-list"]').click();
      await settle(page, 800);
      // not_awaiting_you
      ctl.override = (call, { err }) => (call.path.endsWith('/approve') ? (err(409, 'not_awaiting_you', 'Заявка не на вашем этапе'), true) : false);
      await open();
      await approve();
      await settle(page, 700);
      ok(norm(await page.locator('.decision-state').innerText()).includes('Нет прав на это решение'), '409 not_awaiting_you — «не на вашем этапе»');
      await page.locator('.sheet [data-act="sheet-close"]').click();
      await settle(page, 400);
      // action_failed
      ctl.override = (call, { err }) => (call.path.endsWith('/approve') ? (err(422, 'action_failed', 'Закрыт период: оперативный день утверждён'), true) : false);
      await approve();
      await settle(page, 700);
      const af = norm(await page.locator('.decision-state').innerText());
      ok(af.includes('Учёт не принял решение') && af.includes('Закрыт период: оперативный день утверждён'), '422 action_failed — текст message из учёта');
      await shot(page, '08-uchet-ne-prinyal');
      await page.locator('.sheet [data-act="sheet-close"]').click();
      await settle(page, 400);
      // обрыв связи → «Повторить» с тем же ключом → успех; «Отправляется…» до ответа
      let attempt = 0;
      ctl.override = (call, { route }) => {
        if (!call.path.endsWith('/approve')) return false;
        attempt++;
        if (attempt === 1) {
          route.abort('failed');
          return true;
        }
        setTimeout(() => {
          ctl.state.decided = true;
          route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Idempotent-Replayed', 'Idempotent-Replayed': 'true' }, body: JSON.stringify(card({ status: 'approved', my_action: 'approved', my_decision_at: T(TODAY, '10:20') })) });
        }, 1200);
        return true;
      };
      await approve();
      await settle(page, 700);
      ok(norm(await page.locator('.decision-state').innerText()).includes('Нет связи'), 'обрыв связи — «Нет связи», «Повторить»');
      await page.locator('.sheet [data-act="decision-retry"]').click();
      await settle(page, 300);
      ok(norm(await page.locator('.sheet .btn.loading').innerText()).includes('Отправляется'), '«Отправляется…» до ответа');
      ok(!(await page.locator('.done-overlay').count()), 'до ответа — без «Согласовано»');
      await shot(page, '09-otpravlyaetsya');
      await page.waitForSelector('.done-overlay.show', { timeout: 5000 });
      const done = norm(await page.locator('.done-overlay').innerText());
      ok(done.includes('Заявка согласована') && done.includes('14 ноября'), 'status: approved → «Заявка согласована», платёж на pay_by');
      const dec = ctl.calls.filter((c) => c.path.endsWith('/approve'));
      const keys = dec.slice(-2).map((c) => c.headers['idempotency-key']);
      ok(keys.length === 2 && keys[0] && keys[0] === keys[1], 'повтор с тем же Idempotency-Key');
      ok(dec.length >= 2 && dec[0].headers['idempotency-key'] !== keys[0], 'новое нажатие — новый ключ');
      ok(dec.every((c) => c.headers['x-app-version'] === APP_VERSION && c.method === 'POST'), 'POST …/approve с X-App-Version');
      await page.waitForFunction(() => location.hash === '#/requests');
      await settle(page, 1400);
      ok(await page.locator('.screen:not(.leaving) .req-card').count() === 0, 'заявка ушла из «На согласовании»');
      noErrors(errors);
      await ctx.close();
    }
    {
      const { ctx, page, errors, ctl } = await newCtx();
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      await page.evaluate(() => { location.hash = '#/requests/req_1'; });
      await settle(page, 800);
      await page.locator('.screen:not(.leaving) [data-act="reject"]').click();
      await settle(page, 400);
      await page.locator('.sheet .chip[data-v="Нужен другой поставщик"]').click();
      await page.locator('.sheet [data-act="reject-confirm"]').click();
      await page.waitForSelector('.done-overlay.show', { timeout: 5000 });
      const rj = ctl.calls.find((c) => c.path.endsWith('/reject'));
      ok(rj && rj.body.comment === 'Нужен другой поставщик' && rj.headers['idempotency-key'], 'POST …/reject с комментарием и Idempotency-Key');
      ok(norm(await page.locator('.done-title').innerText()) === 'Заявка отклонена', '«Заявка отклонена»');
      noErrors(errors);
      await ctx.close();
    }

    // ---------- 4а. отправить директору ----------
    console.log('\n▶ «Отправить директору»: доп. согласование директором (контракт, 6.8)');
    {
      const { ctx, page, errors, ctl } = await newCtx();
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      const scr = '.screen:not(.leaving)';
      const open = async () => {
        await page.evaluate(() => { location.hash = '#/requests/req_1'; });
        await settle(page, 800);
      };
      const cardReads = () => ctl.calls.filter((c) => c.method === 'GET' && c.path === '/orgs/org_test/requests/req_1').length;
      const sends = () => ctl.calls.filter((c) => c.path.endsWith('/to-director'));
      const noToast = () => page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 6000 });
      // старая база: полей нет — нет ни кнопки, ни метки, «Согласовать» во всю ширину
      await page.evaluate(() => { location.hash = '#/requests'; });
      await settle(page, 800);
      ok(await page.locator(`${scr} .req-card`).count() === 1 && await page.locator(`${scr} [data-dir-tag]`).count() === 0, 'база без полей 1.16.8: в списке метки «Доп. согласование» нет');
      await open();
      ok(await page.locator(`${scr} [data-act="approve"]`).isVisible() && await page.locator(`${scr} [data-act="to-director"]`).count() === 0 && await page.locator(`${scr} .actionbar.ab-dir`).count() === 0, 'база без полей 1.16.8: кнопки «Отправить директору» нет');
      const wide = await page.evaluate(() => {
        const b = document.querySelector('.screen:not(.leaving) .actionbar .ab-main').getBoundingClientRect();
        const bar = document.querySelector('.screen:not(.leaving) .actionbar').getBoundingClientRect();
        return b.width > bar.width * 0.8;
      });
      ok(wide, 'без кнопки директора «Согласовать» занимает всю ширину, как раньше');
      // can_send_to_director: false — кнопки тоже нет
      ctl.override = (call, { json }) => (call.method === 'GET' && call.path === '/orgs/org_test/requests/req_1' ? (json(200, card({ can_send_to_director: false, director: null })), true) : false);
      await page.evaluate(() => { location.hash = '#/requests'; });
      await settle(page, 600);
      await open();
      ok(await page.locator(`${scr} [data-act="to-director"]`).count() === 0, 'can_send_to_director: false — кнопки нет');
      ctl.override = null;

      // последний этап маршрута: кнопка рядом с «Согласовать»
      ctl.state.dir = { viewer: 'approver', plan: [] };
      await page.evaluate(() => { location.hash = '#/requests'; });
      await settle(page, 700);
      ok(await page.locator(`${scr} [data-dir-tag]`).count() === 0, 'у отправляющего метки «Доп. согласование» в списке нет (director_approval: false)');
      await open();
      const bar = await page.evaluate(() => {
        const q = (s) => document.querySelector(`.screen:not(.leaving) .actionbar ${s}`);
        const rect = (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) }; };
        const d = q('[data-act="to-director"]');
        const range = document.createRange();
        range.selectNodeContents(d);
        return { dir: rect(d), ok: rect(q('[data-act="approve"]')), rej: rect(q('[data-act="reject"]')), text: d.textContent.trim(), fits: d.scrollWidth <= d.clientWidth + 1 && range.getClientRects().length === 1, secondary: d.classList.contains('btn-secondary'), vw: window.innerWidth };
      });
      ok(bar.text === 'Отправить директору' && bar.secondary, 'can_send_to_director: true — вторичная кнопка «Отправить директору»');
      ok(bar.dir.top === bar.ok.top && bar.dir.right <= bar.ok.left && bar.rej.top < bar.dir.top, 'кнопка стоит в одном ряду с «Согласовать», слева от неё; «Отклонить» и «На доработку» — рядом выше');
      ok(bar.fits && bar.ok.right <= bar.vw, 'подпись кнопки помещается в одну строку (390 px), ряд не выходит за экран');
      await shot(page, '30-zayavka-otpravit-direktoru');
      await page.locator(`${scr} [data-act="to-director"]`).click();
      await settle(page, 450);
      const sh = norm(await page.locator('.sheet').innerText());
      ok(sh.includes('Согласовать и отправить директору?') && sh.includes('Директор — Нурлан Абенов') && sh.includes('1 500 000 ₸'), 'подтверждение: вопрос, сумма и имя директора из director.name');
      ok((await page.locator('.sheet #reject-text').getAttribute('maxlength')) === '1000' && (await page.locator('.sheet #reject-text').getAttribute('placeholder')) === 'Комментарий директору, если нужен', 'комментарий необязателен, не длиннее 1000 символов');
      await shot(page, '31-otpravit-direktoru-podtverzhdenie');
      const send = () => page.locator('.sheet [data-act="director-confirm"]').click();
      const reopen = async () => {
        await page.locator(`${scr} [data-act="to-director"]`).click();
        await settle(page, 450);
      };

      // 422 validation_error — длинный комментарий: шторка остаётся, ошибка у поля
      ctl.state.dir.plan = ['long'];
      await send();
      await settle(page, 700);
      ok(await page.locator('.sheet #reject-err').isVisible() && norm(await page.locator('.sheet #reject-err').innerText()).includes('не больше 1000 символов') && await page.locator('.sheet [data-act="director-confirm"]').isEnabled(), '422 validation_error — «Комментарий слишком длинный», шторка остаётся');
      ok(JSON.stringify(sends()[0].body) === '{}' && sends()[0].method === 'POST' && sends()[0].path === '/orgs/org_test/requests/req_1/to-director', 'без комментария уходит POST …/to-director с телом {}');

      // 422 action_failed — message как есть, карточка перечитывается
      ctl.state.dir.plan = ['failed'];
      await send();
      await settle(page, 700);
      const af = norm(await page.locator('.decision-state').innerText());
      ok(af.includes('Отправить директору не получилось') && af.includes('Директор для дополнительного согласования не задан в настройках. Директору заявка не отправлена.'), '422 action_failed — текст message из учёта');
      await shot(page, '32-otpravit-direktoru-otkaz');
      let reads = cardReads();
      await page.locator('.sheet [data-act="decision-refresh"]').click();
      await settle(page, 900);
      ok(cardReads() === reads + 1 && await page.locator('.sheet-wrap').count() === 0, '«Обновить заявку» перечитывает карточку');

      // 409 not_awaiting_you и 409 already_decided — message, карточка перечитывается
      ctl.state.dir.plan = ['stage'];
      await reopen();
      await send();
      await settle(page, 700);
      ok(norm(await page.locator('.decision-state').innerText()).includes('Заявка сейчас не на вашем этапе. Директору заявка не отправлена.'), '409 not_awaiting_you — message сервера');
      reads = cardReads();
      await page.locator('.sheet [data-act="decision-refresh"]').click();
      await settle(page, 900);
      ok(cardReads() === reads + 1, 'после 409 not_awaiting_you карточка перечитана');
      ctl.state.dir.plan = ['decided'];
      await reopen();
      await send();
      await settle(page, 700);
      const ad = norm(await page.locator('.decision-state').innerText());
      ok(ad.includes('Решение уже принято') && ad.includes('Заявку уже согласовал Самат Ахметов 11.11.2026 в 10:12. Директору заявка не отправлена.'), '409 already_decided — message сервера');
      reads = cardReads();
      await page.locator('.sheet [data-act="decision-refresh"]').click();
      await settle(page, 900);
      ok(cardReads() === reads + 1, 'после 409 already_decided карточка перечитана');
      const k4 = sends().map((c) => c.headers['idempotency-key']);
      ok(k4.length === 4 && k4.every(Boolean) && new Set(k4).size === 4, 'каждое нажатие — новый Idempotency-Key');

      // 503 → «Повторить» → обрыв связи → «Повторить» → 200: ключ один; карточка — из ответа, без второго запроса
      ctl.state.dir.plan = ['503', 'abort', 'ok'];
      await reopen();
      await page.locator('.sheet #reject-text').fill('  Сумма большая — на усмотрение директора  ');
      await send();
      await settle(page, 700);
      ok(norm(await page.locator('.decision-state').innerText()).includes('1С сейчас недоступна'), '503 — «1С сейчас недоступна», «Повторить»');
      await page.locator('.sheet [data-act="decision-retry"]').click();
      await settle(page, 700);
      ok(norm(await page.locator('.decision-state').innerText()).includes('Нет связи'), 'обрыв связи — «Нет связи», «Повторить»');
      reads = cardReads();
      await page.locator('.sheet [data-act="decision-retry"]').click();
      await page.waitForSelector('.toast.show', { timeout: 6000 });
      ok(norm(await page.locator('.toast').innerText()).trim() === 'Отправлено директору', 'после 200 — короткое «Отправлено директору»');
      await settle(page, 500);
      const last3 = sends().slice(-3);
      ok(last3.every((c) => c.headers['idempotency-key'] === last3[0].headers['idempotency-key']) && !k4.includes(last3[0].headers['idempotency-key']), 'повторы после 503 и обрыва — с тем же Idempotency-Key');
      ok(last3.every((c) => c.body && c.body.comment === 'Сумма большая — на усмотрение директора') && last3.every((c) => c.headers['x-app-version'] === APP_VERSION), 'комментарий уходит в теле {"comment"} без пробелов по краям');
      ok((await page.evaluate(() => location.hash)) === '#/requests/req_1' && cardReads() === reads, 'остаёмся в карточке; она показана из ответа, без повторного GET');
      ok(await page.locator(`${scr} .actionbar`).count() === 0 && await page.locator('.done-overlay').count() === 0, 'кнопок решения больше нет, «Заявка согласована» не показывается');
      ok(norm(await page.locator(`${scr} .status-chip`).innerText()) === 'На согласовании у директора', 'статус карточки — «На согласовании у директора»');
      const rt = await page.locator(`${scr} .rt`).evaluateAll((els) => els.map((e) => e.innerText.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()));
      ok(rt.length === 3 && rt[1].includes('(вы)') && rt[1].includes('Согласовал и отправил директору') && rt[1].includes('«Сумма большая — на усмотрение директора»'), 'маршрут: строка с sent_to_director — «Согласовал и отправил директору»');
      ok(rt[2].includes('Нурлан Абенов') && rt[2].includes('Директор — доп. согласование') && rt[2].includes('Ждёт решения'), 'маршрут: строка kind "director" — «Директор — доп. согласование», ждёт решения');
      await noToast();
      await page.locator(`${scr} .route`).scrollIntoViewIfNeeded();
      await settle(page, 300);
      await shot(page, '33-otpravleno-direktoru');
      await page.locator(`${scr} [data-back]`).click();
      await settle(page, 900);
      ok((await page.evaluate(() => location.hash)) === '#/requests' && await page.locator(`${scr} .req-card`).count() === 0, 'заявка ушла из «Ждут решения»');
      await page.locator(`${scr} [data-act="req-tab"][data-v="done"]`).click();
      await settle(page, 700);
      ok(await page.locator(`${scr} .req-card`).count() === 1 && norm(await page.locator(`${scr} .req-card`).innerText()).includes('Согласована'), 'в «Решённых» она с my_action: approved');
      noErrors(errors);
      await ctx.close();
    }
    {
      // 504 после того, как учёт принял отправку: «Повторить» с тем же ключом → 200 Idempotent-Replayed
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { dir: { viewer: 'approver', plan: ['504-applied'] } });
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      await page.evaluate(() => { location.hash = '#/requests/req_1'; });
      await settle(page, 800);
      await page.locator('.screen:not(.leaving) [data-act="to-director"]').click();
      await settle(page, 450);
      await page.locator('.sheet [data-act="director-confirm"]').click();
      await settle(page, 800);
      ok(norm(await page.locator('.decision-state').innerText()).includes('Сервер не ответил'), '504 source_timeout — «Сервер не ответил», «Повторить»');
      await page.locator('.sheet [data-act="decision-retry"]').click();
      await page.waitForSelector('.toast.show', { timeout: 6000 });
      const log = ctl.state.dir.log;
      ok(log.length === 2 && log[0].key === log[1].key && norm(await page.locator('.toast').innerText()).trim() === 'Отправлено директору', 'повтор после 504 — с тем же ключом; ответ Idempotent-Replayed принят как успех');
      ok(await page.locator('.screen:not(.leaving) [data-rt-director]').count() === 1 && await page.locator('.screen:not(.leaving) .actionbar').count() === 0, 'в маршруте одна строка директора, кнопок нет');
      noErrors(errors);
      await ctx.close();
    }
    {
      // директор: заявка пришла на доп. согласование — метка в списке, обычные три решения, кнопки «Отправить директору» нет
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { dir: { viewer: 'director' } });
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      const scr = '.screen:not(.leaving)';
      await page.evaluate(() => { location.hash = '#/requests'; });
      await settle(page, 800);
      ok(await page.locator(`${scr} [data-dir-tag]`).count() === 1 && norm(await page.locator(`${scr} [data-dir-tag]`).innerText()) === 'Доп. согласование', 'director_approval: true — метка «Доп. согласование» в списке');
      await shot(page, '34-zayavki-dop-soglasovanie');
      await page.locator(`${scr} .req-card`).click();
      await settle(page, 800);
      ok(await page.locator(`${scr} [data-act="to-director"]`).count() === 0 && await page.locator(`${scr} [data-act="approve"]`).isVisible() && await page.locator(`${scr} [data-act="reject"]`).isVisible() && await page.locator(`${scr} [data-act="return"]`).isVisible(), 'у директора — обычные три решения, «Отправить директору» нет');
      ok(norm(await page.locator(`${scr} .status-chip`).innerText()) === 'Ждёт вашего решения', 'статус у директора — «Ждёт вашего решения»');
      const rt = await page.locator(`${scr} .rt`).evaluateAll((els) => els.map((e) => e.innerText.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()));
      ok(rt.length === 3 && rt[1].includes('Айгуль Сеитова') && rt[1].includes('Согласовал и отправил директору') && rt[1].includes('«Сумма большая — на усмотрение директора»'), 'директор видит, кто отправил, и комментарий');
      ok(rt[2].includes('(вы)') && rt[2].includes('Директор — доп. согласование') && rt[2].includes('Ждёт вашего решения'), 'его строка — «Директор — доп. согласование», ждёт его решения');
      await page.locator(`${scr} .route`).scrollIntoViewIfNeeded();
      await settle(page, 300);
      await shot(page, '35-direktor-dop-soglasovanie');
      noErrors(errors);
      await ctx.close();
    }

    // ---------- 4б. запросы контрагентов ----------
    console.log('\n▶ «Запросы контрагентов»: вход на экран только там, где он есть (counterparty_requests в /orgs)');
    {
      const { ctx, page, errors, ctl } = await newCtx();
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      const scr = '.screen:not(.leaving)';
      ok(await page.locator(`${scr} [data-cr-entry]`).count() === 0 && (await page.evaluate(() => document.querySelector('.tab-badge')?.textContent || '0')) === '1', 'поля нет (база до 1.17.0, бот выключен, нет роли): на главной входа нет, значок вкладки — только заявки');
      await page.evaluate(() => { location.hash = '#/requests'; });
      await settle(page, 800);
      ok(await page.locator(`${scr} [data-cr-entry]`).count() === 0, 'поля нет: во вкладке «Заявки» входа нет');
      ok(!ctl.calls.some((c) => c.path.includes('counterparty-requests')), 'поля нет: запросов к …/counterparty-requests приложение не делает');
      await page.evaluate(() => { location.hash = '#/cr'; });
      await settle(page, 900);
      ok(await page.locator(`${scr} [data-cr-off]`).count() === 1 && norm(await page.locator(`${scr} [data-cr-off]`).innerText()).includes('Раздел недоступен'), 'прямой адрес без доступа (403) — «Раздел недоступен», без ошибки');
      noErrors(errors);
      await ctx.close();
    }
    {
      // counterparty_requests: null — то же, что поля нет
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { orgs: [{ ...ORG, counterparty_requests: null }] });
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      ok(await page.locator('.screen:not(.leaving) [data-cr-entry]').count() === 0 && !ctl.calls.some((c) => c.path.includes('counterparty-requests')), 'counterparty_requests: null — входа нет, запросов нет');
      noErrors(errors);
      await ctx.close();
    }

    console.log('\n▶ «Запросы контрагентов»: список, карточка, файл, «Отправить», «Отклонить», «Закрыть» (контракт, 13.17–13.21)');
    {
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { orgs: [{ ...ORG, counterparty_requests: 3 }], cr: { items: crItems(), plan: [] } });
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      const scr = '.screen:not(.leaving)';
      const C = ctl.state.cr;
      const lists = (tab) => ctl.calls.filter((c) => c.method === 'GET' && c.path === '/orgs/org_test/counterparty-requests' && c.query.tab === tab).length;
      const noToast = () => page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 8000 });
      const openCard = async (id) => {
        await page.evaluate((h) => { location.hash = h; }, `#/cr/${id}`);
        await settle(page, 900);
      };
      // вход с главной и из «Заявок», значок — число ожидающих
      const home = norm(await page.locator(`${scr} .cr-home`).innerText());
      ok(home.includes('Запросы контрагентов: 3') && home.includes('3 запроса ждут решения'), 'главная: карточка «Запросы контрагентов: 3»');
      ok(lists('pending') === 1, 'число ожидающих — одним запросом списка tab=pending');
      await shot(page, '36-glavnaya-zaprosy-kontragentov');
      await page.evaluate(() => { location.hash = '#/requests'; });
      await settle(page, 800);
      ok(norm(await page.locator(`${scr} .cr-entry`).innerText()).replace(/\s+/g, ' ').trim() === 'Запросы контрагентов 3' && lists('pending') === 1, '«Заявки»: строка входа со значком 3, список повторно не читается');
      ok((await page.evaluate(() => document.querySelector('.tab-badge')?.textContent || '0')) === '4', 'значок вкладки «Заявки» — сумма: 1 заявка на согласовании и 3 запроса контрагентов');
      await page.locator(`${scr} .cr-entry`).click();
      await settle(page, 900);
      // список
      ok((await page.evaluate(() => location.hash)) === '#/cr' && await page.locator(`${scr} [data-cr-list="pending"] .req-card`).count() === 3, 'вкладка «Ждут»: три запроса');
      const rows = await page.locator(`${scr} .req-card`).evaluateAll((els) => els.map((e) => e.innerText.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()));
      ok(rows[0].includes('ТОО «Тест Контрагент»') && rows[0].includes('Акт сверки за 01.01.2026–11.11.2026') && rows[0].includes('+7 701 ***-**-67') && rows[0].includes('сегодня, 09:12'), 'строка: контрагент, что просит, номер как пришёл (частично скрыт), когда');
      ok(rows[1].includes('Незнакомый номер') && rows[2].includes('Задача') && rows[2].includes('Контрагент не определён') && rows[2].includes('Новые реквизиты'), 'метки «Незнакомый номер» и «Задача»; задача без контрагента');
      ok(norm(await page.locator(`${scr} .seg-btn.on`).innerText()).trim() === 'Ждут · 3', 'на вкладке — «Ждут · 3»');
      await shot(page, '37-zaprosy-kontragentov-spisok');
      await page.locator(`${scr} [data-act="cr-tab"][data-v="done"]`).click();
      await settle(page, 800);
      const doneRow = norm(await page.locator(`${scr} [data-cr-list="done"] .req-card`).innerText());
      ok(lists('done') === 1 && await page.locator(`${scr} .req-card`).count() === 1 && doneRow.includes('Отправлено') && doneRow.includes('вчера, 15:34'), '«Решённые»: tab=done, статус и время решения');
      await page.locator(`${scr} [data-cr-list="done"] .req-card`).click();
      await settle(page, 900);
      const hist = await page.locator(`${scr} [data-cr-history] .rt`).evaluateAll((els) => els.map((e) => e.innerText.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()));
      ok(hist.length === 4 && hist[1].includes('Отправлено контрагенту') && hist[1].includes('Тест Коллега') && hist[2].includes('Доставлено') && hist[3].includes('Прочитано'), 'решённый запрос: история — кто отправил, «Доставлено», «Прочитано»');
      ok(await page.locator(`${scr} .actionbar`).count() === 0 && norm(await page.locator(`${scr} .status-chip`).innerText()) === 'Отправлено контрагенту', 'у решённого запроса кнопок нет');
      await page.locator(`${scr} [data-back]`).click();
      await settle(page, 700);
      await page.locator(`${scr} [data-act="cr-tab"][data-v="pending"]`).click();
      await settle(page, 700);

      // карточка ответа
      await page.locator(`${scr} .req-wrap[data-id="cr_1"] .req-card`).click();
      await settle(page, 900);
      const card = norm(await page.locator(scr).innerText());
      ok((await page.evaluate(() => location.hash)) === '#/cr/cr_1' && card.includes('ТОО «Тест Контрагент»') && card.includes('БИН 123456789012') && card.includes('Тест Контакт'), 'карточка: контрагент, БИН, контакт');
      ok(norm(await page.locator(`${scr} [data-cr-phone]`).innerText()) === '+7 701 ***-**-67', 'телефон показан так, как пришёл');
      ok(norm(await page.locator(`${scr} [data-cr-question]`).innerText()).includes('Скиньте акт сверки за этот год') && norm(await page.locator(`${scr} [data-cr-answer]`).innerText()).includes('— во вложении.'), 'карточка: вопрос контрагента и ответ бота');
      ok(await page.locator(`${scr} [data-cr-warn]`).count() === 0, 'known_phone: true — предупреждения нет');
      ok(await page.locator(`${scr} [data-act="cr-send"]`).isVisible() && await page.locator(`${scr} [data-act="cr-reject"]`).isVisible() && await page.locator(`${scr} [data-act="cr-done"]`).count() === 0, 'kind: answer — «Отправить» и «Отклонить»');
      await shot(page, '38-zapros-kartochka');
      // файл
      await page.locator(`${scr} [data-act="cr-file"]`).click();
      await page.waitForSelector('.sheet .pdf-frame', { timeout: 6000 });
      const fileCall = ctl.calls.find((c) => c.path === '/orgs/org_test/counterparty-requests/cr_1/files/cf_1');
      ok(fileCall && fileCall.method === 'GET' && /^Bearer /.test(fileCall.headers.authorization || '') && (await page.locator('.sheet .pdf-frame').getAttribute('src')).startsWith('blob:'), 'файл: GET …/files/{id} с авторизацией, просмотр PDF в шторке');
      await page.locator('.pdf-bar [data-act="sheet-close"]').click();
      await settle(page, 400);

      // «Отправить»: пустой текст → ошибка у поля; 503 → обрыв → 200 с одним ключом; текст не меняли — text: null
      await page.locator(`${scr} [data-act="cr-send"]`).click();
      await settle(page, 450);
      const sheet = norm(await page.locator('.sheet').innerText());
      ok(sheet.includes('Отправить ответ контрагенту?') && sheet.includes('+7 701 ***-**-67') && sheet.includes('уйдёт 1 файл') && (await page.locator('.sheet #reject-text').inputValue()).includes('— во вложении.'), 'шторка «Отправить»: ответ в поле, можно поправить; сказано про файл');
      ok((await page.locator('.sheet #reject-text').getAttribute('maxlength')) === '4000' && await page.locator('.sheet [data-cr-warn]').count() === 0, 'ответ — до 4000 знаков');
      await shot(page, '39-zapros-otpravit');
      await page.locator('.sheet #reject-text').fill('   ');
      await page.locator('.sheet [data-act="cr-send-confirm"]').click();
      await settle(page, 400);
      ok(await page.locator('.sheet #reject-err').isVisible() && C.log.length === 0, 'пустой ответ не отправляется');
      await page.locator('.sheet #reject-text').fill('Акт сверки с ТОО «Тест Контрагент» за 01.01.2026–11.11.2026 — во вложении.');
      C.plan = ['503', 'abort', 'ok'];
      await page.locator('.sheet [data-act="cr-send-confirm"]').click();
      await settle(page, 800);
      ok(norm(await page.locator('.decision-state').innerText()).includes('1С сейчас недоступна'), '503 — «1С сейчас недоступна», «Повторить»');
      await page.locator('.sheet [data-act="cr-retry"]').click();
      await settle(page, 800);
      ok(norm(await page.locator('.decision-state').innerText()).includes('Нет связи'), 'обрыв связи — «Нет связи», «Повторить»');
      await page.locator('.sheet [data-act="cr-retry"]').click();
      await page.waitForSelector('.done-overlay.show', { timeout: 6000 });
      ok(norm(await page.locator('.done-title').innerText()) === 'Отправлено контрагенту', 'после 200 — «Отправлено контрагенту»');
      const s3 = C.log.slice(-3);
      ok(s3.length === 3 && s3.every((x) => x.action === 'send' && x.key && x.key === s3[0].key), 'POST …/send; повторы после 503 и обрыва — с тем же Idempotency-Key');
      ok(s3.every((x) => x.body && x.body.text === null && x.body.comment === null), 'текст не меняли — в теле text: null');
      await page.waitForFunction(() => location.hash === '#/cr');
      await settle(page, 1200);
      ok(await page.locator(`${scr} .req-card`).count() === 2 && norm(await page.locator(`${scr} .seg-btn.on`).innerText()).trim() === 'Ждут · 2', 'после отправки — список, осталось два запроса');

      // незнакомый номер: предупреждение, исправленный текст, 422 по длине, 409 «решил другой»
      await page.locator(`${scr} .req-wrap[data-id="cr_2"] .req-card`).click();
      await settle(page, 900);
      const warn = norm(await page.locator(`${scr} [data-cr-warn]`).innerText());
      ok(warn.includes('Номер не из контактов контрагента') && warn.includes('только если уверены, что пишет сотрудник этой компании'), 'known_phone: false — заметное предупреждение в карточке');
      const wbox = await page.locator(`${scr} [data-cr-warn]`).boundingBox();
      ok(wbox && wbox.y < 420, 'предупреждение стоит вверху карточки, без прокрутки');
      await shot(page, '40-zapros-neznakomyy-nomer');
      await page.locator(`${scr} [data-act="cr-send"]`).click();
      await settle(page, 450);
      ok(await page.locator('.sheet [data-cr-warn]').count() === 1, 'предупреждение повторено в шторке «Отправить»');
      await page.locator('.sheet #reject-text').fill('  Задолженность на 11.11.2026 — 640 000 ₸. Подробности пришлём письмом.  ');
      C.plan = ['long'];
      await page.locator('.sheet [data-act="cr-send-confirm"]').click();
      await settle(page, 700);
      ok(await page.locator('.sheet #reject-err').isVisible() && norm(await page.locator('.sheet #reject-err').innerText()).includes('не больше 4000 символов') && await page.locator('.sheet [data-act="cr-send-confirm"]').isEnabled(), '422 validation_error — ошибка у поля, шторка остаётся');
      ok(C.log[C.log.length - 1].body.text === 'Задолженность на 11.11.2026 — 640 000 ₸. Подробности пришлём письмом.', 'исправленный текст уходит в теле text, без пробелов по краям');
      C.plan = ['decided'];
      await page.locator('.sheet [data-act="cr-send-confirm"]').click();
      await settle(page, 700);
      const dec = norm(await page.locator('.decision-state').innerText());
      ok(dec.includes('Запрос уже решён') && dec.includes('Ответ уже отправлен: Тест Коллега, сегодня, 10:05') && dec.includes('Ваше решение не отправлено'), '409 already_decided — кто и когда решил (details)');
      const two = C.log.slice(-2).map((x) => x.key);
      ok(two[0] && two[1] && two[0] !== two[1], 'после окончательного отказа следующее нажатие — с новым ключом');
      await shot(page, '41-zapros-uzhe-reshen');
      await page.locator('.sheet [data-act="cr-to-list"]').click();
      await settle(page, 900);
      ok((await page.evaluate(() => location.hash)) === '#/cr', '«К списку запросов» — список');

      // «Отклонить»: комментарий обязателен
      await openCard('cr_2');
      await page.locator(`${scr} [data-act="cr-reject"]`).click();
      await settle(page, 450);
      ok(norm(await page.locator('.sheet').innerText()).includes('увидят только коллеги'), 'шторка «Отклонить»: комментарий контрагенту не уходит');
      const before = C.log.length;
      await page.locator('.sheet [data-act="cr-reject-confirm"]').click();
      await settle(page, 400);
      ok(await page.locator('.sheet #reject-err').isVisible() && C.log.length === before, 'без комментария отклонить нельзя — запрос не уходит');
      await page.locator('.sheet .chip[data-v="Номер не из нашей базы"]').click();
      C.plan = ['wrong', 'ok'];
      await page.locator('.sheet [data-act="cr-reject-confirm"]').click();
      await settle(page, 700);
      const af = norm(await page.locator('.decision-state').innerText());
      ok(af.includes('Действие не выполнено') && af.includes('Контрагент помечен на удаление. Запрос остался без изменений.'), '422 action_failed — message из учёта');
      await page.locator('.sheet [data-act="cr-refresh"]').click();
      await settle(page, 900);
      await page.locator(`${scr} [data-act="cr-reject"]`).click();
      await settle(page, 450);
      await page.locator('.sheet #reject-text').fill('Номер не из нашей базы');
      await page.locator('.sheet [data-act="cr-reject-confirm"]').click();
      await page.waitForSelector('.done-overlay.show', { timeout: 6000 });
      const rj = C.log[C.log.length - 1];
      ok(rj.action === 'reject' && rj.body.comment === 'Номер не из нашей базы' && rj.key && norm(await page.locator('.done-title').innerText()) === 'Запрос отклонён', 'POST …/reject с комментарием и Idempotency-Key → «Запрос отклонён»');
      await page.waitForFunction(() => location.hash === '#/cr');
      await settle(page, 1200);

      // задача: только «Закрыть»
      await page.locator(`${scr} .req-wrap[data-id="cr_3"] .req-card`).click();
      await settle(page, 900);
      ok(await page.locator(`${scr} [data-act="cr-done"]`).isVisible() && await page.locator(`${scr} [data-act="cr-send"]`).count() === 0 && await page.locator(`${scr} [data-act="cr-reject"]`).count() === 0, 'kind: task — только «Закрыть задачу»');
      ok(norm(await page.locator(`${scr} .rh-who`).innerText()) === 'Контрагент не определён' && await page.locator(`${scr} [data-cr-warn]`).count() === 1 && await page.locator(`${scr} [data-cr-answer]`).count() === 0, 'задача от незнакомого номера: контрагента нет, предупреждение есть, блока ответа нет');
      await shot(page, '42-zapros-zadacha');
      await page.locator(`${scr} [data-act="cr-done"]`).click();
      await settle(page, 450);
      C.plan = ['504-applied'];
      await page.locator('.sheet [data-act="cr-done-confirm"]').click();
      await settle(page, 800);
      ok(norm(await page.locator('.decision-state').innerText()).includes('Сервер не ответил'), '504 — «Сервер не ответил», «Повторить»');
      await page.locator('.sheet [data-act="cr-retry"]').click();
      await page.waitForSelector('.done-overlay.show', { timeout: 6000 });
      const dn = C.log.slice(-2);
      ok(dn.every((x) => x.action === 'done' && x.key === dn[0].key) && dn[0].body.comment === null && norm(await page.locator('.done-title').innerText()) === 'Задача закрыта', 'POST …/done без комментария; повтор после 504 с тем же ключом (Idempotent-Replayed) → «Задача закрыта»');
      await page.waitForFunction(() => location.hash === '#/cr');
      await settle(page, 1200);
      ok(await page.locator(`${scr} .req-card`).count() === 0 && norm(await page.locator(scr).innerText()).includes('Запросов нет'), 'все решены — «Запросов нет»');
      await page.locator(`${scr} [data-back]`).click();
      await page.waitForFunction(() => location.hash !== '#/cr', null, { timeout: 8000 });
      ok(true, '«Назад» из списка после решений уводит с него с первого нажатия');
      await page.evaluate(() => { location.hash = '#/home'; });
      await settle(page, 900);
      const empty = norm(await page.locator(`${scr} .cr-home`).innerText());
      ok(empty.includes('Запросы контрагентов') && empty.includes('Новых запросов нет'), 'главная: «Новых запросов нет» — вход остаётся');
      ok((await page.evaluate(() => document.querySelector('.tab-badge')?.textContent || '0')) === '1', 'запросы решены — на значке вкладки «Заявки» осталась одна заявка');
      noErrors(errors);
      await ctx.close();
    }
    {
      // отправка подтверждена, но WhatsApp не принял (status: failed); push и уведомления
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { orgs: [{ ...ORG, counterparty_requests: 3 }, ORG2], cr: { items: crItems(), plan: ['send-failed'] } });
      await page.goto(`${BASE}#/cr/cr_1?org=org_test&n=n_7`);
      await settle(page, 800);
      await login(page, ctl, { expect: '#/cr/cr_1' });
      const scr = '.screen:not(.leaving)';
      ok((await page.evaluate(() => location.hash)) === '#/cr/cr_1' && norm(await page.locator(`${scr} .rh-who`).innerText()) === 'ТОО «Тест Контрагент»', 'push без входа: после входа открылась карточка запроса (организаций две — выбор пропущен)');
      ok(ctl.calls.some((c) => c.path === '/notifications/read' && c.body && (c.body.ids || []).includes('n_7')), 'уведомление из push отмечено прочитанным');
      await page.locator(`${scr} [data-act="cr-send"]`).click();
      await settle(page, 450);
      await page.locator('.sheet [data-act="cr-send-confirm"]').click();
      await page.waitForSelector('.toast.show', { timeout: 6000 });
      ok(norm(await page.locator('.toast').innerText()).includes('отправить пока не удалось') && (await page.evaluate(() => location.hash)) === '#/cr/cr_1' && await page.locator('.done-overlay').count() === 0, 'status: failed — «отправить пока не удалось, 1С повторит», без «Отправлено»');
      await settle(page, 500);
      ok(norm(await page.locator(`${scr} .status-chip`).innerText()) === 'Не отправлено — 1С повторит' && await page.locator(`${scr} .actionbar`).count() === 0 && await page.locator(`${scr} [data-cr-event="send_failed"]`).count() === 1, 'карточка из ответа: статус «Не отправлено — 1С повторит», кнопок нет, событие в истории');
      await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 8000 });
      // push на запрос, которого уже нет: 404 → список
      await page.evaluate(() => { location.hash = '#/cr/cr_gone?org=org_test&n=n_8'; });
      await page.waitForFunction(() => location.hash === '#/cr', null, { timeout: 8000 });
      await settle(page, 900);
      ok(await page.locator(`${scr} [data-cr-list="pending"]`).count() === 1 && norm(await page.locator('.toast').innerText()).includes('Запрос не найден'), 'push на решённый или удалённый запрос (404) — список и подсказка');
      // строка в уведомлениях
      ctl.override = (call, { json }) => (call.path === '/notifications' ? (json(200, { unread_count: 1, items: [
        { id: 'n_c1', org_id: 'org_test', type: 'counterparty_request', created_at: T(TODAY, '10:02'), title: 'Запрос контрагента', text: 'Откройте, чтобы посмотреть', link: { kind: 'counterparty_request', counterparty_request_id: 'cr_3' }, read: false },
        { id: 'n_c2', org_id: 'org_test', type: 'counterparty_request', created_at: T(TODAY, '09:40'), title: 'Запрос контрагента', text: 'Откройте, чтобы посмотреть', link: { kind: 'none' }, read: true },
      ], next_cursor: null }), true) : false);
      await page.evaluate(() => { location.hash = '#/notifications'; });
      await settle(page, 900);
      ok(await page.locator(`${scr} .notif`).count() === 2 && norm(await page.locator(`${scr} .notif`).first().innerText()).includes('Запрос контрагента'), 'уведомления: строка «Запрос контрагента»');
      await page.locator(`${scr} .notif`).first().click();
      await page.waitForFunction(() => location.hash === '#/cr/cr_3', null, { timeout: 8000 });
      ok(true, 'строка уведомления со ссылкой открывает карточку запроса');
      await page.evaluate(() => { location.hash = '#/notifications'; });
      await settle(page, 900);
      await page.locator(`${scr} .notif`).nth(1).click();
      await page.waitForFunction(() => location.hash === '#/cr', null, { timeout: 8000 });
      ok(true, 'строка уведомления без ссылки открывает список запросов');
      noErrors(errors);
      await ctx.close();
    }

    // ---------- 5. настройки, уведомления, отчёты, выход ----------
    console.log('\n▶ Настройки, уведомления, отчёты, выход');
    {
      const { ctx, page, errors, ctl } = await newCtx();
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      await page.evaluate(() => { location.hash = '#/profile'; });
      await settle(page, 900);
      await page.locator('[data-act="toggle"][data-k="payments"]').click();
      await settle(page, 600);
      const put = ctl.calls.find((c) => c.method === 'PUT' && c.path === '/me/settings');
      ok(put && JSON.stringify(put.body) === JSON.stringify({ notifications: { payments: { enabled: false } } }), 'PUT /me/settings — только изменённый enabled');
      const wa = page.locator('.li-locked[data-k="whatsapp"]');
      ok(norm(await wa.innerText()).includes('Настраивает администратор') && (await wa.getAttribute('aria-disabled')) === 'true', 'whatsapp (editable: false) — неактивный, «Настраивает администратор»');
      await wa.dispatchEvent('click');
      await settle(page, 500);
      ok((await wa.getAttribute('aria-checked')) === 'false', 'нажатие на whatsapp ничего не меняет');
      ok(!ctl.calls.some((c) => c.method === 'PUT' && c.body && c.body.notifications && c.body.notifications.whatsapp), 'запрос на whatsapp не отправлен');
      const prof = norm(await page.locator('.screen:not(.leaving) .scroll').innerText());
      ok(prof.includes('Каждый день в 08:30') && prof.includes('Оплаты от 500 000 ₸') && prof.includes('За 3 дня до разрыва'), 'подписи настроек — из time, min_amount, days_ahead');
      await page.evaluate(() => { const s = document.querySelector('.screen:not(.leaving) .scroll'); s.scrollTop = s.scrollHeight; });
      await settle(page, 300);
      await shot(page, '10-profil-nastroyki');
      await page.evaluate(() => { location.hash = '#/reports/debtors'; });
      await settle(page, 900);
      const dt = norm(await page.locator('.rep-body').innerText());
      ok(dt.includes('ТОО «Должник»') && dt.includes('> 60 дней: 500 000 ₸') && dt.includes('старейший документ — 74 дня'), 'должники: возраст долга, oldest_days');
      ok(!/просроч/i.test(dt), 'должники: без «просрочки»');
      await shot(page, '11-dolzhniki-vozrast');
      await page.evaluate(() => { location.hash = '#/reports/plan'; });
      await settle(page, 900);
      const pf = norm(await page.locator('.rep-body').innerText());
      ok(pf.includes('Аренда') && pf.includes('Связь') && pf.includes('плана нет'), 'план-факт; статья с plan: null — «плана нет»');
      ctl.state.noPlan = true;
      await page.reload(); // отчёты кэшируются на экране 60 с; после перезагрузки сессия поднимается по refresh-токену
      await settle(page, 1200);
      ok((await page.evaluate(() => location.hash)) === '#/reports/plan', 'после перезагрузки — тот же экран, без повторного входа');
      const np = norm(await page.locator('.rep-body').innerText());
      ok(np.includes('Бюджет на месяц не задан') && !np.includes('0%'), 'has_plan: false — «Бюджет на месяц не задан», без плана 0');
      await shot(page, '12-plan-ne-zadan');
      await page.evaluate(() => { location.hash = '#/notifications'; });
      await settle(page, 900);
      const nl = ctl.calls.find((c) => c.path === '/notifications' && c.query.org_id === 'org_test');
      ok(!!nl, 'GET /notifications?org_id=…');
      await page.locator('.notif[data-id="n_1"]').click();
      await settle(page, 900);
      ok((await page.evaluate(() => location.hash)) === '#/requests/req_1', 'link.kind = request → карточка заявки');
      const rd = ctl.calls.find((c) => c.path === '/notifications/read');
      ok(rd && JSON.stringify(rd.body) === JSON.stringify({ ids: ['n_1'], org_id: 'org_test' }), 'POST /notifications/read {ids, org_id}');
      await page.evaluate(() => { location.hash = '#/profile'; });
      await settle(page, 800);
      await page.locator('[data-act="logout-all"]').click();
      await settle(page, 500);
      ok(norm(await page.locator('.sheet').innerText()).includes('Выйти со всех устройств?'), '«Выйти со всех устройств» — подтверждение');
      await shot(page, '13-vyhod-vezde');
      await page.locator('.sheet [data-act="sheet-close"]').click();
      await settle(page, 400);
      ok(!ctl.calls.some((c) => c.path === '/auth/logout-all'), '«Отмена» — запроса нет');
      await page.locator('[data-act="logout"]').click();
      await settle(page, 900);
      const lo = ctl.calls.find((c) => c.path === '/auth/logout');
      ok(lo && !lo.body && !lo.headers.authorization, 'POST /auth/logout — без тела и Authorization, по cookie');
      ok((await page.evaluate(() => window.__cred)).filter((c) => c.url.includes('/auth/logout')).every((c) => c.credentials === 'include'), 'выход — с credentials: include');
      ok((await page.evaluate(() => location.hash)) === '#/login' && !(await page.evaluate(() => localStorage.getItem('finpuls-session'))), 'выход → вход, токены удалены');
      noErrors(errors);
      await ctx.close();
    }

    console.log('\n▶ На доработку и выход со всех устройств');
    {
      const { ctx, page, errors, ctl } = await newCtx();
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      await page.evaluate(() => { location.hash = '#/requests/req_1'; });
      await settle(page, 800);
      await page.locator('.screen:not(.leaving) [data-act="return"]').click();
      await settle(page, 400);
      await page.locator('.sheet [data-act="return-confirm"]').click();
      await settle(page, 600);
      ok(await page.locator('#reject-err').isVisible() && !ctl.calls.some((c) => c.path.endsWith('/return')), 'без комментария — не отправляется');
      await page.locator('.sheet #reject-text').fill('Уточните сумму: в счёте 2 250 000');
      await page.locator('.sheet [data-act="return-confirm"]').click();
      await page.waitForSelector('.done-overlay.show', { timeout: 5000 });
      const rt = ctl.calls.find((c) => c.path.endsWith('/return'));
      ok(rt && rt.method === 'POST' && rt.body.comment === 'Уточните сумму: в счёте 2 250 000' && rt.headers['idempotency-key'], 'POST …/return с комментарием и Idempotency-Key');
      ok(norm(await page.locator('.done-title').innerText()) === 'Возвращена на доработку', '«Возвращена на доработку»');
      await page.waitForFunction(() => location.hash === '#/requests');
      await settle(page, 1300);
      await page.evaluate(() => { location.hash = '#/profile'; });
      await settle(page, 900);
      await page.locator('[data-act="logout-all"]').click();
      await settle(page, 400);
      await page.locator('.sheet [data-act="logout-all-confirm"]').click();
      await settle(page, 1000);
      ok(ctl.calls.some((c) => c.path === '/auth/logout-all' && c.method === 'POST' && !c.headers.authorization && !c.body), 'POST /auth/logout-all — по cookie, без тела и Authorization');
      ok((await page.evaluate(() => location.hash)) === '#/login' && !(await page.evaluate(() => localStorage.getItem('finpuls-session'))), 'выход везде → вход, токены удалены');
      ok(norm(await page.locator('.toast').innerText()).includes('Вы вышли на всех устройствах'), '«Вы вышли на всех устройствах»');
      noErrors(errors);
      await ctx.close();
    }

    console.log('\n▶ Push без входа: после входа — заявка, а не главная');
    {
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { orgs: [ORG, ORG2] });
      await page.goto(`${BASE}#/requests/req_1?org=org_test&n=n_5`);
      await settle(page, 900);
      ok((await page.evaluate(() => location.hash)) === '#/login', 'без входа — экран входа');
      await login(page, ctl, { expect: '#/requests/req_1' });
      ok((await page.evaluate(() => location.hash)) === '#/requests/req_1', 'после входа открылась заявка из push (организаций две — выбор пропущен)');
      ok(norm(await page.locator('.screen:not(.leaving)').innerText()).includes('Заявка № 901'), 'карточка заявки на экране');
      ok(ctl.calls.some((c) => c.path === '/notifications/read' && c.body && c.body.ids && c.body.ids[0] === 'n_5'), 'уведомление из push отмечено прочитанным');
      await page.evaluate(() => { location.hash = '#/home'; });
      await settle(page, 800);
      ok((await page.locator('.org-pill-name').innerText()) === 'Тест', 'выбрана организация из push');
      noErrors(errors);
      await ctx.close();
    }

    // ---------- 6. push ----------
    console.log('\n▶ Push пачки заявок (request_batch, 1.3.1): список «Ждут решения» нужной организации');
    {
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { orgs: [ORG2, ORG] });
      await page.goto(`${BASE}#/requests?org=org_test&n=n_b1`);
      await settle(page, 900);
      ok((await page.evaluate(() => location.hash)) === '#/login', 'без входа — экран входа');
      await login(page, ctl, { expect: '#/requests' });
      const scr = '.screen:not(.leaving)';
      ok((await page.evaluate(() => location.hash)) === '#/requests' && (await page.locator(`${scr} .page-title`).innerText()) === 'Заявки', 'после входа открылся список заявок из push (организаций две — выбор пропущен)');
      ok(ctl.calls.some((c) => c.path === '/notifications/read' && c.body && (c.body.ids || []).includes('n_b1')), 'уведомление о пачке отмечено прочитанным');
      ok(ctl.calls.some((c) => c.path === '/orgs/org_test/requests' && c.query.tab === 'pending'), 'список — организации из push, вкладка «Ждут решения»');
      // открыта «Решённые», приходит ещё одна пачка — список снова на «Ждут решения»
      await page.locator(`${scr} [data-act="req-tab"][data-v="done"]`).click();
      await settle(page, 700);
      await page.evaluate(() => { location.hash = '#/home'; });
      await settle(page, 800);
      await page.evaluate(() => { location.hash = '#/requests?org=org_test&n=n_b2'; });
      await page.waitForFunction(() => location.hash === '#/requests', null, { timeout: 8000 });
      await settle(page, 900);
      ok(norm(await page.locator(`${scr} .seg-btn.on`).innerText()).startsWith('Ждут решения'), 'push пачки открывает вкладку «Ждут решения», даже если раньше была открыта «Решённые»');
      // строка уведомления с link { kind: "requests" } — тот же список
      await page.locator(`${scr} [data-act="req-tab"][data-v="done"]`).click();
      await settle(page, 700);
      ctl.override = (call, { json }) => (call.path === '/notifications' ? (json(200, { unread_count: 1, items: [
        { id: 'n_b3', org_id: 'org_test', type: 'request_batch', created_at: T(TODAY, '10:12'), title: 'На согласование: 3 заявки', text: 'Откройте, чтобы посмотреть', link: { kind: 'requests', org_id: 'org_test' }, read: false },
      ], next_cursor: null }), true) : false);
      await page.evaluate(() => { location.hash = '#/notifications'; });
      await settle(page, 900);
      ok(norm(await page.locator(`${scr} .notif`).innerText()).includes('На согласование: 3 заявки'), 'уведомления: строка «На согласование: 3 заявки»');
      await page.locator(`${scr} .notif`).click();
      await page.waitForFunction(() => location.hash === '#/requests', null, { timeout: 8000 });
      await settle(page, 900);
      ok(norm(await page.locator(`${scr} .seg-btn.on`).innerText()).startsWith('Ждут решения'), 'строка уведомления о пачке открывает «Ждут решения»');
      noErrors(errors);
      await ctx.close();
    }

    console.log('\n▶ Push (контракт, 9)');
    {
      const { ctx, page, errors, ctl } = await newCtx({ viewport: { width: 1280, height: 900 } });
      await ctx.addInitScript(PUSH_STUB);
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      await settle(page, 1500);
      ok(norm(await page.locator('.sheet .push-offer').innerText()).includes('Уведомления о новых заявках'), 'после входа — предложение включить уведомления');
      await page.locator('.sheet [data-act="push-enable"]').click();
      await settle(page, 900);
      const dev = ctl.calls.find((c) => c.path === '/devices' && c.method === 'POST');
      ok(dev && dev.body.platform === 'web' && dev.body.provider === 'webpush' && dev.body.subscription.endpoint && dev.body.subscription.keys.p256dh && dev.body.app_version === APP_VERSION, 'POST /devices {platform: web, provider: webpush, subscription, app_version}');
      ok(await page.evaluate(() => !!(window.__subOpts && window.__subOpts.applicationServerKey && window.__subOpts.applicationServerKey.length === 65)), 'подписка с ключом webpush_public_key из GET /version');
      ok(norm(await page.locator('.toast').innerText()).includes('Уведомления включены'), '«Уведомления включены»');
      // открытие из push: ?org=&n= → заявка и отметка прочитанным
      await page.evaluate(() => { location.hash = '#/requests/req_1?org=org_test&n=n_9'; });
      await settle(page, 900);
      ok((await page.evaluate(() => location.hash)) === '#/requests/req_1', 'ссылка из push открывает заявку');
      ok(ctl.calls.some((c) => c.path === '/notifications/read' && c.body && c.body.ids && c.body.ids[0] === 'n_9'), 'notification_id из push отмечен прочитанным');
      noErrors(errors);
      await ctx.close();
    }

    // service worker: показ push по формату 9.3 и открытие заявки
    console.log('\n▶ Service worker: формат push 9.3');
    {
      const shown = [];
      const posted = [];
      const handlers = {};
      const client = { url: 'https://finpulse.smartsol.pro/#/home', focus: async () => {}, postMessage: (m) => posted.push(m) };
      const self = {
        location: { origin: 'https://finpulse.smartsol.pro' },
        registration: { scope: 'https://finpulse.smartsol.pro/', showNotification: async (t, o) => shown.push({ t, o }) },
        clients: { matchAll: async () => [client], openWindow: async () => {}, claim: async () => {} },
        addEventListener: (n, f) => { handlers[n] = f; },
        skipWaiting: () => {},
      };
      vm.runInNewContext(fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8'), { self, caches: {}, fetch: () => {}, URL, Response: {}, console });
      let wait;
      handlers.push({ data: { json: () => ({ type: 'request', title: 'Новая заявка на согласование', body: 'Откройте, чтобы посмотреть', org_id: 'org_alfa', request_id: 'req_8f40', notification_id: 'n_9a02', sent_at: T(TODAY, '11:30') }) }, waitUntil: (p) => { wait = p; } });
      await wait;
      ok(shown[0] && shown[0].t === 'Новая заявка на согласование' && shown[0].o.body === 'Откройте, чтобы посмотреть', 'push показывается с title и body из сообщения, без сумм');
      handlers.notificationclick({ notification: { close() {}, data: shown[0].o.data }, waitUntil: (p) => { wait = p; } });
      await wait;
      ok(posted[0] && posted[0].hash === '#/requests/req_8f40?org=org_alfa&n=n_9a02', 'нажатие → заявка нужной организации с notification_id');
      handlers.push({ data: { json: () => ({ type: 'something_new', title: 'Новое событие' }) }, waitUntil: (p) => { wait = p; } });
      await wait;
      ok(shown[1] && shown[1].o.data.hash === '#/notifications', 'неизвестный type → список уведомлений');
      // 13.22: запрос контрагента
      handlers.push({ data: { json: () => ({ type: 'counterparty_request', title: 'Запрос контрагента', body: 'Откройте, чтобы посмотреть', org_id: 'org_alfa', counterparty_request_id: 'cr_41a0', notification_id: 'n_9a07', sent_at: T(TODAY, '10:12') }) }, waitUntil: (p) => { wait = p; } });
      await wait;
      ok(shown[2] && shown[2].t === 'Запрос контрагента' && shown[2].o.data.hash === '#/cr/cr_41a0?org=org_alfa&n=n_9a07' && shown[2].o.tag === 'cr-cr_41a0', 'push counterparty_request → карточка запроса нужной организации с notification_id');
      handlers.push({ data: { json: () => ({ type: 'counterparty_request', org_id: 'org_alfa' }) }, waitUntil: (p) => { wait = p; } });
      await wait;
      ok(shown[3] && shown[3].t === 'Запрос контрагента' && shown[3].o.data.hash === '#/cr?org=org_alfa', 'push без идентификатора запроса → список запросов');
      // 1.3.1: пачка новых заявок (Посредник склеивает push за 30 с)
      handlers.push({ data: { json: () => ({ type: 'request_batch', title: 'На согласование: 3 заявки', body: 'Откройте, чтобы посмотреть', org_id: 'org_alfa', count: 3, notification_id: 'n_9b01', sent_at: T(TODAY, '10:12') }) }, waitUntil: (p) => { wait = p; } });
      await wait;
      ok(shown[4] && shown[4].t === 'На согласование: 3 заявки' && shown[4].o.body === 'Откройте, чтобы посмотреть' && shown[4].o.data.hash === '#/requests?org=org_alfa&n=n_9b01', 'push request_batch: title как прислал сервер, нажатие → список заявок организации с notification_id');
      ok(shown[4].o.tag === 'batch-n_9b01', 'тег batch-<notification_id>: своё уведомление на каждую пачку');
      handlers.notificationclick({ notification: { close() {}, data: shown[4].o.data }, waitUntil: (p) => { wait = p; } });
      await wait;
      ok(posted[posted.length - 1] && posted[posted.length - 1].hash === '#/requests?org=org_alfa&n=n_9b01', 'нажатие на пачку при открытом приложении — тот же адрес');
      // пачка разорвалась на две: вторая не заменяет первую — на экране «4 заявки» и «2 заявки»
      handlers.push({ data: { json: () => ({ type: 'request_batch', title: 'На согласование: 2 заявки', org_id: 'org_alfa', count: 2, notification_id: 'n_9b02', sent_at: T(TODAY, '10:13') }) }, waitUntil: (p) => { wait = p; } });
      await wait;
      ok(shown[5] && shown[5].o.tag === 'batch-n_9b02' && shown[5].o.tag !== shown[4].o.tag, 'вторая пачка той же организации — своё уведомление, первая не заменяется');
      handlers.push({ data: { json: () => ({ type: 'request_batch', org_id: 'org_beta', count: 2, sent_at: T(TODAY, '10:14') }) }, waitUntil: (p) => { wait = p; } });
      await wait;
      ok(shown[6] && shown[6].t === 'Новые заявки на согласование' && shown[6].o.tag === `batch-org_beta-${T(TODAY, '10:14')}` && shown[6].o.data.hash === '#/requests?org=org_beta', 'пачка без title и notification_id — «Новые заявки на согласование», тег всё равно свой');
    }

    // ---------- 6б. этап 2: 501 not_implemented ----------
    console.log('\n▶ Этап 2: 501 not_implemented (календарь, настройки) и сервер без списка отчётов');
    {
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { orgs: [ORG_OLD] });
      const STAGE2 = /^\/orgs\/[^/]+\/(calendar|reports\/)|^\/me\/settings$/;
      ctl.override = (call, { err }) => (STAGE2.test(call.path) ? (err(501, 'not_implemented', 'Раздел будет на этапе 2'), true) : false);
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      ok(norm(await page.locator('.hero').innerText()).includes('5 000 000'), 'главная грузится (сводка), хотя календарь и отчёты — 501');
      ok(await page.locator('.wk-col').count() === 7, '«Ближайшие 7 дней» — из сводки');
      const later = async (what) => {
        const txt = norm(await page.locator('.screen:not(.leaving) .scroll').innerText());
        ok(txt.includes('Раздел появится в следующей версии'), `${what}: заглушка «Раздел появится в следующей версии»`);
        ok(!txt.includes('SmartSol') && (await page.locator('.screen:not(.leaving) [data-act="retry"]').count()) === 0 && (await page.locator('.screen:not(.leaving) .err-state').count()) === 0, `${what}: без «напишите в SmartSol», без «Обновить», не ошибка`);
      };
      for (const [hash, what, tabbar] of [['#/calendar', 'календарь', true], ['#/calendar/2026-11-12', 'день календаря', false], ['#/reports', 'отчёт ДДС', true], ['#/reports/plan', 'план-факт', true], ['#/reports/debtors', 'должники', true]]) {
        await page.evaluate((h) => { location.hash = h; }, hash);
        await settle(page, 800);
        await later(what);
        if (tabbar) ok(await page.locator('.tabbar').isVisible(), `${what}: нижняя навигация на месте`);
      }
      await shot(page, '09-razdel-v-sleduyushchey-versii');
      const stage2 = ctl.calls.filter((c) => STAGE2.test(c.path));
      ok(stage2.some((c) => c.path.endsWith('/calendar')) && !stage2.some((c) => /\/reports\//.test(c.path)), 'календарь запрошен и получил 501; отчёты без списка reports не запрашиваются');
      await page.evaluate(() => { location.hash = '#/home'; });
      await settle(page, 800);
      ok((await page.locator('.screen:not(.leaving) [data-go^="#/calendar"]').count()) === 0, 'после 501 календаря главная не ведёт в календарь («Календарь >», дни, плашка)');
      ok(await page.locator('.screen:not(.leaving) .card-head:has-text("Ближайшие 7 дней") .link-btn').count() === 0, '«Календарь >» скрыт');
      ok((await page.locator('.screen:not(.leaving) [data-go="#/reports/debtors"]').count()) === 0, 'без debtors в списке отчётов «Нам должны» не ведёт в должников');
      ok(norm(await page.locator('.screen:not(.leaving) .rec-card').innerText()).includes('Долг по возрасту'), 'дебиторка по возрасту — из сводки');
      await shot(page, '10-glavnaya-bez-kalendarya');
      // профиль: без /me/settings
      await page.evaluate(() => { location.hash = '#/profile'; });
      await settle(page, 900);
      const prof = norm(await page.locator('.screen:not(.leaving) .scroll').innerText());
      ok(ctl.calls.some((c) => c.path === '/me' && c.method === 'GET'), 'профиль: GET /me');
      ok(prof.includes('Тест Руководитель') && prof.includes('+7 700 000 00 01'), 'профиль: имя и телефон из /me');
      ok((await page.locator('[data-act="logout"]').isVisible()) && (await page.locator('[data-act="logout-all"]').isVisible()), 'профиль: «Выйти» и «Выйти со всех устройств» есть');
      ok((await page.locator('[data-act="toggle"], .li-locked').count()) === 0 && (await page.locator('[data-settings="later"]').count()) === 1, 'профиль: переключатели уведомлений при 501 скрыты');
      ok((await page.locator('.screen:not(.leaving) .err-state').count()) === 0 && !prof.includes('Раздел появится'), 'профиль — не ошибка и не заглушка');
      await shot(page, '11-profil-bez-nastroek');
      await page.locator('[data-act="logout"]').click();
      await settle(page, 900);
      ok((await page.evaluate(() => location.hash)) === '#/login' && ctl.calls.some((c) => c.path === '/auth/logout'), 'из профиля можно выйти');
      noErrors(errors);
      await ctx.close();
    }

    console.log('\n▶ Профиль: /me/settings недоступны по другой причине');
    {
      const { ctx, page, errors, ctl } = await newCtx();
      ctl.override = (call, { err }) => (call.path === '/me/settings' ? (err(503, 'source_unavailable', 'Нет связи с учётом компании'), true) : false);
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      await page.evaluate(() => { location.hash = '#/profile'; });
      await settle(page, 900);
      ok((await page.locator('[data-act="logout"]').isVisible()) && (await page.locator('[data-settings="error"]').count()) === 1, '503 настроек — профиль и выход на месте, строка «не загрузились»');
      noErrors(errors);
      await ctx.close();
    }

    // ---------- 7. демо не ходит в сеть ----------
    console.log('\n▶ Демо не обращается к API');
    {
      const { ctx, page, ctl } = await newCtx();
      await page.goto(`${BASE}#/demo`);
      await settle(page, 900);
      ok((await page.locator('.login-hint').innerText()).includes('Демо'), '#/demo включает демо');
      ok(ctl.calls.filter((c) => c.path !== '/version').length === 0, 'кроме проверки версии — ни одного запроса к API');
      await ctx.close();
    }
  } catch (e) {
    failures++;
    console.error(e);
  }
  await browser.close();
  srv.close();
  console.log(failures ? `\nИТОГ: ошибок — ${failures}` : '\nИТОГ: все проверки пройдены');
  process.exit(failures ? 1 : 0);
})();
