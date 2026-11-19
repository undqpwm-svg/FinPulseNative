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
  // Сервер-посредник ещё не развёрнут: при запуске приложение спрашивает GET /version (контракт, 3.1) — отвечаем
  // «недоступен». Этот отказ ожидаем, остальные ошибки консоли — нет.
  await page.route(/^https:\/\/api(-test)?\.smartsol\.pro\//, (r) => r.abort('failed'));
  page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_FAILED/.test(m.text())) errors.push(m.text()); });
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
  await page.waitForSelector('.screen [data-act="tg-start"]');
  await page.evaluate(() => document.fonts.ready);
  await settle(page, 1700);

  // --- вход ---
  ok(await page.locator('.login-foot').innerText().then(norm) === 'SmartSol × FINTAX CONSULT', 'на входе подпись SmartSol × FINTAX CONSULT');
  ok((await page.locator('[data-act="tg-start"]').innerText().then(norm)).includes('Получить код'), 'кнопка «Получить код»');
  ok(await page.locator('#login-phone').count() === 1 && (await page.locator('#login-phone').inputValue()) === '', 'поле номера телефона, пустое');
  await noHScroll(page, 'Вход');
  if (isPhone) await shot(page, '01-vhod');
  ok(await page.locator('[data-act="mode-demo"]').isVisible(), 'по умолчанию — настоящий вход, есть «Посмотреть демо»');
  await page.locator('[data-act="mode-demo"]').click();
  await settle(page, 700);
  ok((await page.locator('.login-hint').innerText().then(norm)).includes('Демо'), 'включён демо-режим');
  ok((await page.locator('#login-phone').inputValue()) === '+7 701 555 12 34', 'демо: в поле — номер демо-пользователя');
  if (isPhone) await shot(page, '01b-vhod-demo-nomer');
  // вход: номер → экран кода (один для всех) → «Войти через Telegram» → «бот» просит номер и присылает код
  await tap(page, '[data-act="tg-start"]');
  await settle(page, 1300);
  ok((await screenKey(page)) === '#/telegram', 'экран после «Получить код»');
  ok((await page.locator('.screen:not(.leaving) .login-title').innerText().then(norm)) === 'Подтвердите вход в Telegram', 'первый вход: экран «Подтвердите вход в Telegram»');
  ok(await page.locator('.screen:not(.leaving) [data-tg-code]').count() === 0, 'числа для выбора больше нет');
  const field = page.locator('.screen:not(.leaving) [data-tg-input]');
  ok(await page.locator('.screen:not(.leaving) .tg-cells i').count() === 6 && (await field.getAttribute('autocomplete')) === 'one-time-code' && (await field.getAttribute('inputmode')) === 'numeric', 'поле кода: 6 цифр, цифровая клавиатура, one-time-code');
  ok((await page.locator('.screen:not(.leaving) [data-tg-note]').innerText().then(norm)) === 'С этого устройства вход нужно один раз подтвердить в Telegram. Нажмите кнопку — бот пришлёт код.', 'новое устройство: текст заказчика');
  ok((await field.isHidden()) && (await page.locator('.screen:not(.leaving) [data-tg-paste]').isHidden()) && (await page.locator('.screen:not(.leaving) [data-tg-submit]').isHidden()), 'до нажатия кнопки — только текст и кнопка: поля кода, «Вставить код» и «Войти» нет');
  ok(await page.locator('.screen:not(.leaving) [data-tg-open]').evaluate((e) => e.classList.contains('btn-primary')), '«Войти через Telegram» — главная кнопка');
  ok((await page.locator('.screen:not(.leaving) [data-tg-phone]').innerText().then(norm)) === '+7 701 555 12 34', 'на экране кода — введённый номер');
  await settle(page, 1800);
  ok(await page.locator('.sheet-wrap').count() === 0, 'первый вход с устройства: бот сам не открывается и код сам не приходит');
  await noHScroll(page, 'Ввод кода');
  if (isPhone) await shot(page, '02a-podtverdite-vhod');
  await tap(page, '[data-tg-open]');
  await settle(page, 500);
  ok((await page.locator('.sheet-wrap .tgbot').innerText().then(norm)).includes('Нажмите «Поделиться номером»'), '«Войти через Telegram» → демо-бот просит «Поделиться номером»');
  if (isPhone) await shot(page, '02b-demo-bot-nomer');
  await page.locator('.sheet-wrap [data-act="tg-demo-share"]').click();
  await page.waitForSelector('.sheet-wrap .tgbot-code', { timeout: 6000 });
  await settle(page, 400);
  const botMsg = await page.locator('.sheet-wrap [data-tgbot-code]').innerText().then(norm);
  const code1 = (await page.locator('.sheet-wrap .tgbot-code').innerText()).trim();
  ok(/^\d{6}$/.test(code1), 'демо-бот прислал код из 6 цифр');
  ok(botMsg.replace(/\s+/g, ' ') === `Код для входа в ФинПульс: ${code1} Действует 5 минут. Вводите только на finpulse.smartsol.pro. Никому не называйте этот код. Если вход начали не вы — просто проигнорируйте сообщение.`, 'текст сообщения бота — как у настоящего');
  ok((await page.locator('.sheet-wrap .tgbot-msg.mine').innerText().then(norm)).includes('+7 701 555 12 34'), 'боту ушёл номер, введённый в приложении');
  if (isPhone) await shot(page, '02c-demo-bot-kod');
  await tap(page, '[data-act="sheet-close"].btn');
  await settle(page, 450);
  ok((await page.locator('.screen:not(.leaving) .login-title').innerText().then(norm)) === 'Введите код из Telegram' && (await page.locator('.screen:not(.leaving) [data-tg-note]').innerText().then(norm)) === 'Нажмите на код в сообщении бота — он скопируется. Вернитесь сюда и вставьте его.', 'после бота экран — про ввод кода');
  ok((await field.isVisible()) && (await page.locator('.screen:not(.leaving) [data-tg-status]').innerText().then(norm)) === 'Код действует 5 минут', 'появилось поле кода и подсказка «Код действует 5 минут», без таймера');
  ok((await page.locator('.screen:not(.leaving) [data-tg-open]').innerText().then(norm)).includes('Открыть Telegram ещё раз'), 'кнопка бота — «Открыть Telegram ещё раз»');
  if (isPhone) await shot(page, '02d-posle-bota-vvedite-kod');
  // неверный код → «Осталось попыток: 4», поле очищено
  const wrong = code1 === '000000' ? '111111' : '000000';
  await field.fill(wrong);
  await page.waitForSelector('.screen:not(.leaving) #tg-code-err:not([hidden])', { timeout: 6000 });
  ok((await page.locator('.screen:not(.leaving) #tg-code-err').innerText().then(norm)).includes('Неверный код. Осталось попыток: 4'), 'неверный код — «Осталось попыток: 4»');
  ok((await field.inputValue()) === '', 'поле кода очищено');
  await settle(page, 300);
  if (isPhone) await shot(page, '02e-nevernyy-kod');
  // «Войти через Telegram» ещё раз → код не повторяется; нажатие на код копирует его → «Вставить код» → вход
  await tap(page, '[data-tg-open]');
  await settle(page, 500);
  ok((await page.locator('.sheet-wrap .tgbot').innerText().then(norm)).includes('Код уже отправлен — он выше в этом чате'), 'бот открыт ещё раз: «Код уже отправлен — он выше в этом чате»');
  await page.locator('.sheet-wrap .tgbot-code').click();
  await page.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 6000 });
  await tap(page, '[data-tg-paste]');
  await page.waitForFunction(() => location.hash === '#/orgs', null, { timeout: 8000 });
  await settle(page, 900);

  // --- выбор организации ---
  ok((await screenKey(page)) === '#/orgs', 'код из бота вставлен кнопкой «Вставить код» → выбор организации');
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
  const homeRec = await page.locator('.screen:not(.leaving) .rec-card').innerText().then(norm);
  ok(homeRec.includes('Долг по возрасту') && homeRec.includes('> 60 дней') && !/просроч|в срок/i.test(homeRec), 'главная: долг по возрасту, без «просрочено»');
  if (isPhone) await shot(page, '04-glavnaya');
  await scrollTo(page, '.card');
  if (isPhone) await shot(page, '05-glavnaya-7-dney-i-debitorka');

  await tap(page, '.hero');
  await settle(page, 450);
  ok(await page.locator('.sheet [data-acc="main"] .acc-row').count() === 3, 'шторка со счетами открывается');
  ok(/^На \d\d:\d\d · /.test((await page.locator('.sheet [data-acc-sub]').innerText()).trim()), 'под заголовком листа — «На ЧЧ:ММ» и организация');
  ok(await page.locator('.sheet [data-acc="deposits"] .acc-row').count() === 1 && (await page.locator('.sheet [data-acc="deposits"]').innerText()).includes('не входят'), 'депозит — отдельным блоком под «Итого», с подписью «не входят»');
  {
    const num = (t) => String(t).replace(/[^\d]/g, '');
    const total = num(await page.locator('.sheet .acc-total b').innerText());
    ok(total === '12480000' && num(await page.locator('.hero .bm-num').innerText()) === total, `«Итого» без депозита — 12 480 000 ₸, как «Деньги на сегодня» (${total})`);
  }
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
  ok(await page.locator('.screen:not(.leaving) [data-dir-tag]').count() === 1 && (await page.locator('.screen:not(.leaving) .req-wrap[data-id="r103"] [data-dir-tag]').innerText().then(norm)) === 'Доп. согласование', 'одна заявка с меткой «Доп. согласование» — та, что пришла директору');
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

  // --- на доработку ---
  await page.evaluate(() => { location.hash = '#/requests/r103'; });
  await settle(page);
  ok(await page.locator('.screen:not(.leaving) .actionbar [data-act="return"]').isVisible(), 'в карточке есть «На доработку»');
  const dirRt = await page.locator('.screen:not(.leaving) .rt').evaluateAll((els) => els.map((e) => e.innerText.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim()));
  ok(dirRt.length === 3 && dirRt[1].includes('Гульнара Бекова') && dirRt[1].includes('Согласовал и отправил директору') && dirRt[2].includes('(вы)') && dirRt[2].includes('Директор — доп. согласование'), 'заявка на доп. согласовании: кто отправил директору и строка директора');
  ok(await page.locator('.screen:not(.leaving) [data-act="to-director"]').count() === 0, 'у директора кнопки «Отправить директору» нет');
  if (isPhone) await shot(page, '26-zayavka-tri-deystviya');
  await tap(page, '[data-act="return"]');
  await settle(page, 450);
  await tap(page, '[data-act="return-confirm"]');
  await settle(page, 600);
  ok(await page.locator('#reject-err').isVisible(), 'без комментария вернуть на доработку нельзя');
  await tap(page, '.chip[data-v="Уточните сумму"]');
  await settle(page, 400);
  if (isPhone) await shot(page, '27-na-dorabotku');
  await tap(page, '[data-act="return-confirm"]');
  await page.waitForSelector('.done-overlay.show');
  await settle(page, 750);
  ok((await page.locator('.done-title').innerText().then(norm)) === 'Возвращена на доработку', 'анимация «Возвращена на доработку»');
  if (isPhone) await shot(page, '28-vozvrashchena');
  await page.waitForFunction(() => location.hash === '#/requests');
  await settle(page, 1300);
  ok(await page.locator('.screen:not(.leaving) .req-card').count() === 0, 'заявка ушла из списка — все решены');
  await tap(page, '[data-act="req-tab"][data-v="done"]');
  await settle(page, 300);
  ok((await page.locator('.screen:not(.leaving) .req-list').innerText().then(norm)).includes('На доработке'), 'в «Решённых» — метка «На доработке»');
  await tap(page, '[data-act="req-tab"][data-v="pending"]');
  await settle(page, 200);

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
  const debtText = await page.locator('.screen:not(.leaving) .rep-body').innerText().then(norm);
  ok(debtText.includes('Долг по возрасту') && debtText.includes('0–30 дней') && debtText.includes('31–60 дней') && debtText.includes('> 60 дней'), 'должники: долг по возрасту 0–30 / 31–60 / > 60 дней');
  ok(!/просроч/i.test(debtText), 'должники: нет слов «просрочено» и «просрочка»');
  await noHScroll(page, 'Отчёты, должники');
  if (isPhone) await shot(page, '21-otchet-dolzhniki');

  // --- проекты (у «Альфа Логистик» учёт по проектам включён: четвёртый пункт переключателя) ---
  ok((await page.locator('.screen:not(.leaving) .seg-btn').allInnerTexts()).map((x) => norm(x).trim()).join(' · ') === 'ДДС · План-факт · Должники · Проекты', 'переключатель отчётов: ДДС · План-факт · Должники · Проекты');
  await tap(page, '.seg-btn[data-go="#/reports/projects"]');
  await page.waitForSelector('.screen:not(.leaving) [data-prj-totals]', { timeout: 6000 });
  await settle(page, 400);
  const prjTot = await page.locator('.screen:not(.leaving) [data-prj-totals]').innerText().then(norm);
  ok(prjTot.includes('8 проектов') && prjTot.includes('1 без ID') && prjTot.includes('468 389 086') && prjTot.includes('96,2 млн'), 'проекты: итоги — 8 проектов, 1 без ID, стоимость и долг');
  ok(await page.locator('.screen:not(.leaving) .prj').count() === 8 && await page.locator('.screen:not(.leaving) .prj').last().evaluate((e) => e.classList.contains('noid')), 'проекты: 8 строк, реализация без ID — последней');
  await noHScroll(page, 'Проекты');
  if (isPhone) await shot(page, '32-proekty-spisok');
  {
    // отбор по категории: ряд чипов над итогами
    const cats = (await page.locator('.screen:not(.leaving) [data-prj-cats] .chip').allInnerTexts()).map((x) => norm(x).replace(/\s+/g, ' ').trim());
    ok(cats.join(' · ') === 'Все · Проектная 2 · Регулярная 5', `проекты: чипы категорий с числом проектов (${cats.join(' · ')})`);
    await tap(page, '[data-prj-cat="cat_project"]');
    await page.waitForFunction(() => document.querySelectorAll('.screen:not(.leaving) .prj').length === 2, null, { timeout: 6000 });
    ok((await page.locator('.screen:not(.leaving) [data-prj-totals]').innerText().then(norm)).includes('2 проекта'), 'проекты: «Проектная» — 2 проекта, итоги по категории');
    await noHScroll(page, 'Проекты, категория');
    if (isPhone) await shot(page, '40-proekty-kategoriya');
    await tap(page, '[data-prj-cat=""]');
    await page.waitForFunction(() => document.querySelectorAll('.screen:not(.leaving) .prj').length === 8, null, { timeout: 6000 });
    ok((await page.locator('.screen:not(.leaving) [data-prj-period] svg').count()) === 2, 'проекты: на кнопке периода — значок календаря');
  }
  await tap(page, '[data-act="prj-chip"][data-k="debtOnly"]');
  await page.waitForFunction(() => document.querySelectorAll('.screen:not(.leaving) .prj').length === 7, null, { timeout: 6000 });
  ok((await page.locator('.screen:not(.leaving) [data-prj-totals]').innerText().then(norm)).includes('7 проектов'), 'проекты: «Есть долг» — 7 проектов, итоги по отбору');
  await tap(page, '[data-prj-period]');
  await settle(page, 450);
  ok((await page.locator('.sheet').innerText().then(norm)).includes('Период — по дате реализаций'), 'проекты: шторка «Отборы и сортировка»');
  await noHScroll(page, 'Проекты, отборы');
  if (isPhone) await shot(page, '33-proekty-otbory');
  await page.locator('.sheet [data-act="prj-reset"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.screen:not(.leaving) .prj').length === 8, null, { timeout: 6000 });
  await settle(page, 400);
  await tap(page, '.prj[data-prj="prj_demo_7d4c"]');
  await page.waitForSelector('.screen:not(.leaving) [data-project="prj_demo_7d4c"]', { timeout: 6000 });
  await settle(page, 500);
  const prjCard = await page.locator('.screen:not(.leaving) .scroll').innerText().then(norm);
  ok(prjCard.includes('ТОО «Бирлик Трейд»') && prjCard.includes('42 085 759') && prjCard.includes('Оплата заказчика') && prjCard.includes('Оплаты поставщикам'), 'отчёт по проекту PS-2026-04: стоимость, оплата заказчика, оплаты поставщикам');
  await noHScroll(page, 'Проект');
  if (isPhone) await shot(page, '34-proekt-kartochka');
  await tap(page, '[data-pt="sales"] .pt-head');
  await tap(page, '[data-pt="payments"] .pt-head');
  await settle(page, 300);
  ok(await page.locator('.screen:not(.leaving) [data-pt="sales"] .pt-row').count() === 8 && (await page.locator('.screen:not(.leaving) [data-pt="sales"] .pt-body').innerText().then(norm)).includes('счёт 1274'), 'проект: таблица «Реализации» раскрыта — 8 строк, доход и расход');
  await scrollTo(page, '[data-pt="sales"]');
  await noHScroll(page, 'Проект, таблицы');
  if (isPhone) await shot(page, '35-proekt-tablicy');
  await tap(page, '.topbar [data-back]');
  await page.waitForSelector('.screen:not(.leaving) [data-prj-totals]', { timeout: 6000 });
  await settle(page, 400);
  await tap(page, '.prj.noid');
  await page.waitForSelector('.screen:not(.leaving) [data-project="prj_demo_b188"]', { timeout: 6000 });
  await settle(page, 500);
  ok((await page.locator('.screen:not(.leaving) [data-prj-hint]').innerText().then(norm)).includes('нет ID заявки'), 'реализация без ID: подсказка бухгалтеру');
  if (isPhone) await shot(page, '36-proekt-bez-id');
  await tap(page, '.topbar [data-back]');
  await page.waitForSelector('.screen:not(.leaving) [data-prj-totals]', { timeout: 6000 });
  await settle(page, 400);
  await tap(page, '.prj[data-prj="prj_demo_4a1f"]');
  await page.waitForSelector('.screen:not(.leaving) [data-project="prj_demo_4a1f"]', { timeout: 6000 });
  ok((await page.locator('.screen:not(.leaving) .tb-title').innerText().then(norm)) === 'Проект PS-2026-01', 'карточка любого проекта демо открывается');
  await tap(page, '.topbar [data-back]');
  await page.waitForSelector('.screen:not(.leaving) [data-prj-totals]', { timeout: 6000 });
  await settle(page, 300);

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
  const wa = page.locator('.screen:not(.leaving) .li-locked[data-k="whatsapp"]');
  ok((await wa.innerText().then(norm)).includes('Настраивает администратор'), 'WhatsApp — неактивный, «Настраивает администратор»');
  ok(await page.locator('.screen:not(.leaving) [data-act="logout-all"]').count() === 1, 'в профиле есть «Выйти со всех устройств»');
  await page.evaluate(() => { const s = document.querySelector('.screen:not(.leaving) .scroll'); s.scrollTop = s.scrollHeight; });
  await settle(page, 300);
  if (isPhone) await shot(page, '29-profil-vyhod-vezde');
  await tap(page, '[data-act="logout-all"]');
  await settle(page, 450);
  ok((await page.locator('.sheet').innerText().then(norm)).includes('Выйти со всех устройств?'), '«Выйти со всех устройств» — с подтверждением');
  if (isPhone) await shot(page, '30-vyhod-vezde-podtverzhdenie');
  await tap(page, '[data-act="sheet-close"].btn');
  await settle(page, 400);
  await tap(page, '[data-act="switch-org"][data-id="sever"]');
  await settle(page, 300);
  await tab(page, '#/home');
  await settle(page);
  ok((await page.locator('.org-pill-name').innerText().then(norm)) === 'Север Трейд', 'переключение организации из профиля');
  ok(await page.locator('.screen:not(.leaving) .calm-card').isVisible(), 'у «Север Трейд» нет разрывов — спокойная плашка');
  // у «Север Трейд» учёта по проектам нет — на вкладке три отчёта
  await tab(page, '#/reports');
  await settle(page);
  ok((await page.locator('.screen:not(.leaving) .seg-btn').allInnerTexts()).map((x) => norm(x).trim()).join(' · ') === 'ДДС · План-факт · Должники', '«Север Трейд»: на вкладке «Отчёты» три отчёта, «Проектов» нет');
  await tab(page, '#/home');
  await settle(page);
  // заявка с двумя статьями: превышение — по доле основной статьи, а не по всей сумме заявки
  ok((await homeCount(page)) === 'На согласовании: 3' && (await page.locator('.screen:not(.leaving) .appr-body').innerText().then(norm)).includes('1 сверх лимита'), '«Север Трейд»: 3 заявки, одна сверх лимита');
  await page.evaluate(() => { location.hash = '#/requests/r203'; });
  await settle(page);
  const two = await page.locator('.screen:not(.leaving) [data-budget]').innerText().then(norm);
  ok(two.includes('Превышение лимита на 150 000 ₸') && !two.includes('600 000'), 'заявка с двумя статьями: превышение 150 000 ₸ (по доле статьи), а не 600 000 ₸ (по всей сумме)');
  ok(two.includes('По статье') && two.includes('1 100 000 ₸') && two.includes('из 1 550 000 ₸ приходится 1 100 000 ₸'), 'в бюджете — доля заявки по статье «Доставка»: 1 100 000 из 1 550 000');
  await noHScroll(page, 'Заявка с двумя статьями');
  await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 5000 });
  await scrollTo(page, '.budget');
  if (isPhone) await shot(page, '31-zayavka-dve-stati');
  await tap(page, '[data-act="approve"]');
  await settle(page, 450);
  ok((await page.locator('.sheet .over-note').innerText().then(norm)).includes('Сверх лимита на 150 000 ₸'), 'подтверждение согласования: то же превышение 150 000 ₸');
  await tap(page, '[data-act="sheet-close"].btn');
  await settle(page, 400);
  await tab(page, '#/home');
  await settle(page);
  await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 5000 });
  await settle(page, 500);
  if (isPhone) await shot(page, '25-glavnaya-sever-treyd');

  // --- массовое согласование на демо-данных («Север Трейд»: три заявки, одна сверх лимита) ---
  await tab(page, '#/requests');
  await settle(page);
  ok(await page.locator('.screen:not(.leaving) [data-act="bulk-start"]').isVisible(), 'демо: на вкладке «Ждут решения» есть «Выбрать»');
  await tap(page, '[data-act="bulk-start"]');
  await settle(page, 300);
  ok(await page.locator('.screen:not(.leaving) .req-wrap.unpickable').count() === 1 && (await page.locator('.screen:not(.leaving) .req-wrap.unpickable').innerText().then(norm)).includes('только по одной'), 'демо: заявка сверх лимита — «только по одной»');
  await tap(page, '[data-act="bulk-all"]');
  await settle(page, 300);
  const bulkBtn = await page.locator('.screen:not(.leaving) [data-bulk-go]').innerText().then(norm);
  ok(await page.locator('.screen:not(.leaving) .req-wrap.picked').count() === 2 && bulkBtn.includes('Согласовать (2)'), `демо: «Выбрать все» — две заявки, кнопка «${bulkBtn.trim()}»`);
  await noHScroll(page, 'Заявки, выбор');
  if (isPhone) await shot(page, '37-zayavki-vybor');
  await tap(page, '[data-bulk-go]');
  await settle(page, 500);
  ok((await page.locator('.sheet-wrap').innerText().then(norm)).includes('Согласовать 2 заявки?') && await page.locator('.sheet-wrap .bk-row').count() === 2, 'демо: подтверждение со списком двух заявок');
  await noHScroll(page, 'Заявки, подтверждение');
  if (isPhone) await shot(page, '38-zayavki-podtverzhdenie');
  await tap(page, '[data-act="bulk-send"]');
  await page.waitForSelector('.sheet-wrap [data-bulk-result]', { timeout: 15000 });
  await settle(page, 400);
  const bulkRes = await page.locator('.sheet-wrap').innerText().then(norm);
  ok(bulkRes.includes('Согласовано: 2') && bulkRes.includes('Все выбранные заявки согласованы') && await page.locator('.sheet-wrap .bk-row[data-st="ok"]').count() === 2, 'демо: итог «Согласовано: 2», по каждой заявке — «Согласована»');
  if (isPhone) await shot(page, '39-zayavki-itog');
  await tap(page, '[data-act="bulk-done"]');
  await settle(page, 900);
  ok(await page.locator('.screen:not(.leaving) .req-card').count() === 1 && (await tabBadge(page)) === '1' && await page.locator('.screen:not(.leaving) [data-act="bulk-start"]').count() === 0, 'демо: в списке осталась одна заявка, значок вкладки — 1');

  // --- отправить директору («Дала Агро Сервис»: пользователь — последний в маршруте, директор — другой человек) ---
  await page.evaluate(() => { location.hash = '#/profile'; });
  await settle(page);
  await tap(page, '[data-act="switch-org"][data-id="dala"]');
  await settle(page, 300);
  await page.evaluate(() => { location.hash = '#/requests/r301'; });
  await settle(page);
  await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 5000 });
  ok(await page.locator('.screen:not(.leaving) .actionbar [data-act="to-director"]').isVisible(), 'демо: в карточке есть «Отправить директору»');
  await noHScroll(page, 'Заявка, отправить директору');
  if (isPhone) await shot(page, '41-zayavka-otpravit-direktoru');
  await tap(page, '[data-act="to-director"]');
  await settle(page, 450);
  ok((await page.locator('.sheet').innerText().then(norm)).includes('Директор — Серик Байжанов'), 'демо: в подтверждении — имя директора');
  await page.locator('.sheet #reject-text').fill('Предзаказ на весну — на ваше решение');
  await noHScroll(page, 'Отправить директору, подтверждение');
  if (isPhone) await shot(page, '42-otpravit-direktoru-podtverzhdenie');
  await tap(page, '[data-act="director-confirm"]');
  await page.waitForSelector('.toast.show', { timeout: 6000 });
  ok((await page.locator('.toast').innerText().then(norm)).trim() === 'Отправлено директору' && (await screenKey(page)) === '#/requests/r301', 'демо: «Отправлено директору», карточка остаётся открытой');
  await settle(page, 500);
  const sentRt = await page.locator('.screen:not(.leaving) .rt').evaluateAll((els) => els.map((e) => e.innerText.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()));
  ok(sentRt.length === 4 && sentRt[2].includes('Согласовал и отправил директору') && sentRt[3].includes('Серик Байжанов') && sentRt[3].includes('Директор — доп. согласование'), 'демо: в маршруте — «Согласовал и отправил директору» и строка директора');
  ok(await page.locator('.screen:not(.leaving) .actionbar').count() === 0 && (await page.locator('.screen:not(.leaving) .status-chip').innerText().then(norm)) === 'На согласовании у директора', 'демо: кнопок нет, статус «На согласовании у директора»');
  await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 5000 });
  await scrollTo(page, '.route');
  if (isPhone) await shot(page, '43-otpravleno-direktoru');
  await tap(page, '[data-back]');
  await settle(page);
  ok(await page.locator('.screen:not(.leaving) .req-card').count() === 0 && (await tabBadge(page)) === '0', 'демо: заявка ушла из «Ждут решения», значка на вкладке нет');
  await page.evaluate(() => { location.hash = '#/calendar/2026-11-15'; });
  await settle(page);
  ok((await screenKey(page)) === '#/calendar/2026-11-15' && !(await page.locator('.screen:not(.leaving)').innerText().then(norm)).includes('Агро Запчасть'), 'демо: отправленная директору заявка в календарь на дату оплаты не встала');
  await page.evaluate(() => { location.hash = '#/profile'; });
  await settle(page);
  await tap(page, '[data-act="switch-org"][data-id="alfa"]');
  await settle(page, 300);
  await tap(page, '[data-act="reset-demo"]');
  await settle(page, 400);
  await tap(page, '[data-act="reset-confirm"]');
  await settle(page, 600);
  ok((await tabBadge(page)) === '3', '«Сбросить демо» возвращает 3 заявки');

  // --- запросы контрагентов (бот в WhatsApp): экран есть у «Альфа Логистик» ---
  const S = '.screen:not(.leaving)';
  const crRows = () => page.locator(`${S} [data-cr-list] .req-card`).count();
  await tab(page, '#/home');
  await settle(page);
  await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 6000 });
  const crHome = await page.locator(`${S} .cr-home`).innerText().then(norm);
  ok(crHome.includes('Запросы контрагентов: 5') && crHome.includes('5 запросов ждут решения'), 'демо: на главной — «Запросы контрагентов: 5»');
  await scrollTo(page, '.alert-card, .calm-card');
  await noHScroll(page, 'Главная, запросы контрагентов');
  if (isPhone) await shot(page, '44-glavnaya-zaprosy-kontragentov');
  await tab(page, '#/requests');
  await settle(page);
  ok((await page.locator(`${S} .cr-entry`).innerText().then(norm)).replace(/\s+/g, ' ').trim() === 'Запросы контрагентов 5' && (await tabBadge(page)) === '3', 'демо: вход из «Заявок» со значком 5; значок вкладки — только заявки');
  if (isPhone) await shot(page, '45-zayavki-vhod-v-zaprosy');
  await tap(page, '.cr-entry');
  await settle(page);
  ok((await screenKey(page)) === '#/cr' && (await crRows()) === 5, 'демо: «Ждут» — пять запросов');
  const crTexts = await page.locator(`${S} [data-cr-list] .req-card`).evaluateAll((els) => els.map((e) => e.innerText.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()));
  ok(crTexts[0].includes('ТОО «Караван Транс»') && crTexts[0].includes('Акт сверки') && crTexts[0].includes('+7 701 ***-**-67'), 'демо: первым — самый старый запрос; номер частично скрыт');
  ok(crTexts.filter((t) => t.includes('Незнакомый номер')).length === 1 && crTexts.filter((t) => t.includes('Задача')).length === 2 && crTexts[4].includes('Контрагент не определён'), 'демо: один незнакомый номер и две задачи, одна — без контрагента');
  await noHScroll(page, 'Запросы контрагентов');
  if (isPhone) await shot(page, '46-zaprosy-kontragentov');

  // ответ с актом сверки: просмотр файла и «Отправить»
  await tap(page, '.req-wrap[data-id="c1"] .req-card');
  await settle(page);
  ok((await screenKey(page)) === '#/cr/c1' && await page.locator(`${S} [data-cr-warn]`).count() === 0 && await page.locator(`${S} [data-act="cr-send"]`).isVisible(), 'демо: карточка ответа — «Отправить» и «Отклонить», предупреждения нет');
  await noHScroll(page, 'Запрос контрагента');
  if (isPhone) await shot(page, '47-zapros-kartochka');
  await scrollTo(page, '[data-cr-answer]');
  if (isPhone) await shot(page, '48-zapros-otvet-i-vlozhenie');
  await tap(page, '[data-act="cr-file"]');
  await settle(page, 500);
  ok(await page.locator('.sheet [data-cr-paper]').isVisible() && (await page.locator('.sheet [data-cr-paper]').innerText().then(norm)).includes('Акт сверки взаимных расчётов'), 'демо: вложение открывается заглушкой акта сверки');
  if (isPhone) await shot(page, '49-zapros-akt-sverki');
  await tap(page, '.pdf-bar [data-act="sheet-close"]');
  await settle(page, 350);
  await tap(page, '[data-act="cr-send"]');
  await settle(page, 450);
  ok((await page.locator('.sheet #reject-text').inputValue()).includes('во вложении'), 'демо: в шторке «Отправить» — текст ответа, его можно поправить');
  await noHScroll(page, 'Запрос, отправить');
  if (isPhone) await shot(page, '50-zapros-otpravit');
  await tap(page, '[data-act="cr-send-confirm"]');
  await page.waitForSelector('.done-overlay.show');
  await settle(page, 750);
  ok((await page.locator('.done-title').innerText().then(norm)) === 'Отправлено контрагенту', 'демо: «Отправлено контрагенту»');
  if (isPhone) await shot(page, '51-zapros-otpravleno');
  await page.waitForFunction(() => location.hash === '#/cr');
  await settle(page, 1300);
  ok((await crRows()) === 4, 'демо: запрос ушёл из «Ждут»');

  // незнакомый номер: предупреждение и «Отклонить» с обязательным комментарием
  await tap(page, '.req-wrap[data-id="c3"] .req-card');
  await settle(page);
  ok((await page.locator(`${S} [data-cr-warn]`).innerText().then(norm)).includes('Номер не из контактов контрагента'), 'демо: незнакомый номер — предупреждение в карточке');
  if (isPhone) await shot(page, '52-zapros-neznakomyy-nomer');
  await tap(page, '[data-act="cr-reject"]');
  await settle(page, 450);
  await tap(page, '[data-act="cr-reject-confirm"]');
  await settle(page, 500);
  ok(await page.locator('#reject-err').isVisible(), 'демо: без комментария отклонить нельзя');
  await tap(page, '.chip[data-v="Номер не из нашей базы"]');
  await settle(page, 300);
  await noHScroll(page, 'Запрос, отклонить');
  if (isPhone) await shot(page, '53-zapros-otklonit');
  await tap(page, '[data-act="cr-reject-confirm"]');
  await page.waitForSelector('.done-overlay.show');
  ok((await page.locator('.done-title').innerText().then(norm)) === 'Запрос отклонён', 'демо: «Запрос отклонён»');
  await page.waitForFunction(() => location.hash === '#/cr');
  await settle(page, 1300);

  // задача бухгалтеру: только «Закрыть»
  await tap(page, '.req-wrap[data-id="c4"] .req-card');
  await settle(page);
  ok(await page.locator(`${S} [data-act="cr-done"]`).isVisible() && await page.locator(`${S} [data-act="cr-send"]`).count() === 0, 'демо: у задачи — только «Закрыть задачу»');
  await noHScroll(page, 'Задача бухгалтеру');
  if (isPhone) await shot(page, '54-zapros-zadacha');
  await tap(page, '[data-act="cr-done"]');
  await settle(page, 450);
  await tap(page, '[data-act="cr-done-confirm"]');
  await page.waitForSelector('.done-overlay.show');
  ok((await page.locator('.done-title').innerText().then(norm)) === 'Задача закрыта', 'демо: «Задача закрыта»');
  await page.waitForFunction(() => location.hash === '#/cr');
  await settle(page, 1300);
  ok((await crRows()) === 2, 'демо: в «Ждут» осталось два запроса');

  // «Решённые» и история
  await tap(page, '[data-act="cr-tab"][data-v="done"]');
  await settle(page, 400);
  ok((await crRows()) === 5, 'демо: в «Решённых» пять запросов — три своих и два прежних');
  if (isPhone) await shot(page, '55-zaprosy-reshennye');
  await tap(page, '.req-wrap[data-id="c6"] .req-card');
  await settle(page);
  const crHist = await page.locator(`${S} [data-cr-history] .rt`).evaluateAll((els) => els.map((e) => e.innerText.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()));
  ok(crHist.length === 4 && crHist[1].includes('Отправлено контрагенту') && crHist[1].includes('Динара Оспанова') && crHist[3].includes('Прочитано') && await page.locator(`${S} .actionbar`).count() === 0, 'демо: решённый запрос — история с тем, кто отправил, «Доставлено» и «Прочитано»; кнопок нет');
  await scrollTo(page, '[data-cr-history]');
  if (isPhone) await shot(page, '56-zapros-istoriya');
  await tap(page, '[data-back]');
  await settle(page);
  await tap(page, '[data-back]');
  await settle(page);
  ok((await screenKey(page)) !== '#/cr', 'демо: «Назад» из списка запросов уводит с него с первого нажатия');
  await tab(page, '#/home');
  await settle(page);
  ok((await page.locator(`${S} .cr-home`).innerText().then(norm)).includes('Запросы контрагентов: 2'), 'демо: на главной число запросов уменьшилось до 2');

  // строка в уведомлениях ведёт в карточку
  await tap(page, '.icon-btn[data-go="#/notifications"]');
  await settle(page);
  await tap(page, '.notif:has-text("Запрос контрагента")');
  await settle(page);
  ok((await screenKey(page)) === '#/cr/c3' && (await page.locator(`${S} .status-chip`).innerText().then(norm)) === 'Отклонено', 'демо: уведомление «Запрос контрагента» открывает карточку');

  // у организации без бота экрана нет
  await page.evaluate(() => { location.hash = '#/profile'; });
  await settle(page);
  await tap(page, '[data-act="switch-org"][data-id="sever"]');
  await settle(page, 300);
  await tab(page, '#/home');
  await settle(page);
  ok(await page.locator(`${S} [data-cr-entry]`).count() === 0, 'демо: у «Север Трейд» входа на экран запросов нет');
  await tab(page, '#/requests');
  await settle(page);
  ok(await page.locator(`${S} [data-cr-entry]`).count() === 0, 'демо: и во вкладке «Заявки» у «Север Трейд» его нет');
  await page.evaluate(() => { location.hash = '#/profile'; });
  await settle(page);
  await tap(page, '[data-act="switch-org"][data-id="alfa"]');
  await settle(page, 300);
  await tap(page, '[data-act="reset-demo"]');
  await settle(page, 400);
  await tap(page, '[data-act="reset-confirm"]');
  await settle(page, 600);
  await tab(page, '#/home');
  await settle(page);
  ok((await page.locator(`${S} .cr-home`).innerText().then(norm)).includes('Запросы контрагентов: 5'), 'демо: «Сбросить демо» возвращает пять запросов');

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
  ok((await screenKey(page)) === '#/login' && (await page.locator('[data-act="mode-demo"]').count()) === 1, '«Выйти из демо» возвращает к настоящему входу');
  ok((await page.locator('#login-phone').inputValue()) === '', 'после выхода поле номера пустое');

  // --- знакомое устройство: при следующем входе бот присылает код сам ---
  await page.locator('[data-act="mode-demo"]').click();
  await settle(page, 700);
  await tap(page, '[data-act="tg-start"]');
  await page.waitForSelector('.sheet-wrap .tgbot-code', { timeout: 8000 });
  await settle(page, 500);
  const autoTxt = await page.locator('.sheet-wrap').innerText().then(norm);
  ok(autoTxt.includes('Код для входа в ФинПульс:') && !autoTxt.includes('Поделиться номером') && autoTxt.includes('бот присылает код сам'), 'знакомое устройство: бот прислал код сам, без «Поделиться номером»');
  if (isPhone) await shot(page, '02g-kod-prishel-sam');
  await page.locator('.sheet-wrap .tgbot-code').click();
  await page.waitForFunction(() => !document.querySelector('.sheet-wrap'), null, { timeout: 6000 });
  ok((await page.locator('.screen:not(.leaving) .login-title').innerText().then(norm)) === 'Введите код из Telegram' && (await page.locator('.screen:not(.leaving) [data-tg-note]').innerText().then(norm)) === 'Если номер подключён, код придёт в Telegram в течение минуты. Не пришёл — нажмите „Войти через Telegram“ или обратитесь к администратору вашей компании.', 'знакомое устройство: экран «Введите код из Telegram» с нейтральным текстом');
  ok(!(await page.locator('.screen:not(.leaving) [data-tg-open]').evaluate((e) => e.classList.contains('btn-primary'))), 'знакомое устройство: «Войти через Telegram» — запасная кнопка');
  await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 5000 });
  await settle(page, 450); // всплывающая подсказка «Код скопирован» гаснет не сразу
  if (isPhone) await shot(page, '02f-znakomoe-ustroystvo');
  await tap(page, '[data-tg-paste]');
  await page.waitForFunction(() => location.hash === '#/orgs', null, { timeout: 8000 });
  await settle(page, 700);
  ok((await screenKey(page)) === '#/orgs', 'код вставлен → вход выполнен');
  await tap(page, '[data-act="pick-org"][data-id="alfa"]');
  await settle(page, 600);
  await page.goto(BASE + '#/profile');
  await settle(page);
  await tap(page, '[data-act="logout"]');
  await settle(page);
  ok((await screenKey(page)) === '#/login', 'снова вышли из демо');

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
  await page.waitForSelector('.screen [data-act="tg-start"]');
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
