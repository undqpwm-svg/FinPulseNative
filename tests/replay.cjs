// Прогон настоящих ответов сервера через приложение — без входа и без обращений к серверу.
// Ответы API, снятые заранее (например, Посредником с api-test и тестовой базы), лежат в папке файлами JSON.
// Приложение открывается в браузере, все его запросы к API подменяются: вход — условный, остальные GET — из папки.
// Сценарий проходит лист «Счета» (если снят GET /orgs/{org}/accounts), календарь (если снят GET /orgs/{org}/calendar),
// вкладку «Отчёты» (все отчёты из reports в /orgs),
// список проектов, отборы и карточки, для которых есть снятые ответы; сохраняет снимки и текст каждого экрана —
// по тексту цифры сверяются с 1С. Ответ календаря заодно проверяется на арифметику контракта 5.3.
//
// Запуск: node tests/replay.cjs <папка с ответами> [--out <папка результата>] [--org <id организации>]
//         [--now 2026-11-16T03:00:00+05:00]
//
// Формат файла (любое имя *.json; один ответ, массив ответов или { "entries": [...] }):
//   { "request": "GET /orgs/org_x/reports/projects?limit=50", "status": 200, "ms": 812, "body": { ... } }
// Путь — относительно /api/v1, вместе с параметрами. Вместо "request" можно "path" (+ "query" объектом) или "url".
// "ms" — время ответа сервера, по желанию: попадает в сводку (цель — быстрее 5 с).
// Запрос приложения ищется сначала точно (путь и параметры в любом порядке), затем только по пути — с пометкой.
// Чего в папке нет — 404 и строка в сводке «не снято».
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const DIR = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : null;
if (!DIR || !fs.existsSync(DIR)) {
  console.error('Укажите папку с ответами: node tests/replay.cjs <папка> [--out <папка>] [--org <id>] [--now <дата-время>]');
  process.exit(2);
}
const OUT = path.resolve(opt('--out') || path.join(DIR, 'progon'));
const NOW = opt('--now');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// ---------- снятые ответы ----------
const keyOf = (p, q) => `${p}?${[...new URLSearchParams(q)].map(([k, v]) => `${k}=${v}`).sort().join('&')}`;
const dumps = []; // { path, query, key, status, ms, body, file }
const bad = [];
for (const f of fs.readdirSync(DIR).filter((x) => x.toLowerCase().endsWith('.json')).sort()) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    bad.push(`${f}: не читается как JSON (${e.message})`);
    continue;
  }
  const list = Array.isArray(data) ? data : Array.isArray(data.entries) ? data.entries : [data];
  for (const e of list) {
    let raw = e.request || e.url || e.path;
    if (!raw || !('body' in e)) {
      bad.push(`${f}: нет поля request или body`);
      continue;
    }
    raw = String(raw).replace(/^[A-Z]+\s+/, '').replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/v1/, '');
    const [p, qs = ''] = raw.split('?');
    const q = new URLSearchParams(qs);
    if (e.query && typeof e.query === 'object') for (const [k, v] of Object.entries(e.query)) q.set(k, v);
    dumps.push({ path: decodeURI(p), query: q, key: keyOf(decodeURI(p), q), status: Number(e.status) || 200, ms: e.ms ?? e.duration_ms ?? null, body: e.body, file: f });
  }
}
const find = (p, q) => {
  const exact = dumps.find((d) => d.key === keyOf(p, q));
  if (exact) return { d: exact, exact: true };
  const same = dumps.filter((d) => d.path === p);
  return same.length ? { d: same[0], exact: false } : null;
};
const has = (p, q = '') => dumps.some((d) => d.key === keyOf(p, new URLSearchParams(q)));

let failures = 0;
const notes = [];
const ok = (c, m) => {
  console.log(`  ${c ? '✓' : '✗'} ${m}`);
  if (!c) failures++;
};
const note = (m) => {
  console.log(`  • ${m}`);
  notes.push(m);
};
const norm = (t) => String(t).replace(/ | /g, ' ');

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

