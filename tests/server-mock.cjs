// Проверка режима «сервер» без настоящего сервера: ответы API подменяются в браузере (page.route).
// Сценарии: вход по коду (ошибки кода, лимиты), одна организация, 1С недоступна → «Обновить», сессия истекла → вход,
// согласование: «Отправляется…», успех, «уже согласовано», «нет прав», «нет связи — повторить» с тем же ключом, push.
// Запуск: node tests/server-mock.cjs  (поднимает свой сервер для /docs). Формы ответов — spec/api-client.md.
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');
const SHOTS = path.join(__dirname, '..', 'screenshots', 'server');
const SAVE = process.argv.includes('--shots');
const shot = async (page, name) => {
  if (!SAVE) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};
const API = 'https://api.smartsol.pro/v1';
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
const norm = (t) => t.replace(/ /g, ' ');
const settle = (p, ms = 500) => p.waitForTimeout(ms);

// ---------- поддельный сервер ----------
const TODAY = '2026-11-11';
const day = (i) => {
  const d = new Date(Date.UTC(2026, 10, 11 + i));
  return d.toISOString().slice(0, 10);
};
function fixtures() {
  const calendarDays = Array.from({ length: 28 }, (_, i) => ({
    date: day(i), start: 5000000 - i * 10000, end: 5000000 - (i + 1) * 10000, in: i % 3 ? 300000 : 0, out: 310000,
    items: [{ dir: 'out', who: 'ТОО «Тест Поставщик»', article: 'Аренда', note: '', amount: 310000, requestId: null }],
  }));
  const req = {
    id: 'R-1', num: '901', contractor: 'ТОО «Тест Поставщик»', amount: 1500000, currency: 'KZT', article: 'Аренда',
    purpose: 'Аренда склада за декабрь', initiator: { name: 'Тест Инициатор', initials: 'ТИ', role: 'Бухгалтер' },
    due: day(3), overLimit: 0, status: 'pending', decidedAt: null,
  };
  return {
    orgs: { items: [{ id: 'org-1', name: 'ТОО «Тест»', short: 'Тест', initials: 'ТТ', city: 'Алматы', activity: 'услуги', summary: { money: 5000000, pending: 1, gap: null } }] },
    home: {
      today: TODAY, asOf: `${TODAY}T10:15:00`, horizonDays: 28,
      user: { id: 'u1', name: 'Тест Руководитель', firstName: 'Тест', initials: 'ТР', role: 'Директор', phone: '+7 700 *** ** 01' },
      org: { id: 'org-1', name: 'ТОО «Тест»', short: 'Тест', initials: 'ТТ' },
      money: { total: 5000000, bank: 4800000, cash: 200000 }, threshold: 0,
      forecast: { start: 5000000, days: calendarDays.slice(0, 14).map((d) => ({ date: d.date, end: d.end })) },
      gap: null, minBalance: { date: day(27), amount: 4720000 },
      approvals: { count: 1, sum: 1500000, overLimit: 0 },
      week: calendarDays.slice(0, 7).map((d) => ({ date: d.date, in: d.in, out: d.out, end: d.end })),
      receivables: { total: 3000000, overdue: 500000, worst: { name: 'ТОО «Должник»', days: 12 } }, unread: 0,
    },
    calendar: { today: TODAY, threshold: 0, days: calendarDays },
    requests: { today: TODAY, items: [req] },
    request: {
      today: TODAY, ...req, payFrom: 'Тест Банк · KZ•• 0001', createdAt: `${TODAY}T09:00:00`, comment: 'Как обычно',
      budget: { period: 'декабрь', limit: 2000000, used: 0 }, impact: { date: day(3), before: 4960000, after: 3460000, inCalendar: false },
      attachments: [], canDecide: true,
      route: [
        { name: 'Тест Инициатор', role: 'Инициатор', me: false, status: 'created', at: `${TODAY}T09:00:00`, comment: '' },
        { name: 'Тест Руководитель', role: 'Директор', me: true, status: 'pending', at: null, comment: '' },
      ],
    },
    settings: { summary: true, requests: true, payments: true, gaps: true, whatsapp: false },
  };
}

