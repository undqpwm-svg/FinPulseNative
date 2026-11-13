// Экраны и действия. Данные — только через api.* (js/api/index.js): экран не знает, демо это или 1С.
// Каждый экран — async-функция: получает DTO (spec/api-client.md) и возвращает { key, html, … }.
import { api, isDemo, setMode, ApiError } from './api/index.js';
import { CONFIG } from './config.js';
import { uuid, storage } from './api/core.js';
import { I, logoMark } from './icons.js';
import { navigate, replace, openSheet, closeSheet, setSheet, sheetOpen, toast, success, nav } from './ui.js';
import { enablePush, pushState, shouldOfferPush, markPushOffered, demoNotification, disablePush, syncPush } from './push.js';
import {
  esc, cap, money, moneyShort, digits, mln, plural, iso, parseISO, diffDays,
  dayMonth, dayMonthShort, monthTitle, wdLong, wdShort, wdAcc, WD_HEAD, relDay, greeting, sum, NB,
} from './util.js';

export const views = {};
export const actions = {};

// Состояние экранов (не данные): режимы, выбранное, последний загруженный объект для действий.
export const ui = {
  calMode: 'week', reqTab: 'pending', ddsSel: null, leaving: null,
  tg: null, request: null, decision: null, busy: false, pushOffered: false, notifs: [],
};

const H = esc;
const REQ_FORMS = ['заявка', 'заявки', 'заявок'];
const DAY_FORMS = ['день', 'дня', 'дней'];

// ---------- кэш ответов на время работы с экраном (переключение дней и вкладок без повторных запросов) ----------
const cache = new Map();
async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}
export const invalidate = () => cache.clear();

// ---------- даты из DTO ----------
const D = (s) => parseISO(String(s).slice(0, 10));
const offset = (dateStr, todayStr) => diffDays(D(dateStr), D(todayStr));
function stampAt(isoDT, todayStr) {
  if (!isoDT) return '';
  const d = offset(isoDT, todayStr);
  const day = d === 0 ? 'сегодня' : d === -1 ? 'вчера' : dayMonth(D(isoDT));
  const t = String(isoDT).slice(11, 16);
  return t ? `${day}, ${t}` : day;
}

// ---------- общие куски ----------
const PALETTE = ['#C9D8FF', '#BDEBD4', '#FFD9CC', '#E7E2F5'];
const orgColor = (id) => PALETTE[[...String(id)].reduce((s, c) => s + c.charCodeAt(0), 0) % PALETTE.length];
const ava = (o, cls = '') => `<span class="ava ${cls}" style="--ava:${orgColor(o.id)}">${H(o.initials || (o.short || o.name || '?').slice(0, 2))}</span>`;
const personAva = (initials, cls = '') => `<span class="ava ava-person ${cls}">${H(initials || '')}</span>`;

function topbar(title, fallback, right = '') {
  return `<header class="topbar">
    <button class="tb-btn" data-back="${fallback}" aria-label="Назад">${I.chevL}</button>
    <div class="tb-title">${title}</div>
    <div class="tb-right">${right}</div>
  </header>`;
}

const bigMoney = (n, cls = '') => `<span class="big-money ${cls}"><span class="bm-num">${digits(n)}</span><span class="bm-cur">₸</span></span>`;

function segmented(items, current, act) {
  const idx = Math.max(0, items.findIndex((i) => i.v === current));
  return `<div class="seg" style="--n:${items.length};--i:${idx}" role="tablist">
    <span class="seg-thumb" aria-hidden="true"></span>
    ${items.map((i) => `<button class="seg-btn ${i.v === current ? 'on' : ''}" role="tab" aria-selected="${i.v === current}" ${act(i.v)}>${i.label}</button>`).join('')}
  </div>`;
}

const spinner = '<span class="spin" aria-hidden="true"></span>';

// Долг по возрасту (дни от даты документа продажи): 0–30 / 31–60 / больше 60. Это возраст, а не просрочка.
const AGE = [['days_0_30', '0–30 дней', 'a0'], ['days_31_60', '31–60 дней', 'a1'], ['days_over_60', '> 60 дней', 'a2']];
const ageBar = (aging, scale, cls = '') => `<span class="age-bar ${cls}">${AGE.map(([k, , c]) => ((aging && aging[k]) > 0 && scale > 0
  ? `<i class="${c}" style="width:${((aging[k] / scale) * 100).toFixed(2)}%"></i>` : '')).join('')}</span>`;
const ageLegend = (aging) => `<span class="age-legend">${AGE.map(([k, label, c]) => `<span><small><i class="sw sw-${c}"></i>${label}</small><b>${moneyShort((aging && aging[k]) || 0)}</b></span>`).join('')}</span>`;
const demoBadge = () => (isDemo() ? '<span class="demo-badge">Демо</span>' : '');

// ---------- ошибки: понятный текст вместо белого экрана ----------
export function errorText(e) {
  const code = e instanceof ApiError ? e.code : 'server_error';
  const map = {
    upstream_unavailable: ['1С сейчас недоступна', 'Данные приходят из 1С в момент запроса. Обычно это ненадолго — обновите через минуту.'],
    server_unavailable: ['Сервер ФинПульс недоступен', 'Обновите через минуту. Данные в 1С не пострадали.'],
    network: ['Нет связи', 'Проверьте интернет и обновите.'],
    timeout: ['Сервер долго не отвечает', '1С может быть занята расчётом. Обновите через минуту.'],
    forbidden: ['Нет доступа', 'У вашего пользователя нет прав на эти данные. Обратитесь к администратору 1С.'],
    not_found: ['Не найдено', 'Возможно, объект удалён или относится к другой организации.'],
    rate_limited: ['Слишком много запросов', 'Подождите минуту и обновите.'],
    not_supported: ['Пока недоступно', 'Эта функция появится после подключения к серверу.'],
    too_many_requests: ['Слишком много запросов', 'Подождите минуту и обновите.'],
    maintenance: ['Технические работы', 'Сервер на обслуживании. Повторите чуть позже.'],
    app_outdated: ['Обновите приложение', 'Версия устарела: обновите страницу или переустановите приложение с экрана «Домой».'],
    access_revoked: ['Доступ выключен', 'Обратитесь к администратору ФинПульса в своей компании.'],
  };
  const [title, text] = map[code] || ['Не удалось загрузить', 'Попробуйте обновить. Если не помогает — напишите в SmartSol.'];
  return { code, title, text };
}

const errorIcon = (code) => (code === 'network' || code === 'timeout' ? I.info : code === 'forbidden' ? I.shield : I.alert);

// Экран ошибки на месте экрана (с заголовком раздела и «Обновить»).
// 501 not_implemented — раздел следующего этапа: не ошибка, спокойная заглушка без «Обновить».
export const isLater = (e) => e instanceof ApiError && e.code === 'not_implemented';
const later = new Set(); // разделы, которые сервер пока не отдаёт (501): главная не ведёт в них

export function laterView(base = {}) {
  return {
    key: base.key || `later:${base.title || ''}`,
    tab: base.tab,
    depth: base.depth ?? 1,
    nav: !!base.tab,
    title: base.title,
    html: `${base.tab ? '' : topbar(H(base.title || ''), base.back || '#/home')}
      <div class="scroll ${base.tab ? '' : 'has-topbar'}">
        ${base.tab ? `<div class="page-head"><h1 class="page-title">${H(base.title || '')}</h1></div>` : ''}
        <div class="empty later-state" data-later>
          <span class="empty-ic">${I.clock}</span>
          <b>Раздел появится в следующей версии</b>
          <span>Сейчас в приложении — главная и согласование заявок.</span>
        </div>
      </div>`,
  };
}

export function errorView(e, base = {}) {
  if (isLater(e)) return laterView(base);
  const t = errorText(e);
  if (base.text) [t.title, t.text] = base.text; // свой текст для экрана (например, «Нет связи с учётом компании»)
  return {
    key: base.key || `error:${base.title || ''}`,
    tab: base.tab,
    depth: base.depth ?? 1,
    nav: !!base.tab,
    title: base.title,
    html: `${base.tab ? '' : topbar(H(base.title || ''), base.back || '#/home')}
      <div class="scroll ${base.tab ? '' : 'has-topbar'}">
        ${base.tab ? `<div class="page-head"><h1 class="page-title">${H(base.title || '')}</h1></div>` : ''}
        <div class="empty err-state" data-error="${t.code}" role="alert">
          <span class="empty-ic err">${errorIcon(t.code)}</span>
          <b>${t.title}</b>
          <span>${t.text}</span>
          <button class="btn btn-secondary" data-act="retry">${I.refresh}${base.retry || 'Обновить'}</button>
        </div>
      </div>`,
  };
}

actions.retry = () => {
  invalidate();
  nav.rerender();
};

// Сессия истекла или отозвана: стираем и — на вход.
export function onUnauthorized(e) {
  invalidate();
  ui.tg = null;
  nav.badge = null;
  // Доступ выключил администратор (403 access_revoked) — показать его текст на экране входа.
  if (e instanceof ApiError && e.code === 'access_revoked') {
    ui.loginNotice = e.message || 'Доступ к приложению выключен. Обратитесь к администратору ФинПульса в своей компании.';
    replace('#/login', 'fade');
    return;
  }
  replace('#/login', 'fade');
  setTimeout(() => toast('Сессия истекла — войдите снова', 'info'), 50);
}

const isSessionEnd = (e) => e instanceof ApiError && (e.code === 'unauthorized' || e.code === 'access_revoked');

// Общая обработка ошибок действий (не загрузки экрана).
function actionError(e) {
  if (isSessionEnd(e)) return onUnauthorized(e);
  if (isLater(e)) return toast('Раздел появится в следующей версии', 'info');
  const t = errorText(e);
  toast(`${t.title}. ${t.text}`, 'error');
}

