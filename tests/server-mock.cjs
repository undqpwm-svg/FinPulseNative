// Проверка режима «сервер» по контракту «ФинПульс: API приложения руководителя» v1 (11.11.2026) без настоящего сервера:
// ответы API подменяются в браузере (page.route) по формам и кодам ошибок контракта.
// Сценарии: версия API и заголовки; вход (resend_too_early, too_many_requests, phone_blocked, invalid_code, code_expired,
// source_unavailable с повтором того же кода, access_revoked); выбор организации (несколько / одна); обновление токенов
// (одно на все запросы, refresh_invalid, access_revoked); «1С недоступна»; решения (успех, already_decided,
// not_awaiting_you, action_failed, обрыв связи и повтор с тем же Idempotency-Key); настройки; уведомления; push.
// Запуск: node tests/server-mock.cjs [--shots]
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DOCS = path.join(__dirname, '..', 'docs');
const API = 'https://api.smartsol.pro/api/v1';
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
const ORG = { id: 'org_test', name: 'ТОО «Тест»', short_name: 'Тест', initials: 'ТТ', city: null, activity: null, money_total: 5000000, pending_requests: 1, gap: null, available: true, updated_at: T(TODAY, '10:15') };
const ORG2 = { id: 'org_off', name: 'ТОО «Без связи»', short_name: 'Без связи', initials: 'БС', city: null, activity: null, money_total: null, pending_requests: null, gap: null, available: false, updated_at: null };