async function mockApi(page, ctl) {
  const fx = fixtures();
  ctl.calls = [];
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace('/v1', '');
    const body = req.postDataJSON ? (() => { try { return req.postDataJSON(); } catch (e) { return null; } })() : null;
    ctl.calls.push({ method: req.method(), path: p, body, headers: req.headers() });
    const json = (status, data, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', ...headers }, body: JSON.stringify(data) });
    const err = (status, code, details = {}) => json(status, { error: { code, message: code, details } });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    if (ctl.override && ctl.override(p, req, { json, err, route })) return undefined;
    if (p === '/auth/otp/request') {
      if (body.phone === '+77000000000') return err(429, 'rate_limited', { retryAfter: 600 });
      return json(200, { requestId: 'otp-1', codeLength: 6, expiresIn: 300, resendIn: 30, phoneMasked: '+7 700 ··· 00 01' });
    }
    if (p === '/auth/otp/verify') {
      if (body.code === '000000') return err(422, 'code_invalid', { attemptsLeft: 2 });
      if (body.code === '111111') return err(422, 'code_expired');
      if (body.code === '222222') return err(429, 'too_many_attempts', { retryAfter: 900 });
      return json(200, { token: 'tok-abc', expiresAt: '2099-01-01T00:00:00Z', user: fx.home.user });
    }
    const auth = req.headers().authorization;
    if (auth !== 'Bearer tok-abc') return err(401, 'unauthorized');
    if (p === '/orgs') return json(200, fx.orgs);
    if (p === '/me/settings') return json(200, fx.settings);
    if (p === '/me') return json(200, fx.home.user);
    if (p === '/push/config') return json(200, { vapidPublicKey: null });
    if (p === '/orgs/org-1/home') return json(200, fx.home);
    if (p === '/orgs/org-1/calendar') return json(200, fx.calendar);
    if (p === '/orgs/org-1/requests') return json(200, ctl.decided ? { today: TODAY, items: [] } : fx.requests);
    if (p === '/orgs/org-1/requests/R-1') return json(200, fx.request);
    if (p === '/orgs/org-1/requests/R-1/decision') {
      ctl.decided = true;
      return json(200, { decision: 'approved', requestStatus: 'approved', paymentDate: day(3), nextApprover: null });
    }
    if (p === '/orgs/org-1/notifications') return json(200, { today: TODAY, items: [] });
    return err(404, 'not_found');
  });
}

async function login(page, ctl) {
  await page.locator('#phone').fill('7000000001');
  await page.locator('[data-submit]').click();
  await page.waitForFunction(() => location.hash === '#/code');
  await settle(page, 400);
  await page.locator('#code').fill('123456');
  await page.waitForFunction(() => location.hash === '#/home', null, { timeout: 8000 });
  await settle(page, 700);
}