// ======================================================================
// ВХОД
// ======================================================================
// Вход через Telegram-бота SmartSol (контракт, 2): бот присылает одноразовый код → пользователь вводит его здесь.
const TG_BLOCK_KEY = 'finpuls-tg-blocked'; // до какого времени вход закрыт (challenge_rejected, blocked); кода и токенов тут нет
const blockedLeft = () => Math.max(0, Math.ceil(((Number(storage.get(TG_BLOCK_KEY)) || 0) - Date.now()) / 1000));
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.max(0, sec) % 60).padStart(2, '0')}`;

function minutesText(sec) {
  const m = Math.max(1, Math.ceil(sec / 60));
  return `${m} ${plural(m, ['минуту', 'минуты', 'минут'])}`;
}

// Ошибка POST /auth/telegram/start — текст под кнопкой входа.
function loginErrorText(e) {
  const c = e instanceof ApiError ? e.code : '';
  if (c === 'too_many_requests' || c === 'rate_limited') return `Слишком много попыток входа с этого адреса. Повторите через ${minutesText(e.retryAfter || 600)}.`;
  if (c === 'access_revoked') return H(e.message) || 'Доступ к приложению выключен. Обратитесь к администратору ФинПульса в своей компании.';
  if (c === 'upstream_unavailable') return 'Нет связи с учётом компании. Повторите через минуту.';
  if (c === 'app_outdated') return 'Версия приложения устарела — обновите страницу.';
  if (c === 'maintenance') return 'Сервер на обслуживании. Повторите чуть позже.';
  if (c === 'network' || c === 'timeout' || c === 'server_unavailable') return 'Нет связи с сервером. Проверьте интернет и повторите.';
  return 'Не удалось начать вход. Повторите через минуту.';
}

const tgHint = () => (isDemo()
  ? 'Демо: бот SmartSol откроется прямо в приложении'
  : `Откроется бот SmartSol в${NB}Telegram. Пароль не${NB}нужен`);

views.login = async () => {
  const demo = isDemo();
  return {
    key: 'login', depth: 0, theme: 'dark', title: 'Вход',
    html: `<div class="scroll login">
      <div class="login-brand">${logoMark(44)}<span class="wordmark">ФинПульс</span>${demo ? '<span class="demo-badge on-dark">Демо</span>' : ''}
        <span class="login-switch">${demo
    ? `<button class="link-btn" data-act="mode-server">Настоящий вход ${I.arrowR}</button>`
    : `<button class="link-btn" data-act="mode-demo">Посмотреть демо ${I.arrowR}</button>`}</span>
      </div>
      <div class="login-visual" aria-hidden="true">
        <div class="float-card fc-1"><span class="fc-ic in">${I.arrowIn}</span><span><b>+850${NB}000${NB}₸</b><small>Поступила оплата</small></span></div>
        <div class="float-card fc-2"><span class="fc-ic warn">${I.alert}</span><span><b>Четверг: −1,2 млн</b><small>Кассовый разрыв</small></span></div>
        <div class="float-card fc-3"><span class="fc-ic ok">${I.check}</span><span><b>Заявка согласована</b><small>2 300 000 ₸</small></span></div>
        <svg class="login-pulse" viewBox="0 0 360 120" preserveAspectRatio="none"><path d="M0 70 H96 L120 30 L150 104 L176 52 L196 70 H360"/></svg>
      </div>
      <h1 class="login-title">Деньги компании —<br>в&nbsp;вашем телефоне</h1>
      <p class="login-sub">Остатки, платёжный календарь и&nbsp;согласование заявок из&nbsp;1С:Бухгалтерии</p>
      <div class="login-form">
        <div class="form-err" id="login-err" role="alert" hidden></div>
        <button class="btn btn-primary btn-block btn-tg" data-act="tg-start" data-submit>${I.tg}<span>Войти через Telegram</span></button>
        <p class="login-hint">${tgHint()}</p>
      </div>
      <div class="login-foot">SmartSol × FINTAX CONSULT</div>
    </div>`,
    mount(el) {
      ui.tg = null;
      const err = el.querySelector('#login-err');
      const btn = el.querySelector('[data-submit]');
      if (ui.loginNotice) {
        err.hidden = false;
        err.innerHTML = `${I.alert}<span>${H(ui.loginNotice)}</span>`;
        ui.loginNotice = null;
      }
      // Telegram-аккаунт заблокирован на 15 минут — кнопка с таймером.
      const drawBlock = () => {
        const left = blockedLeft();
        btn.disabled = left > 0;
        btn.querySelector('span').textContent = left > 0 ? `Вход снова через ${mmss(left)}` : 'Войти через Telegram';
        return left;
      };
      if (drawBlock() > 0) {
        const t = setInterval(() => {
          if (!el.isConnected || drawBlock() <= 0) clearInterval(t);
        }, 1000);
      }
    },
  };
};

// Начать вход: POST /auth/telegram/start → ссылка на бота и длина кода. Окно для Telegram открываем сразу по нажатию
// (иначе браузер сочтёт его всплывающим и заблокирует), адрес подставляем, когда придёт ответ.
actions['tg-start'] = async (b) => {
  if (b.classList.contains('loading') || blockedLeft() > 0) return;
  const demo = isDemo();
  const label = b.innerHTML;
  const err = document.querySelector('.screen:not(.leaving) #login-err, .screen:not(.leaving) #tg-err');
  let w = null;
  if (!demo) {
    try {
      w = window.open('', '_blank');
    } catch (e) {
      w = null;
    }
  }
  b.classList.add('loading');
  b.innerHTML = `${spinner}Начинаем вход…`;
  try {
    const r = await api.startLogin();
    if (w) {
      w.opener = null;
      w.location.href = r.botUrl;
    }
    ui.tg = { ...r, startedAt: Date.now(), opened: !!w };
    if (location.hash === '#/telegram') nav.rerender();
    else navigate('#/telegram');
  } catch (e) {
    if (w) w.close();
    b.classList.remove('loading');
    b.innerHTML = label;
    if (err) {
      err.hidden = false;
      err.innerHTML = `${I.alert}<span>${loginErrorText(e)}</span>`;
    } else toast(loginErrorText(e), 'error');
  }
};

actions['mode-demo'] = () => {
  setMode('demo');
  invalidate();
  ui.tg = null;
  nav.route();
};

actions['mode-server'] = () => {
  setMode('server');
  invalidate();
  ui.tg = null;
  nav.route();
};

// Экран после «Войти через Telegram». Сервер прислал code_length — ввод одноразового кода (контракт, 2);
// прислал match_code — прежний экран с числом (ВРЕМЕННО, переходный период — см. telegramMatch ниже).
views.telegram = async () => {
  const t = ui.tg;
  if (!t) return { redirect: '#/login' };
  return t.codeLength ? telegramCode(t) : telegramMatch(t);
};

// Общее для обоих экранов входа: «вход не удался» — текст и «Начать заново» (при блокировке — с таймером).
function tgRestart(el, acts, wait) {
  acts.innerHTML = '<button class="btn btn-primary btn-block" data-act="tg-start" data-restart><span>Начать заново</span></button>';
  if (!(wait > 0)) return;
  const btn = acts.querySelector('[data-restart]');
  const until = Date.now() + wait * 1000;
  const draw = () => {
    const s = Math.ceil((until - Date.now()) / 1000);
    btn.disabled = s > 0;
    btn.querySelector('span').textContent = s > 0 ? `Начать заново через ${mmss(s)}` : 'Начать заново';
    return s;
  };
  draw();
  const tt = setInterval(() => {
    if (!el.isConnected || draw() <= 0) clearInterval(tt);
  }, 1000);
}

// Вход выполнен (токены получены): дальше — выбор организации.
function tgSignedIn() {
  ui.tg = null;
  storage.remove(TG_BLOCK_KEY);
  closeSheet();
  invalidate();
  syncPush();
  setTimeout(() => navigate('#/orgs', 'push'), 450);
}

// Ввод кода: бот присылает код из code_length цифр, пользователь вводит его здесь.
// Опрос POST /auth/telegram/poll (раз в poll_interval) токенов не выдаёт — по нему видно, что код отправлен, срок вышел
// или вход отклонён. Токены — только из POST /auth/telegram/confirm. Сам код приложение не знает, не хранит и не пишет
// в журнал: он живёт в поле ввода и уходит в теле одного запроса.
function telegramCode(t) {
  const demo = !!t.demoBot;
  const n = t.codeLength;
  const open = demo
    ? `<button class="btn btn-ghost-dark btn-block" data-act="tg-demo-bot">${I.tg}Открыть Telegram ещё раз</button>`
    : `<a class="btn btn-ghost-dark btn-block" href="${H(t.botUrl)}" target="_blank" rel="noopener noreferrer" data-tg-open>${I.tg}${t.opened ? 'Открыть Telegram ещё раз' : 'Открыть Telegram'}</a>`;
  return {
    key: 'telegram', depth: 1, theme: 'dark', title: 'Вход через Telegram',
    html: `<header class="topbar topbar-dark"><button class="tb-btn" data-back="#/login" aria-label="Назад">${I.chevL}</button><div class="tb-title"></div><div class="tb-right"></div></header>
    <div class="scroll login tg-screen">
      <h1 class="login-title sm">Введите код из&nbsp;Telegram</h1>
      <p class="login-sub tg-sub">Код пришлёт бот в&nbsp;Telegram. При первом входе бот попросит «Поделиться номером».</p>
      <div class="tg-field" data-tg-field style="--n:${n}">
        <div class="tg-cells" aria-hidden="true">${'<i></i>'.repeat(n)}</div>
        <input class="tg-input" data-tg-input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="Код из Telegram, ${n} ${plural(n, ['цифра', 'цифры', 'цифр'])}">
      </div>
      <div class="tg-under"><button class="link-btn on-dark" type="button" data-tg-paste>Вставить код</button></div>
      <div class="form-err on-dark" id="tg-code-err" role="alert" hidden></div>
      <div class="tg-status" data-tg-status role="status">${spinner}<span data-tg-text>Ждём код от${NB}бота</span><b data-tg-left></b></div>
      <div class="form-err on-dark" id="tg-err" role="alert" hidden></div>
      <div class="tg-actions" data-tg-actions>
        <button class="btn btn-primary btn-block" type="button" data-tg-submit disabled>Войти</button>
        ${open}
      </div>
      <p class="tg-note" data-tg-note>Если номер подключён к${NB}ФинПульсу, код придёт в${NB}течение минуты. Не${NB}пришёл${NB}— начните вход заново или обратитесь к${NB}администратору вашей компании.</p>
      <p class="tg-warn">${I.shield}<span>Никому не называйте этот код. Он нужен только для входа на${NB}этом экране.</span></p>
    </div>`,
    mount(el) {
      const q = (s) => el.querySelector(s);
      const field = q('[data-tg-field]');
      const input = q('[data-tg-input]');
      const cells = [...el.querySelectorAll('.tg-cells i')];
      const submit = q('[data-tg-submit]');
      const paste = q('[data-tg-paste]');
      const status = q('[data-tg-status]');
      const text = q('[data-tg-text]');
      const leftEl = q('[data-tg-left]');
      const err = q('#tg-err');
      const codeErr = q('#tg-code-err');
      const acts = q('[data-tg-actions]');
      const every = t.pollInterval * 1000;
      let expiresAt = t.startedAt + t.expiresIn * 1000; // срок ссылки на бота; когда код придёт — срок кода
      let sent = false; // бот прислал код (опрос ответил code_sent)
      let timer = null;
      let inflight = false; // идёт опрос
      let confirming = false; // идёт проверка кода
      let done = false;
      let last = 0;
      let holdUntil = 0; // 429 на вводе кода: до этого времени код не отправляем
      const alive = () => el.isConnected && !done && ui.tg === t;

      // ---------- поле кода ----------
      const digitsOf = (s) => String(s == null ? '' : s).replace(/\D/g, '').slice(0, n);
      const paint = () => {
        const v = input.value;
        cells.forEach((c, i) => {
          c.textContent = v[i] || '';
          c.classList.toggle('on', i === Math.min(v.length, n - 1));
        });
        submit.disabled = done || confirming || v.length !== n || Date.now() < holdUntil;
      };
      const showCodeErr = (html, kind = '') => {
        codeErr.hidden = false;
        codeErr.dataset.kind = kind;
        codeErr.innerHTML = `${I.alert}<span>${html}</span>`;
      };
      const hideCodeErr = () => {
        codeErr.hidden = true;
        codeErr.dataset.kind = '';
      };
      const shake = () => {
        field.classList.add('err');
        field.classList.remove('shake');
        void field.offsetWidth;
        field.classList.add('shake');
      };
      // Принять введённое или вставленное: только цифры, не длиннее кода. Код набран целиком — отправляем сразу.
      const setCode = (raw) => {
        input.value = digitsOf(raw);
        field.classList.remove('err');
        paint();
        if (input.value.length === n) send();
      };
      input.addEventListener('input', () => setCode(input.value));
      input.addEventListener('paste', (e) => {
        const s = e.clipboardData ? e.clipboardData.getData('text') : null;
        if (s == null) return; // буфер недоступен — пусть вставит браузер, цифры отберём в input
        e.preventDefault();
        setCode(s); // «483 921», «483-921» и всё сообщение бота целиком тоже подойдут
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          send();
        }
      });
      input.addEventListener('focus', () => field.classList.add('focus'));
      input.addEventListener('blur', () => field.classList.remove('focus'));
      submit.addEventListener('click', () => send());
      // «Вставить код»: в Telegram код копируется нажатием, здесь — одно нажатие вместо долгого. Браузер может
      // спросить разрешение на чтение буфера; нет такой возможности — кнопки нет, вставка в поле работает как обычно.
      if (!demo && !(navigator.clipboard && navigator.clipboard.readText)) paste.hidden = true;
      paste.addEventListener('click', async () => {
        if (!alive() || confirming) return;
        let s = demo ? t.demoClip || '' : '';
        if (!s) {
          try {
            s = await navigator.clipboard.readText();
          } catch (e) {
            s = '';
          }
        }
        if (!alive() || confirming) return;
        if (digitsOf(s).length !== n) {
          showCodeErr(`В${NB}буфере нет кода. В${NB}Telegram нажмите на${NB}код в${NB}сообщении бота${NB}— он скопируется.`, 'paste');
          return;
        }
        hideCodeErr();
        setCode(s);
      });
      paint();

      // ---------- таймер и опрос ----------
      const drawLeft = () => {
        const s = Math.ceil((expiresAt - Date.now()) / 1000);
        leftEl.textContent = s > 0 ? mmss(s) : '';
        if (s <= 0 && !done) text.textContent = 'Время вышло — проверяем';
      };
      const tick = setInterval(() => (el.isConnected && !done ? drawLeft() : clearInterval(tick)), 1000);
      drawLeft();
      const schedule = (ms) => {
        clearTimeout(timer);
        timer = setTimeout(poll, Math.max(0, ms));
      };
      // Вернулись из Telegram — опросить сразу, но не чаще poll_interval.
      const soon = () => {
        if (alive() && !inflight && document.visibilityState !== 'hidden') schedule(last + every - Date.now());
      };
      const stop = () => {
        done = true;
        clearTimeout(timer);
        clearInterval(tick);
        document.removeEventListener('visibilitychange', soon);
        window.removeEventListener('focus', soon);
        window.removeEventListener('tg-poll', soon);
      };
      document.addEventListener('visibilitychange', soon);
      window.addEventListener('focus', soon);
      window.addEventListener('tg-poll', soon);

      // Вход не удался: текст и «Начать заново» (при блокировке — с таймером). Поле кода больше не нужно.
      const fail = (msg, { wait = 0, kind = '' } = {}) => {
        stop();
        field.classList.add('off');
        input.disabled = true;
        input.value = '';
        paint();
        paste.hidden = true;
        hideCodeErr();
        status.hidden = true;
        q('[data-tg-note]').hidden = true;
        err.hidden = false;
        err.dataset.kind = kind;
        err.innerHTML = `${I.alert}<span>${msg}</span>`;
        tgRestart(el, acts, wait);
      };
      const msg = (e, fallback) => H((e && e.message) || fallback);

      // Отказы, общие для опроса и ввода кода. true — вход закончен (или опрос перенесён), false — ошибку не узнали.
      function refused(e) {
        const c = e instanceof ApiError ? e.code : 'server_error';
        const d = (e && e.details) || {};
        if (c === 'challenge_rejected' && d.reason === 'blocked') {
          const sec = Number(d.retry_after) || e.retryAfter || 900;
          storage.set(TG_BLOCK_KEY, String(Date.now() + sec * 1000));
          fail(msg(e, 'Слишком много попыток входа. Вход через Telegram закрыт на 15 минут.'), { wait: sec, kind: 'blocked' });
        } else if (c === 'challenge_rejected') fail(msg(e, 'Код введён неверно несколько раз. Начните вход заново.'), { kind: 'wrong_code' });
        else if (c === 'access_revoked') fail(msg(e, 'Доступ к приложению выключен. Обратитесь к администратору ФинПульса в своей компании.'), { kind: 'access_revoked' });
        else if (c === 'challenge_expired') fail(sent ? 'Срок действия кода вышел. Начните вход заново — бот пришлёт новый код.' : 'Время входа вышло. Начните заново.', { kind: 'expired' });
        else if (c === 'not_found') fail('Вход не найден. Начните заново.', { kind: 'expired' });
        else if (c === 'upstream_unavailable') fail('Нет связи с учётом компании. Вход отменён — начните заново через минуту.', { wait: e.retryAfter || 60, kind: 'source' });
        else if (c === 'app_outdated') fail('Версия приложения устарела — обновите страницу.', { kind: 'outdated' });
        else if (c === 'maintenance') fail('Сервер на обслуживании. Повторите чуть позже.', { wait: e.retryAfter || 0, kind: 'maintenance' });
        else return false;
        return true;
      }

      function pollFailed(e) {
        const c = e instanceof ApiError ? e.code : 'server_error';
        if (refused(e)) return;
        if (c === 'too_many_requests') return schedule(Math.max(every, (e.retryAfter || 0) * 1000)); // опрашиваем реже
        if (c === 'network' || c === 'timeout' || c === 'server_unavailable') {
          text.textContent = 'Нет связи — пробуем снова';
          return schedule(Math.max(every, 4000));
        }
        return fail('Не получилось, попробуйте позже.', { kind: 'error' });
      }

      const waitText = () => (sent ? 'Срок действия кода' : `Ждём код от${NB}бота`);

      async function poll() {
        if (!alive() || inflight) return;
        if (confirming) return schedule(every); // код проверяется — ответ опроса сейчас ничего не решает
        inflight = true;
        last = Date.now();
        let r;
        let failed = null;
        try {
          r = await api.pollLogin(t.challengeId);
        } catch (e) {
          failed = e;
        }
        inflight = false;
        if (!alive()) return;
        // Пока шёл опрос, код ушёл на проверку: после удачного входа опрос ответил бы 410 — такой ответ не слушаем.
        if (confirming) return schedule(every);
        if (failed) return pollFailed(failed);
        if (r.status === 'ok') return signedIn(); // сервер прежней схемы выдал токены опросом — тоже вход
        if (r.status === 'code_sent') {
          sent = true;
          status.classList.add('sent');
          status.dataset.state = 'sent';
          if (r.expiresIn > 0) expiresAt = Date.now() + r.expiresIn * 1000;
          if (codeErr.dataset.kind === 'not_sent') hideCodeErr();
        }
        text.innerHTML = waitText();
        drawLeft();
        schedule(every);
      }

      // ---------- проверка кода ----------
      const idle = () => {
        confirming = false;
        input.readOnly = false;
        submit.classList.remove('loading');
        submit.textContent = 'Войти';
        paint();
      };

      function signedIn() {
        stop();
        field.classList.add('ok');
        input.readOnly = true;
        submit.disabled = true;
        paste.hidden = true;
        hideCodeErr();
        status.hidden = false;
        status.classList.add('ok');
        status.innerHTML = `${I.check}<span>Вход выполнен</span>`;
        tgSignedIn();
      }

      function confirmFailed(e) {
        const c = e instanceof ApiError ? e.code : 'server_error';
        const d = (e && e.details) || {};
        idle();
        if (refused(e)) return;
        if (c === 'code_invalid') {
          const leftN = Number(d.attemptsLeft != null ? d.attemptsLeft : d.attempts_left);
          input.value = '';
          paint();
          shake();
          showCodeErr(leftN > 0 ? `Неверный код. Осталось попыток: ${leftN}` : msg(e, 'Неверный код. Проверьте и введите ещё раз.'), 'code_invalid');
          input.focus();
        } else if (c === 'code_not_sent') {
          showCodeErr(`Бот ещё не прислал код. Откройте Telegram${NB}— бот пришлёт код.`, 'not_sent');
        } else if (c === 'validation_error') {
          shake();
          showCodeErr(`В${NB}коде должно быть ${n} ${plural(n, ['цифра', 'цифры', 'цифр'])}. Проверьте и введите ещё раз.`, 'validation');
        } else if (c === 'too_many_requests' || c === 'rate_limited') {
          const sec = e.retryAfter || 60;
          holdUntil = Date.now() + sec * 1000;
          paint();
          const draw = () => {
            const s = Math.ceil((holdUntil - Date.now()) / 1000);
            if (s > 0) showCodeErr(`Слишком много попыток. Повторите через ${mmss(s)}`, 'rate');
            else {
              if (codeErr.dataset.kind === 'rate') hideCodeErr();
              paint();
            }
            return s;
          };
          draw();
          const tt = setInterval(() => {
            if (!alive() || draw() <= 0) clearInterval(tt);
          }, 1000);
        } else if (c === 'network' || c === 'timeout' || c === 'server_unavailable') {
          showCodeErr('Нет связи с сервером. Проверьте интернет и нажмите «Войти» ещё раз.', 'network');
        } else {
          showCodeErr('Не получилось проверить код. Нажмите «Войти» ещё раз.', 'error');
        }
        if (alive()) schedule(every);
      }

      async function send() {
        const code = input.value;
        if (done || confirming || ui.tg !== t || code.length !== n || Date.now() < holdUntil) return;
        confirming = true;
        hideCodeErr();
        field.classList.remove('err');
        input.readOnly = true;
        submit.disabled = true;
        submit.classList.add('loading');
        submit.innerHTML = `${spinner}Проверяем код…`;
        let ok = false;
        let failed = null;
        try {
          ok = (await api.confirmLogin(t.challengeId, code)).status === 'ok';
        } catch (e) {
          failed = e;
        }
        if (done || ui.tg !== t) return; // начали другой вход или ушли со входа — этот ответ уже не нужен
        if (!el.isConnected) {
          // Пока код проверялся, пользователь ушёл с экрана. Вход всё равно состоялся — открываем приложение.
          confirming = false;
          if (ok) tgSignedIn();
          return;
        }
        if (failed) return confirmFailed(failed);
        confirming = false;
        if (ok) signedIn();
        else confirmFailed(new ApiError('server_error'));
      }

      schedule(every);
      if (demo && !t.botShown) {
        t.botShown = true;
        setTimeout(() => alive() && demoBotSheet(), 650);
      } else if (!demo) {
        // На компьютере курсор сразу в поле; на телефоне клавиатура без нажатия не откроется — и не нужно.
        setTimeout(() => alive() && !sheetOpen() && input.focus({ preventScroll: true }), 420);
      }
    },
  };
}

// ----------------------------------------------------------------------------------------------------------------
// ВРЕМЕННО, переходный период. Сервер прежней схемы отвечает на start числом match_code: его показываем крупно,
// пользователь выбирает его в боте, токены приходят из опроса. Нужен, пока на рабочем сервере не включён вход по
// коду, — чтобы приложение и сервер можно было выкладывать не одновременно. После выкладки сервера удалить:
// эту функцию, ветки «ВРЕМЕННО» в api/server.js (startLogin, pollLogin) и стиль .tg-code.
// ----------------------------------------------------------------------------------------------------------------
function telegramMatch(t) {
  const open = `<a class="btn ${t.opened ? 'btn-ghost-dark' : 'btn-primary'} btn-block" href="${H(t.botUrl)}" target="_blank" rel="noopener noreferrer" data-tg-open>${I.tg}${t.opened ? 'Открыть Telegram ещё раз' : 'Открыть Telegram'}</a>`;
  return {
    key: 'telegram', depth: 1, theme: 'dark', title: 'Вход через Telegram',
    html: `<header class="topbar topbar-dark"><button class="tb-btn" data-back="#/login" aria-label="Назад">${I.chevL}</button><div class="tb-title"></div><div class="tb-right"></div></header>
    <div class="scroll login tg-screen">
      <h1 class="login-title sm">Выберите в&nbsp;Telegram число</h1>
      <div class="tg-code" data-tg-code aria-label="Число для входа ${H(t.matchCode)}">${H(t.matchCode)}</div>
      <p class="login-sub tg-sub">Бот SmartSol покажет три числа — нажмите это. При первом входе бот попросит «Поделиться номером».</p>
      <div class="tg-status" data-tg-status role="status">${spinner}<span data-tg-text>Ждём подтверждения в&nbsp;Telegram</span><b data-tg-left></b></div>
      <div class="form-err on-dark" id="tg-err" role="alert" hidden></div>
      <div class="tg-actions" data-tg-actions>${open}</div>
      <p class="tg-warn">${I.shield}<span>Никому не называйте это число. Если вход начали не${NB}вы — ничего не${NB}нажимайте в${NB}боте.</span></p>
    </div>`,
    mount(el) {
      const status = el.querySelector('[data-tg-status]');
      const text = el.querySelector('[data-tg-text]');
      const leftEl = el.querySelector('[data-tg-left]');
      const err = el.querySelector('#tg-err');
      const acts = el.querySelector('[data-tg-actions]');
      const expiresAt = t.startedAt + t.expiresIn * 1000;
      const every = t.pollInterval * 1000;
      let timer = null;
      let inflight = false;
      let done = false;
      let last = 0;
      const alive = () => el.isConnected && !done && ui.tg === t;
      const drawLeft = () => {
        const s = Math.ceil((expiresAt - Date.now()) / 1000);
        leftEl.textContent = s > 0 ? mmss(s) : '';
        if (s <= 0 && !done) text.textContent = 'Время вышло — проверяем';
      };
      const tick = setInterval(() => (el.isConnected && !done ? drawLeft() : clearInterval(tick)), 1000);
      drawLeft();
      const schedule = (ms) => {
        clearTimeout(timer);
        timer = setTimeout(poll, Math.max(0, ms));
      };
      // Вернулись из Telegram — опросить сразу, но не чаще poll_interval.
      const soon = () => {
        if (alive() && !inflight && document.visibilityState !== 'hidden') schedule(last + every - Date.now());
      };
      const stop = () => {
        done = true;
        clearTimeout(timer);
        clearInterval(tick);
        document.removeEventListener('visibilitychange', soon);
        window.removeEventListener('focus', soon);
      };
      document.addEventListener('visibilitychange', soon);
      window.addEventListener('focus', soon);

      const fail = (msg, { wait = 0, kind = '' } = {}) => {
        stop();
        el.querySelector('[data-tg-code]').classList.add('off');
        status.hidden = true;
        err.hidden = false;
        err.dataset.kind = kind;
        err.innerHTML = `${I.alert}<span>${msg}</span>`;
        tgRestart(el, acts, wait);
      };
      const msg = (e, fallback) => H((e && e.message) || fallback);

      function handle(e) {
        const c = e instanceof ApiError ? e.code : 'server_error';
        const d = (e && e.details) || {};
        if (c === 'challenge_rejected' && d.reason === 'blocked') {
          const sec = Number(d.retry_after) || e.retryAfter || 900;
          storage.set(TG_BLOCK_KEY, String(Date.now() + sec * 1000));
          return fail(msg(e, 'Вход через Telegram заблокирован на 15 минут.'), { wait: sec, kind: 'blocked' });
        }
        if (c === 'challenge_rejected') return fail(msg(e, 'В Telegram выбрано другое число. Начните вход заново.'), { kind: 'wrong_number' });
        if (c === 'access_revoked') return fail(msg(e, 'Этот номер не подключён к ФинПульсу. Обратитесь к администратору компании.'), { kind: 'access_revoked' });
        if (c === 'challenge_expired') return fail('Время входа истекло. Начните заново — появится новое число.', { kind: 'expired' });
        if (c === 'not_found') return fail('Вход не найден. Начните заново.', { kind: 'expired' });
        if (c === 'upstream_unavailable') return fail('Нет связи с учётом компании. Вход отменён — начните заново через минуту.', { wait: e.retryAfter || 60, kind: 'source' });
        if (c === 'app_outdated') return fail('Версия приложения устарела — обновите страницу.', { kind: 'outdated' });
        if (c === 'maintenance') return fail('Сервер на обслуживании. Повторите чуть позже.', { wait: e.retryAfter || 0, kind: 'maintenance' });
        if (c === 'too_many_requests') return schedule(Math.max(every, (e.retryAfter || 0) * 1000)); // опрашиваем реже
        if (c === 'network' || c === 'timeout' || c === 'server_unavailable') {
          text.textContent = 'Нет связи — пробуем снова';
          return schedule(Math.max(every, 4000));
        }
        return fail('Не получилось, попробуйте позже.', { kind: 'error' });
      }

      async function poll() {
        if (!alive() || inflight) return;
        inflight = true;
        last = Date.now();
        let r;
        try {
          r = await api.pollLogin(t.challengeId);
        } catch (e) {
          inflight = false;
          if (alive()) handle(e);
          return;
        }
        inflight = false;
        if (!alive()) return;
        if (r.status === 'ok') {
          stop();
          el.querySelector('[data-tg-code]').classList.add('ok');
          status.classList.add('ok');
          status.innerHTML = `${I.check}<span>Вход подтверждён</span>`;
          tgSignedIn();
          return;
        }
        text.innerHTML = `Ждём подтверждения в${NB}Telegram`;
        schedule(every);
      }

      schedule(every);
    },
  };
}

// Демо: «бот SmartSol» в шторке — то же, что пользователь увидит в Telegram. Тексты — как у настоящего бота.
const tgBotHead = `<div class="tgbot-head"><span class="tgbot-ava">${I.tg}</span><div><b>SmartSol</b><small>бот · демо</small></div></div>`;
const TG_ASK = 'Вход в ФинПульс. Нажмите «Поделиться номером» — проверим, что ваш номер подключён к ФинПульсу.';

// Сообщение с кодом: «Код для входа в ФинПульс: 483921», код моноширинный и копируется нажатием.
function tgBotCode(s) {
  const min = `${s.minutes} ${plural(s.minutes, ['минуту', 'минуты', 'минут'])}`;
  return `<div class="tgbot-msg" data-tgbot-code>Код для входа в ФинПульс: <button class="tgbot-code" type="button" data-act="tg-demo-copy" data-v="${H(s.code)}" aria-label="Скопировать код ${H(s.code)}">${H(s.code)}</button><br>
    Действует ${min}. Вводите только на ${H(s.site)}. Никому не называйте этот код. Если вход начали не вы — просто проигнорируйте сообщение.</div>`;
}

function tgBotBody(s, before = '') {
  if (s.step === 'contact') {
    return `<div class="tgbot-msg">${TG_ASK}</div>
      <div class="tgbot-btns one"><button class="tgbot-btn" data-act="tg-demo-share">Поделиться номером</button></div>`;
  }
  if (s.step === 'blocked') return `<div class="tgbot-msg">Слишком много попыток. Попробуйте через ${s.minutes} мин.</div>`;
  return `${before}${tgBotCode(s)}${s.step === 'again' ? '<div class="tgbot-msg">Код уже отправлен — он выше в этом чате. Если не нашли, начните вход в приложении заново.</div>' : ''}`;
}

const tgBotSheet = (s, before = '') => `<div class="tgbot">${tgBotHead}${tgBotBody(s, before)}</div>
    <p class="sheet-note">${I.info}${s.step === 'contact' ? 'Демо: так выглядит бот в Telegram' : s.step === 'blocked' ? 'Демо: блокировка снимется сама' : 'Демо: нажмите на код — он скопируется'}</p>
    <button class="btn btn-text btn-block" data-act="sheet-close">Вернуться в приложение</button>`;

function demoBotSheet() {
  const s = api.demoBotOpen();
  if (s.step === 'none') return;
  openSheet(tgBotSheet(s));
  if (s.code) window.dispatchEvent(new Event('tg-poll'));
}

actions['tg-demo-bot'] = () => demoBotSheet();

// «Поделиться номером» (только при первом входе): контакт уходит боту, бот присылает код.
actions['tg-demo-share'] = () => {
  const s = api.demoBotShare();
  if (s.step === 'none') return closeSheet();
  setSheet(tgBotSheet(s, `<div class="tgbot-msg">${TG_ASK}</div>
    <div class="tgbot-msg mine">${I.user}Мой номер${s.phone ? `<small>${H(s.phone)}</small>` : ''}</div>
    <div class="tgbot-msg">Номер получен, проверяю доступ…</div>`));
  window.dispatchEvent(new Event('tg-poll'));
};

// Нажатие на код в сообщении бота: код в буфере (как в Telegram) — и назад в приложение, к полю ввода.
actions['tg-demo-copy'] = (b) => {
  const code = b.dataset.v;
  if (ui.tg) ui.tg.demoClip = code; // для кнопки «Вставить код», если браузер не дал доступ к буферу
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).catch(() => {});
  } catch (e) {
    /* буфер недоступен — код вставится из памяти демо */
  }
  b.classList.add('copied');
  toast('Код скопирован');
  setTimeout(() => {
    closeSheet();
    window.dispatchEvent(new Event('tg-poll'));
  }, 700);
};

// ======================================================================
// ССЫЛКА ИЗ PUSH ДО ВХОДА: после входа открыть заявку, а не главную
// ======================================================================
const LINK_KEY = 'finpuls-after-login';

export function rememberLink(hash) {
  storage.setJSON(LINK_KEY, { hash, at: Date.now() });
}

function pendingLink() {
  const v = storage.getJSON(LINK_KEY);
  if (!v || !v.hash || Date.now() - v.at > 30 * 60e3) return null; // ссылка из push живёт полчаса
  return v.hash;
}

const takeLink = () => storage.remove(LINK_KEY);
const linkOrg = (hash) => new URLSearchParams(String(hash).split('?')[1] || '').get('org');

// ======================================================================
// ВЫБОР ОРГАНИЗАЦИИ
// ======================================================================
views.orgs = async () => {
  const inApp = !!api.orgId();
  let data;
  try {
    data = await api.orgs();
  } catch (e) {
    // 503 source_unavailable — не ответила ни одна компания пользователя (4.2)
    if (e instanceof ApiError && e.code === 'upstream_unavailable') {
      return errorView(e, {
        key: 'error:orgs', title: 'Организации', back: inApp ? '#/home' : '#/login', depth: 2, retry: 'Повторить',
        text: ['Нет связи с учётом компании', 'Базы 1С сейчас не отвечают. Обычно это ненадолго — повторите через минуту.'],
      });
    }
    throw e;
  }
  const items = data.items || [];
  const partial = !!data.partial;
  // Вход из push: организация известна из ссылки (или она одна) — сразу в заявку.
  const link = !inApp && pendingLink();
  if (link) {
    const lo = linkOrg(link);
    const target = lo ? items.find((o) => o.id === lo) : items.length === 1 ? items[0] : null;
    if (target) {
      api.setOrgId(target.id);
      takeLink();
      return { redirect: link };
    }
  }
  // У пользователя одна организация (настоящий вход) — выбирать нечего.
  if (!inApp && items.length === 1 && !partial && !isDemo()) {
    api.setOrgId(items[0].id);
    return { redirect: '#/home' };
  }
  const cards = items.map((o) => {
    const s = o.summary || {};
    const active = inApp && o.id === api.orgId();
    return `<button class="org-card ${active ? 'active' : ''}" data-act="pick-org" data-id="${H(o.id)}">
      <div class="oc-head">
        ${ava(o, 'ava-lg')}
        <div class="oc-name"><b>${H(o.name)}</b><span>${H([o.city, o.activity].filter(Boolean).join(' · '))}</span></div>
        <span class="oc-go">${active ? I.check : I.chevR}</span>
      </div>
      <div class="oc-stats">
        <div><span>Деньги</span><b>${s.money == null ? '—' : moneyShort(s.money)}</b></div>
        <div><span>Заявки</span><b>${s.pending ?? '—'}</b></div>
        <div><span>Разрыв</span>${s.gap ? `<b class="neg">${wdAcc(D(s.gap.date)).replace(/^во? /, '')}</b>` : s.money == null ? '<b>—</b>' : '<b class="pos">нет</b>'}</div>
      </div>
    </button>`;
  }).join('');
  return {
    key: 'orgs', depth: 2, title: 'Организации',
    html: `${inApp ? topbar('', '#/home') : ''}
    <div class="scroll ${inApp ? 'has-topbar' : ''}">
      ${inApp ? '' : `<div class="orgs-brand">${logoMark(36)}<span class="wordmark dark">ФинПульс</span>${demoBadge()}</div>`}
      <h1 class="page-title">${inApp ? 'Организации' : 'Выберите организацию'}</h1>
      <p class="page-sub">Данные по каждой компании приходят из её базы 1С. Переключиться можно в любой момент.</p>
      ${partial ? `<div class="partial-note" role="status">${I.info}<span><b>Часть организаций недоступна</b>Учёт некоторых компаний сейчас не отвечает. Список обновится при следующем открытии.</span><button class="link-btn" data-act="retry">Обновить</button></div>` : ''}
      <div class="org-list">${cards || (partial ? '' : `<div class="empty"><span class="empty-ic">${I.building}</span><b>Нет доступных организаций</b><span>Обратитесь к администратору ФинПульса в своей компании.</span></div>`)}</div>
    </div>`,
  };
};

actions['pick-org'] = (t) => {
  const prev = api.orgId();
  api.setOrgId(t.dataset.id);
  invalidate();
  nav.badge = null;
  if (prev && prev !== t.dataset.id) toast('Организация переключена');
  const link = pendingLink();
  takeLink();
  const lo = link && linkOrg(link);
  navigate(link && (!lo || lo === t.dataset.id) ? link : '#/home', 'fade');
};

// ======================================================================
// ГЛАВНАЯ
// ======================================================================
function spark(start, points) {
  const vals = [start, ...points.map((d) => d.end)];
  const W = 300;
  const Hh = 64;
  const pad = 6;
  const max = Math.max(...vals);
  const min = Math.min(...vals, 0);
  const x = (i) => (i * W) / (vals.length - 1);
  const y = (v) => pad + ((max - v) / (max - min || 1)) * (Hh - 2 * pad);
  const line = `M${vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('L')}`;
  const zy = y(0).toFixed(1);
  const uid = Math.random().toString(36).slice(2, 7);
  const minI = vals.indexOf(Math.min(...vals));
  return `<svg class="spark" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <clipPath id="sp-p-${uid}"><rect x="0" y="0" width="${W}" height="${zy}"/></clipPath>
      <clipPath id="sp-n-${uid}"><rect x="0" y="${zy}" width="${W}" height="${Hh}"/></clipPath>
      <linearGradient id="sp-g-${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9D8FF" stop-opacity=".32"/><stop offset="1" stop-color="#C9D8FF" stop-opacity="0"/></linearGradient>
      <linearGradient id="sp-r-${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF5B2E" stop-opacity=".45"/><stop offset="1" stop-color="#FF5B2E" stop-opacity="0"/></linearGradient>
    </defs>
    <path d="${line}L${W},${Hh}L0,${Hh}Z" fill="url(#sp-g-${uid})" clip-path="url(#sp-p-${uid})"/>
    ${min < 0 ? `<path d="${line}L${W},${zy}L0,${zy}Z" fill="url(#sp-r-${uid})" clip-path="url(#sp-n-${uid})"/><line class="sp-zero" x1="0" x2="${W}" y1="${zy}" y2="${zy}"/>` : ''}
    <path class="sp-line" d="${line}" clip-path="url(#sp-p-${uid})"/>
    <path class="sp-line neg" d="${line}" clip-path="url(#sp-n-${uid})"/>
    ${vals[minI] < 0 ? `<circle class="sp-dot" cx="${x(minI).toFixed(1)}" cy="${y(vals[minI]).toFixed(1)}" r="3.2"/>` : ''}
  </svg>`;
}

views.home = async () => {
  const d = await api.home(api.orgId());
  const today = D(d.today);
  // Календарь или отчёт ещё не подключены (501) — блоки главной из сводки остаются, но никуда не ведут.
  const calOn = !later.has('calendar');
  const go = (hash, on = calOn) => (on ? `data-go="${hash}"` : '');
  const u = d.user || (api.session() && api.session().user) || {};
  nav.badge = d.approvals.count;

  let alert;
  if (d.gap) {
    const gd = D(d.gap.date);
    const off = offset(d.gap.date, d.today);
    const when = off === 0 ? 'Сегодня' : cap(wdAcc(gd));
    const what = (d.gap.articles || []).map((a) => a.toLowerCase()).join(' и ');
    alert = `<${calOn ? 'button' : 'div'} class="alert-card" ${go(`#/calendar/${d.gap.date}`)}>
      <span class="alert-ic">${I.alert}</span>
      <span class="alert-body">
        <b>${when} не хватит ${moneyShort(d.gap.deficit)}</b>
        <span>${cap(relDay(off))}, ${dayMonth(gd)}${what ? `: ${H(what)} на ${moneyShort(d.gap.outflow)}` : ''}</span>
        ${calOn ? `<span class="alert-cta">Открыть календарь ${I.arrowR}</span>` : ''}
      </span>
    </${calOn ? 'button' : 'div'}>`;
  } else {
    const m = d.minBalance;
    alert = `<${calOn ? 'button' : 'div'} class="calm-card" ${go(`#/calendar${m ? `/${m.date}` : ''}`)}>
      <span class="calm-ic">${I.shield}</span>
      <span class="alert-body">
        <b>Разрывов нет на ${Math.round((d.horizonDays || 28) / 7)} недели</b>
        ${m ? `<span>Минимальный остаток — ${moneyShort(m.amount)}, ${dayMonth(D(m.date))}</span>` : ''}
      </span>
      ${calOn ? I.chevR : ''}
    </${calOn ? 'button' : 'div'}>`;
  }

  const a = d.approvals;
  const appr = a.count
    ? `<button class="appr-card" data-go="#/requests">
        <span class="appr-count">${a.count}</span>
        <span class="appr-body"><b>На согласовании: ${a.count}</b>
        <span>${a.count} ${plural(a.count, REQ_FORMS)} на ${moneyShort(a.sum)}${a.overLimit ? ` · ${a.overLimit} сверх лимита` : ''}</span></span>
        <span class="appr-go">${I.chevR}</span>
      </button>`
    : `<button class="appr-card is-empty" data-go="#/requests">
        <span class="appr-count ok">${I.check}</span>
        <span class="appr-body"><b>Всё согласовано</b><span>Новых заявок пока нет</span></span>
        <span class="appr-go">${I.chevR}</span>
      </button>`;

  const week = d.week || [];
  const wIn = sum(week, (x) => x.in);
  const wOut = sum(week, (x) => x.out);
  const maxBar = Math.max(...week.map((x) => Math.max(x.in, x.out)), 1);
  const thr = d.threshold || 0;
  const bars = week.map((x) => {
    const dt = D(x.date);
    const tag = calOn ? 'button' : 'div';
    return `<${tag} class="wk-col ${x.end < thr ? 'neg' : ''}" ${go(`#/calendar/${x.date}`)} aria-label="${wdLong(dt)}, ${dayMonth(dt)}">
      <span class="wk-bars">
        <i class="b-in" style="height:${Math.max(x.in ? 6 : 0, (x.in / maxBar) * 100)}%"></i>
        <i class="b-out" style="height:${Math.max(x.out ? 6 : 0, (x.out / maxBar) * 100)}%"></i>
      </span>
      <span class="wk-d">${offset(x.date, d.today) === 0 ? 'Сег' : wdShort(dt)}</span>
    </${tag}>`;
  }).join('');

  const rec = d.receivables;
  const fc = d.forecast;

  return {
    key: 'home', tab: 'home', depth: 1, nav: true, title: 'Главная',
    html: `<div class="scroll">
      <div class="home-top">
        <button class="org-pill" data-go="#/orgs">${ava(d.org)}<span class="org-pill-name">${H(d.org.short || d.org.name)}</span>${I.chevD}</button>
        <div class="home-top-r">${demoBadge()}
          <button class="icon-btn" data-go="#/notifications" aria-label="Уведомления${d.unread ? `, новых: ${d.unread}` : ''}">${I.bell}${d.unread ? `<span class="icon-badge">${d.unread}</span>` : ''}</button>
        </div>
      </div>
      <div class="greet">
        <h1>${greeting()}${u.firstName ? `, ${H(u.firstName)}` : ''}</h1>
        <p>${cap(wdLong(today))}, ${dayMonth(today)}</p>
      </div>

      <button class="hero" data-act="accounts">
        <span class="hero-row"><span class="hero-label">Деньги на сегодня</span><span class="hero-more">Счета ${I.chevR}</span></span>
        ${bigMoney(d.money.total, 'on-dark')}
        <span class="hero-split">
          <span><i class="dot" style="background:var(--lav)"></i><small>Банк</small><b>${money(d.money.bank)}</b></span>
          <span><i class="dot" style="background:var(--mint)"></i><small>Касса</small><b>${money(d.money.cash)}</b></span>
        </span>
        ${fc && fc.days && fc.days.length > 1 ? `<span class="hero-spark">
          ${spark(fc.start, fc.days)}
          <span class="spark-cap"><span>Прогноз остатка на 2 недели</span><span>до ${dayMonthShort(D(fc.days[fc.days.length - 1].date))}</span></span>
        </span>` : ''}
      </button>

      ${alert}
      ${appr}

      <section class="card">
        <div class="card-head"><h2>Ближайшие 7 дней</h2>${calOn ? `<button class="link-btn" data-go="#/calendar">Календарь ${I.chevR}</button>` : ''}</div>
        <div class="kpi-row">
          <div class="kpi"><span class="kpi-label"><i class="sw sw-in"></i>Поступления</span><b class="pos">${moneyShort(wIn, { sign: true })}</b></div>
          <div class="kpi"><span class="kpi-label"><i class="sw sw-out"></i>Платежи</span><b>${moneyShort(-wOut)}</b></div>
        </div>
        <div class="wk-chart">${bars}</div>
      </section>

      <${later.has('debtors') ? 'div' : 'button'} class="card rec-card" ${go('#/reports/debtors', !later.has('debtors'))}>
        <span class="card-head"><h2>Нам должны</h2>${later.has('debtors') ? '' : `<span class="link-btn">Должники ${I.chevR}</span>`}</span>
        <span class="rec-sum">${moneyShort(rec.total)}</span>
        <span class="age-title">Долг по возрасту</span>
        ${ageBar(rec.aging, rec.total)}
        ${ageLegend(rec.aging)}
        ${rec.oldest ? `<span class="rec-worst">${I.clock}<span>Самый старый долг: ${H(rec.oldest.name)} — ${rec.oldest.days} ${plural(rec.oldest.days, DAY_FORMS)}</span></span>` : ''}
      </${later.has('debtors') ? 'div' : 'button'}>

      <p class="foot-note">${I.refresh}<span>Данные 1С на ${d.asOf ? stampAt(d.asOf, d.today) : 'сейчас'}</span></p>
    </div>`,
    mount() {
      // После входа — один раз предложить уведомления о новых заявках.
      if (!ui.pushOffered && shouldOfferPush()) {
        ui.pushOffered = true;
        setTimeout(() => {
          if (location.hash.startsWith('#/home') && !sheetOpen()) offerPush();
        }, 1200);
      }
    },
  };
};

function offerPush() {
  markPushOffered();
  openSheet(`<div class="push-offer">
      <span class="push-ic">${I.bell}</span>
      <div class="sheet-title">Уведомления о новых заявках</div>
      <p class="sheet-sub">Сразу узнаете, когда заявка ждёт вашего решения. Нажмёте на уведомление — откроется заявка.</p>
    </div>
    <div class="sheet-actions">
      <button class="btn btn-primary btn-block" data-act="push-enable">Включить</button>
      <button class="btn btn-text btn-block" data-act="sheet-close">Не сейчас</button>
    </div>`);
}

actions['push-enable'] = async () => {
  const r = await enablePush();
  await closeSheet();
  if (r.ok && r.demo) {
    toast('Уведомления включены. Пример придёт через 3 секунды');
    setTimeout(() => demoNotification('r101', `2${NB}300${NB}000${NB}₸`), 3000);
  } else if (r.ok) toast('Уведомления включены');
  else if (r.reason === 'needs-install') toast('Сначала добавьте приложение на экран «Домой»', 'info');
  else if (r.reason === 'denied') toast('Уведомления запрещены — включите в настройках телефона', 'info');
  else if (r.reason === 'no-key') toast('Уведомления заработают после подключения сервера', 'info');
  else toast('Не удалось включить уведомления', 'error');
  if (location.hash.startsWith('#/profile')) nav.rerender();
};

actions.accounts = async () => {
  try {
    const d = await api.accounts(api.orgId());
    openSheet(`<div class="sheet-title">Деньги на сегодня</div>
      <div class="sheet-sub">${H(d.orgName || '')}</div>
      <div class="acc-list">
        ${d.items.map((a) => `<div class="acc-row">
          <span class="acc-ic ${a.type === 'cash' ? 'cash' : 'bank'}">${a.type === 'cash' ? I.cash : I.bank}</span>
          <span class="acc-name"><b>${H(a.name)}</b><small>${H(a.note || '')}</small></span>
          <b class="acc-sum">${money(a.amount)}</b>
        </div>`).join('')}
      </div>
      <div class="acc-total"><span>Итого</span><b>${money(d.total)}</b></div>
      <button class="btn btn-secondary btn-block" data-act="sheet-close">Понятно</button>`);
  } catch (e) {
    actionError(e);
  }
};

// ======================================================================
// ПЛАТЁЖНЫЙ КАЛЕНДАРЬ
// ======================================================================
function flowRow(f) {
  const isIn = f.dir === 'in';
  return `<div class="flow">
    <span class="flow-ic ${isIn ? 'in' : 'out'}">${isIn ? I.arrowIn : I.arrowOut}</span>
    <span class="flow-main"><b>${H(f.who)}</b><small>${H(f.article)}${f.note ? ` · ${H(f.note)}` : ''}</small>
      ${f.requestId ? '<span class="tag tag-lav">по заявке</span>' : ''}</span>
    <span class="flow-sum ${isIn ? 'pos' : ''}">${money(isIn ? f.amount : -f.amount, { sign: true })}</span>
  </div>`;
}

function dayDetail(day, days, idx, cal) {
  const thr = cal.threshold || 0;
  const neg = day.end < thr;
  const ins = day.items.filter((f) => f.dir === 'in').sort((a, b) => b.amount - a.amount);
  const outs = day.items.filter((f) => f.dir !== 'in').sort((a, b) => b.amount - a.amount);
  const dt = D(day.date);
  let hint = '';
  if (neg) {
    const next = days.slice(idx + 1).find((x) => x.in > 0);
    hint = `<div class="gap-hint">
      <span class="gap-hint-ic">${I.alert}</span>
      <div><b>Не хватает ${money(thr - day.end)}</b>
      <span>${next ? `${cap(wdAcc(D(next.date)))} ждём ${moneyShort(next.in)} от покупателей — часть платежей можно перенести на этот день.` : 'Перенесите часть платежей или ускорьте поступления.'}</span></div>
    </div>`;
  }
  return `<section class="card day-card ${neg ? 'is-neg' : ''}">
    <div class="day-head">
      <div><h2>${cap(wdLong(dt))}, ${dayMonth(dt)}</h2>
      <span class="muted">${cap(relDay(offset(day.date, cal.today)))}</span></div>
    </div>
    <div class="bal-line"><span>Остаток на начало дня</span><b>${money(day.start)}</b></div>
    ${!ins.length && !outs.length ? `<div class="empty-mini">${I.calendar}<span>Платежей и поступлений нет</span></div>` : ''}
    ${ins.length ? `<div class="flow-group"><div class="fg-head"><span>Поступления</span><b class="pos">${money(day.in, { sign: true })}</b></div>${ins.map(flowRow).join('')}</div>` : ''}
    ${outs.length ? `<div class="flow-group"><div class="fg-head"><span>Платежи</span><b>${money(-day.out)}</b></div>${outs.map(flowRow).join('')}</div>` : ''}
    <div class="bal-line bal-end ${neg ? 'neg' : ''}"><span>Остаток на конец дня</span><b>${money(day.end)}</b></div>
    ${hint}
  </section>`;
}

function firstGap(cal) {
  const thr = cal.threshold || 0;
  const i = cal.days.findIndex((x) => x.end < thr);
  if (i < 0) return null;
  let min = cal.days[i].end;
  for (let j = i + 1; j < cal.days.length && cal.days[j].end < thr; j++) min = Math.min(min, cal.days[j].end);
  return { day: cal.days[i], deficit: thr - min };
}

views.calendar = async (params) => {
  const org = api.orgId();
  let cal;
  try {
    cal = await cached(`cal:${org}`, 60e3, () => api.calendar(org));
  } catch (e) {
    if (isLater(e)) later.add('calendar');
    throw e;
  }
  later.delete('calendar');
  const ds = cal.days || [];
  if (!ds.length) {
    return {
      key: 'calendar', tab: 'calendar', depth: 1, nav: true, title: 'Календарь',
      html: `<div class="scroll"><div class="page-head"><h1 class="page-title">Календарь</h1></div><div class="empty"><span class="empty-ic">${I.calendar}</span><b>Нет плановых платежей</b></div></div>`,
    };
  }
  const Hn = ds.length;
  const thr = cal.threshold || 0;
  let sel = 0;
  if (params[0] && /^\d{4}-\d{2}-\d{2}$/.test(params[0])) sel = offset(params[0], ds[0].date);
  if (!(sel >= 0 && sel < Hn)) sel = 0;
  const day = ds[sel];
  const g = firstGap(cal);
  const today = D(cal.today);

  let picker;
  if (ui.calMode === 'week') {
    const page = Math.floor(sel / 7);
    const pages = Math.ceil(Hn / 7);
    const from = D(ds[page * 7].date);
    const to = D(ds[Math.min(page * 7 + 6, Hn - 1)].date);
    const rows = ds.slice(page * 7, page * 7 + 7).map((x, k) => {
      const i = page * 7 + k;
      const neg = x.end < thr;
      const dt = D(x.date);
      return `<button class="wk-row ${i === sel ? 'on' : ''} ${neg ? 'neg' : ''}" data-go="#/calendar/${x.date}" data-dir="same">
        <span class="wr-date"><b>${dt.getDate()}</b><small>${offset(x.date, cal.today) === 0 ? 'сег' : wdShort(dt).toLowerCase()}</small></span>
        <span class="wr-flows">${x.in ? `<span class="pos">${moneyShort(x.in, { sign: true })}</span>` : ''}${x.out ? `<span>${moneyShort(-x.out)}</span>` : ''}${!x.in && !x.out ? '<span class="muted">нет движений</span>' : ''}</span>
        <span class="wr-bal"><b class="${x.start < thr ? 'neg' : ''}">${moneyShort(x.start)}</b>${neg ? `<small class="neg">к вечеру ${moneyShort(x.end)}</small>` : ''}</span>
      </button>`;
    }).join('');
    picker = `<div class="period-nav">
        <button class="pn-btn" ${page > 0 ? `data-go="#/calendar/${ds[(page - 1) * 7].date}" data-dir="same"` : 'disabled'} aria-label="Предыдущая неделя">${I.chevL}</button>
        <span class="pn-title">${from.getMonth() !== to.getMonth() ? dayMonth(from) : from.getDate()} — ${dayMonth(to)}</span>
        <button class="pn-btn" ${page < pages - 1 ? `data-go="#/calendar/${ds[(page + 1) * 7].date}" data-dir="same"` : 'disabled'} aria-label="Следующая неделя">${I.chevR}</button>
      </div>
      <div class="card wk-table">
        <div class="wt-head"><span>День</span><span>Движение</span><span>На начало дня</span></div>
        ${rows}
      </div>`;
  } else {
    const sd = D(day.date);
    const first = D(ds[0].date);
    const mStart = new Date(sd.getFullYear(), sd.getMonth(), 1);
    const mEnd = new Date(sd.getFullYear(), sd.getMonth() + 1, 0);
    const lead = (mStart.getDay() + 6) % 7;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<span class="mc mc-blank"></span>');
    for (let n = 1; n <= mEnd.getDate(); n++) {
      const dt = new Date(sd.getFullYear(), sd.getMonth(), n);
      const off = diffDays(dt, first);
      if (off >= 0 && off < Hn) {
        const x = ds[off];
        cells.push(`<button class="mc ${off === sel ? 'on' : ''} ${x.end < thr ? 'neg' : ''} ${diffDays(dt, today) === 0 ? 'today' : ''}" data-go="#/calendar/${x.date}" data-dir="same">
          <span class="mc-num">${n}</span><span class="mc-bal">${mln(x.start)}</span>
        </button>`);
      } else {
        cells.push(`<span class="mc mc-off ${off < 0 ? 'past' : ''}"><span class="mc-num">${n}</span></span>`);
      }
    }
    const nextM = new Date(sd.getFullYear(), sd.getMonth() + 1, 1);
    const prevM = new Date(sd.getFullYear(), sd.getMonth() - 1, 1);
    const prevOk = diffDays(new Date(sd.getFullYear(), sd.getMonth(), 0), first) >= 0;
    const nextOk = diffDays(nextM, first) < Hn;
    const prevTarget = prevOk ? (diffDays(prevM, first) > 0 ? prevM : first) : null;
    picker = `<div class="period-nav">
        <button class="pn-btn" ${prevTarget ? `data-go="#/calendar/${iso(prevTarget)}" data-dir="same"` : 'disabled'} aria-label="Предыдущий месяц">${I.chevL}</button>
        <span class="pn-title">${monthTitle(sd)}</span>
        <button class="pn-btn" ${nextOk ? `data-go="#/calendar/${iso(nextM)}" data-dir="same"` : 'disabled'} aria-label="Следующий месяц">${I.chevR}</button>
      </div>
      <div class="card month">
        <div class="month-head">${WD_HEAD.map((w, i) => `<span class="${i > 4 ? 'we' : ''}">${w}</span>`).join('')}</div>
        <div class="month-grid">${cells.join('')}</div>
        <div class="month-legend"><span>Остаток на начало дня, млн ₸</span><span><i class="sw sw-neg"></i>${thr > 0 ? 'ниже неснижаемого' : 'не хватает денег'}</span></div>
      </div>`;
  }

  return {
    key: 'calendar', tab: 'calendar', depth: 1, nav: true, title: 'Календарь',
    html: `<div class="scroll">
      <div class="page-head">
        <h1 class="page-title">Календарь</h1>
        ${segmented([{ v: 'week', label: 'Неделя' }, { v: 'month', label: 'Месяц' }], ui.calMode, (v) => `data-act="cal-mode" data-v="${v}"`)}
      </div>
      ${g ? `<button class="gap-strip" data-go="#/calendar/${g.day.date}" data-dir="same">${I.alert}<span>${cap(wdAcc(D(g.day.date)))}, ${dayMonth(D(g.day.date))}, не хватит <b>${moneyShort(g.deficit)}</b></span>${I.chevR}</button>` : ''}
      ${picker}
      ${dayDetail(day, ds, sel, cal)}
    </div>`,
  };
};

actions['cal-mode'] = (t) => {
  if (ui.calMode === t.dataset.v) return;
  ui.calMode = t.dataset.v;
  nav.rerender();
};

// ======================================================================
// ЗАЯВКИ
// ======================================================================
function dueLabel(r, today) {
  const off = offset(r.due, today);
  if (off < 0) return `срок был ${dayMonth(D(r.due))}`;
  return `до ${dayMonth(D(r.due))} · ${relDay(off)}`;
}

function reqCard(r, today, leaving = false) {
  const urgent = offset(r.due, today) <= 2 && r.status === 'pending';
  const statusTag = r.status === 'approved'
    ? '<span class="tag tag-pos">Согласована</span>'
    : r.status === 'rejected' ? '<span class="tag tag-neg">Отклонена</span>' : r.status === 'returned' ? '<span class="tag">На доработке</span>' : '';
  return `<div class="req-wrap ${leaving ? 'leaving' : ''}" data-id="${H(r.id)}">
    <button class="req-card" data-go="#/requests/${H(r.id)}">
      <span class="req-top"><b class="req-who">${H(r.contractor)}</b><b class="req-sum">${money(r.amount)}</b></span>
      <span class="req-purpose">${H(r.purpose)}</span>
      <span class="req-tags"><span class="tag">${H(r.article)}</span>${r.overLimit > 0 && r.status === 'pending' ? `<span class="tag tag-warn">${I.alert}Сверх лимита</span>` : ''}${statusTag}</span>
      <span class="req-foot">
        <span class="req-person">${personAva(r.initiator.initials, 'ava-xs')}${H(r.initiator.name)}</span>
        ${r.status === 'pending' ? `<span class="req-due ${urgent ? 'urgent' : ''}">${I.clock}${dueLabel(r, today)}</span>` : `<span class="req-due">${stampAt(r.decidedAt, today)}</span>`}
      </span>
    </button>
  </div>`;
}

views.requests = (params) => (params[0] ? requestDetail(params[0]) : requestList());

async function requestList() {
  const tab = ui.reqTab;
  const data = await api.requests(api.orgId(), tab);
  const items = data.items || [];
  const today = data.today;
  let list;
  if (tab === 'pending') {
    nav.badge = items.length;
    const lv = ui.leaving && !items.some((r) => r.id === ui.leaving.id) ? ui.leaving : null;
    const rows = lv ? [...items, { ...lv, status: 'pending', leavingRow: true }].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0)) : items;
    list = rows.map((r) => reqCard(r, today, !!r.leavingRow)).join('');
    if (!items.length) {
      list += `<div class="empty ${lv ? 'delay' : ''}">
        <span class="empty-ic ok">${I.check}</span>
        <b>Всё согласовано</b>
        <span>Новые заявки появятся здесь и&nbsp;в&nbsp;уведомлениях</span>
      </div>`;
    }
  } else {
    list = items.length ? items.map((r) => reqCard(r, today)).join('') : `<div class="empty"><span class="empty-ic">${I.requests}</span><b>Пока пусто</b><span>Здесь будут заявки, по которым вы приняли решение</span></div>`;
  }
  return {
    key: 'requests', tab: 'requests', depth: 1, nav: true, title: 'Заявки',
    html: `<div class="scroll">
      <div class="page-head"><h1 class="page-title">Заявки</h1></div>
      ${segmented([{ v: 'pending', label: `Ждут решения${tab === 'pending' && items.length ? ` · ${items.length}` : ''}` }, { v: 'done', label: 'Решённые' }], tab, (v) => `data-act="req-tab" data-v="${v}"`)}
      ${tab === 'pending' && items.length ? `<p class="list-sum">${items.length} ${plural(items.length, REQ_FORMS)} на ${money(sum(items, (r) => r.amount))}</p>` : '<div class="list-gap"></div>'}
      <div class="req-list">${list}</div>
    </div>`,
    mount(el) {
      const lvEl = el.querySelector('.req-wrap.leaving');
      if (!lvEl) return;
      const id = ui.leaving && ui.leaving.id;
      setTimeout(() => {
        lvEl.style.height = `${lvEl.offsetHeight}px`;
        void lvEl.offsetHeight;
        lvEl.classList.add('go');
        lvEl.style.height = '0px';
        setTimeout(() => {
          lvEl.remove();
          if (ui.leaving && ui.leaving.id === id) ui.leaving = null;
        }, 480);
      }, 380);
    },
  };
}

actions['req-tab'] = (t) => {
  if (ui.reqTab === t.dataset.v) return;
  ui.reqTab = t.dataset.v;
  ui.leaving = null;
  nav.rerender();
};

function routeStep(s, today) {
  const label = { created: 'Заявка создана', approved: 'Согласовано', rejected: 'Отклонено', returned: 'Возвращено на доработку', pending: 'Ждёт решения', waiting: 'Ещё не дошла очередь', skipped: 'Этап пропущен' }[s.status] || s.status;
  const ic = { created: I.file, approved: I.check, rejected: I.x, returned: I.refresh, pending: I.clock, waiting: I.clock, skipped: I.chevR }[s.status] || I.clock;
  return `<li class="rt rt-${H(s.status)}">
    <span class="rt-dot">${ic}</span>
    <div class="rt-body">
      <b>${H(s.name)}${s.me ? ' (вы)' : ''}</b>
      <span class="rt-role">${H(s.role || '')}</span>
      <span class="rt-status">${s.status === 'pending' && s.me ? 'Ждёт вашего решения' : label}${s.at ? ` · ${stampAt(s.at, today)}` : ''}</span>
      ${s.comment ? `<span class="rt-comment">«${H(s.comment)}»</span>` : ''}
    </div>
  </li>`;
}

// Бюджет основной статьи заявки: сколько из заявки приходится на статью и на сколько превышен лимит.
//  part  — доля заявки по статье (budget.request, в контракте this_request); нет поля — вся сумма заявки;
//  over  — превышение: как посчитал учёт (budget.overBy, в контракте over_by), иначе от доли: used + part − limit;
//  split — у заявки несколько статей, доля меньше суммы заявки.
function budgetUse(r) {
  const b = r.budget;
  if (!b || !(b.limit > 0)) return { part: 0, split: false, after: 0, over: 0 };
  const part = b.request != null ? b.request : r.amount;
  const after = b.used + part;
  const over = Math.max(0, b.overBy != null ? b.overBy : after - b.limit);
  return { part, split: part !== r.amount, after, over };
}

async function requestDetail(id) {
  let r;
  try {
    r = await api.request(api.orgId(), id);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'not_found') {
      return {
        key: `req:${id}`, depth: 2, title: 'Заявка',
        html: `${topbar('Заявка', '#/requests')}<div class="scroll has-topbar"><div class="empty"><span class="empty-ic">${I.info}</span><b>Заявка не найдена</b><span>Возможно, она удалена или относится к другой организации</span><button class="btn btn-secondary" data-go="#/requests">К списку заявок</button></div></div>`,
      };
    }
    throw e;
  }
  ui.request = r;
  const today = r.today;
  const b = r.budget;
  let budget = '';
  if (b && b.limit > 0) {
    // Считаем от доли заявки по этой статье, а не от всей суммы: у заявки с несколькими статьями они разные.
    const { part, split, after, over } = budgetUse(r);
    const article = b.article || r.article;
    const scale = Math.max(b.limit, after);
    const pct = (v) => ((v / scale) * 100).toFixed(2);
    budget = `<section class="card budget ${over > 0 ? 'is-over' : ''}" data-budget data-part="${part}" data-over="${over}">
        <div class="card-head"><h2>Бюджет статьи</h2><span class="muted">${H(article)}${b.period ? ` · ${H(b.period)}` : ''}</span></div>
        <div class="bud-bar">
          <div class="bud-track">
            <i class="bud-used" style="width:${pct(b.used)}%"></i>
            <i class="bud-req" style="left:${pct(b.used)}%;width:${pct(part)}%"></i>
          </div>
          <span class="bud-limit" style="left:${pct(b.limit)}%"><small>лимит</small></span>
        </div>
        <div class="bud-legend">
          <span><i class="sw sw-ink"></i>Израсходовано<b>${money(b.used)}</b></span>
          <span><i class="sw ${over > 0 ? 'sw-coral' : 'sw-lav'}"></i>${split ? 'По статье' : 'Эта заявка'}<b>${money(part)}</b></span>
          <span><i class="sw sw-limit"></i>Лимит<b>${money(b.limit)}</b></span>
        </div>
        ${split ? `<p class="bud-split" data-bud-split>${I.info}<span>В${NB}заявке несколько статей. На${NB}эту статью из${NB}${money(r.amount)} приходится ${money(part)}.</span></p>` : ''}
        ${over > 0
    ? `<div class="over-note">${I.alert}<div><b>Превышение лимита на ${money(over)}</b><span>+${Math.round((over / b.limit) * 100)}% к бюджету статьи${b.period ? ` на ${H(b.period)}` : ''}. Согласование пройдёт сверх лимита.</span></div></div>`
    : `<div class="ok-note">${I.check}<span>В пределах лимита. Останется ${money(b.limit - after)}</span></div>`}
      </section>`;
  }

  let impact = '';
  if (r.impact) {
    const im = r.impact;
    impact = `<section class="card impact">
      <div class="card-head"><h2>Остаток на ${dayMonth(D(im.date))}</h2><span class="muted">${im.inCalendar ? 'уже в календаре' : 'если оплатить'}</span></div>
      <div class="imp-row">
        <span class="imp-val"><small>до оплаты</small><b>${moneyShort(im.before)}</b></span>
        <span class="imp-arrow">${I.arrowR}</span>
        <span class="imp-val"><small>после</small><b class="${im.after < 0 ? 'neg' : ''}">${moneyShort(im.after)}</b></span>
      </div>
      <p class="imp-note ${im.after < 0 ? 'neg' : 'pos'}">${im.after < 0 ? `${I.alert}Оплата создаст кассовый разрыв` : `${I.check}Разрыва не будет`}</p>
    </section>`;
  }

  const statusChip = r.status === 'pending'
    ? `<span class="status-chip st-wait">${r.canDecide ? 'Ждёт вашего решения' : 'На согласовании'}</span>`
    : r.status === 'approved' ? '<span class="status-chip st-ok">Согласована</span>'
      : r.status === 'rejected' ? '<span class="status-chip st-neg">Отклонена</span>' : '<span class="status-chip">На доработке</span>';
  const dueOff = offset(r.due, today);
  const atts = r.attachments || [];

  return {
    key: `req:${id}`, depth: 2, title: `Заявка № ${r.num}`,
    html: `${topbar(`Заявка № ${H(r.num)}`, '#/requests')}
    <div class="scroll has-topbar ${r.canDecide ? 'has-actionbar ab-3-pad' : ''}">
      <section class="req-hero">
        ${statusChip}
        <div class="rh-who">${H(r.contractor)}</div>
        <div class="rh-sum">${bigMoney(r.amount)}</div>
        <div class="rh-purpose">${H(r.purpose)}</div>
      </section>

      <section class="card kv">
        <div class="kv-row"><span>Статья</span><b>${H(r.article)}</b></div>
        <div class="kv-row"><span>Оплатить</span><b class="${dueOff <= 2 && r.status === 'pending' ? 'warn-text' : ''}">${dueOff >= 0 ? `до ${dayMonth(D(r.due))}, ${relDay(dueOff)}` : dayMonth(D(r.due))}</b></div>
        ${r.payFrom ? `<div class="kv-row"><span>Со счёта</span><b>${H(r.payFrom)}</b></div>` : ''}
        <div class="kv-row"><span>Инициатор</span><b class="kv-person">${personAva(r.initiator.initials, 'ava-xs')}<span>${H(r.initiator.name)}<small>${H(r.initiator.role || '')}</small></span></b></div>
        ${r.createdAt ? `<div class="kv-row"><span>Создана</span><b>${stampAt(r.createdAt, today)}</b></div>` : ''}
      </section>

      ${budget}
      ${impact}

      ${r.comment ? `<section class="card">
        <div class="card-head"><h2>Комментарий инициатора</h2></div>
        <div class="quote">${personAva(r.initiator.initials)}<div class="bubble">${H(r.comment)}</div></div>
      </section>` : ''}

      ${atts.length ? `<section class="card">
        <div class="card-head"><h2>Вложения</h2></div>
        ${atts.map((a) => `<button class="attach" data-act="open-pdf" data-att="${H(a.id)}">
          <span class="pdf-ic">PDF</span>
          <span class="attach-name"><b>${H(a.name)}</b><small>${H(a.size || '')}${a.kind === 'invoice' ? ' · счёт на оплату' : ''}</small></span>
          ${I.chevR}
        </button>`).join('')}
      </section>` : ''}

      <section class="card">
        <div class="card-head"><h2>Маршрут согласования</h2></div>
        <ol class="route">${(r.route || []).map((s) => routeStep(s, today)).join('')}</ol>
      </section>
    </div>
    ${r.canDecide ? `<div class="actionbar ab-3">
      <button class="btn btn-ghost btn-sm" data-act="reject">Отклонить</button>
      <button class="btn btn-ghost btn-sm" data-act="return">На доработку</button>
      <button class="btn btn-primary ab-main" data-act="approve">${I.check}Согласовать</button>
    </div>` : ''}`,
  };
}

let pdfUrl = null;
actions['open-pdf'] = async (t) => {
  const r = ui.request;
  if (!r) return;
  try {
    const a = await api.attachment(api.orgId(), r.id, t.dataset.att);
    if (a.kind === 'pdf') {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      pdfUrl = a.url;
      openSheet(`<div class="pdf-bar"><span class="pdf-ic sm">PDF</span><b>${H(a.name || 'Вложение')}</b><button class="tb-btn" data-act="sheet-close" aria-label="Закрыть">${I.x}</button></div>
        <iframe class="pdf-frame" src="${H(a.url)}" title="${H(a.name || 'PDF')}"></iframe>
        <a class="btn btn-secondary btn-block" href="${H(a.url)}" target="_blank" rel="noopener">${I.download}Открыть отдельно</a>`, { tall: true });
      return;
    }
    openSheet(`<div class="pdf-bar"><span class="pdf-ic sm">PDF</span><b>${H(a.name)}</b><button class="tb-btn" data-act="sheet-close" aria-label="Закрыть">${I.x}</button></div>
      <div class="paper-scroll">
        <div class="paper">
          <div class="paper-stamp">ДЕМО</div>
          <div class="paper-top">
            <div><small>Поставщик</small><b>${H(a.supplier)}</b><span>БИН ••••••••••••</span></div>
            <div class="ta-r"><small>Счёт на оплату</small><b>№ ${H(a.number)}</b><span>от ${dayMonth(D(a.date))} ${D(a.date).getFullYear()} г.</span></div>
          </div>
          <div class="paper-party"><small>Покупатель</small><b>${H(a.buyer)}</b></div>
          <table class="paper-table">
            <thead><tr><th>Наименование</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead>
            <tbody>${a.items.map((i) => `<tr><td>${H(i.name)}</td><td>${digits(i.qty)} ${H(i.unit)}</td><td>${digits(i.price)}</td><td>${digits(i.qty * i.price)}</td></tr>`).join('')}</tbody>
          </table>
          <div class="paper-total"><span>Итого к оплате</span><b>${money(a.total)}</b></div>
          <div class="paper-vat">в т. ч. НДС ${a.vatRate}%: ${money(a.vat)}</div>
          <div class="paper-sign"><span>Руководитель ____________</span><span>Бухгалтер ____________</span></div>
        </div>
      </div>
      <p class="sheet-note">Это заглушка вложения. В рабочей версии здесь откроется PDF счёта из&nbsp;1С.</p>`, { tall: true });
  } catch (e) {
    actionError(e);
  }
};

// ---------- решение по заявке: никакого «согласовано» до ответа сервера ----------
actions.approve = () => {
  const r = ui.request;
  if (!r) return;
  const { over } = budgetUse(r);
  ui.decision = null;
  openSheet(`<div class="sheet-title">Согласовать оплату?</div>
    <div class="confirm-sum">${money(r.amount)}</div>
    <p class="confirm-sub">${H(r.contractor)} · до ${dayMonth(D(r.due))}</p>
    ${over ? `<div class="over-note compact">${I.alert}<div><b>Сверх лимита на ${money(over)}</b><span>Статья «${H((r.budget && r.budget.article) || r.article)}»</span></div></div>` : ''}
    <div class="sheet-actions">
      <button class="btn btn-primary btn-block" data-act="approve-confirm">Да, согласовать</button>
      <button class="btn btn-text btn-block" data-act="sheet-close">Отмена</button>
    </div>`);
};

actions['approve-confirm'] = (t) => submitDecision('approve', '', t);

const REASONS = ['Нет денег в бюджете', 'Перенесём на следующий месяц', 'Нужен другой поставщик', 'Уточните сумму'];

// Отклонение и возврат на доработку: комментарий обязателен, его увидит инициатор.
const COMMENT_KINDS = {
  reject: {
    title: 'Отклонить заявку',
    sub: (who) => `Напишите причину — её увидит ${who}. Без комментария отклонить нельзя.`,
    reasons: REASONS,
    placeholder: 'Причина отказа',
    error: 'Напишите причину отказа',
    button: 'Отклонить заявку',
    btnClass: 'btn-danger',
  },
  return: {
    title: 'Вернуть на доработку',
    sub: (who) => `Это не отказ: ${who} исправит заявку и отправит снова — она опять придёт к вам. Напишите, что исправить.`,
    reasons: ['Уточните сумму', 'Приложите счёт', 'Поменяйте статью', 'Перенесите дату оплаты'],
    placeholder: 'Что исправить',
    error: 'Напишите, что исправить',
    button: 'Вернуть на доработку',
    btnClass: 'btn-dark',
  },
};

function commentSheet(kind) {
  const r = ui.request;
  if (!r) return;
  const k = COMMENT_KINDS[kind];
  ui.decision = null;
  const first = (r.initiator.name || '').split(' ')[0] || 'инициатор';
  openSheet(`<div class="sheet-title">${k.title}</div>
    <p class="sheet-sub">${k.sub(H(first))}</p>
    <div class="chips">${k.reasons.map((c) => `<button class="chip" data-act="reason" data-v="${c}">${c}</button>`).join('')}</div>
    <textarea class="textarea" id="reject-text" rows="3" maxlength="1000" placeholder="${k.placeholder}"></textarea>
    <div class="field-err" id="reject-err" hidden>${I.alert}<span>${k.error}</span></div>
    <div class="sheet-actions">
      <button class="btn ${k.btnClass} btn-block" data-act="${kind}-confirm" data-label="${k.button}">${k.button}</button>
      <button class="btn btn-text btn-block" data-act="sheet-close">Отмена</button>
    </div>`, {
    onMount(wrap) {
      const ta = wrap.querySelector('#reject-text');
      ta.addEventListener('input', () => {
        if (ta.value.trim()) {
          wrap.querySelector('#reject-err').hidden = true;
          ta.classList.remove('invalid');
        }
        wrap.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.v === ta.value.trim()));
      });
    },
  });
}

actions.reject = () => commentSheet('reject');
actions.return = () => commentSheet('return');

actions.reason = (t) => {
  const ta = document.getElementById('reject-text');
  ta.value = t.dataset.v;
  ta.dispatchEvent(new Event('input'));
};

function confirmWithComment(kind, t) {
  const ta = document.getElementById('reject-text');
  const text = ta ? ta.value.trim() : '';
  if (!text) {
    document.getElementById('reject-err').hidden = false;
    ta.classList.add('invalid');
    ta.classList.remove('shake');
    void ta.offsetWidth;
    ta.classList.add('shake');
    ta.focus();
    return;
  }
  submitDecision(kind, text, t);
}

actions['reject-confirm'] = (t) => confirmWithComment('reject', t);
actions['return-confirm'] = (t) => confirmWithComment('return', t);

actions['decision-retry'] = (t) => {
  const d = ui.decision;
  if (d) submitDecision(d.kind, d.comment, t);
};

actions['decision-to-list'] = async () => {
  ui.decision = null;
  invalidate();
  await closeSheet();
  ui.reqTab = 'pending';
  replace('#/requests', 'pop');
};

actions['decision-refresh'] = async () => {
  ui.decision = null;
  invalidate();
  await closeSheet();
  nav.rerender();
};

function setBusy(btn, label) {
  ui.busy = true;
  const wrap = document.querySelector('.sheet-wrap');
  wrap?.classList.add('busy');
  wrap?.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  const ta = document.getElementById('reject-text');
  if (ta) ta.readOnly = true;
  if (btn) {
    btn.classList.add('loading');
    btn.innerHTML = `${spinner}${label}`;
  }
}

async function submitDecision(kind, comment, btn) {
  const r = ui.request;
  if (!r || ui.busy) return;
  // Тот же ключ при повторе той же операции: сервер не применит решение дважды.
  if (!ui.decision || ui.decision.reqId !== r.id || ui.decision.kind !== kind) {
    ui.decision = { reqId: r.id, kind, comment, key: uuid() };
  }
  ui.decision.comment = comment;
  setBusy(btn, 'Отправляется…');
  let res;
  try {
    res = await api.decide(api.orgId(), r.id, { decision: kind, comment, idempotencyKey: ui.decision.key });
  } catch (e) {
    ui.busy = false;
    if (isSessionEnd(e)) {
      await closeSheet(true);
      onUnauthorized(e);
      return;
    }
    showDecisionError(e, r);
    return;
  }
  ui.busy = false;
  ui.decision = null;
  invalidate();
  await closeSheet();
  const amount = money(r.amount);
  if (kind === 'approve') {
    const final = !res || !res.requestStatus || res.requestStatus === 'approved';
    await success({
      kind: 'approved',
      title: final ? 'Заявка согласована' : 'Вы согласовали',
      text: final
        ? (res && res.paymentDate ? `Платёж ${amount} стоит в календаре на ${dayMonth(D(res.paymentDate))}` : `Платёж ${amount} согласован`)
        : `Заявка ушла на следующий этап${res.nextApprover ? `: ${H(res.nextApprover)}` : ''}`,
    });
  } else if (kind === 'return') {
    await success({ kind: 'returned', title: 'Возвращена на доработку', text: `${H(r.initiator.name)} исправит заявку и отправит снова — она опять придёт к вам` });
  } else {
    await success({ kind: 'rejected', title: 'Заявка отклонена', text: `${H(r.initiator.name)} получит уведомление с вашим комментарием` });
  }
  ui.leaving = { id: r.id, num: r.num, contractor: r.contractor, amount: r.amount, article: r.article, purpose: r.purpose, initiator: r.initiator, due: r.due, overLimit: r.overLimit };
  ui.reqTab = 'pending';
  replace('#/requests', 'pop');
}

function setSheetIdle() {
  ui.busy = false;
  const wrap = document.querySelector('.sheet-wrap');
  wrap?.classList.remove('busy');
  wrap?.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  const ta = document.getElementById('reject-text');
  if (ta) ta.readOnly = false;
  const btn = wrap?.querySelector('.loading');
  if (btn) {
    btn.classList.remove('loading');
    btn.textContent = btn.dataset.label || 'Отправить';
  }
}

function showDecisionError(e, r) {
  const c = e instanceof ApiError ? e.code : 'server_error';
  if (c === 'comment_required') {
    setSheetIdle();
    const err = document.getElementById('reject-err');
    if (err) err.hidden = false;
    return;
  }
  let icon = I.alert;
  let title;
  let text;
  let buttons;
  if (c === 'already_decided') {
    const det = e.details || {};
    const what = det.status === 'rejected' ? 'отклонена' : det.status === 'returned' ? 'возвращена на доработку' : 'согласована';
    icon = I.info;
    title = 'Решение уже принято';
    text = `Заявка уже ${what}${det.by ? `: ${H(det.by)}` : ''}${det.at ? `, ${stampAt(det.at, r.today)}` : ''}. Ваше решение не отправлено.`;
    buttons = '<button class="btn btn-primary btn-block" data-act="decision-to-list">К списку заявок</button>';
  } else if (c === 'action_failed') {
    title = 'Учёт не принял решение';
    text = `${H(e.message || 'Причина не указана.')} Заявка осталась в прежнем состоянии.`;
    buttons = `<button class="btn btn-primary btn-block" data-act="decision-refresh">Обновить заявку</button>
      <button class="btn btn-text btn-block" data-act="sheet-close">Закрыть</button>`;
  } else if (c === 'forbidden') {
    icon = I.shield;
    title = 'Нет прав на это решение';
    text = 'Решение принимает согласующий текущего этапа маршрута или его заместитель. Возможно, этап уже сменился.';
    buttons = `<button class="btn btn-primary btn-block" data-act="decision-refresh">Обновить заявку</button>
      <button class="btn btn-text btn-block" data-act="sheet-close">Закрыть</button>`;
  } else {
    const map = {
      network: ['Нет связи', 'Решение не отправлено. Проверьте интернет и повторите.'],
      timeout: ['Сервер не ответил', 'Неизвестно, дошло ли решение. Повторите — дважды оно не применится.'],
      upstream_unavailable: ['1С сейчас недоступна', 'Решение не применено. Повторите через минуту.'],
      server_unavailable: ['Сервер недоступен', 'Решение не отправлено. Повторите через минуту.'],
    };
    [title, text] = map[c] || ['Не удалось отправить решение', 'Повторите — дважды оно не применится.'];
    buttons = `<button class="btn btn-primary btn-block" data-act="decision-retry">${I.refresh}Повторить</button>
      <button class="btn btn-text btn-block" data-act="sheet-close">Отмена</button>`;
  }
  ui.busy = false;
  setSheet(`<div class="decision-state" data-state="${H(c)}" role="alert">
      <span class="ds-ic ${c === 'already_decided' ? 'info' : ''}">${icon}</span>
      <div class="sheet-title">${title}</div>
      <p class="sheet-sub">${text}</p>
    </div>
    <div class="sheet-actions">${buttons}</div>`);
}

// ======================================================================
// ОТЧЁТЫ
// ======================================================================
function niceMax(v) {
  const step = v > 20e6 ? 5e6 : v > 8e6 ? 2e6 : 1e6;
  return Math.max(step, Math.ceil(v / step) * step);
}

function ddsReport(rep) {
  const w = rep.weeks || [];
  if (!w.length) return `<div class="empty"><span class="empty-ic">${I.chart}</span><b>Нет данных за период</b></div>`;
  const tin = sum(w, (x) => x.in);
  const tout = sum(w, (x) => x.out);
  const sel = Math.min(ui.ddsSel ?? w.length - 1, w.length - 1);
  const max = niceMax(Math.max(...w.map((x) => Math.max(x.in, x.out))));
  const W = 326;
  const Hc = 180;
  const left = 30;
  const top = 8;
  const plotW = W - left;
  const plotH = Hc - 22 - top;
  const gw = plotW / w.length;
  const bw = Math.min(16, gw * 0.26);
  const y = (v) => top + plotH - (v / max) * plotH;
  const svg = `<svg class="dds-chart" viewBox="0 0 ${W} ${Hc}" role="img" aria-label="Поступления и выплаты по неделям">
    ${[0, 0.25, 0.5, 0.75, 1].map((k) => k * max).map((t) => `<line class="grid" x1="${left}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${left - 6}" y="${y(t) + 3.5}" text-anchor="end">${t ? Math.round(t / 1e6) : 0}</text>`).join('')}
    ${w.map((x, i) => {
    const cx = left + gw * i + gw / 2;
    const on = i === sel;
    return `<g class="dds-g ${on ? 'on' : ''}">
        <rect class="hit" x="${left + gw * i}" y="0" width="${gw}" height="${Hc}" data-act="dds-sel" data-i="${i}"/>
        ${on ? `<rect class="sel-bg" x="${left + gw * i + 3}" y="${top - 4}" width="${gw - 6}" height="${plotH + 4}" rx="10"/>` : ''}
        <rect class="b-in" x="${cx - bw - 1.5}" y="${y(x.in)}" width="${bw}" height="${(x.in / max) * plotH}" rx="4"/>
        <rect class="b-out" x="${cx + 1.5}" y="${y(x.out)}" width="${bw}" height="${(x.out / max) * plotH}" rx="4"/>
        <text class="axis x ${on ? 'on' : ''}" x="${cx}" y="${Hc - 6}" text-anchor="middle">${H(x.label)}</text>
      </g>`;
  }).join('')}
  </svg>`;
  const s = w[sel];
  const net = s.in - s.out;
  return `<div class="kpi3">
      <div><small>Поступления</small><b class="pos">${moneyShort(tin)}</b></div>
      <div><small>Выплаты</small><b>${moneyShort(tout)}</b></div>
      <div><small>Итог месяца</small><b class="${tin - tout < 0 ? 'neg' : 'pos'}">${moneyShort(tin - tout, { sign: true })}</b></div>
    </div>
    <section class="card">
      <div class="card-head"><h2>Движение денег по неделям</h2><span class="muted">млн ₸</span></div>
      ${svg}
      <div class="chart-legend"><span><i class="sw sw-in"></i>Поступления</span><span><i class="sw sw-out"></i>Выплаты</span></div>
      <div class="dds-sel">
        <div class="ds-title">${H(s.full || s.label)}</div>
        <div class="ds-row"><span>Поступления</span><b class="pos">${money(s.in, { sign: true })}</b></div>
        <div class="ds-row"><span>Выплаты</span><b>${money(-s.out)}</b></div>
        <div class="ds-row total"><span>Итог недели</span><b class="${net < 0 ? 'neg' : 'pos'}">${money(net, { sign: true })}</b></div>
      </div>
    </section>
    <p class="hint-line">${I.info}<span>Нажмите на неделю, чтобы увидеть суммы</span></p>`;
}

// Строка без плана (статьи нет в бюджете или бюджета на месяц нет): только факт.
const factRow = (x) => `<div class="pf noplan">
    <div class="pf-top"><span>${H(x.article)}</span><b>${moneyShort(x.fact || 0)}</b></div>
    <div class="pf-sub"><span>факт, плана нет</span></div>
  </div>`;

function pfRow(x, income = false) {
  if (x.plan == null) return factRow(x);
  const p = x.plan ? Math.round((x.fact / x.plan) * 100) : 0;
  const over = !income && x.fact > x.plan;
  const scale = Math.max(x.plan, x.fact) || 1;
  const fillW = (Math.min(x.fact, x.plan) / scale) * 100;
  const overW = over ? ((x.fact - x.plan) / scale) * 100 : 0;
  return `<div class="pf ${over ? 'over' : ''} ${income ? 'income' : ''}">
    <div class="pf-top"><span>${H(x.article)}</span><b>${p}%</b></div>
    <div class="pf-bar">
      <i class="pf-fill" style="width:${fillW}%"></i>
      ${over ? `<i class="pf-over" style="left:${fillW}%;width:${overW}%"></i><span class="pf-plan" style="left:${(x.plan / scale) * 100}%"></span>` : ''}
    </div>
    <div class="pf-sub"><span>${moneyShort(x.fact)} из ${moneyShort(x.plan)}</span>${over ? `<span class="neg">+${money(x.fact - x.plan)} сверх плана</span>` : income && x.fact < x.plan ? `<span class="muted">${moneyShort(x.fact - x.plan)} до плана</span>` : ''}</div>
  </div>`;
}

function planFact(rep) {
  if (rep.hasPlan === false) {
    return `<div class="noplan-note">
        <span class="noplan-ic">${I.calendar}</span>
        <div><b>Бюджет на месяц не задан</b><span>План сравнивать не с чем — показываем только фактические оплаты.</span></div>
      </div>
      ${(rep.income || []).length ? `<section class="card"><div class="card-head"><h2>Поступления</h2><span class="muted">факт</span></div>${rep.income.map(factRow).join('')}</section>` : ''}
      <section class="card">
        <div class="card-head"><h2>Выплаты по статьям</h2><span class="muted">факт</span></div>
        ${(rep.expense || []).map(factRow).join('')}
      </section>`;
  }
  const overs = (rep.expense || []).filter((x) => x.plan != null && x.fact > x.plan);
  return `${overs.length ? `<div class="over-note">${I.alert}<div><b>${overs.length} ${plural(overs.length, ['статья', 'статьи', 'статей'])} сверх плана</b><span>${overs.map((x) => `${H(x.article)} +${Math.round((x.fact / x.plan - 1) * 100)}%`).join(', ')}</span></div></div>` : ''}
    ${(rep.income || []).length ? `<section class="card"><div class="card-head"><h2>Поступления</h2></div>${rep.income.map((x) => pfRow(x, true)).join('')}</section>` : ''}
    <section class="card">
      <div class="card-head"><h2>Выплаты по статьям</h2><span class="muted">факт / план</span></div>
      ${(rep.expense || []).map((x) => pfRow(x)).join('')}
    </section>`;
}

function debtorsReport(rep) {
  const list = rep.top || [];
  const max = list.length ? Math.max(...list.map((d) => d.amount)) : 1;
  return `<section class="card">
      <div class="card-head"><h2>Дебиторка на ${dayMonth(D(rep.asOf))}</h2></div>
      <div class="rec-sum">${moneyShort(rep.total)}</div>
      <span class="age-title">Долг по возрасту</span>
      ${ageBar(rep.aging, rep.total)}
      ${ageLegend(rep.aging)}
      <p class="age-note">${I.info}<span>Возраст — дни от даты акта или накладной. Оплаты гасят самые старые документы первыми.</span></p>
    </section>
    <section class="card">
      <div class="card-head"><h2>Топ-5 должников</h2></div>
      <ol class="debt-list">
        ${list.map((d, i) => `<li class="debt">
          <span class="debt-rank">${i + 1}</span>
          <div class="debt-main">
            <div class="debt-top"><b>${H(d.name)}</b><b class="debt-sum">${money(d.amount)}</b></div>
            ${ageBar(d.aging, max, 'age-bar-sm')}
            <div class="debt-sub"><span class="tag">старейший документ — ${d.days} ${plural(d.days, DAY_FORMS)}</span>${d.aging && d.aging.days_over_60 ? `<span class="neg">&gt; 60 дней: ${money(d.aging.days_over_60)}</span>` : ''}</div>
          </div>
        </li>`).join('')}
      </ol>
      ${rep.rest > 0 ? `<div class="debt-rest"><span>Остальные покупатели</span><b>${money(rep.rest)}</b></div>` : ''}
    </section>`;
}

views.reports = async (params) => {
  const org = api.orgId();
  const tab = ['dds', 'plan', 'debtors'].includes(params[0]) ? params[0] : 'dds';
  let rep;
  try {
    rep = await cached(`rep:${org}:${tab}`, 60e3, () => api.report(org, tab));
  } catch (e) {
    if (isLater(e) && tab === 'debtors') later.add('debtors');
    throw e;
  }
  if (tab === 'debtors') later.delete('debtors');
  const body = tab === 'dds' ? ddsReport(rep) : tab === 'plan' ? planFact(rep) : debtorsReport(rep);
  return {
    key: 'reports', tab: 'reports', depth: 1, nav: true, title: 'Отчёты',
    html: `<div class="scroll">
      <div class="page-head"><h1 class="page-title">Отчёты</h1><span class="period-chip">${tab === 'debtors' ? 'на сегодня' : H(rep.period || '')}</span></div>
      ${segmented([{ v: 'dds', label: 'ДДС' }, { v: 'plan', label: 'План-факт' }, { v: 'debtors', label: 'Должники' }], tab, (v) => `data-go="#/reports/${v}" data-dir="same"`)}
      <div class="rep-body">${body}</div>
    </div>`,
  };
};

actions['dds-sel'] = (t) => {
  ui.ddsSel = Number(t.dataset.i);
  nav.rerender();
};

// ======================================================================
// УВЕДОМЛЕНИЯ
// ======================================================================
const N_IC = {
  payment: ['in', I.arrowIn],
  request: ['req', I.requests],
  gap: ['gap', I.alert],
  summary: ['sum', I.sun],
  debt: ['debt', I.trendDown],
  approved: ['in', I.check],
  rejected: ['gap', I.x],
  returned: ['req', I.refresh],
};

function linkToHash(link) {
  if (!link) return null;
  const [kind, val] = String(link).split(':');
  if (kind === 'calendar') return `#/calendar/${val}`;
  if (kind === 'request') return `#/requests/${val}`;
  if (kind === 'reports') return `#/reports/${val}`;
  if (kind === 'requests') return '#/requests';
  return null;
}