(async () => {
  console.log(`Ответы: ${DIR} — ${dumps.length} шт.`);
  bad.forEach((b) => note(`пропущен файл — ${b}`));
  const orgsDump = dumps.find((d) => d.path === '/orgs' && d.status === 200);
  if (!orgsDump) {
    console.error('Нет снятого ответа GET /orgs — без него вкладку «Отчёты» не собрать.');
    process.exit(2);
  }
  const allOrgs = orgsDump.body.items || [];
  const org = allOrgs.find((o) => o.id === opt('--org')) || allOrgs.find((o) => (o.reports || []).includes('projects')) || allOrgs.find((o) => (o.reports || []).length) || allOrgs[0];
  if (!org) {
    console.error('В GET /orgs нет ни одной организации.');
    process.exit(2);
  }
  console.log(`Организация: ${org.short_name || org.name} (${org.id}); reports: ${JSON.stringify(org.reports ?? null)}`);
  if (allOrgs.length > 1) note(`в /orgs ${allOrgs.length} организаций — приложению отдана одна выбранная, чтобы не проходить экран выбора`);

  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const BASE = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', timezoneId: 'Asia/Almaty', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  if (NOW) await page.clock.setFixedTime(new Date(NOW));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|status of [45]\d\d|net::ERR_FAILED/.test(m.text())) errors.push(m.text());
  });
  await ctx.route(/^https:\/\/t\.me\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>Telegram</title>' }));

  const calls = []; // { req, served: 'точно' | 'по пути' | 'не снято' | 'условно', status, ms }
  const meDump = dumps.find((d) => d.path === '/me' && d.status === 200);
  const user = (meDump && meDump.body.user) || { id: 'u_progon', name: 'Прогон', first_name: 'Прогон', initials: 'ПР', position: null, phone: null };
  let access = 'at_1';
  await page.route(/^https:\/\/api(-test)?\.smartsol\.pro\/api\/v1\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = decodeURI(url.pathname.replace('/api/v1', ''));
    const cors = {
      'Access-Control-Allow-Origin': req.headers().origin || '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Idempotency-Key, X-App-Version, X-App-Platform, Content-Type',
      'Access-Control-Expose-Headers': 'Idempotent-Replayed, Retry-After, Content-Disposition',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (status, data) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', headers: cors, body: data === null || data === undefined ? '' : JSON.stringify(data) });
    const line = `${req.method()} ${p}${url.search}`;
    const stub = (status, data) => {
      calls.push({ req: line, served: 'условно', status, ms: null });
      return json(status, data);
    };
    // вход и служебное — условные ответы: в прогоне проверяются отчёты, а не вход
    const tokens = { access_token: access, access_expires_in: 900, refresh_expires_in: 2592000, token_type: 'Bearer' };
    if (p === '/auth/telegram/start') return stub(200, { challenge_id: 'ch_progon', bot_url: 'https://t.me/finpulse_smartsol_bot', code_length: 6, expires_in: 300, poll_interval: 3, device: 'known' });
    if (p === '/auth/telegram/poll') return stub(202, { status: 'pending' });
    if (p === '/auth/telegram/confirm') return stub(200, { ...tokens, user });
    if (p === '/auth/refresh') {
      access = `at_${Number(access.slice(3)) + 1}`;
      return stub(200, { ...tokens, access_token: access });
    }
    if (p.startsWith('/auth/')) return route.fulfill({ status: 204, headers: cors });
    if (req.method() !== 'GET') return stub(501, { error: 'not_implemented', message: 'В прогоне только просмотр' });
    const hit = find(p, url.searchParams);
    if (hit) {
      calls.push({ req: line, served: hit.exact ? 'точно' : 'по пути', status: hit.d.status, ms: hit.d.ms, file: hit.d.file });
      const body = p === '/orgs' && hit.d.status === 200 ? { ...hit.d.body, items: [org], partial: false } : hit.d.body;
      return json(hit.d.status, body);
    }
    if (p === '/version') return stub(200, { api_version: '1.0', min_app_version: '1.0.0', server_time: new Date().toISOString() });
    if (p === '/me') return stub(200, { user });
    if (p === '/notifications') return stub(200, { unread_count: 0, items: [], next_cursor: null });
    calls.push({ req: line, served: 'не снято', status: 404, ms: null });
    return json(404, { error: 'not_found', message: 'Ответ не снят' });
  });

  const screen = '.screen:not(.leaving)';
  const settle = (ms = 600) => page.waitForTimeout(ms);
  let n = 0;
  // снимок экрана (верх и, если экран длиннее, низ) + текст экрана в файл; общие проверки вёрстки и данных
  const capture = async (name, title) => {
    n += 1;
    const base = `${String(n).padStart(2, '0')}-${name}`;
    await settle();
    await page.screenshot({ path: path.join(OUT, `${base}.png`) });
    const long = await page.evaluate((s) => {
      const el = document.querySelector(`${s} .scroll`);
      if (!el || el.scrollHeight <= el.clientHeight + 40) return false;
      el.scrollTop = el.scrollHeight;
      return true;
    }, screen);
    if (long) {
      await settle(300);
      await page.screenshot({ path: path.join(OUT, `${base}-niz.png`) });
      await page.evaluate((s) => (document.querySelector(`${s} .scroll`).scrollTop = 0), screen);
    }
    const text = norm(await page.locator(screen).innerText());
    fs.writeFileSync(path.join(OUT, `${base}.txt`), text, 'utf8');
    const junk = text.match(/NaN|Infinity|undefined|Invalid Date|\[object Object\]|\bnull\b/g);
    ok(!junk, `${title}: в тексте нет мусора${junk ? ` — найдено: ${[...new Set(junk)].join(', ')}` : ''}`);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    ok(!wide, `${title}: нет горизонтальной прокрутки`);
    const errCode = await page.evaluate((s) => document.querySelector(`${s} [data-error]`)?.getAttribute('data-error') || null, screen);
    return { text, errCode, base };
  };
  const firstLines = (text, k = 6) => text.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, k).join(' | ');

  try {
    // ---------- вход (условный) ----------
    await page.goto(BASE);
    await page.locator(`${screen} #login-phone`).waitFor({ timeout: 15000 });
    await page.locator(`${screen} #login-phone`).fill('7000000000');
    await page.locator(`${screen} [data-act="tg-start"]`).click();
    await page.locator(`${screen} [data-tg-input]`).waitFor({ timeout: 12000 });
    await page.locator(`${screen} [data-tg-input]`).fill('000000');
    await page.waitForFunction(() => location.hash === '#/home', null, { timeout: 15000 });
    await settle(900);

    // ---------- главная ----------
    console.log('\n▶ Главная');
    if (has(`/orgs/${org.id}/summary`)) {
      const home = await capture('glavnaya', 'главная');
      ok(!home.errCode, `главная открылась${home.errCode ? ` — ошибка ${home.errCode}` : ''}`);
      const debtLink = await page.locator(`${screen} [data-go="#/reports/debtors"]`).count();
      ok((debtLink > 0) === (org.reports || []).includes('debtors'), `«Нам должны» ${debtLink ? 'ведёт в «Должники»' : 'без ссылки'} — как в списке reports`);
    } else {
      note('главная не проверялась: ответ /summary не снят');
    }

    // ---------- счета (5.2) ----------
    const ACC = `/orgs/${org.id}/accounts`;
    const accDump = dumps.find((d) => d.path === ACC);
    if (!accDump) {
      note('лист «Счета» не проверялся: ответ /accounts не снят');
    } else if (!has(`/orgs/${org.id}/summary`)) {
      note('лист «Счета» не проверялся: он открывается с главной, а ответ /summary не снят');
    } else {
      console.log('\n▶ Лист «Счета» (5.2)');
      await page.locator(`${screen} .hero`).click();
      await settle(1200);
      const sheet = page.locator('.sheet-wrap .sheet-body');
      const opened = (await sheet.count()) === 1;
      n += 1;
      const base = `${String(n).padStart(2, '0')}-scheta`;
      await page.screenshot({ path: path.join(OUT, `${base}.png`) });
      const text = opened ? norm(await sheet.innerText()) : '';
      fs.writeFileSync(path.join(OUT, `${base}.txt`), text, 'utf8');
      if (accDump.status === 501) {
        ok(opened && (await page.locator('.sheet-wrap [data-acc-off="later"]').count()) === 1, 'ответ 501 — «Остатки по счетам появятся после обновления базы»');
      } else if (accDump.status === 403) {
        ok(opened && (await page.locator('.sheet-wrap [data-acc-off="off"]').count()) === 1, 'ответ 403 — «Остатки по счетам сейчас недоступны»');
      } else if (accDump.status !== 200) {
        ok(!opened, `ответ ${accDump.status} — лист не открылся, ошибка всплывающим сообщением`);
      } else {
        const acc = accDump.body;
        const items = acc.items || [];
        const tenge = (v) => `${v < 0 ? '−' : ''}${Math.round(Math.abs(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₸`;
        const near = (a, b) => Math.abs(a - b) < 0.011;
        const kzt = (i) => Number(i.balance_kzt != null ? i.balance_kzt : i.balance) || 0;
        const sumOf = (arr) => arr.reduce((t, i) => t + kzt(i), 0);
        const deps = items.filter((i) => i.deposit === true);
        const main = items.filter((i) => i.deposit !== true);
        const flat = (t) => norm(t).replace(/\s+/g, ' ').trim();

        // ----- сам ответ против контракта 5.2 и решения «депозиты в итог не входят» (расхождение — вопрос к серверу) -----
        const badItems = items.filter((i) => !['bank', 'cash'].includes(i.type) || !i.name || typeof i.balance !== 'number' || typeof i.balance_kzt !== 'number' || typeof i.deposit !== 'boolean' || !('currency' in i));
        ok(!badItems.length && typeof acc.total_kzt === 'number', `ответ: у каждого из ${items.length} счетов есть type, name, currency (может быть null), balance, balance_kzt, deposit; total_kzt — число${badItems.length ? ` — не так у ${badItems.length}` : ''}`);
        console.log(`  счетов и касс: ${main.length} (банк ${main.filter((i) => i.type === 'bank').length}, касса ${main.filter((i) => i.type === 'cash').length}), депозитов: ${deps.length}, валютных: ${items.filter((i) => i.currency && i.currency !== 'KZT').length}, без валюты: ${items.filter((i) => !i.currency).length}, с нулём: ${items.filter((i) => kzt(i) === 0).length}, с минусом: ${items.filter((i) => kzt(i) < 0).length}`);
        if (near(sumOf(main), acc.total_kzt)) ok(true, `ответ: total_kzt (${tenge(acc.total_kzt)}) = сумме счетов и касс без депозитов`);
        else if (deps.length && near(sumOf(items), acc.total_kzt)) ok(false, `ответ: total_kzt (${tenge(acc.total_kzt)}) включает депозиты (${tenge(sumOf(deps))}) — по решению они в итог не входят; вопрос к 1С`);
        else ok(false, `ответ: total_kzt (${tenge(acc.total_kzt)}) не равен сумме счетов без депозитов (${tenge(sumOf(main))}); с депозитами — ${tenge(sumOf(items))}`);
        if ('deposits_kzt' in acc) ok(typeof acc.deposits_kzt === 'number' && near(acc.deposits_kzt, sumOf(deps)), `ответ: deposits_kzt (${tenge(acc.deposits_kzt)}) = сумме счетов с deposit: true (${tenge(sumOf(deps))})`);
        else note('в ответе /accounts нет поля deposits_kzt — сумму депозитов приложение сложило само');
        ok(deps.every((i) => i.type === 'bank') && items.every((i) => kzt(i) !== 0), `ответ: депозиты — только банковские счета, нулевых остатков нет${items.some((i) => kzt(i) === 0) ? ` — с нулём: ${items.filter((i) => kzt(i) === 0).length}` : ''}`);
        const rank = (i) => (i.deposit === true ? 2 : i.type === 'cash' ? 1 : 0);
        ok(items.every((i, k) => k === 0 || rank(items[k - 1]) <= rank(i)), 'ответ: порядок базы — банковские счета, кассы, депозиты');
        const sumDump = dumps.find((d) => d.path === `/orgs/${org.id}/summary` && d.status === 200);
        if (sumDump && sumDump.body.money) {
          const m = sumDump.body.money;
          ok(near(m.total, acc.total_kzt), `ответ: total_kzt = money.total сводки (${tenge(m.total)}) — «Итого» совпадает с «Деньги на сегодня»`);
          const bank = sumOf(main.filter((i) => i.type === 'bank'));
          const cash = sumOf(main.filter((i) => i.type === 'cash'));
          ok(near(m.bank, bank) && near(m.cash, cash), `ответ: «Банк» и «Касса» сводки (${tenge(m.bank)} и ${tenge(m.cash)}) = счетам и кассам листа без депозитов (${tenge(bank)} и ${tenge(cash)})`);
        }

        // ----- экран -----
        ok(opened, 'лист «Счета» открылся');
        const junk = text.match(/NaN|Infinity|undefined|Invalid Date|\[object Object\]|\bnull\b/g);
        ok(!junk, `лист «Счета»: в тексте нет мусора${junk ? ` — найдено: ${[...new Set(junk)].join(', ')}` : ''}`);
        const mainRows = (await page.locator('.sheet-wrap [data-acc="main"] .acc-row').allInnerTexts()).map(flat);
        const depRows = (await page.locator('.sheet-wrap [data-acc="deposits"] .acc-row').allInnerTexts()).map(flat);
        ok(mainRows.length === main.length && depRows.length === deps.length, `в листе ${mainRows.length} счетов и касс и ${depRows.length} депозитов — как в ответе (${main.length} и ${deps.length})`);
        const lost = items.filter((i) => !(i.deposit === true ? depRows : mainRows).some((r) => r.includes(flat(i.name)) && r.includes(tenge(kzt(i)))));
        ok(!lost.length, `каждый счёт показан с названием и остатком в тенге${lost.length ? ` — не найдено: ${lost.length}` : ''}`);
        const cur = items.filter((i) => i.currency && i.currency !== 'KZT');
        if (cur.length) ok(cur.every((i) => (i.deposit === true ? depRows : mainRows).some((r) => r.includes(flat(i.name)) && r.includes(` ${i.currency}`))), `валютные счета (${cur.length}): в подписи остаток в валюте счёта`);
        ok(flat(await page.locator('.sheet-wrap .acc-total').innerText()) === `Итого ${tenge(acc.total_kzt)}`, `«Итого» в листе — ${tenge(acc.total_kzt)}`);
        if (sumDump) ok(norm(await page.locator(`${screen} .hero .bm-num`).innerText()).replace(/\s/g, '') === tenge(acc.total_kzt).replace(/[\s₸]/g, ''), '«Итого» в листе и «Деньги на сегодня» на главной — одна цифра');
        const depSum = typeof acc.deposits_kzt === 'number' ? acc.deposits_kzt : sumOf(deps);
        if (deps.length) ok(flat(await page.locator('.sheet-wrap .acc-dep-head').innerText()) === `Депозиты ${tenge(depSum)}`, `блок «Депозиты» под итогом, сумма ${tenge(depSum)}`);
        else ok((await page.locator('.sheet-wrap [data-acc="deposits"]').count()) === 0, 'депозитов в ответе нет — блока «Депозиты» нет');
        const hm = String(acc.updated_at || '').slice(11, 16);
        ok(/^\d\d:\d\d$/.test(hm) && flat(await page.locator('.sheet-wrap [data-acc-at]').innerText()) === `На ${hm}`, `под заголовком — «На ${hm}»: время ответа по времени компании`);
        const subBox = await page.locator('.sheet-wrap [data-acc-at]').evaluate((el) => el.getClientRects().length);
        ok(subBox === 1, 'время в подписи не разорвано переносом строки');
        ok(!/null/.test(mainRows.concat(depRows).join(' ')), 'в подписях счетов нет «null»');
        const wide = await page.evaluate(() => {
          const b = document.querySelector('.sheet-wrap .sheet-body');
          return b.scrollWidth > b.clientWidth + 1;
        });
        ok(!wide, 'лист «Счета»: нет горизонтальной прокрутки');
        const long = await page.evaluate(() => {
          const b = document.querySelector('.sheet-wrap .sheet-body');
          if (b.scrollHeight <= b.clientHeight + 40) return false;
          b.scrollTop = b.scrollHeight;
          return true;
        });
        if (long) {
          await settle(300);
          await page.screenshot({ path: path.join(OUT, `${base}-niz.png`) });
          ok(await page.locator('.sheet-wrap .btn[data-act="sheet-close"]').isVisible(), 'длинный список счетов прокручивается до кнопки «Понятно»');
        }
      }
      if (await page.locator('.sheet-wrap').count()) {
        await page.locator('.sheet-wrap .sheet-backdrop').click({ position: { x: 10, y: 10 } });
        await settle(600);
      }
      await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 8000 }).catch(() => {});
    }

    // ---------- календарь ----------
    const CAL = `/orgs/${org.id}/calendar`;
    const calDump = dumps.find((d) => d.path === CAL);
    if (!calDump) {
      note('календарь не проверялся: ответ /calendar не снят');
    } else if (calDump.status !== 200) {
      console.log('\n▶ Календарь');
      await page.evaluate(() => (location.hash = '#/calendar'));
      await settle(1500);
      const s = await capture('kalendar', 'календарь');
      if (calDump.status === 501) ok((await page.locator(`${screen} [data-later]`).count()) === 1, 'ответ 501 — заглушка «Раздел появится в следующей версии»');
      else ok(!!s.errCode, `ответ ${calDump.status} — экран ошибки (${s.errCode})`);
    } else {
      const cal = calDump.body;
      const days = cal.days || [];
      const thr = cal.threshold || 0;
      const tenge = (v) => `${v < 0 ? '−' : ''}${Math.round(Math.abs(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₸`;
      const near = (a, b) => Math.abs(a - b) < 0.011;
      const kzt = (i) => (i.amount_kzt != null ? i.amount_kzt : i.amount);
      const sumOf = (arr) => arr.reduce((t, i) => t + kzt(i), 0);
      const offItems = (d) => (d.items || []).filter((i) => i.in_totals === false);

      // ----- сам ответ: арифметика контракта 5.3 (если не сходится — вопрос к серверу, а не к приложению) -----
      console.log('\n▶ Ответ календаря против контракта 5.3');
      const bads = [];
      const chk = (c, m) => {
        if (!c) bads.push(m);
      };
      const iso = (dt) => dt.toISOString().slice(0, 10);
      chk(days.length > 0 && days[0].date === cal.from, `первый день ${days[0] && days[0].date} — не from ${cal.from}`);
      chk(days.length > 0 && days[days.length - 1].date === cal.to, `последний день ${days.length && days[days.length - 1].date} — не to ${cal.to}`);
      chk(days.length === 0 || near(cal.opening, days[0].opening), `opening ответа ${cal.opening} ≠ opening первого дня ${days[0] && days[0].opening}`);
      const SOURCES = ['request', 'supplier_invoice', 'planned_payment', 'salary', 'tax', 'expected_receipt', 'other'];
      days.forEach((d, k) => {
        if (k > 0) {
          chk(iso(new Date(Date.parse(`${days[k - 1].date}T00:00:00Z`) + 864e5)) === d.date, `${d.date}: дни идут не подряд`);
          chk(near(d.opening, days[k - 1].closing), `${d.date}: opening ${d.opening} ≠ closing предыдущего дня ${days[k - 1].closing}`);
        }
        chk(near(d.opening + d.inflow - d.outflow, d.closing), `${d.date}: opening + inflow − outflow ≠ closing`);
        const its = d.items || [];
        chk(near(sumOf(its.filter((i) => i.direction === 'in' && i.in_totals !== false)), d.inflow), `${d.date}: inflow ${d.inflow} ≠ сумме поступлений с in_totals`);
        chk(near(sumOf(its.filter((i) => i.direction === 'out' && i.in_totals !== false)), d.outflow), `${d.date}: outflow ${d.outflow} ≠ сумме платежей с in_totals`);
        chk(d.gap === (d.closing < thr), `${d.date}: gap ${d.gap}, а closing ${d.closing} при пороге ${thr}`);
        its.forEach((i, j) => {
          const at = `${d.date}, позиция ${j + 1}`;
          chk(i.direction === 'in' || i.direction === 'out', `${at}: direction ${JSON.stringify(i.direction)}`);
          chk(typeof i.amount === 'number' && typeof kzt(i) === 'number', `${at}: сумма не число`);
          chk(SOURCES.includes(i.source), `${at}: source ${JSON.stringify(i.source)}`);
          chk(i.source !== 'request' || !!i.request_id, `${at}: source request без request_id`);
          chk(i.currency !== 'KZT' || near(kzt(i), i.amount), `${at}: тенге, а amount_kzt ≠ amount`);
          chk(typeof i.in_totals === 'boolean', `${at}: нет in_totals`);
          chk(i.in_totals !== false || (i.direction === 'in' && i.late === true), `${at}: in_totals false не у просроченного поступления`);
          chk(!(i.direction === 'in' && i.late === true) || i.in_totals === false, `${at}: просроченное поступление входит в итоги`);
          chk(!i.late || k === 0, `${at}: late не в первом дне`);
        });
      });
      const gapDay = days.find((d) => d.closing < thr);
      if (gapDay) chk(!!cal.gap && cal.gap.date === gapDay.date && near(cal.gap.shortage, thr - gapDay.closing), `gap ответа ${JSON.stringify(cal.gap)} — ждали ${gapDay.date}, ${thr - gapDay.closing}`);
      else chk(cal.gap === null, `разрывов по дням нет, а gap ${JSON.stringify(cal.gap)}`);
      const allOff = days.flatMap(offItems);
      if (cal.overdue_receipts) chk(cal.overdue_receipts.count === allOff.length && near(cal.overdue_receipts.amount, sumOf(allOff)), `overdue_receipts ${JSON.stringify(cal.overdue_receipts)} — по позициям ${allOff.length} шт. на ${sumOf(allOff)}`);
      else chk(false, 'нет overdue_receipts');
      const total = days.reduce((t, d) => t + (d.items || []).length, 0);
      const maxDay = days.reduce((m, d) => ((d.items || []).length > (m.items || []).length ? d : m), days[0] || { items: [] });
      ok(bads.length === 0, `ответ сходится с контрактом 5.3${bads.length ? ` — расхождений ${bads.length}: ${bads.slice(0, 8).join('; ')}${bads.length > 8 ? '; …' : ''}` : ''}`);
      console.log(`    дней ${days.length} (${cal.from} — ${cal.to}), позиций ${total}, больше всего в дне — ${(maxDay.items || []).length} (${maxDay.date}); порог ${thr}; разрыв: ${cal.gap ? `${cal.gap.date}, не хватает ${cal.gap.shortage}` : 'нет'}; просроченных поступлений ${allOff.length}; валюты: ${[...new Set(days.flatMap((d) => (d.items || []).map((i) => i.currency)))].join(', ') || '—'}`);

      // ----- главная и календарь: одно и то же в двух ответах -----
      const sumDump = dumps.find((d) => d.path === `/orgs/${org.id}/summary` && d.status === 200);
      if (sumDump) {
        const sm = sumDump.body;
        const g1 = sm.gap ? `${sm.gap.date} ${sm.gap.shortage}` : 'нет';
        const g2 = cal.gap ? `${cal.gap.date} ${cal.gap.shortage}` : 'нет';
        ok(g1 === g2, `разрыв на главной и в календаре один и тот же (${g1}${g1 === g2 ? '' : ` и ${g2}`})`);
        const diff = ((sm.week && sm.week.days) || []).filter((w) => {
          const d = days.find((x) => x.date === w.date);
          return !d || !near(d.closing, w.closing) || !near(d.inflow, w.inflow) || !near(d.outflow, w.outflow);
        });
        ok(diff.length === 0, `«Ближайшие 7 дней» главной совпадают с днями календаря${diff.length ? ` — расходятся: ${diff.map((w) => w.date).join(', ')}` : ''}`);
      }

      // ----- экран -----
      console.log('\n▶ Календарь');
      if (sumDump) {
        await page.evaluate(() => (location.hash = '#/home'));
        await settle(900);
        const links = await page.locator(`${screen} [data-go^="#/calendar"]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-go')));
        const inRange = links.filter((h) => h.includes('/calendar/')).every((h) => days.some((d) => d.date === h.split('/').pop()));
        ok(links.length > 0 && inRange, `главная ведёт в календарь: ссылок ${links.length}, все даты — в диапазоне календаря`);
      }
      await page.evaluate(() => (location.hash = '#/calendar'));
      await settle(1500);
      const wk = await capture('kalendar-nedelya', 'календарь, неделя');
      ok(!wk.errCode && (await page.locator(`${screen} .wk-row`).count()) === Math.min(7, days.length), `календарь открылся, в неделе ${Math.min(7, days.length)} дней${wk.errCode ? ` — ошибка ${wk.errCode}` : ''}`);
      if (!wk.errCode && days.length) {
        console.log(`    ${firstLines(wk.text, 10)}`);
        // плашка разрыва
        const strip = page.locator(`${screen} .gap-strip`);
        if (cal.gap) {
          const st = (await strip.count()) ? norm(await strip.innerText()) : '';
          ok((await strip.count()) === 1 && (await strip.getAttribute('data-go')) === `#/calendar/${cal.gap.date}`, `плашка разрыва ведёт в ${cal.gap.date}: «${st.trim()}»`);
        } else {
          ok((await strip.count()) === 0, 'разрыва нет — плашки нет');
        }
        // каждый день: остатки, итоги и число позиций — как в ответе
        const miss = [];
        for (const d of days) {
          await page.evaluate((h) => (location.hash = h), `#/calendar/${d.date}`);
          await page.waitForFunction((dt) => location.hash === `#/calendar/${dt}` && !!document.querySelector('.screen:not(.leaving) .day-card'), d.date, { timeout: 8000 });
          await settle(120);
          const t = norm(await page.locator(`${screen} .day-card`).innerText());
          const its = d.items || [];
          const off = offItems(d);
          const cnt = async (k) => page.locator(`${screen} .day-card [data-flows="${k}"] .flow`).count();
          const want = { in: its.filter((i) => i.direction === 'in' && i.in_totals !== false).length, out: its.filter((i) => i.direction !== 'in' && i.in_totals !== false).length, off: off.length };
          const got = { in: await cnt('in'), out: await cnt('out'), off: await cnt('off') };
          const why = [];
          if (!t.includes(tenge(d.opening))) why.push(`нет остатка на начало ${tenge(d.opening)}`);
          if (!t.includes(tenge(d.closing))) why.push(`нет остатка на конец ${tenge(d.closing)}`);
          if (want.in && !t.includes(`+${tenge(d.inflow)}`)) why.push(`нет итога поступлений +${tenge(d.inflow)}`);
          if (want.out && !t.includes(`−${tenge(d.outflow)}`)) why.push(`нет итога платежей −${tenge(d.outflow)}`);
          for (const k of ['in', 'out', 'off']) if (got[k] !== want[k]) why.push(`${k}: строк ${got[k]}, в ответе ${want[k]}`);
          if (off.length && !t.includes(tenge(sumOf(off)))) why.push(`нет суммы просроченных ${tenge(sumOf(off))}`);
          if ((d.closing < thr) !== t.includes('Не хватает')) why.push(`подсказка «Не хватает» ${d.closing < thr ? 'не показана' : 'показана зря'}`);
          if (/NaN|Infinity|undefined|Invalid Date|\[object Object\]|\bnull\b/.test(t)) why.push('мусор в тексте');
          if (why.length) miss.push(`${d.date}: ${why.join(', ')}`);
        }
        ok(miss.length === 0, `все ${days.length} дней: остатки, итоги и число позиций на экране — как в ответе${miss.length ? ` — расхождения: ${miss.slice(0, 6).join(' | ')}` : ''}`);

        // «Показать все N» в каждой группе дня (кнопка после нажатия исчезает)
        const openAll = async () => {
          const more = page.locator(`${screen} [data-act="flow-more"]`);
          while (await more.count()) await more.first().click();
        };
        // дни, которые стоит посмотреть глазами
        const show = async (d, name, title) => {
          await page.evaluate((h) => (location.hash = h), `#/calendar/${d.date}`);
          await settle(700);
          await openAll();
          await page.evaluate((sel) => document.querySelector(`${sel} .day-card`).scrollIntoView({ block: 'start' }), screen);
          return capture(name, title);
        };
        const first = await show(days[0], 'kalendar-pervyy-den', 'календарь, первый день');
        if (offItems(days[0]).length) ok(first.text.includes('Просроченные поступления') && first.text.includes('В остаток дня не вход'), `просроченные поступления (${offItems(days[0]).length}) — отдельным блоком, в остаток не входят`);
        if ((maxDay.items || []).length && maxDay !== days[0]) await show(maxDay, 'kalendar-samyy-plotnyy-den', `календарь, ${maxDay.date} (больше всего позиций)`);
        if (gapDay && gapDay !== days[0] && gapDay !== maxDay) await show(gapDay, 'kalendar-razryv', `календарь, разрыв ${gapDay.date}`);
        const curDay = days.find((d) => (d.items || []).some((i) => i.currency && i.currency !== 'KZT'));
        if (curDay && ![days[0], maxDay, gapDay].includes(curDay)) await show(curDay, 'kalendar-valyuta', `календарь, валюта ${curDay.date}`);
        if (curDay) {
          const ci = curDay.items.find((i) => i.currency && i.currency !== 'KZT');
          await page.evaluate((h) => (location.hash = h), `#/calendar/${curDay.date}`);
          await settle(500);
          const t = norm(await page.locator(`${screen} .day-card`).innerText());
          ok(t.includes(tenge(ci.amount_kzt)) && t.includes(` ${ci.currency}`), `валютная позиция: сумма в тенге ${tenge(ci.amount_kzt)} и подпись в ${ci.currency}`);
        }

        // позиция по заявке → карточка заявки
        const reqDay = days.find((d) => (d.items || []).some((i) => i.request_id));
        if (!reqDay) {
          note('позиций по заявкам (request_id) в ответе календаря нет — переход в заявку не проверялся');
        } else {
          const rid = reqDay.items.find((i) => i.request_id).request_id;
          await page.evaluate((h) => (location.hash = h), `#/calendar/${reqDay.date}`);
          await settle(700);
          await openAll();
          await page.locator(`${screen} [data-flow-req][data-go="#/requests/${rid}"]`).first().click();
          await settle(1500);
          const hash = await page.evaluate(() => decodeURIComponent(location.hash));
          const rq = await capture('kalendar-zayavka', 'заявка из календаря');
          ok(hash === `#/requests/${rid}`, `строка «по заявке» открывает заявку ${rid}`);
          if (has(`/orgs/${org.id}/requests/${rid}`)) ok(!rq.errCode && !rq.text.includes('Заявка не найдена'), 'карточка заявки открылась');
          else note(`карточка заявки ${rid} не снята — на экране «Заявка не найдена», это ожидаемо`);
          await page.locator('.topbar [data-back]').first().click();
          await settle(900);
          ok((await page.evaluate(() => location.hash)) === `#/calendar/${reqDay.date}`, '«Назад» из заявки возвращает в день календаря');
        }

        // месяц
        await page.evaluate(() => (location.hash = '#/calendar'));
        await settle(600);
        await page.locator(`${screen} [data-act="cal-mode"][data-v="month"]`).click();
        await settle(700);
        const mon = await capture('kalendar-mesyac', 'календарь, месяц');
        const inMonth = days.filter((d) => d.date.slice(0, 7) === days[0].date.slice(0, 7)).length;
        ok(!mon.errCode && (await page.locator(`${screen} button.mc`).count()) === inMonth, `месяц: дней с остатком ${inMonth}`);
        const tight = await page.locator(`${screen} .mc-bal`).evaluateAll((els) => els.filter((e) => e.scrollWidth > e.parentElement.clientWidth + 1).length);
        ok(tight === 0, `месяц: остатки помещаются в ячейки${tight ? ` — не помещаются в ${tight}` : ''}`);
        if (days[days.length - 1].date.slice(0, 7) !== days[0].date.slice(0, 7)) {
          await page.locator(`${screen} .pn-btn[aria-label="Следующий месяц"]`).click();
          await settle(700);
          await capture('kalendar-mesyac-sleduyushchiy', 'календарь, следующий месяц');
        }
        await page.locator(`${screen} [data-act="cal-mode"][data-v="week"]`).click();
        await settle(400);
      }
    }

    // ---------- вкладка «Отчёты» ----------
    console.log('\n▶ Вкладка «Отчёты»');
    await page.evaluate(() => (location.hash = '#/reports'));
    await settle(1500);
    const NAMES = { 'cash-flow': 'ДДС', 'plan-fact': 'План-факт', debtors: 'Должники', projects: 'Проекты' };
    const TABS = { 'cash-flow': 'dds', 'plan-fact': 'plan', debtors: 'debtors', projects: 'projects' };
    const want = (org.reports || []).filter((r) => NAMES[r]);
    const dumped = (r) => dumps.some((d) => d.path === `/orgs/${org.id}/reports/${r}`);
    const segs = (await page.locator(`${screen} .seg-btn`).allInnerTexts()).map((x) => norm(x).trim());
    if (want.length && !dumped(want[0])) {
      note(`вкладка «Отчёты» не проверялась: ответ первого отчёта (${NAMES[want[0]]}) не снят`);
    } else if (!want.length) {
      const stub = await capture('otchety-zaglushka', 'отчёты, заглушка');
      ok(stub.text.includes('Раздел появится'), 'списка отчётов нет — показана заглушка');
    } else if (want.length === 1) {
      ok(segs.length === 0 && norm(await page.locator(`${screen} .page-title`).innerText()).trim() === NAMES[want[0]], `один отчёт — без переключателя, заголовок «${NAMES[want[0]]}»`);
    } else {
      ok(segs.join(' · ') === want.map((r) => NAMES[r]).join(' · '), `переключатель: ${segs.join(' · ')} — в порядке reports`);
    }

    for (const r of want.filter((x) => x !== 'projects')) {
      if (!dumped(r)) {
        note(`${NAMES[r]} не проверялся: ответ не снят`);
        continue;
      }
      console.log(`\n▶ ${NAMES[r]}`);
      await page.evaluate((t) => (location.hash = `#/reports/${t}`), TABS[r]);
      await settle(1500);
      const s = await capture(TABS[r], NAMES[r]);
      ok(!s.errCode, `${NAMES[r]}: экран открылся${s.errCode ? ` — ошибка ${s.errCode}` : ''}`);
      console.log(`    ${firstLines(s.text, 12)}`);
    }

    // ---------- проекты ----------
    if (want.includes('projects') && !dumped('projects')) {
      note('Проекты не проверялись: ответ не снят');
    } else if (want.includes('projects')) {
      console.log('\n▶ Проекты');
      const LIST = `/orgs/${org.id}/reports/projects`;
      await page.evaluate(() => (location.hash = '#/reports/projects'));
      await settle(1800);
      const list = await capture('proekty-spisok', 'проекты');
      ok(!list.errCode, `проекты: список открылся${list.errCode ? ` — ошибка ${list.errCode}` : ''}`);
      const first = dumps.find((d) => d.key === keyOf(LIST, new URLSearchParams('limit=50')));
      if (first && first.status === 200 && !list.errCode) {
        const rows = await page.locator(`${screen} .prj`).count();
        ok(rows === (first.body.items || []).length, `проекты: строк на экране ${rows} — столько же в ответе (${(first.body.items || []).length}); всего по итогам ${first.body.totals ? first.body.totals.count : '—'}`);
        console.log(`    ${firstLines(norm(await page.locator(`${screen} [data-prj-totals]`).innerText()), 14)}`);
        // следующая порция
        if (first.body.next_cursor) {
          if (has(LIST, `limit=50&cursor=${first.body.next_cursor}`)) {
            await page.locator(`${screen} [data-act="prj-more"]`).click();
            await settle(1500);
            const more = await page.locator(`${screen} .prj`).count();
            ok(more > rows, `проекты: «Показать ещё» догрузил строки — стало ${more}`);
          } else {
            note(`вторая порция списка не снята (cursor=${first.body.next_cursor}) — «Показать ещё» не проверялось`);
          }
        }
        // отборы: только те, для которых снят ответ
        const chips = [
          ['status=in_work', '[data-act="prj-chip"][data-v="in_work"]', 'В работе'],
          ['status=done', '[data-act="prj-chip"][data-v="done"]', 'Выполнен'],
          ['debt_only=true', '[data-act="prj-chip"][data-k="debtOnly"]', 'Есть долг'],
          ['without_id=true', '[data-act="prj-chip"][data-k="withoutId"]', 'Без ID'],
        ];
        for (const [q, sel, label] of chips) {
          if (!has(LIST, `limit=50&${q}`)) {
            note(`отбор «${label}» не проверялся: ответ с ${q} не снят`);
            continue;
          }
          const d = dumps.find((x) => x.key === keyOf(LIST, new URLSearchParams(`limit=50&${q}`)));
          await page.evaluate(() => (location.hash = '#/reports/projects'));
          await settle(400);
          if (!(await page.locator(`${screen} ${sel}`).count())) {
            note(`отбор «${label}»: такого чипа на экране нет`);
            continue;
          }
          await page.locator(`${screen} ${sel}`).click();
          await settle(1500);
          const s = await capture(`proekty-${q.replace(/[=_]/g, '-')}`, `проекты, «${label}»`);
          const cnt = await page.locator(`${screen} .prj`).count();
          ok(!s.errCode && cnt === (d.body.items || []).length, `проекты, «${label}»: строк ${cnt}, в ответе ${(d.body.items || []).length}`);
          // снять отбор: статус — чипом «Все», переключатели — повторным нажатием
          await page.locator(`${screen} ${q.startsWith('status') ? '[data-act="prj-chip"][data-k="status"][data-v=""]' : sel}`).click();
          await settle(1200);
        }
      }

      // ---------- карточки ----------
      const cards = dumps.filter((d) => d.path.startsWith(`${LIST}/`));
      if (!cards.length) note('карточки проектов не проверялись: ответы не сняты');
      for (const c of cards) {
        const id = c.path.slice(LIST.length + 1);
        console.log(`\n▶ Отчёт по проекту ${id}`);
        await page.evaluate((h) => (location.hash = h), `#/reports/projects/${encodeURIComponent(id)}`);
        await settle(1800);
        const tag = `proekt-${id.replace(/[^\w-]+/g, '_').slice(-24)}`;
        const s = await capture(tag, `проект ${id}`);
        if (c.status === 404) {
          ok((await page.locator(`${screen} [data-prj-missing]`).count()) === 1, 'ответ 404 — «Проект не найден»');
          continue;
        }
        ok(!s.errCode && (await page.locator(`${screen} [data-project]`).count()) === 1, `карточка открылась${s.errCode ? ` — ошибка ${s.errCode}` : ''}`);
        if (s.errCode) continue;
        console.log(`    ${firstLines(s.text, 16)}`);
        const b = c.body;
        for (const [pt, arr] of [['sales', b.sales], ['purchases', b.purchases], ['payments', b.payments]]) {
          const head = page.locator(`${screen} [data-pt="${pt}"] .pt-head`);
          if (!(await head.count())) {
            ok(false, `таблица ${pt}: нет на экране`);
            continue;
          }
          await head.click();
          await settle(250);
          const moreBtn = page.locator(`${screen} [data-pt="${pt}"] [data-act="pt-more"]`);
          if (await moreBtn.count()) await moreBtn.click();
          await settle(200);
          const shown = await page.locator(`${screen} [data-pt="${pt}"] .pt-row:not([hidden])`).count();
          const expect = Array.isArray(arr) ? arr.length : 0;
          ok(shown === expect, `таблица ${pt}: строк на экране ${shown}, в ответе ${arr === null ? 'null' : expect}`);
        }
        await capture(`${tag}-tablicy`, `проект ${id}, таблицы`);
        await page.evaluate(() => (location.hash = '#/reports/projects'));
        await settle(700);
      }
    }

    // ---------- сводка ----------
    console.log('\n▶ Запросы приложения');
    const seen = new Set();
    for (const c of calls.filter((x) => x.served !== 'условно')) {
      const k = `${c.req}|${c.served}`;
      if (seen.has(k)) continue;
      seen.add(k);
      console.log(`  ${c.served === 'точно' ? '=' : c.served === 'по пути' ? '~' : '✗'} ${c.req} → ${c.status}${c.ms !== null && c.ms !== undefined ? `, ${c.ms} мс` : ''}${c.served === 'по пути' ? ' (параметры в снятом ответе другие)' : c.served === 'не снято' ? ' (не снято)' : ''}`);
    }
    const slow = dumps.filter((d) => typeof d.ms === 'number' && d.ms > 5000);
    ok(slow.length === 0, `время ответа: ${slow.length ? `дольше 5 с — ${slow.map((d) => `${d.key} (${d.ms} мс)`).join('; ')}` : dumps.some((d) => typeof d.ms === 'number') ? 'все снятые ответы быстрее 5 с' : 'в файлах не указано'}`);
    const unused = dumps.filter((d) => !calls.some((c) => c.file === d.file && c.req.includes(d.path)));
    if (unused.length) note(`снятые ответы, которые приложение не запросило: ${unused.map((d) => d.key).join('; ')}`);
    ok(errors.length === 0, `нет ошибок в консоли${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } catch (e) {
    failures++;
    console.error('✗ Прогон оборвался:', e.message);
    await page.screenshot({ path: path.join(OUT, 'oshibka.png') }).catch(() => {});
  }
  await browser.close();
  srv.close();
  console.log(`\nСнимки и тексты экранов: ${OUT}`);
  if (notes.length) console.log(`Пометки: ${notes.length}`);
  console.log(failures ? `ИТОГ: не прошло проверок — ${failures}` : 'ИТОГ: все проверки пройдены');
  process.exit(failures ? 1 : 0);
})();
