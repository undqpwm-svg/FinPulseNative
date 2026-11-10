// Сквозная проверка демо ФинПульс в Playwright.
// Запуск: node tests/e2e.cjs                 — поднимет локальный сервер для /docs
//         node tests/e2e.cjs https://…/      — проверит опубликованный сайт
// Флаг --shots сохраняет скриншоты экранов (iPhone 13) в /screenshots.
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const SHOTS = path.join(ROOT, 'screenshots');
const args = process.argv.slice(2);
const SAVE = args.includes('--shots');
let BASE = args.find((a) => a.startsWith('http'));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(DOCS, p);
      if (!f.startsWith(DOCS) || !fs.existsSync(f)) {
        res.writeHead(404);
        return res.end('404');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, () => resolve(srv));
  });
}

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.log(`  ✗ ${msg}`);
  }
};

// утренний сценарий: 11 ноября 2026, 09:41 по Алматы
const FIXED = new Date('2026-11-11T09:41:00+05:00');

async function newPage(browser, opts) {
  const ctx = await browser.newContext({ ...opts, locale: 'ru-RU', timezoneId: 'Asia/Almaty', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FIXED);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  return { ctx, page, errors };
}

const settle = (page, ms = 520) => page.waitForTimeout(ms);
const screenKey = (page) => page.evaluate(() => location.hash);

async function noHScroll(page, label) {
  const r = await page.evaluate(() => {
    const doc = document.documentElement.scrollWidth - window.innerWidth;
    const inner = [...document.querySelectorAll('.screen:not(.leaving) .scroll, .sheet-body')].map((e) => e.scrollWidth - e.clientWidth);
    return Math.max(doc, ...inner, 0);
  });
  ok(r <= 1, `${label}: нет горизонтального скролла`);
}

async function shot(page, name) {
  if (!SAVE) return;
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function scrollTo(page, sel) {
  await page.evaluate((s) => {
    const el = document.querySelector(`.screen:not(.leaving) ${s}`);
    const sc = document.querySelector('.screen:not(.leaving) .scroll');
    if (el && sc) sc.scrollTop = el.offsetTop - 12;
  }, sel);
  await settle(page, 300);
}

const norm = (t) => t.replace(/\u00A0/g, ' ');
const tab = (page, hash) => page.locator(`.tabbar .tab[data-go="${hash}"]`).click();
const tap = (page, sel) => page.locator(`.screen:not(.leaving) ${sel}, .sheet-wrap ${sel}`).first().click();
const homeCount = (page) => page.evaluate(() => (document.querySelector('.screen:not(.leaving) .appr-body b')?.textContent || '').replace(/\u00A0/g, ' '));
const tabBadge = (page) => page.evaluate(() => document.querySelector('.tab-badge')?.textContent || '0');

async function runFlow(browser, name, opts, isPhone) {
  console.log(`\n▶ ${name}`);
  const { ctx, page, errors } = await newPage(browser, opts);
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE);
  await page.waitForSelector('.screen #phone');
  await page.evaluate(() => document.fonts.ready);
  await settle(page, 1700);

  // --- вход ---
  ok(await page.locator('.login-foot').innerText().then(norm) === 'SmartSol × FINTAX CONSULT', 'на входе подпись SmartSol × FINTAX CONSULT');
  ok(await page.locator('[data-submit]').isDisabled(), 'кнопка «Получить код» неактивна без номера');
  await noHScroll(page, 'Вход');
  if (isPhone) await shot(page, '01-vhod');
  await page.locator('#phone').fill('7015551234');
  ok(await page.locator('#phone').inputValue() === '701 555 12 34', 'маска номера телефона');
  await page.locator('[data-submit]').click();
  await settle(page);
  ok((await screenKey(page)) === '#/code', 'переход к вводу кода');
  ok(await page.locator('.demo-chip').isVisible(), 'подсказка «демо: любой код»');
  await page.locator('#code').fill('48');
  await settle(page, 200);
  if (isPhone) await shot(page, '02-kod-iz-sms');
  await page.locator('#code').fill('4821');
  await settle(page, 1100);

  // --- выбор организации ---
  ok((await screenKey(page)) === '#/orgs', 'любой код пускает дальше → выбор организации');
  ok(await page.locator('.org-card').count() === 3, 'три организации с мини-сводкой');
  await noHScroll(page, 'Организации');
  if (isPhone) await shot(page, '03-vybor-organizacii');
  await tap(page, '[data-act="pick-org"][data-id="alfa"]');
  await settle(page, 600);

  // --- главная ---
  ok((await screenKey(page)) === '#/home', 'открылась главная');
  const heroText = await page.locator('.screen:not(.leaving) .hero').innerText().then(norm);
  ok(heroText.includes('12 480 000') && heroText.includes('11 830 000') && heroText.includes('650 000'), 'деньги на сегодня: итого, банк, касса');
  ok((await page.locator('.alert-card b').innerText().then(norm)).includes('В четверг не хватит 1,2 млн ₸'), 'предупреждение «В четверг не хватит 1,2 млн ₸»');
  ok((await homeCount(page)) === 'На согласовании: 3', 'плашка «На согласовании: 3»');
  ok((await tabBadge(page)) === '3', 'бейдж 3 на вкладке «Заявки»');
  await noHScroll(page, 'Главная');
  if (isPhone) await shot(page, '04-glavnaya');
  await scrollTo(page, '.card');
  if (isPhone) await shot(page, '05-glavnaya-7-dney-i-debitorka');

  await tap(page, '.hero');
  await settle(page, 450);
  ok(await page.locator('.sheet .acc-row').count() === 3, 'шторка со счетами открывается');
  if (isPhone) await shot(page, '06-scheta');
  await tap(page, '[data-act="sheet-close"].btn');
  await settle(page, 350);

  // предупреждение → календарь на день разрыва
  await scrollTo(page, '.alert-card');
  await tap(page, '.alert-card');
  await settle(page);
  ok((await screenKey(page)) === '#/calendar/2026-11-12', 'предупреждение ведёт в календарь на 12 ноября');
  ok(await page.locator('.screen:not(.leaving) .wk-row.neg').count() >= 1, 'день разрыва подсвечен красным');
  ok((await page.locator('.screen:not(.leaving) .day-card .bal-end').innerText().then(norm)).includes('−1 200 000'), 'остаток на конец дня −1 200 000 ₸');
  await noHScroll(page, 'Календарь, неделя');
  if (isPhone) await shot(page, '07-kalendar-nedelya');
  await scrollTo(page, '.day-card');
  if (isPhone) await shot(page, '08-kalendar-den-razryva');

  // переключение недель и режим месяца
  await tap(page, '.pn-btn[aria-label="Следующая неделя"]');
  await settle(page, 250);
  ok((await screenKey(page)) === '#/calendar/2026-11-18', 'следующая неделя');
  await tap(page, '[data-act="cal-mode"][data-v="month"]');
  await settle(page, 300);
  ok(await page.locator('.screen:not(.leaving) .month-grid .mc').count() >= 30, 'месячная сетка');
  await tap(page, '.mc[data-go="#/calendar/2026-11-12"]');
  await settle(page, 300);
  ok(await page.locator('.screen:not(.leaving) .mc.neg.on').count() === 1, 'в месяце выбран красный день');
  await noHScroll(page, 'Календарь, месяц');
  if (isPhone) await shot(page, '09-kalendar-mesyac');
  await tap(page, '.pn-btn[aria-label="Следующий месяц"]');
  await settle(page, 250);
  ok((await screenKey(page)) === '#/calendar/2026-12-01', 'следующий месяц');
  await tap(page, '[data-act="cal-mode"][data-v="week"]');
  await settle(page, 250);

  // --- заявки ---
  await tab(page, '#/requests');
  await settle(page);
  ok(await page.locator('.screen:not(.leaving) .req-card').count() === 3, 'в списке 3 заявки');
  ok(await page.locator('.screen:not(.leaving) .tag-warn').count() === 1, 'одна заявка с пометкой «Сверх лимита»');
  await noHScroll(page, 'Заявки');
  if (isPhone) await shot(page, '10-zayavki');

  await tap(page, '.req-card[data-go="#/requests/r101"]');
  await settle(page);
  ok((await screenKey(page)) === '#/requests/r101', 'карточка заявки');
  ok((await page.locator('.screen:not(.leaving) .over-note').innerText().then(norm)).includes('Превышение лимита на 500 000 ₸'), 'превышение лимита на 500 000 ₸');
  ok(await page.locator('.screen:not(.leaving) .rt').count() === 3, 'маршрут согласования из 3 шагов');
  await noHScroll(page, 'Карточка заявки');
  if (isPhone) await shot(page, '11-zayavka-kartochka');
  await scrollTo(page, '.budget');
  if (isPhone) await shot(page, '12-zayavka-byudzhet-i-limit');
  await scrollTo(page, '.route');
  if (isPhone) await shot(page, '13-zayavka-marshrut');

  await tap(page, '[data-act="open-pdf"]');
  await settle(page, 450);
  ok(await page.locator('.sheet .paper').isVisible(), 'вложение PDF открывается заглушкой');
  ok((await page.locator('.sheet .paper-total').innerText().then(norm)).includes('2 300 000'), 'сумма счёта совпадает с заявкой');
  if (isPhone) await shot(page, '14-vlozhenie-schet');
  await tap(page, '.pdf-bar [data-act="sheet-close"]');
  await settle(page, 350);

  // согласование
  await tap(page, '[data-act="approve"]');
  await settle(page, 450);
  ok(await page.locator('.sheet .confirm-sum').isVisible(), 'подтверждение согласования');
  if (isPhone) await shot(page, '15-podtverzhdenie');
  await tap(page, '[data-act="approve-confirm"]');
  await page.waitForSelector('.done-overlay.show');
  await settle(page, 750);
  ok(await page.locator('.done-title').innerText().then(norm) === 'Заявка согласована', 'анимация «Заявка согласована»');
  if (isPhone) await shot(page, '16-soglasovano');
  await page.waitForFunction(() => location.hash === '#/requests');
  await settle(page, 1300);
  ok(await page.locator('.screen:not(.leaving) .req-card').count() === 2, 'заявка ушла из списка');
  ok((await tabBadge(page)) === '2', 'бейдж вкладки уменьшился до 2');

  // отклонение без комментария и с комментарием
  await tap(page, '.req-card[data-go="#/requests/r102"]');
  await settle(page);
  await tap(page, '[data-act="reject"]');
  await settle(page, 450);
  await tap(page, '[data-act="reject-confirm"]');
  await settle(page, 600);
  ok(await page.locator('#reject-err').isVisible(), 'без комментария отклонить нельзя');
  if (isPhone) await shot(page, '17-otklonenie-nuzhen-kommentariy');
  await tap(page, '.chip[data-v="Перенесём на следующий месяц"]');
  await tap(page, '[data-act="reject-confirm"]');
  await page.waitForSelector('.done-overlay.show');
  ok(await page.locator('.done-title').innerText().then(norm) === 'Заявка отклонена', 'анимация «Заявка отклонена»');
  await page.waitForFunction(() => location.hash === '#/requests');
  await settle(page, 1300);
  ok(await page.locator('.screen:not(.leaving) .req-card').count() === 1, 'осталась 1 заявка');

  await tap(page, '[data-act="req-tab"][data-v="done"]');
  await settle(page, 250);
  ok(await page.locator('.screen:not(.leaving) .req-card').count() === 4, 'во вкладке «Решённые» 4 заявки');
  if (isPhone) await shot(page, '18-zayavki-reshennye');
  await tap(page, '[data-act="req-tab"][data-v="pending"]');
  await settle(page, 200);

  await tab(page, '#/home');
  await settle(page);
  ok((await homeCount(page)) === 'На согласовании: 1', 'счётчик на главной уменьшился до 1');

  // согласованная заявка появилась в календаре
  await page.evaluate(() => { location.hash = '#/calendar/2026-11-13'; });
  await settle(page);
  ok((await page.locator('.screen:not(.leaving) .day-card').innerText().then(norm)).includes('по заявке'), 'согласованный платёж встал в календарь');

  // --- отчёты ---
  await tab(page, '#/reports');
  await settle(page);
  ok(await page.locator('.screen:not(.leaving) .dds-chart').isVisible(), 'ДДС: график по неделям');
  await page.locator('.screen:not(.leaving) .dds-chart .hit').nth(1).dispatchEvent('click');
  await settle(page, 250);
  ok((await page.locator('.screen:not(.leaving) .ds-title').innerText().then(norm)) === '5–11 октября', 'выбор недели на графике');
  await noHScroll(page, 'Отчёты, ДДС');
  if (isPhone) await shot(page, '19-otchet-dds');
  await tap(page, '.seg-btn[data-go="#/reports/plan"]');
  await settle(page, 300);
  ok(await page.locator('.screen:not(.leaving) .pf').count() >= 6, 'план-факт по статьям');
  ok(await page.locator('.screen:not(.leaving) .pf.over').count() >= 1, 'статья сверх плана выделена');
  await noHScroll(page, 'Отчёты, план-факт');
  if (isPhone) await shot(page, '20-otchet-plan-fakt');
  await tap(page, '.seg-btn[data-go="#/reports/debtors"]');
  await settle(page, 300);
  ok(await page.locator('.screen:not(.leaving) .debt').count() === 5, 'топ-5 должников');
  await noHScroll(page, 'Отчёты, должники');
  if (isPhone) await shot(page, '21-otchet-dolzhniki');

  // --- уведомления ---
  await tab(page, '#/home');
  await settle(page);
  await tap(page, '.icon-btn[data-go="#/notifications"]');
  await settle(page);
  const ntext = await page.locator('.screen:not(.leaving) .scroll').innerText().then(norm);
  ok(ntext.includes('Поступила оплата') && ntext.includes('Новая заявка на согласование') && ntext.includes('Кассовый разрыв в четверг') && ntext.includes('Утренняя сводка'), 'лента: оплата, заявка, разрыв, сводка');
  ok(ntext.includes('Вы согласовали заявку'), 'в ленте есть ваше решение по заявке');
  await noHScroll(page, 'Уведомления');
  if (isPhone) await shot(page, '22-uvedomleniya');
  await tap(page, '.notif:has-text("Утренняя сводка")');
  await settle(page, 450);
  ok(await page.locator('.sheet .sc-bubble').isVisible(), 'утренняя сводка открывается');
  if (isPhone) await shot(page, '23-utrennyaya-svodka');
  await tap(page, '[data-act="sheet-close"].btn');
  await settle(page, 350);
  await tap(page, '.notif:has-text("Кассовый разрыв")');
  await settle(page);
  ok((await screenKey(page)) === '#/calendar/2026-11-12', 'уведомление о разрыве ведёт в календарь');
  await page.goBack();
  await settle(page);

  // --- профиль ---
  await page.evaluate(() => { location.hash = '#/profile'; });
  await settle(page);
  const sw = page.locator('.screen:not(.leaving) [data-act="toggle"][data-k="payments"]');
  const before = await sw.getAttribute('aria-checked');
  await sw.click();
  ok((await sw.getAttribute('aria-checked')) !== before, 'переключатель уведомлений работает');
  await noHScroll(page, 'Профиль');
  await page.evaluate(() => { document.querySelector('.screen:not(.leaving) .scroll').scrollTop = 0; });
  await settle(page, 300);
  if (isPhone) await shot(page, '24-profil');
  await tap(page, '[data-act="switch-org"][data-id="sever"]');
  await settle(page, 300);
  await tab(page, '#/home');
  await settle(page);
  ok((await page.locator('.org-pill-name').innerText().then(norm)) === 'Север Трейд', 'переключение организации из профиля');
  ok(await page.locator('.screen:not(.leaving) .calm-card').isVisible(), 'у «Север Трейд» нет разрывов — спокойная плашка');
  await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 5000 });
  await settle(page, 500);
  if (isPhone) await shot(page, '25-glavnaya-sever-treyd');
  await page.evaluate(() => { location.hash = '#/profile'; });
  await settle(page);
  await tap(page, '[data-act="switch-org"][data-id="alfa"]');
  await settle(page, 300);
  await tap(page, '[data-act="reset-demo"]');
  await settle(page, 400);
  await tap(page, '[data-act="reset-confirm"]');
  await settle(page, 600);
  ok((await tabBadge(page)) === '3', '«Сбросить демо» возвращает 3 заявки');

  // --- обновление страницы на любом экране ---
  for (const h of ['#/home', '#/calendar/2026-11-12', '#/requests', '#/requests/r101', '#/reports/plan', '#/notifications', '#/profile', '#/orgs']) {
    const resp = await page.goto(BASE + h);
    await settle(page, 450);
    const okStatus = resp ? resp.status() < 400 : true;
    ok(okStatus && (await screenKey(page)) === h && (await page.locator('.screen').count()) >= 1, `обновление на ${h} — без 404, тот же экран`);
  }

  // «Назад» на экране, открытом по прямой ссылке, ведёт внутрь приложения
  await page.goto(BASE + '#/requests/r103');
  await settle(page, 500);
  await tap(page, '[data-back]');
  await settle(page);
  ok((await screenKey(page)) === '#/requests', '«Назад» после прямой ссылки ведёт в список заявок');

  // --- выход ---
  await page.goto(BASE + '#/profile');
  await settle(page);
  await tap(page, '[data-act="logout"]');
  await settle(page);
  ok((await screenKey(page)) === '#/login', '«Выйти» возвращает на вход');

  // без localStorage (приватный режим) — не падает
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  await page.goto(BASE + '#/home');
  await settle(page, 600);
  ok((await screenKey(page)) === '#/login', 'без localStorage приложение работает (вход)');

  ok(errors.length === 0, `нет ошибок в консоли${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await ctx.close();
}

async function desktopFrame(browser) {
  console.log('\n▶ Десктоп 1440×900: рамка телефона');
  const { ctx, page, errors } = await newPage(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE);
  await page.waitForSelector('.screen #phone');
  await page.evaluate(() => document.fonts.ready);
  await settle(page, 1700);
  ok(await page.evaluate(() => document.documentElement.classList.contains('framed')), 'на компьютере включена рамка телефона');
  const box = await page.locator('.device-slot').boundingBox();
  ok(Math.abs(box.x + box.width / 2 - 1440 / 2) < 260 && box.height <= 900, 'телефон по центру экрана и помещается по высоте');
  ok(await page.locator('.promo').isVisible(), 'подпись для презентации рядом с телефоном');
  await noHScroll(page, 'Десктоп');
  if (SAVE) await page.screenshot({ path: path.join(SHOTS, '00-desktop-ramka.png') });
  ok(errors.length === 0, `нет ошибок в консоли${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await ctx.close();
}

(async () => {
  let srv;
  if (!BASE) {
    srv = await serve();
    BASE = `http://localhost:${srv.address().port}/`;
  }
  if (SAVE) fs.mkdirSync(SHOTS, { recursive: true });
  console.log(`Проверяю ${BASE}`);
  const browser = await chromium.launch();
  try {
    await runFlow(browser, 'iPhone 13', devices['iPhone 13'], true);
    await runFlow(browser, 'Десктоп 1440×900', { viewport: { width: 1440, height: 900 } }, false);
    await desktopFrame(browser);
  } catch (e) {
    failures++;
    console.error(e);
  }
  await browser.close();
  srv?.close();
  console.log(failures ? `\nИТОГ: ошибок — ${failures}` : '\nИТОГ: все проверки пройдены');
  process.exit(failures ? 1 : 0);
})();