views.notifications = async () => {
  const data = await api.notifications(api.orgId());
  ui.notifs = data.items || [];
  const unread = ui.notifs.filter((n) => !n.read).length;
  const groups = [];
  ui.notifs.forEach((n) => {
    const off = offset(n.at, data.today);
    const label = off === 0 ? 'Сегодня' : off === -1 ? 'Вчера' : cap(dayMonth(D(n.at)));
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { label, items: [] }));
    g.items.push(n);
  });
  return {
    key: 'notifications', depth: 2, title: 'Уведомления',
    html: `${topbar('Уведомления', '#/home', unread ? '<button class="link-btn" data-act="read-all">Прочитать все</button>' : '')}
    <div class="scroll has-topbar">
      ${groups.length ? groups.map((g) => `<div class="n-group"><div class="n-label">${g.label}</div>
        <div class="card n-card">${g.items.map((n) => {
    const [cls, ic] = N_IC[n.type] || ['sum', I.bell];
    return `<button class="notif ${n.read ? '' : 'unread'}" data-act="open-notif" data-id="${H(n.id)}">
            <span class="n-ic n-${cls}">${ic}</span>
            <span class="n-main"><b>${H(n.title)}</b><span>${H(n.text)}</span><time>${String(n.at).slice(11, 16)}</time></span>
            ${n.read ? '' : '<i class="n-dot" aria-label="Новое"></i>'}
          </button>`;
  }).join('')}</div></div>`).join('') : `<div class="empty"><span class="empty-ic">${I.bell}</span><b>Уведомлений нет</b><span>Здесь будут оплаты, новые заявки и предупреждения о разрывах</span></div>`}
      <p class="foot-note">${I.chat}<span>Утренняя сводка и разрывы дублируются в WhatsApp</span></p>
    </div>`,
  };
};