function calDays() {
  return Array.from({ length: 28 }, (_, i) => {
    const opening = 5000000 - i * 10000;
    return {
      date: day(i), opening, inflow: i % 3 ? 300000 : 0, outflow: 310000, closing: opening - 10000 - (i % 3 ? 0 : 300000) + (i % 3 ? 0 : 300000), gap: false,
      items: [{ direction: 'out', counterparty: 'ТОО «Тест Поставщик»', article: 'Аренда', note: null, amount: 310000, currency: 'KZT', source: 'planned_payment', request_id: null, late: false, preliminary: false }],
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

const listItem = (c) => ({ id: c.id, number: c.number, status: c.status, my_action: c.my_action, counterparty: c.counterparty, amount: c.amount, currency: c.currency, amount_kzt: c.amount_kzt, article: c.article, purpose: c.purpose, pay_by: c.pay_by, created_at: c.created_at, initiator: { name: 'Тест Инициатор', initials: 'ТИ' }, over_limit: 0, my_decision_at: c.my_decision_at });

function summary() {
  const d = calDays();
  return {
    org_id: 'org_test', date: TODAY, updated_at: T(TODAY, '10:15'),
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
  ctl.state = { refresh: 'rt_1', access: 'at_1', decided: false, orgs: [ORG], settings: { requests: true, summary: true, payments: true, gaps: true, whatsapp: false }, ...ctl.state };
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace('/api/v1', '');
    let body = null;
    try {
      body = req.postDataJSON();
    } catch (e) {
      body = null;
    }
    const call = { method: req.method(), path: p, query: Object.fromEntries(url.searchParams), body, headers: req.headers() };
    ctl.calls.push(call);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Idempotent-Replayed, Retry-After, Content-Disposition' };
    const json = (status, data, headers = {}) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', headers: { ...cors, ...headers }, body: data === null ? '' : JSON.stringify(data) });
    const err = (status, error, message = '', details = undefined, headers = {}) => json(status, { error, message, ...(details ? { details } : {}) }, headers);
    const st = ctl.state;
    if (ctl.override && ctl.override(call, { json, err, route, st })) return undefined;

    if (p === '/version') return json(200, { api_version: '1.0', min_app_version: '1.0.0', server_time: T(TODAY, '10:00'), webpush_public_key: 'BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5cW8OCzVI3YvMClY4f3hHsqeY3m6Iyjn6CbsXzc' });
    if (p === '/auth/code') {
      const phone = body && body.phone;
      if (!/^\+7\d{10}$/.test(phone || '')) return err(422, 'validation_error', 'Номер не в формате E.164');
      if (phone === '+77000000002') return err(429, 'resend_too_early', 'Повторно — через 42 секунды', { retry_after: 42 }, { 'Retry-After': '42' });
      if (phone === '+77000000003') return err(429, 'too_many_requests', 'Слишком много кодов', { retry_after: 1800 });
      if (phone === '+77000000004') return err(429, 'phone_blocked', 'Номер заблокирован', { retry_after: 900 });
      return json(200, { challenge_id: 'ch_1', channel: 'whatsapp', code_length: 4, expires_in: 300, resend_after: 60 });
    }
    if (p === '/auth/token') {
      const code = body && body.code;
      if (code === '0000') return err(400, 'invalid_code', 'Неверный код. Осталось попыток: 3', { attempts_left: 3 });
      if (code === '1111') return err(400, 'code_expired', 'Код просрочен');
      if (code === '2222') return err(429, 'phone_blocked', 'Номер заблокирован на 15 минут', { retry_after: 900 });
      if (code === '3333' && !st.sourceBack) return err(503, 'source_unavailable', 'Учёт компании не отвечает', undefined, { 'Retry-After': '30' });
      if (code === '4444') return err(403, 'access_revoked', 'Доступ к приложению выключен администратором компании');
      return json(200, { access_token: st.access, access_expires_in: 900, refresh_token: st.refresh, refresh_expires_in: 2592000, token_type: 'Bearer', user: USER });
    }
    if (p === '/auth/refresh') {
      if (st.revokeOnRefresh) return err(403, 'access_revoked', 'Администратор выключил вам доступ к приложению');
      if (!body || body.refresh_token !== st.refresh) return err(401, 'refresh_invalid', 'Сессия закончилась');
      st.refreshCount = (st.refreshCount || 0) + 1;
      st.refresh = `rt_${st.refreshCount + 1}`;
      st.access = `at_${st.refreshCount + 1}`;
      return json(200, { access_token: st.access, access_expires_in: 900, refresh_token: st.refresh, refresh_expires_in: 2592000, token_type: 'Bearer' });
    }
    // всё дальше — с авторизацией
    const auth = req.headers().authorization || '';
    if (st.expireAccess && auth === `Bearer ${st.expireAccess}`) return err(401, 'token_expired', 'Токен истёк');
    if (auth !== `Bearer ${st.access}`) return err(401, 'unauthorized', 'Нет авторизации');
    if (p === '/auth/logout' || p === '/auth/logout-all') return route.fulfill({ status: 204, headers: cors });
    if (p === '/me') return json(200, { user: USER });
    if (p === '/me/settings' && req.method() === 'GET') return json(200, settingsBody(st));
    if (p === '/me/settings' && req.method() === 'PUT') {
      const n = (body && body.notifications) || {};
      for (const [k, v] of Object.entries(n)) {
        if (k === 'whatsapp') return err(422, 'validation_error', 'Переключатель настраивает администратор');
        st.settings[k] = !!v.enabled;
      }
      return json(200, settingsBody(st));
    }
    if (p === '/orgs') return json(200, { items: st.orgs });
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
      return json(200, { updated_at: T(TODAY, '10:15'), items: st.decided ? [] : [listItem(c)], next_cursor: null });
    }
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

async function login(page, { phone = '7000000001', code = '4817', expect = '#/home' } = {}) {
  await page.locator('#phone').fill(phone);
  await page.locator('[data-submit]').click();
  await page.waitForFunction(() => location.hash === '#/code');
  await settle(page, 400);
  await page.locator('#code').fill(code);
  await page.waitForFunction((h) => location.hash === h, expect, { timeout: 8000 });
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
    const ctl = { state };
    await mockApi(page, ctl);
    return { ctx, page, errors, ctl };
  };
  const noErrors = (errors) => ok(errors.length === 0, `нет ошибок в консоли${errors.length ? `: ${errors.join(' | ')}` : ''}`);

  try {
    // ---------- 1. вход ----------
    console.log('\n▶ Вход по коду из WhatsApp (контракт, 2)');
    {
      const { ctx, page, errors, ctl } = await newCtx(devices['iPhone 13'], { orgs: [ORG, ORG2] });
      await page.goto(BASE);
      await settle(page, 900);
      ok((await page.evaluate(() => location.hash)) === '#/login', 'по умолчанию — настоящий вход');
      const ver = ctl.calls.find((c) => c.path === '/version');
      ok(ver && ver.headers['x-app-version'] === '1.0.0' && ver.headers['x-app-platform'] === 'web', 'при запуске GET /version с X-App-Version и X-App-Platform');
      await shot(page, '01-vhod');
      const codeErr = async (phone) => {
        await page.locator('#phone').fill(phone);
        await page.locator('[data-submit]').click();
        await settle(page, 600);
        return norm(await page.locator('#login-err').innerText());
      };
      ok((await codeErr('7000000002')).includes('Код уже отправлен. Новый можно запросить через 42 секунды'), 'resend_too_early — «код уже отправлен, через 42 секунды»');
      ok((await codeErr('7000000003')).includes('уже отправлено 5 кодов за час. Повторите через 30 минут'), 'too_many_requests — «5 кодов за час»');
      ok((await codeErr('7000000004')).includes('Номер заблокирован после 5 неверных кодов. Повторите через 15 минут'), 'phone_blocked при запросе кода — понятный текст');
      await page.locator('#phone').fill('7000000001');
      await page.locator('[data-submit]').click();
      await page.waitForFunction(() => location.hash === '#/code');
      await settle(page, 400);
      const req = ctl.calls.find((c) => c.path === '/auth/code' && c.body.phone === '+77000000001');
      ok(!!req, 'POST /auth/code с номером в E.164');
      ok(await page.locator('.code-box').count() === 4, 'длина кода из code_length (4)');
      ok(norm(await page.locator('.login-sub').innerText()).includes('+7 700 000 00 01'), '«Отправили на +7 700 000 00 01»');
      const verify = async (code) => {
        await page.locator('#code').fill(code);
        await settle(page, 700);
        return norm(await page.locator('#code-err').innerText());
      };
      ok((await verify('0000')).includes('Неверный код. Осталось попыток: 3'), 'invalid_code — число попыток из attempts_left');
      ok(ctl.calls.some((c) => c.path === '/auth/token' && c.body.challenge_id === 'ch_1' && c.body.code === '0000'), 'POST /auth/token с challenge_id и кодом');
      await shot(page, '02-nevernyy-kod');
      ok((await verify('1111')).includes('Код истёк'), 'code_expired — «Код истёк — запросите новый»');
      ok(await page.locator('[data-act="resend"]').isVisible(), 'после code_expired — «Отправить код ещё раз»');
      await page.locator('[data-act="resend"]').click();
      await settle(page, 700);
      ok((await verify('3333')).includes('Нет связи с учётом компании. Код действует ещё'), 'source_unavailable — «Нет связи с учётом компании», код сохранён');
      ok((await page.locator('#code').inputValue()) === '3333', 'введённый код не стёрт');
      await shot(page, '03-net-svyazi-s-uchetom');
      ctl.state.sourceBack = true;
      await page.locator('[data-act="code-retry"]').click();
      await page.waitForFunction(() => location.hash === '#/orgs', null, { timeout: 8000 });
      await settle(page, 800);
      ok(true, '«Повторить» с тем же кодом → вход');
      ok(await page.locator('.org-card').count() === 2, 'организаций две → экран выбора');
      ok(norm(await page.locator('.org-card[data-id="org_off"]').innerText()).includes('нет связи с 1С'), 'available: false — пометка «нет связи с 1С»');
      await shot(page, '04-vybor-organizacii');
      const sess = await page.evaluate(() => localStorage.getItem('finpuls-session'));
      ok(sess && sess.includes('rt_1') && !sess.includes('at_1'), 'в хранилище — refresh-токен; access-токен только в памяти');
      await page.locator('[data-act="pick-org"][data-id="org_test"]').click();
      await settle(page, 900);
      ok((await page.evaluate(() => location.hash)) === '#/home', 'выбрали организацию → главная');
      ok(norm(await page.locator('.hero').innerText()).includes('5 000 000'), 'главная из GET /orgs/{id}/summary');
      ok(ctl.calls.some((c) => c.path === '/orgs/org_test/summary' && c.headers.authorization === 'Bearer at_1'), 'запросы данных с Bearer access-токеном');
      noErrors(errors);
      await ctx.close();
    }

    console.log('\n▶ Вход: одна организация и отзыв доступа');
    {
      const { ctx, page, errors, ctl } = await newCtx();
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, { code: '2222', expect: '#/code' });
      ok(norm(await page.locator('#code-err').innerText()).includes('номер заблокирован на 15 минут'), 'phone_blocked при вводе кода — таймер блокировки');
      ok(await page.locator('#code').isDisabled(), 'ввод кода заблокирован');
      await page.locator('[data-back]').click();
      await settle(page, 600);
      await login(page, { code: '4444', expect: '#/login' });
      ok(norm(await page.locator('#login-err').innerText()).includes('Доступ к приложению выключен администратором компании'), 'access_revoked — текст message, возврат на ввод номера');
      await shot(page, '05-dostup-vyklyuchen');
      await login(page, { code: '4817' });
      ok((await page.evaluate(() => location.hash)) === '#/home', 'одна организация → сразу главная');
      noErrors(errors);
      await ctx.close();
    }

    // ---------- 2. токены ----------
    console.log('\n▶ Обновление токенов (контракт, 2.3)');
    {
      const { ctx, page, errors, ctl } = await newCtx();
      await page.goto(BASE);
      await settle(page, 800);
      await login(page);
      // access-токен истёк: все запросы главной получают 401 token_expired — обновление должно быть одно
      ctl.state.expireAccess = ctl.state.access;
      ctl.state.access = 'at_never';
      const before = ctl.calls.length;
      ctl.override = (call, { json, st }) => {
        if (call.path === '/auth/refresh' && call.body && call.body.refresh_token === st.refresh) {
          st.refreshCount = (st.refreshCount || 0) + 1;
          st.refresh = 'rt_new';
          st.access = 'at_new';
          json(200, { access_token: 'at_new', access_expires_in: 900, refresh_token: 'rt_new', refresh_expires_in: 2592000, token_type: 'Bearer' });
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
      ok((await page.evaluate(() => localStorage.getItem('finpuls-session'))).includes('rt_new'), 'новый refresh-токен сохранён');
      ok(norm(await page.locator('.hero').innerText()).includes('5 000 000'), 'главная открылась без выхода');
      // refresh_invalid → вход
      ctl.override = null;
      ctl.state.expireAccess = 'at_new';
      ctl.state.access = 'at_other';
      ctl.state.refresh = 'rt_other';
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
      await login(page);
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
      await login(page);
      ctl.override = (call, { err }) => (call.path === '/orgs/org_test/calendar' ? (err(503, 'source_unavailable', 'Учёт компании не отвечает', undefined, { 'Retry-After': '30' }), true) : false);
      await page.locator('.tabbar .tab[data-go="#/calendar"]').click();
      await settle(page, 900);
      ok(norm(await page.locator('.err-state').innerText()).includes('1С сейчас недоступна'), '503 source_unavailable — «1С сейчас недоступна» и «Обновить»');
      await shot(page, '06-1s-nedostupna');
      ctl.override = null;
      await page.locator('.err-state [data-act="retry"]').click();
      await settle(page, 900);
      ok(await page.locator('.wk-table').isVisible(), '«Обновить» → календарь из GET /calendar');
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
      await login(page);
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
      // already_decided — приложение перечитывает карточку и пишет, кто и когда
      ctl.override = (call, { err, json }) => {
        if (call.path.endsWith('/approve')) return err(409, 'already_decided', 'Решение уже принято'), true;
        if (call.path === '/orgs/org_test/requests/req_1' && call.method === 'GET' && ctl.state.conflictCard) {
          return json(200, card({ status: 'approved', my_action: 'none', route: [card().route[0], { stage: 1, kind: 'approval', approver: { name: 'Тест Заместитель', initials: 'ТЗ', position: null, is_group: false }, is_me: false, state: 'done', decision: 'approved', at: T(TODAY, '10:05'), comment: null, on_behalf_of: 'Тест Руководитель', due_at: null }] })), true;
        }
        return false;
      };
      ctl.state.conflictCard = true;
      await approve();
      await settle(page, 900);
      ok(norm(await page.locator('.decision-state').innerText()).includes('Заявка уже согласована: Тест Заместитель, сегодня, 10:05'), '409 already_decided — кто и когда (из перечитанной карточки)');
      await shot(page, '07-uzhe-soglasovano');
      await page.locator('.sheet [data-act="decision-to-list"]').click();
      await settle(page, 800);
      ctl.state.conflictCard = false;
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
      ok(dec.every((c) => c.headers['x-app-version'] === '1.0.0' && c.method === 'POST'), 'POST …/approve с X-App-Version');
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
      await login(page);
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
      await login(page);
      await page.evaluate(() => { location.hash = '#/profile'; });
      await settle(page, 900);
      await page.locator('[data-act="toggle"][data-k="payments"]').click();
      await settle(page, 600);
      const put = ctl.calls.find((c) => c.method === 'PUT' && c.path === '/me/settings');
      ok(put && JSON.stringify(put.body) === JSON.stringify({ notifications: { payments: { enabled: false } } }), 'PUT /me/settings — только изменённый enabled');
      await page.locator('[data-act="toggle"][data-k="whatsapp"]').click();
      await settle(page, 600);
      ok((await page.locator('[data-act="toggle"][data-k="whatsapp"]').getAttribute('aria-checked')) === 'false', 'whatsapp (editable: false) не меняется');
      ok(!ctl.calls.some((c) => c.method === 'PUT' && c.body && c.body.notifications && c.body.notifications.whatsapp), 'запрос на whatsapp не отправлен');
      await page.evaluate(() => { location.hash = '#/reports/debtors'; });
      await settle(page, 900);
      ok(norm(await page.locator('.rep-body').innerText()).includes('ТОО «Должник»'), 'должники из GET /reports/debtors');
      await page.evaluate(() => { location.hash = '#/reports/plan'; });
      await settle(page, 900);
      ok(norm(await page.locator('.rep-body').innerText()).includes('Аренда'), 'план-факт из GET /reports/plan-fact');
      await page.evaluate(() => { location.hash = '#/notifications'; });
      await settle(page, 900);
      const nl = ctl.calls.find((c) => c.path === '/notifications' && c.query.org_id === 'org_test');
      ok(!!nl, 'GET /notifications?org_id=…');
      await page.locator('.notif[data-id="n_1"]').click();
      await settle(page, 900);
      ok((await page.evaluate(() => location.hash)) === '#/requests/req_1', 'link.kind = request → карточка заявки');
      const rd = ctl.calls.find((c) => c.path === '/notifications/read');
      ok(rd && JSON.stringify(rd.body) === JSON.stringify({ ids: ['n_1'] }), 'POST /notifications/read {ids}');
      await page.evaluate(() => { location.hash = '#/profile'; });
      await settle(page, 800);
      await page.locator('[data-act="logout"]').click();
      await settle(page, 900);
      const lo = ctl.calls.find((c) => c.path === '/auth/logout');
      ok(lo && lo.body.refresh_token === 'rt_1', 'POST /auth/logout с refresh_token');
      ok((await page.evaluate(() => location.hash)) === '#/login' && !(await page.evaluate(() => localStorage.getItem('finpuls-session'))), 'выход → вход, токены удалены');
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
      await login(page);
      await settle(page, 1500);
      ok(norm(await page.locator('.sheet .push-offer').innerText()).includes('Уведомления о новых заявках'), 'после входа — предложение включить уведомления');
      await page.locator('.sheet [data-act="push-enable"]').click();
      await settle(page, 900);
      const dev = ctl.calls.find((c) => c.path === '/devices' && c.method === 'POST');
      ok(dev && dev.body.platform === 'web' && dev.body.provider === 'webpush' && dev.body.subscription.endpoint && dev.body.subscription.keys.p256dh && dev.body.app_version === '1.0.0', 'POST /devices {platform: web, provider: webpush, subscription, app_version}');
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
