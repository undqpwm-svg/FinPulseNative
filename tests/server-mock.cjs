// Проверка режима «сервер» по контракту «ФинПульс: API приложения руководителя» v1 (11.11.2026) без настоящего сервера:
// ответы API подменяются в браузере (page.route) по формам и кодам ошибок контракта.
// Сценарии: версия API и заголовки; вход — номер в приложении, код из Telegram (start с номером → экран кода с
// нейтральным текстом и кнопкой бота → poll: 202 pending, отказы → confirm: 200, code_invalid, code_not_sent,
// challenge_rejected wrong_code/blocked, challenge_expired, too_many_requests, source_unavailable, обрыв связи);
// переходный период — старый ответ start с match_code; тестовый сервер (?api=test); залпы одинаковых запросов;
// заявка с двумя статьями;
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
// Экран «Новое устройство» (device: new): до нажатия «Войти через Telegram» и после.
const NEW_NOTE = 'Код сам не придёт: вход с этого устройства нужно подтвердить в Telegram. Нажмите „Войти через Telegram“ — бот пришлёт код. При первом входе он попросит „Поделиться номером“.';
const NEW_DONE = 'В Telegram нажмите на код в сообщении бота — он скопируется. Вернитесь сюда и вставьте его.';
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
const ORG = { id: 'org_test', name: 'ТОО «Тест»', short_name: 'Тест', initials: 'ТТ', city: null, activity: null, money_total: 5000000, pending_requests: 1, gap: null, updated_at: T(TODAY, '10:15') };
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
  // legacy: true — сервер прежней схемы входа (match_code, токены из опроса); code — код, который «прислал бот»;
  // known: true — знакомое устройство (device: known): бот присылает код сам сразу после start (sent); false —
  // новое (device: new): код появится, когда тест выставит sent (человек открыл бота). noDevice: true — сервер
  // без поля device в ответе start. queue / confirmQueue — исходы очередных опросов и вводов кода;
  // delay — задержка ответов на GET, мс (медленная 1С).
  ctl.state = { cookie: false, access: 'at_1', decided: false, orgs: [ORG], partial: false, queue: [], confirmQueue: [], starts: 0, legacy: false, known: true, code: '483921', sent: false, tries: 5, delay: 0, settings: { requests: true, summary: true, payments: true, gaps: true, whatsapp: false }, ...ctl.state };
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
      // Ответ 200 одинаков для любого номера. Сервер прежней схемы тело не читает.
      if (!st.legacy) {
        let d = String((body && body.phone) || '').replace(/\D/g, '');
        if (d.length === 11 && d[0] === '8') d = `7${d.slice(1)}`;
        if (d.length !== 11) return err(422, 'validation_error', 'Проверьте поля запроса.', { fields: { phone: 'Не номер' } });
      }
      st.starts++;
      st.challenge = `ch_${st.starts}`;
      st.sent = !st.legacy && !!st.known; // знакомое устройство: бот прислал код сам
      st.tries = 5;
      // сервер прежней схемы: число для выбора в боте, поля code_length нет
      if (st.legacy) return json(200, { challenge_id: st.challenge, bot_url: `${BOT}?start=n_${st.starts}`, match_code: st.starts === 1 ? '47' : '05', expires_in: 300, poll_interval: 1 });
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
      if (st.legacy) {
        if (o === 'revoked') return err(403, 'access_revoked', 'Этот номер не подключён к ФинПульсу. Обратитесь к администратору компании', { reason: 'not_connected' });
        if (o === 'wrong') return err(409, 'challenge_rejected', 'В Telegram выбрано другое число. Начните вход заново.', { reason: 'wrong_number' });
        if (o === 'ok') return tokens(); // прежняя схема: токены выдаёт опрос
        return json(202, { status: 'pending' });
      }
      // новая схема: опрос токенов не выдаёт и о том, отправлен ли код, не сообщает — всегда 202 pending
      return json(202, { status: 'pending' });
    }
    if (p === '/auth/telegram/confirm') {
      if (st.legacy) return err(404, 'not_found', 'Не найдено'); // на сервере прежней схемы такого метода нет
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
    if (p === '/orgs/org_test/reports/plan-fact' && st.noPlan) return json(200, { updated_at: T(TODAY, '10:15'), month: '2026-10', title: 'Октябрь 2026', has_plan: false, income: [{ article: 'Оплата от покупателей', plan: null, fact: 68750000 }], expense: [{ article: 'Аренда', plan: null, fact: 1900000 }, { article: 'Связь', plan: null, fact: 50000 }] });
    if (p === '/orgs/org_test/reports/cash-flow') return json(200, { updated_at: T(TODAY, '10:15'), month: '2026-10', title: 'Октябрь 2026', inflow: 24000000, outflow: 21650000, weeks: [{ label: '1–4', from: '2026-10-01', to: '2026-10-04', inflow: 9800000, outflow: 8450000 }, { label: '5–11', from: '2026-10-05', to: '2026-10-11', inflow: 14200000, outflow: 13200000 }] });
    if (p === '/orgs/org_test/reports/plan-fact') return json(200, { updated_at: T(TODAY, '10:15'), month: '2026-10', title: 'Октябрь 2026', has_plan: true, income: [{ article: 'Оплата от покупателей', plan: 72000000, fact: 68750000 }], expense: [{ article: 'Аренда', plan: 1800000, fact: 1900000 }, { article: 'Связь', plan: null, fact: 50000 }] });
    if (p === '/orgs/org_test/reports/debtors') return json(200, { updated_at: T(TODAY, '10:15'), date: TODAY, total: 3000000, aging: { days_0_30: 2000000, days_31_60: 500000, days_over_60: 500000 }, items: [{ counterparty: 'ТОО «Должник»', amount: 1200000, aging: { days_0_30: 200000, days_31_60: 500000, days_over_60: 500000 }, oldest_days: 74 }] });
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
      // Начать вход с экрана входа: номер → «Получить код» → экран кода
      const begin = async (number = '7015551234') => {
        await phone().fill(number);
        await startBtn().click();
        await input().waitFor({ timeout: 8000 });
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

      // start → device: new → экран «Новое устройство» (от номера не зависит)
      await begin();
      await settle(page, 900);
      const start = starts().slice(-1)[0];
      ok(start.method === 'POST' && JSON.stringify(start.body) === JSON.stringify({ phone: '+77015551234' }) && !start.headers.authorization, 'POST /auth/telegram/start {phone: "+77015551234"}, без Authorization');
      ok((await page.evaluate(() => window.__cred)).filter((c) => c.url.includes('/auth/telegram/start')).every((c) => c.credentials === 'include'), 'start — с credentials: include (метка знакомого устройства в cookie)');
      ok(ctl.popups.length === 0, 'bot_url сразу не открывается');
      ok((await page.locator('[data-tg-device]').getAttribute('data-tg-device')) === 'new' && norm(await page.locator('.login-title').innerText()) === 'Новое устройство', 'device: new → экран «Новое устройство»');
      ok(norm(await page.locator('[data-tg-phone]').innerText()) === '+7 701 555 12 34' && norm(await page.locator('[data-tg-change]').innerText()) === 'Изменить номер', 'на экране — введённый номер и «Изменить номер»');
      ok((await page.locator('[data-tg-code]').count()) === 0, 'числа для выбора на экране нет');
      ok((await page.locator('.tg-cells i').count()) === 6, 'поле кода — по code_length (6 цифр)');
      ok((await input().getAttribute('inputmode')) === 'numeric' && (await input().getAttribute('autocomplete')) === 'one-time-code', 'поле: inputmode="numeric", autocomplete="one-time-code"');
      ok(await page.locator('[data-tg-submit]').isDisabled(), '«Войти» неактивна, пока код не введён целиком');
      ok(norm(await page.locator('[data-tg-note]').innerText()) === NEW_NOTE, 'новое устройство: объяснение — код сам не придёт, нужно «Войти через Telegram»');
      const openBtn = page.locator('.screen:not(.leaving) [data-tg-open]');
      ok(norm(await openBtn.innerText()).includes('Войти через Telegram') && (await openBtn.getAttribute('href')) === `${BOT}?start=n_${st.starts}` && (await openBtn.getAttribute('target')) === '_blank', 'кнопка «Войти через Telegram» — ссылка bot_url этого входа');
      ok(await openBtn.evaluate((e) => e.classList.contains('btn-primary')), 'новое устройство: «Войти через Telegram» — главная кнопка');
      ok(await page.evaluate(() => {
        const help = document.querySelector('.screen:not(.leaving) [data-tg-help]');
        const field = document.querySelector('.screen:not(.leaving) [data-tg-field]');
        return !!(help.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING);
      }), 'новое устройство: поле кода — ниже кнопки бота');
      ok(norm(await page.locator('[data-tg-status]').innerText()) === 'Код действует 5 минут' && (await page.locator('[data-tg-left]').count()) === 0, '«Код действует 5 минут» — подсказка без таймера');
      ok(!/не подключ/i.test(norm(await page.locator('.screen:not(.leaving)').innerText())), 'сообщения «номер не подключён» на экране нет');
      await shot(page, '02a-novoe-ustroystvo');
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
      await shot(page, '02b-novoe-ustroystvo-posle-bota');

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
      await page.locator('.screen:not(.leaving) [data-tg-input]').waitFor({ timeout: 8000 });
      await settle(page, 700);
      ok((await page.locator('[data-tg-device]').getAttribute('data-tg-device')) === 'new' && norm(await page.locator('.login-title').innerText()) === 'Новое устройство', 'нет поля device → экран «Новое устройство»');
      await page.locator('.screen:not(.leaving) [data-tg-input]').fill(ctl.state.code);
      await page.waitForFunction(() => location.hash === '#/home', null, { timeout: 12000 });
      ok(true, 'код с этого экрана принимается → вход выполнен');
      noErrors(errors);
      await ctx.close();
    }

    // ---------- 1а. переходный период: сервер прежней схемы ----------
    console.log('\n▶ Переходный период: сервер отвечает по-старому (match_code) — прежний экран с числом');
    {
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { legacy: true });
      const st = ctl.state;
      await page.goto(BASE);
      await settle(page, 900);
      await page.locator('#login-phone').fill('7015551234');
      await page.locator('[data-act="tg-start"]').click();
      await page.waitForFunction(() => location.hash === '#/telegram');
      await settle(page, 900);
      ok(ctl.calls.find((c) => c.path === '/auth/telegram/start').body.phone === '+77015551234', 'номер уходит в start и на старый сервер (он его не читает)');
      ok((await page.locator('[data-tg-code]').innerText()).trim() === '47', 'match_code крупно: «47»');
      ok(norm(await page.locator('.login-title').innerText()).includes('Выберите в Telegram число') && (await page.locator('[data-tg-input]').count()) === 0, '«Выберите в Telegram число», поля кода нет');
      const openOld = page.locator('[data-tg-open]');
      ok(ctl.popups.length === 0 && (await openOld.getAttribute('href')) === `${BOT}?start=n_1` && norm(await openOld.innerText()).includes('Открыть Telegram'), 'бот открывается кнопкой «Открыть Telegram» по bot_url');
      ok(norm(await page.locator('[data-tg-status]').innerText()).includes('Ждём подтверждения'), 'статус «Ждём подтверждения в Telegram»');
      await shot(page, '10-staraya-shema-chislo');
      await settle(page, 1300);
      ok((await page.locator('#tg-err').isHidden()) && (await page.evaluate(() => location.hash)) === '#/telegram', '202 — ждём дальше');
      st.queue = ['wrong'];
      await page.waitForSelector('.screen:not(.leaving) #tg-err:not([hidden])', { timeout: 8000 });
      ok(norm(await page.locator('.screen:not(.leaving) #tg-err').innerText()).includes('В Telegram выбрано другое число. Начните вход заново.'), '409 challenge_rejected wrong_number — текст message, «Начать заново»');
      st.queue = ['pending', 'ok'];
      await page.locator('[data-restart]').click();
      await page.waitForFunction(() => location.hash === '#/home', null, { timeout: 12000 });
      await settle(page, 700);
      ok(st.starts === 2 && st.cookie, 'новый вход: опрос ответил 200 с токенами → вход выполнен');
      ok(!ctl.calls.some((c) => c.path === '/auth/telegram/confirm'), 'по старой схеме confirm не вызывается');
      ok(norm(await page.locator('.hero').innerText()).includes('5 000 000'), 'главная открылась');
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
      ok((await page.locator('.sheet .push-offer').count()) === 0 && !ctl.calls.some((c) => c.path === '/devices'), 'push в тестовой вкладке не предлагается и не регистрируется');
      await shot(page, '11-test-plashka');
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
      await shot(page, '12-zayavka-dve-stati');
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
    }

    // ---------- 6б. этап 2: 501 not_implemented ----------
    console.log('\n▶ Этап 2: 501 not_implemented (календарь, отчёты, настройки)');
    {
      const { ctx, page, errors, ctl } = await newCtx();
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
      ok(stage2.some((c) => c.path.endsWith('/calendar')) && ['cash-flow', 'plan-fact', 'debtors'].every((r) => stage2.some((c) => c.path.endsWith(`/reports/${r}`))), 'все методы этапа 2 вызывались и получили 501');
      await page.evaluate(() => { location.hash = '#/home'; });
      await settle(page, 800);
      ok((await page.locator('.screen:not(.leaving) [data-go^="#/calendar"]').count()) === 0, 'после 501 календаря главная не ведёт в календарь («Календарь >», дни, плашка)');
      ok(await page.locator('.screen:not(.leaving) .card-head:has-text("Ближайшие 7 дней") .link-btn').count() === 0, '«Календарь >» скрыт');
      ok((await page.locator('.screen:not(.leaving) [data-go="#/reports/debtors"]').count()) === 0, 'после 501 отчёта «Нам должны» не ведёт в должников');
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