actions['read-all'] = async () => {
  try {
    await api.markAllRead(api.orgId());
  } catch (e) {
    return actionError(e);
  }
  nav.rerender();
};

actions['open-notif'] = (t) => {
  const n = (ui.notifs || []).find((x) => x.id === t.dataset.id);
  if (!n) return;
  if (!n.read) api.markRead(api.orgId(), n.id).catch(() => {}); // не критично: не прочиталось — останется точка
  n.read = true;
  if (n.link === 'summary') {
    t.classList.remove('unread');
    t.querySelector('.n-dot')?.remove();
    openSummary();
    return;
  }
  const h = linkToHash(n.link);
  if (h) navigate(h, 'push');
  else nav.rerender();
};

async function openSummary() {
  let s;
  try {
    s = await api.summary(api.orgId());
  } catch (e) {
    return actionError(e);
  }
  const n = s.approvals.count;
  const lines = [
    ['Деньги', `${moneyShort(s.money.total)} (банк ${moneyShort(s.money.bank)}, касса ${moneyShort(s.money.cash)})`],
    ['Сегодня', `поступления ${moneyShort(s.today.in)}, платежи ${moneyShort(s.today.out)}`],
    s.gap ? ['Разрыв', `${wdAcc(D(s.gap.date))}, ${dayMonth(D(s.gap.date))}, не хватит ${moneyShort(s.gap.deficit)}`] : ['Разрывы', 'на 4 недели не ожидаются'],
    ['Заявки', n ? `${n} ${plural(n, REQ_FORMS)} ${n % 10 === 1 && n % 100 !== 11 ? 'ждёт' : 'ждут'} решения на ${moneyShort(s.approvals.sum)}` : 'всё согласовано'],
    ['Старый долг', `покупатели должны ${moneyShort(s.over60 || 0)} дольше 60 дней`],
  ];
  const u = (api.session() && api.session().user) || {};
  const t = String(s.asOf).slice(11, 16);
  openSheet(`<div class="sheet-title">Утренняя сводка</div>
    <div class="sheet-sub">${H(s.orgName || '')} · ${dayMonth(D(s.asOf))}, ${t}</div>
    <div class="summary-chat">
      <div class="sc-bubble">
        <p>${greeting()}${u.firstName ? `, ${H(u.firstName)}` : ''}! Коротко о деньгах на сегодня:</p>
        ${lines.map(([k, v]) => `<p><b>${k}:</b> ${v}</p>`).join('')}
        <span class="sc-time">${t} ${I.check}</span>
      </div>
    </div>
    <p class="sheet-note">${I.chat} Такая же сводка приходит в WhatsApp каждое утро</p>
    <button class="btn btn-secondary btn-block" data-act="sheet-close">Закрыть</button>`);
}