(async () => {
  const srv = await serve();
  const BASE = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch();
  const newCtx = async (opts = devices['iPhone 13']) => {
    const ctx = await browser.newContext({ ...opts, locale: 'ru-RU', timezoneId: 'Asia/Almaty', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      // ожидаемые ответы-ошибки API браузер пишет в консоль как «Failed to load resource» — это не ошибки приложения
      if (m.type() === 'error' && !/Failed to load resource|status of 4\d\d|status of 5\d\d|net::ERR_FAILED/.test(m.text())) errors.push(m.text());
    });
    const ctl = {};
    await mockApi(page, ctl);
    return { ctx, page, errors, ctl };
  };

  try {
    // ---------- 1. вход ----------
    console.log('\n▶ Вход по коду из WhatsApp');
    {
      const { ctx, page, errors, ctl } = await newCtx();
      await page.goto(BASE);
      await settle(page, 900);
      ok((await page.evaluate(() => location.hash)) === '#/login', 'по умолчанию — настоящий вход');
      await shot(page, '01-vhod');
      ok(await page.locator('[data-act="mode-demo"]').isVisible(), 'есть ссылка «Посмотреть демо»');
      await page.locator('#phone').fill('7000000000');
      await page.locator('[data-submit]').click();
      await settle(page, 600);
      ok(norm(await page.locator('#login-err').innerText()).includes('Слишком много запросов кода'), 'лимит запросов кода — понятное сообщение');
      await page.locator('#phone').fill('7000000001');
      await page.locator('[data-submit]').click();
      await page.waitForFunction(() => location.hash === '#/code');
      await settle(page, 400);
      ok(await page.locator('.code-box').count() === 6, 'длина кода — из ответа сервера (6)');
      ok(!(await page.locator('.demo-chip').count()), 'подсказки «демо: любой код» нет');
      await page.locator('#code').fill('000000');
      await settle(page, 600);
      ok(norm(await page.locator('#code-err').innerText()).includes('Неверный код. Осталось попыток: 2'), 'неверный код — с числом попыток');
      await shot(page, '02-nevernyy-kod');
      await page.locator('#code').fill('111111');
      await settle(page, 600);
      ok(norm(await page.locator('#code-err').innerText()).includes('Код истёк'), 'код истёк — «запросите новый»');
      ok(await page.locator('[data-act="resend"]').isVisible(), 'после истечения — кнопка «Отправить код ещё раз»');
      await page.locator('[data-act="resend"]').click();
      await settle(page, 700);
      await page.locator('#code').fill('222222');
      await settle(page, 600);
      ok(norm(await page.locator('#code-err').innerText()).includes('Слишком много попыток'), 'слишком много попыток');
      ok(await page.locator('#code').isDisabled(), 'ввод кода заблокирован');
      await page.locator('[data-back]').click();
      await settle(page, 600);
      await login(page, ctl);
      ok((await page.evaluate(() => location.hash)) === '#/home', 'верный код → главная (одна организация — без выбора)');
      ok((await page.evaluate(() => JSON.parse(localStorage.getItem('finpuls-session')).token)) === 'tok-abc', 'токен сессии — в хранилище браузера');
      const verify = ctl.calls.find((c) => c.path === '/auth/otp/verify' && c.body.code === '123456');
      ok(verify && verify.body.phone === '+77000000001' && verify.body.requestId === 'otp-1', 'в проверку кода уходят номер в E.164 и requestId');
      const authed = ctl.calls.filter((c) => c.path === '/orgs/org-1/home');
      ok(authed.length > 0 && authed[0].headers.authorization === 'Bearer tok-abc', 'запросы данных — с токеном в заголовке');
      ok(norm(await page.locator('.hero').innerText()).includes('5 000 000'), 'главная — из ответа сервера');
      ok(!(await page.locator('.demo-badge').count()), 'метки «Демо» нет');
      ok(errors.length === 0, `нет ошибок в консоли${errors.length ? `: ${errors.join(' | ')}` : ''}`);
      await ctx.close();
    }

    // ---------- 2. 1С недоступна, сессия истекла ----------
    console.log('\n▶ 1С недоступна и истёкшая сессия');
    {
      const { ctx, page, errors, ctl } = await newCtx();
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      ctl.override = (p, req, { err }) => (p === '/orgs/org-1/calendar' ? (err(503, 'upstream_unavailable'), true) : false);
      await page.locator('.tabbar .tab[data-go="#/calendar"]').click();
      await settle(page, 800);
      ok(norm(await page.locator('.err-state').innerText()).includes('1С сейчас недоступна'), '«1С сейчас недоступна» вместо белого экрана');
      await shot(page, '03-1s-nedostupna');
      ok(await page.locator('.tabbar').isVisible(), 'нижняя навигация на месте');
      ctl.override = null;
      await page.locator('.err-state [data-act="retry"]').click();
      await settle(page, 800);
      ok(await page.locator('.wk-table').isVisible(), '«Обновить» — календарь загрузился');
      ctl.override = (p, req, { route }) => (p === '/orgs/org-1/home' ? (route.abort('failed'), true) : false);
      await page.locator('.tabbar .tab[data-go="#/home"]').click();
      await settle(page, 900);
      ok(norm(await page.locator('.err-state').innerText()).includes('Нет связи'), 'нет связи — «Нет связи» и «Обновить»');
      ctl.override = (p, req, { err }) => (p === '/orgs/org-1/home' ? (err(401, 'unauthorized'), true) : false);
      await page.locator('.err-state [data-act="retry"]').click();
      await settle(page, 900);
      ok((await page.evaluate(() => location.hash)) === '#/login', 'сессия истекла → экран входа');
      ok(norm(await page.locator('.toast').innerText()).includes('Сессия истекла'), 'сообщение «Сессия истекла — войдите снова»');
      ok(!(await page.evaluate(() => localStorage.getItem('finpuls-session'))), 'токен стёрт');
      ok(errors.length === 0, `нет ошибок в консоли${errors.length ? `: ${errors.join(' | ')}` : ''}`);
      await ctx.close();
    }

    // ---------- 3. согласование ----------
    console.log('\n▶ Согласование: состояния');
    {
      const { ctx, page, errors, ctl } = await newCtx();
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      const openRequest = async () => {
        await page.evaluate(() => { location.hash = '#/requests/R-1'; });
        await settle(page, 700);
      };
      const decide = async () => {
        await page.locator('.screen:not(.leaving) [data-act="approve"]').click();
        await settle(page, 400);
        await page.locator('.sheet [data-act="approve-confirm"]').click();
      };

      // уже согласовано другим
      ctl.override = (p, req, { err }) => (p.endsWith('/decision') ? (err(409, 'already_decided', { status: 'approved', by: 'Тест Финдиректор', at: `${TODAY}T10:05:00` }), true) : false);
      await openRequest();
      await decide();
      await settle(page, 600);
      ok(norm(await page.locator('.decision-state').innerText()).includes('Заявка уже согласована: Тест Финдиректор, сегодня, 10:05'), '«уже согласовано другим» — кто и когда');
      await shot(page, '04-uzhe-soglasovano');
      ok(!(await page.locator('.done-overlay').count()), 'никакого «Согласовано» при конфликте');
      await page.locator('.sheet [data-act="decision-to-list"]').click();
      await settle(page, 700);
      ok((await page.evaluate(() => location.hash)) === '#/requests', 'конфликт → к списку заявок');

      // нет прав
      ctl.override = (p, req, { err }) => (p.endsWith('/decision') ? (err(403, 'forbidden'), true) : false);
      await openRequest();
      await decide();
      await settle(page, 600);
      ok(norm(await page.locator('.decision-state').innerText()).includes('Нет прав на это решение'), '«нет прав»');
      await shot(page, '07-net-prav');
      await page.locator('.sheet [data-act="sheet-close"]').click();
      await settle(page, 400);

      // нет связи → повторить с тем же ключом → успех; «Отправляется…» до ответа
      let attempt = 0;
      ctl.override = (p, req, { route, json }) => {
        if (!p.endsWith('/decision')) return false;
        attempt++;
        if (attempt === 1) {
          route.abort('failed');
          return true;
        }
        setTimeout(() => { ctl.decided = true; json(200, { decision: 'approved', requestStatus: 'approved', paymentDate: day(3), nextApprover: null }); }, 1200);
        return true;
      };
      await openRequest();
      await decide();
      await settle(page, 600);
      ok(norm(await page.locator('.decision-state').innerText()).includes('Нет связи'), '«нет связи — повторить»');
      await shot(page, '05-net-svyazi-povtorit');
      await page.locator('.sheet [data-act="decision-retry"]').click();
      await settle(page, 300);
      ok(norm(await page.locator('.sheet .btn.loading').innerText()).includes('Отправляется'), '«Отправляется…» до ответа сервера');
      await shot(page, '06-otpravlyaetsya');
      ok(!(await page.locator('.done-overlay').count()), 'до ответа — без «Согласовано»');
      await page.locator('.sheet-backdrop').click({ force: true });
      ok(await page.locator('.sheet-wrap').count() === 1, 'во время отправки шторка не закрывается');
      await page.waitForSelector('.done-overlay.show', { timeout: 5000 });
      ok(norm(await page.locator('.done-title').innerText()) === 'Заявка согласована', 'после ответа — «Заявка согласована»');
      const keys = ctl.calls.filter((c) => c.path.endsWith('/decision')).slice(-2).map((c) => c.headers['idempotency-key']);
      ok(keys.length === 2 && keys[0] && keys[0] === keys[1], 'повтор ушёл с тем же Idempotency-Key');
      await page.waitForFunction(() => location.hash === '#/requests');
      await settle(page, 1400);
      ok(await page.locator('.screen:not(.leaving) .req-card').count() === 0, 'заявка ушла из списка');
      ok(errors.length === 0, `нет ошибок в консоли${errors.length ? `: ${errors.join(' | ')}` : ''}`);
      await ctx.close();
    }

    // ---------- 4. push ----------
    console.log('\n▶ Push: предложение после входа');
    {
      const { ctx, page, errors, ctl } = await newCtx({ viewport: { width: 1280, height: 900 } });
      // headless-браузер запрещает уведомления заранее — имитируем телефон, где ещё не спрашивали
      await ctx.addInitScript(() => {
        Object.defineProperty(Notification, 'permission', { configurable: true, get: () => window.__perm || 'default' });
        Notification.requestPermission = async () => (window.__perm = 'granted');
      });
      await page.goto(BASE);
      await settle(page, 800);
      await login(page, ctl);
      await settle(page, 1500);
      ok(norm(await page.locator('.sheet .push-offer').innerText()).includes('Уведомления о новых заявках'), 'после входа — предложение включить уведомления');
      await page.locator('.sheet [data-act="push-enable"]').click();
      await settle(page, 900);
      ok(norm(await page.locator('.toast').innerText()).includes('после подключения сервера'), 'нет ключа VAPID — понятное сообщение (заглушка)');
      ok(ctl.calls.some((c) => c.path === '/push/config'), 'ключ VAPID запрашивается у сервера');
      ok(errors.length === 0, `нет ошибок в консоли${errors.length ? `: ${errors.join(' | ')}` : ''}`);
      await ctx.close();
    }

    // ---------- 5. демо не ходит в сеть ----------
    console.log('\n▶ Демо не обращается к API');
    {
      const { ctx, page, ctl } = await newCtx();
      await page.goto(`${BASE}#/demo`);
      await settle(page, 900);
      ok((await page.evaluate(() => location.hash)) === '#/login' && (await page.locator('.demo-chip, .login-hint').first().innerText()).includes('Демо'), '#/demo включает демо');
      ok(ctl.calls.length === 0, 'ни одного запроса к API в демо');
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
