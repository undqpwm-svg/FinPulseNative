// Прогон настоящих ответов сервера через приложение — без входа и без обращений к серверу.
// Ответы API, снятые заранее (например, Посредником с api-test и тестовой базы), лежат в папке файлами JSON.
// Приложение открывается в браузере, все его запросы к API подменяются: вход — условный, остальные GET — из папки.
// Сценарий проходит вкладку «Отчёты» (все отчёты из reports в /orgs), список проектов, отборы и карточки, для
// которых есть снятые ответы; сохраняет снимки и текст каждого экрана — по тексту цифры сверяются с 1С.
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

    // ---------- вкладка «Отчёты» ----------
    console.log('\n▶ Вкладка «Отчёты»');
    await page.evaluate(() => (location.hash = '#/reports'));
    await settle(1500);
    const NAMES = { 'cash-flow': 'ДДС', 'plan-fact': 'План-факт', debtors: 'Должники', projects: 'Проекты' };
    const TABS = { 'cash-flow': 'dds', 'plan-fact': 'plan', debtors: 'debtors', projects: 'projects' };
    const want = (org.reports || []).filter((r) => NAMES[r]);
    const segs = (await page.locator(`${screen} .seg-btn`).allInnerTexts()).map((x) => norm(x).trim());
    if (!want.length) {
      const stub = await capture('otchety-zaglushka', 'отчёты, заглушка');
      ok(stub.text.includes('Раздел появится'), 'списка отчётов нет — показана заглушка');
    } else if (want.length === 1) {
      ok(segs.length === 0 && norm(await page.locator(`${screen} .page-title`).innerText()).trim() === NAMES[want[0]], `один отчёт — без переключателя, заголовок «${NAMES[want[0]]}»`);
    } else {
      ok(segs.join(' · ') === want.map((r) => NAMES[r]).join(' · '), `переключатель: ${segs.join(' · ')} — в порядке reports`);
    }

    for (const r of want.filter((x) => x !== 'projects')) {
      console.log(`\n▶ ${NAMES[r]}`);
      await page.evaluate((t) => (location.hash = `#/reports/${t}`), TABS[r]);
      await settle(1500);
      const s = await capture(TABS[r], NAMES[r]);
      ok(!s.errCode, `${NAMES[r]}: экран открылся${s.errCode ? ` — ошибка ${s.errCode}` : ''}`);
      console.log(`    ${firstLines(s.text, 12)}`);
    }

    // ---------- проекты ----------
    if (want.includes('projects')) {
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