// ======================================================================
// ПРОФИЛЬ
// ======================================================================
// Подписи: время, сумму и горизонт задаёт администратор — приложение их только показывает.
const TOGGLES = [
  ['summary', 'Утренняя сводка', (i) => `Каждый день в ${i.summaryTime || '08:30'}`],
  ['requests', 'Новые заявки', () => 'Как только заявка дошла до вас'],
  ['payments', 'Поступления', (i) => `Оплаты от ${money(i.paymentsMin ?? 500000)}`],
  ['gaps', 'Кассовые разрывы', (i) => {
    const n = i.gapsDays ?? 3;
    return `За ${n} ${plural(n, DAY_FORMS)} до разрыва`;
  }],
  ['whatsapp', 'Дублировать в WhatsApp', () => 'Сводка и разрывы — в чат'],
];

function toggleRow([k, title, desc], st) {
  const on = !!st.toggles[k];
  if ((st.locked || []).includes(k)) {
    return `<div class="li li-locked" data-k="${k}" role="switch" aria-checked="${on}" aria-disabled="true">
      <span class="li-main"><b>${title}</b><small>${desc(st.info || {})}</small><small class="li-note">${I.shield}Настраивает администратор</small></span>
      <span class="switch locked ${on ? 'on' : ''}"><i></i></span>
    </div>`;
  }
  return `<button class="li" data-act="toggle" data-k="${k}" role="switch" aria-checked="${on}">
      <span class="li-main"><b>${title}</b><small>${desc(st.info || {})}</small></span>
      <span class="switch ${on ? 'on' : ''}"><i></i></span>
    </button>`;
}

function pushRow() {
  const st = pushState();
  const demoTest = isDemo() && st === 'granted';
  const [text, act] = {
    granted: ['Включены', demoTest ? 'push-test' : ''],
    default: ['Выключены — нажмите, чтобы включить', 'push-enable'],
    denied: ['Запрещены в настройках телефона', ''],
    'needs-install': ['Добавьте приложение на экран «Домой»', ''],
    unsupported: ['Этот браузер не поддерживает', ''],
  }[st] || ['—', ''];
  return `<button class="li li-push" ${act ? `data-act="${act}"` : 'disabled'}>
      <span class="li-ic">${I.bell}</span>
      <span class="li-main"><b>Уведомления на этом телефоне</b><small>${text}${demoTest ? ' · нажмите для примера' : ''}</small></span>
      ${act ? I.chevR : ''}
    </button>`;
}

actions['push-test'] = () => {
  toast('Пример уведомления придёт через 3 секунды');
  setTimeout(() => demoNotification('r101', `2${NB}300${NB}000${NB}₸`), 3000);
};

// Профиль не зависит от настроек: имя, телефон и выход есть всегда. Пользователь — из GET /me
// (не ответил — из сессии). Настройки (501 — этап 2) и список организаций — по возможности.
views.profile = async () => {
  const [orgsR, stR, meR] = await Promise.allSettled([api.orgs(), api.settings(), api.me()]);
  const end = [orgsR, stR, meR].find((r) => r.status === 'rejected' && isSessionEnd(r.reason));
  if (end) throw end.reason; // сессия закрыта — на вход
  const orgsData = orgsR.status === 'fulfilled' ? orgsR.value : null;
  const st = stR.status === 'fulfilled' ? stR.value : null;
  const stLater = !st && isLater(stR.reason);
  const u = (meR.status === 'fulfilled' && meR.value) || (api.session() && api.session().user) || {};
  const cur = api.orgId();
  return {
    key: 'profile', tab: 'profile', depth: 1, nav: true, title: 'Профиль',
    html: `<div class="scroll">
      <div class="page-head"><h1 class="page-title">Профиль</h1>${demoBadge()}</div>
      <section class="card me-card">
        ${personAva(u.initials, 'ava-xl ava-ink')}
        <div><b>${H(u.name || '')}</b><span>${H(u.role || '')}</span><span class="muted">${H(u.phone || '')}</span></div>
      </section>

      ${orgsData ? `<div class="list-label">Организации</div>
      <section class="card list">
        ${(orgsData.items || []).map((o) => `<button class="li" data-act="switch-org" data-id="${H(o.id)}">
          ${ava(o)}
          <span class="li-main"><b>${H(o.name)}</b><small>${H([o.city, o.activity].filter(Boolean).join(' · '))}</small></span>
          ${o.id === cur ? `<span class="li-check">${I.check}</span>` : '<span class="li-radio"></span>'}
        </button>`).join('')}
      </section>` : ''}

      <div class="list-label">Уведомления</div>
      <section class="card list" data-settings="${st ? 'on' : stLater ? 'later' : 'error'}">
        ${pushRow()}
        ${st ? TOGGLES.map((t) => toggleRow(t, st)).join('') : ''}
        ${!st && !stLater ? `<div class="li li-note-row"><span class="li-main"><small>Настройки уведомлений не загрузились — откройте профиль позже</small></span></div>` : ''}
      </section>

      <div class="list-label">${isDemo() ? 'Демо' : 'Вход'}</div>
      <section class="card list">
        ${isDemo() ? `<button class="li" data-act="reset-demo">
          <span class="li-ic">${I.refresh}</span>
          <span class="li-main"><b>Сбросить демо</b><small>Вернуть заявки и уведомления в исходное состояние</small></span>
          ${I.chevR}
        </button>` : ''}
        <button class="li li-danger" data-act="logout">
          <span class="li-ic">${I.logout}</span>
          <span class="li-main"><b>${isDemo() ? 'Выйти из демо' : 'Выйти'}</b>${isDemo() ? '<small>Вернуться к настоящему входу</small>' : ''}</span>
        </button>
        <button class="li li-danger" data-act="logout-all">
          <span class="li-ic">${I.shield}</span>
          <span class="li-main"><b>Выйти со всех устройств</b><small>Закрыть вход на всех телефонах и компьютерах</small></span>
          ${I.chevR}
        </button>
      </section>

      <div class="about">
        ${logoMark(28)}
        <span>ФинПульс ${H(CONFIG.appVersion.split('.').slice(0, 2).join('.'))}${isDemo() ? ' · демо-версия<br>Все данные выдуманы' : '<br>Данные — из 1С в момент запроса'}</span>
        <span class="about-brand">SmartSol × FINTAX CONSULT</span>
      </div>
    </div>`,
  };
};

// Переключение организации в профиле. Список организаций, настройки и пользователь от выбранной организации не
// зависят — профиль с сервера не перечитываем (раньше каждое нажатие давало GET /orgs, /me и /me/settings),
// только переставляем отметку. Данные новой организации загрузятся, когда откроют её экраны.
actions['switch-org'] = (t) => {
  if (api.orgId() === t.dataset.id) return;
  api.setOrgId(t.dataset.id);
  invalidate();
  nav.badge = null;
  const list = t.closest('.list');
  (list ? [...list.querySelectorAll('[data-act="switch-org"]')] : []).forEach((b) => {
    const mark = b.querySelector('.li-check, .li-radio');
    if (mark) mark.outerHTML = b === t ? `<span class="li-check">${I.check}</span>` : '<span class="li-radio"></span>';
  });
  document.querySelector('.tabbar .tab-badge')?.remove(); // число заявок прежней организации
  toast('Организация переключена');
};

actions.toggle = async (t) => {
  const k = t.dataset.k;
  const on = t.getAttribute('aria-checked') !== 'true';
  const paint = (v) => {
    t.setAttribute('aria-checked', v);
    t.querySelector('.switch').classList.toggle('on', v);
  };
  paint(on);
  try {
    await api.saveSettings({ [k]: on });
  } catch (e) {
    paint(!on);
    actionError(e);
  }
};

actions['reset-demo'] = () => {
  openSheet(`<div class="sheet-title">Сбросить демо?</div>
    <p class="sheet-sub">Все заявки снова будут ждать решения, уведомления станут непрочитанными. Вход и организация сохранятся.</p>
    <div class="sheet-actions">
      <button class="btn btn-primary btn-block" data-act="reset-confirm">Сбросить</button>
      <button class="btn btn-text btn-block" data-act="sheet-close">Отмена</button>
    </div>`);
};

actions['reset-confirm'] = async () => {
  await api.resetDemo();
  invalidate();
  ui.leaving = null;
  ui.ddsSel = null;
  nav.badge = ((await api.requests(api.orgId(), 'pending')).items || []).length;
  await closeSheet();
  nav.rerender();
  toast('Демо сброшено');
};

actions.logout = async () => {
  const demo = isDemo();
  if (!demo) await disablePush();
  await api.logout();
  invalidate();
  ui.tg = null;
  nav.badge = null;
  if (demo) setMode('server');
  replace('#/login', 'fade');
};

actions['logout-all'] = () => {
  openSheet(`<div class="sheet-title">Выйти со всех устройств?</div>
    <p class="sheet-sub">Вход закроется на всех телефонах и компьютерах, уведомления на них перестанут приходить. Чтобы войти снова, понадобится код из Telegram.</p>
    <div class="sheet-actions">
      <button class="btn btn-danger btn-block" data-act="logout-all-confirm" data-label="Выйти везде">Выйти везде</button>
      <button class="btn btn-text btn-block" data-act="sheet-close">Отмена</button>
    </div>`);
};

actions['logout-all-confirm'] = async (t) => {
  if (ui.busy) return;
  const demo = isDemo();
  setBusy(t, 'Выходим…');
  try {
    await api.logoutAll();
  } catch (e) {
    setSheetIdle();
    await closeSheet();
    actionError(e);
    return;
  }
  ui.busy = false;
  await closeSheet();
  invalidate();
  ui.tg = null;
  nav.badge = null;
  if (demo) setMode('server');
  replace('#/login', 'fade');
  setTimeout(() => toast('Вы вышли на всех устройствах'), 60);
};

actions['sheet-close'] = () => {
  if (ui.busy) return; // решение отправляется — шторку не закрываем
  if (pdfUrl) {
    URL.revokeObjectURL(pdfUrl);
    pdfUrl = null;
  }
  closeSheet();
};
