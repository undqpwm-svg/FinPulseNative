// Экраны и действия. Данные — только через api.* (js/api/index.js): экран не знает, демо это или 1С.
// Каждый экран — async-функция: получает DTO (spec/api-client.md) и возвращает { key, html, … }.
import { api, isDemo, setMode, ApiError } from './api/index.js';
import { uuid } from './api/core.js';
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
  phone: '', otp: null, request: null, decision: null, busy: false, pushOffered: false, notifs: [],
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
  };
  const [title, text] = map[code] || ['Не удалось загрузить', 'Попробуйте обновить. Если не помогает — напишите в SmartSol.'];
  return { code, title, text };
}

const errorIcon = (code) => (code === 'network' || code === 'timeout' ? I.info : code === 'forbidden' ? I.shield : I.alert);

// Экран ошибки на месте экрана (с заголовком раздела и «Обновить»).
export function errorView(e, base = {}) {
  const t = errorText(e);
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
          <button class="btn btn-secondary" data-act="retry">${I.refresh}Обновить</button>
        </div>
      </div>`,
  };
}

actions.retry = () => {
  invalidate();
  nav.rerender();
};

// Сессия истекла или отозвана: стираем и — на вход.
export function onUnauthorized() {
  invalidate();
  ui.otp = null;
  nav.badge = null;
  replace('#/login', 'fade');
  setTimeout(() => toast('Сессия истекла — войдите снова', 'info'), 50);
}

// Общая обработка ошибок действий (не загрузки экрана).
function actionError(e) {
  if (e instanceof ApiError && e.code === 'unauthorized') return onUnauthorized();
  const t = errorText(e);
  toast(`${t.title}. ${t.text}`, 'error');
}

// ======================================================================
// ВХОД
// ======================================================================
function formatPhone(d) {
  d = d.slice(0, 10);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 8), d.slice(8, 10)].filter(Boolean).join(' ');
}

function minutesText(sec) {
  const m = Math.max(1, Math.ceil(sec / 60));
  return `${m} ${plural(m, ['минуту', 'минуты', 'минут'])}`;
}

function loginErrorText(e) {
  const c = e instanceof ApiError ? e.code : '';
  if (c === 'rate_limited' || c === 'too_many_attempts') return `Слишком много запросов кода. Повторите через ${minutesText(e.retryAfter || 600)}.`;
  if (c === 'invalid_phone') return 'Проверьте номер: 10 цифр после +7.';
  if (c === 'network' || c === 'timeout' || c === 'server_unavailable') return 'Нет связи с сервером. Проверьте интернет и повторите.';
  return 'Не удалось отправить код. Повторите через минуту.';
}

views.login = async () => {
  const ph = ui.phone;
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
      <form class="login-form" data-form="phone" novalidate>
        <label class="field-label" for="phone">Номер телефона</label>
        <div class="phone-field">
          <span class="phone-prefix">+7</span>
          <input id="phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="701 555 12 34" value="${H(formatPhone(ph))}" maxlength="13">
        </div>
        <div class="form-err" id="login-err" role="alert" hidden></div>
        <button class="btn btn-primary btn-block" type="submit" data-submit ${ph.length === 10 ? '' : 'disabled'}>Получить код</button>
        <p class="login-hint">${demo ? 'Демо: подойдёт любой номер и любой код' : `Код придёт в${NB}WhatsApp`}</p>
      </form>
      <div class="login-foot">SmartSol × FINTAX CONSULT</div>
    </div>`,
    mount(el) {
      const input = el.querySelector('#phone');
      const btn = el.querySelector('[data-submit]');
      const err = el.querySelector('#login-err');
      input.addEventListener('input', () => {
        let d = input.value.replace(/\D/g, '');
        if (d.length > 10 && (d[0] === '7' || d[0] === '8')) d = d.slice(1);
        ui.phone = d.slice(0, 10);
        input.value = formatPhone(ui.phone);
        btn.disabled = ui.phone.length !== 10;
        err.hidden = true;
      });
      el.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (ui.phone.length !== 10 || btn.classList.contains('loading')) return;
        input.blur();
        btn.classList.add('loading');
        btn.innerHTML = `${spinner}Отправляем код…`;
        try {
          const r = await api.requestCode(ui.phone);
          ui.otp = { ...r, digits10: ui.phone, sentAt: Date.now() };
          navigate('#/code');
        } catch (ex) {
          btn.classList.remove('loading');
          btn.textContent = 'Получить код';
          err.hidden = false;
          err.innerHTML = `${I.alert}<span>${loginErrorText(ex)}</span>`;
        }
      });
    },
  };
};

actions['mode-demo'] = () => {
  setMode('demo');
  invalidate();
  ui.otp = null;
  nav.route();
};

actions['mode-server'] = () => {
  setMode('server');
  invalidate();
  ui.otp = null;
  nav.route();
};

views.code = async () => {
  const otp = ui.otp;
  if (!otp) return { redirect: '#/login' };
  const len = otp.codeLength || 6;
  return {
    key: 'code', depth: 1, theme: 'dark', title: 'Код из WhatsApp',
    html: `<header class="topbar topbar-dark"><button class="tb-btn" data-back="#/login" aria-label="Назад">${I.chevL}</button><div class="tb-title"></div><div class="tb-right"></div></header>
    <div class="scroll login code-screen">
      <h1 class="login-title sm">Введите код из&nbsp;WhatsApp</h1>
      <p class="login-sub">Отправили на&nbsp;${H(otp.phoneMasked || '')}</p>
      <label class="code-boxes" for="code" style="--len:${len}">
        ${Array.from({ length: len }, (_, i) => `<span class="code-box" data-i="${i}"></span>`).join('')}
        <input id="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="${len}" aria-label="Код из WhatsApp">
      </label>
      <div class="form-err on-dark" id="code-err" role="alert" hidden></div>
      ${isDemo() ? `<div class="demo-chip">${I.info}<span>демо: любой код</span></div>` : ''}
      <p class="resend" data-resend></p>
    </div>`,
    mount(el) {
      const input = el.querySelector('#code');
      const boxes = [...el.querySelectorAll('.code-box')];
      const wrap = el.querySelector('.code-boxes');
      const err = el.querySelector('#code-err');
      const r = el.querySelector('[data-resend]');
      let locked = false;
      let timer = null;
      const paint = () => {
        const v = input.value;
        boxes.forEach((b, i) => {
          b.textContent = v[i] || '';
          b.classList.toggle('filled', !!v[i]);
          b.classList.toggle('active', i === Math.min(v.length, len - 1) && document.activeElement === input);
        });
      };
      const showErr = (html, { shake = true, clear = true } = {}) => {
        err.hidden = false;
        err.innerHTML = `${I.alert}<span>${html}</span>`;
        wrap.classList.remove('ok', 'checking');
        if (shake) {
          wrap.classList.remove('bad');
          void wrap.offsetWidth;
          wrap.classList.add('bad');
        }
        if (clear) input.value = '';
        paint();
      };
      const setResend = (sec) => {
        clearInterval(timer);
        let left = Math.max(0, Math.round(sec));
        const draw = () => {
          r.innerHTML = left > 0
            ? `Отправить ещё раз через <b>${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</b>`
            : '<button class="link-btn" data-act="resend">Отправить код ещё раз</button>';
        };
        draw();
        timer = setInterval(() => {
          if (!el.isConnected) return clearInterval(timer);
          left--;
          draw();
          if (left <= 0) clearInterval(timer);
        }, 1000);
      };
      const verify = async () => {
        locked = true;
        input.blur();
        wrap.classList.add('checking');
        try {
          await api.verifyCode({ requestId: otp.requestId, digits10: otp.digits10, code: input.value });
          wrap.classList.remove('checking');
          wrap.classList.add('ok');
          ui.otp = null;
          invalidate();
          syncPush();
          setTimeout(() => navigate('#/orgs', 'push'), 350);
        } catch (e) {
          const c = e instanceof ApiError ? e.code : '';
          if (c === 'code_invalid') {
            const left = e.details && e.details.attemptsLeft;
            showErr(`Неверный код${Number.isFinite(left) ? `. Осталось попыток: ${left}` : ''}`);
            locked = false;
            input.focus({ preventScroll: true });
          } else if (c === 'code_expired') {
            showErr('Код истёк — запросите новый', { shake: false });
            setResend(0);
          } else if (c === 'too_many_attempts' || c === 'rate_limited') {
            showErr(`Слишком много попыток. Запросите новый код${e.retryAfter ? ` через ${minutesText(e.retryAfter)}` : ''}`, { shake: false });
            input.disabled = true;
            setResend(e.retryAfter || 0);
          } else {
            const t = errorText(e);
            showErr(`${t.title}. <button class="link-btn" data-act="code-retry">Повторить</button>`, { shake: false, clear: false });
            ui.retryVerify = verify;
            locked = false;
          }
        }
      };
      input.addEventListener('input', () => {
        if (locked) return;
        input.value = input.value.replace(/\D/g, '').slice(0, len);
        err.hidden = true;
        wrap.classList.remove('bad');
        paint();
        if (input.value.length === len) verify();
      });
      input.addEventListener('focus', paint);
      input.addEventListener('blur', paint);
      setTimeout(() => input.focus({ preventScroll: true }), 350);
      setResend(Math.max(0, (otp.resendIn || 60) - (Date.now() - otp.sentAt) / 1000));
    },
  };
};

actions['code-retry'] = () => ui.retryVerify && ui.retryVerify();

actions.resend = async (t) => {
  if (!ui.otp) return replace('#/login');
  t.disabled = true;
  try {
    const r = await api.requestCode(ui.otp.digits10);
    ui.otp = { ...r, digits10: ui.otp.digits10, sentAt: Date.now() };
    toast('Код отправлен повторно');
    nav.rerender();
  } catch (e) {
    t.disabled = false;
    toast(loginErrorText(e), 'error');
  }
};

// ======================================================================
// ВЫБОР ОРГАНИЗАЦИИ
// ======================================================================
views.orgs = async () => {
  const inApp = !!api.orgId();
  const data = await api.orgs();
  const items = data.items || [];
  // У пользователя одна организация (настоящий вход) — выбирать нечего.
  if (!inApp && items.length === 1 && !isDemo()) {
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
        <div><span>Разрыв</span>${s.gap ? `<b class="neg">${wdAcc(D(s.gap.date)).replace(/^во? /, '')}</b>` : '<b class="pos">нет</b>'}</div>
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
      <div class="org-list">${cards || `<div class="empty"><span class="empty-ic">${I.building}</span><b>Нет доступных организаций</b><span>Попросите администратора 1С подключить ваш номер к мобильному приложению.</span></div>`}</div>
    </div>`,
  };
};

actions['pick-org'] = (t) => {
  const prev = api.orgId();
  api.setOrgId(t.dataset.id);
  invalidate();
  nav.badge = null;
  if (prev && prev !== t.dataset.id) toast('Организация переключена');
  navigate('#/home', 'fade');
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
  const u = d.user || (api.session() && api.session().user) || {};
  nav.badge = d.approvals.count;

  let alert;
  if (d.gap) {
    const gd = D(d.gap.date);
    const off = offset(d.gap.date, d.today);
    const when = off === 0 ? 'Сегодня' : cap(wdAcc(gd));
    const what = (d.gap.articles || []).map((a) => a.toLowerCase()).join(' и ');
    alert = `<button class="alert-card" data-go="#/calendar/${d.gap.date}">
      <span class="alert-ic">${I.alert}</span>
      <span class="alert-body">
        <b>${when} не хватит ${moneyShort(d.gap.deficit)}</b>
        <span>${cap(relDay(off))}, ${dayMonth(gd)}${what ? `: ${H(what)} на ${moneyShort(d.gap.outflow)}` : ''}</span>
        <span class="alert-cta">Открыть календарь ${I.arrowR}</span>
      </span>
    </button>`;
  } else {
    const m = d.minBalance;
    alert = `<button class="calm-card" data-go="#/calendar${m ? `/${m.date}` : ''}">
      <span class="calm-ic">${I.shield}</span>
      <span class="alert-body">
        <b>Разрывов нет на ${Math.round((d.horizonDays || 28) / 7)} недели</b>
        ${m ? `<span>Минимальный остаток — ${moneyShort(m.amount)}, ${dayMonth(D(m.date))}</span>` : ''}
      </span>
      ${I.chevR}
    </button>`;
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
    return `<button class="wk-col ${x.end < thr ? 'neg' : ''}" data-go="#/calendar/${x.date}" aria-label="${wdLong(dt)}, ${dayMonth(dt)}">
      <span class="wk-bars">
        <i class="b-in" style="height:${Math.max(x.in ? 6 : 0, (x.in / maxBar) * 100)}%"></i>
        <i class="b-out" style="height:${Math.max(x.out ? 6 : 0, (x.out / maxBar) * 100)}%"></i>
      </span>
      <span class="wk-d">${offset(x.date, d.today) === 0 ? 'Сег' : wdShort(dt)}</span>
    </button>`;
  }).join('');

  const rec = d.receivables;
  const overPct = rec.total ? Math.round((rec.overdue / rec.total) * 100) : 0;
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
        <div class="card-head"><h2>Ближайшие 7 дней</h2><button class="link-btn" data-go="#/calendar">Календарь ${I.chevR}</button></div>
        <div class="kpi-row">
          <div class="kpi"><span class="kpi-label"><i class="sw sw-in"></i>Поступления</span><b class="pos">${moneyShort(wIn, { sign: true })}</b></div>
          <div class="kpi"><span class="kpi-label"><i class="sw sw-out"></i>Платежи</span><b>${moneyShort(-wOut)}</b></div>
        </div>
        <div class="wk-chart">${bars}</div>
      </section>

      <button class="card rec-card" data-go="#/reports/debtors">
        <span class="card-head"><h2>Нам должны</h2><span class="link-btn">Должники ${I.chevR}</span></span>
        <span class="rec-sum">${moneyShort(rec.total)}</span>
        <span class="rec-bar"><i style="width:${overPct}%"></i></span>
        <span class="rec-legend">
          <span><i class="sw sw-neg"></i>Просрочено ${moneyShort(rec.overdue)} · ${overPct}%</span>
          <span><i class="sw sw-ok"></i>В срок ${moneyShort(rec.total - rec.overdue)}</span>
        </span>
        ${rec.worst ? `<span class="rec-worst">${I.clock}<span>Дольше всех: ${H(rec.worst.name)} — ${rec.worst.days} ${plural(rec.worst.days, DAY_FORMS)}</span></span>` : ''}
      </button>

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
  const cal = await cached(`cal:${org}`, 60e3, () => api.calendar(org));
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
  const label = { created: 'Заявка создана', approved: 'Согласовано', rejected: 'Отклонено', returned: 'Возвращено на доработку', pending: 'Ждёт решения' }[s.status] || s.status;
  const ic = { created: I.file, approved: I.check, rejected: I.x, returned: I.refresh, pending: I.clock }[s.status] || I.clock;
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
    const after = b.used + r.amount;
    const over = after - b.limit;
    const scale = Math.max(b.limit, after);
    const pct = (v) => ((v / scale) * 100).toFixed(2);
    budget = `<section class="card budget ${over > 0 ? 'is-over' : ''}">
        <div class="card-head"><h2>Бюджет статьи</h2><span class="muted">${H(r.article)}${b.period ? ` · ${H(b.period)}` : ''}</span></div>
        <div class="bud-bar">
          <div class="bud-track">
            <i class="bud-used" style="width:${pct(b.used)}%"></i>
            <i class="bud-req" style="left:${pct(b.used)}%;width:${pct(r.amount)}%"></i>
          </div>
          <span class="bud-limit" style="left:${pct(b.limit)}%"><small>лимит</small></span>
        </div>
        <div class="bud-legend">
          <span><i class="sw sw-ink"></i>Израсходовано<b>${money(b.used)}</b></span>
          <span><i class="sw ${over > 0 ? 'sw-coral' : 'sw-lav'}"></i>Эта заявка<b>${money(r.amount)}</b></span>
          <span><i class="sw sw-limit"></i>Лимит<b>${money(b.limit)}</b></span>
        </div>
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
    <div class="scroll has-topbar ${r.canDecide ? 'has-actionbar' : ''}">
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
    ${r.canDecide ? `<div class="actionbar">
      <button class="btn btn-ghost" data-act="reject">Отклонить</button>
      <button class="btn btn-primary" data-act="approve">${I.check}Согласовать</button>
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
  const over = r.budget ? Math.max(0, r.budget.used + r.amount - r.budget.limit) : 0;
  ui.decision = null;
  openSheet(`<div class="sheet-title">Согласовать оплату?</div>
    <div class="confirm-sum">${money(r.amount)}</div>
    <p class="confirm-sub">${H(r.contractor)} · до ${dayMonth(D(r.due))}</p>
    ${over ? `<div class="over-note compact">${I.alert}<div><b>Сверх лимита на ${money(over)}</b><span>Статья «${H(r.article)}»</span></div></div>` : ''}
    <div class="sheet-actions">
      <button class="btn btn-primary btn-block" data-act="approve-confirm">Да, согласовать</button>
      <button class="btn btn-text btn-block" data-act="sheet-close">Отмена</button>
    </div>`);
};

actions['approve-confirm'] = (t) => submitDecision('approve', '', t);

const REASONS = ['Нет денег в бюджете', 'Перенесём на следующий месяц', 'Нужен другой поставщик', 'Уточните сумму'];

actions.reject = () => {
  const r = ui.request;
  if (!r) return;
  ui.decision = null;
  const first = (r.initiator.name || '').split(' ')[0] || 'инициатор';
  openSheet(`<div class="sheet-title">Отклонить заявку</div>
    <p class="sheet-sub">Напишите причину — её увидит ${H(first)}. Без комментария отклонить нельзя.</p>
    <div class="chips">${REASONS.map((c) => `<button class="chip" data-act="reason" data-v="${c}">${c}</button>`).join('')}</div>
    <textarea class="textarea" id="reject-text" rows="3" maxlength="300" placeholder="Причина отказа"></textarea>
    <div class="field-err" id="reject-err" hidden>${I.alert}<span>Напишите причину отказа</span></div>
    <div class="sheet-actions">
      <button class="btn btn-danger btn-block" data-act="reject-confirm">Отклонить заявку</button>
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
};

actions.reason = (t) => {
  const ta = document.getElementById('reject-text');
  ta.value = t.dataset.v;
  ta.dispatchEvent(new Event('input'));
};

actions['reject-confirm'] = (t) => {
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
  submitDecision('reject', text, t);
};

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
    if (e instanceof ApiError && e.code === 'unauthorized') {
      await closeSheet(true);
      onUnauthorized();
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
    btn.textContent = 'Отклонить заявку';
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

function pfRow(x, income = false) {
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
  const overs = (rep.expense || []).filter((x) => x.fact > x.plan);
  return `${overs.length ? `<div class="over-note">${I.alert}<div><b>${overs.length} ${plural(overs.length, ['статья', 'статьи', 'статей'])} сверх плана</b><span>${overs.map((x) => `${H(x.article)} +${Math.round((x.fact / x.plan - 1) * 100)}%`).join(', ')}</span></div></div>` : ''}
    ${(rep.income || []).length ? `<section class="card"><div class="card-head"><h2>Поступления</h2></div>${rep.income.map((x) => pfRow(x, true)).join('')}</section>` : ''}
    <section class="card">
      <div class="card-head"><h2>Выплаты по статьям</h2><span class="muted">факт / план</span></div>
      ${(rep.expense || []).map((x) => pfRow(x)).join('')}
    </section>`;
}

function debtorsReport(rep) {
  const list = rep.top || [];
  const max = list.length ? list[0].amount : 1;
  const overPct = rep.total ? Math.round((rep.overdue / rep.total) * 100) : 0;
  return `<section class="card">
      <div class="card-head"><h2>Дебиторка на ${dayMonth(D(rep.asOf))}</h2></div>
      <div class="rec-sum">${moneyShort(rep.total)}</div>
      <div class="rec-bar"><i style="width:${overPct}%"></i></div>
      <div class="rec-legend">
        <span><i class="sw sw-neg"></i>Просрочено ${moneyShort(rep.overdue)} · ${overPct}%</span>
        <span><i class="sw sw-ok"></i>В срок ${moneyShort(rep.total - rep.overdue)}</span>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Топ-5 должников</h2></div>
      <ol class="debt-list">
        ${list.map((d, i) => `<li class="debt">
          <span class="debt-rank">${i + 1}</span>
          <div class="debt-main">
            <div class="debt-top"><b>${H(d.name)}</b><b class="debt-sum">${money(d.amount)}</b></div>
            <div class="debt-bar"><i style="width:${(d.amount / max) * 100}%"></i>${d.overdue ? `<i class="od" style="width:${(d.overdue / max) * 100}%"></i>` : ''}</div>
            <div class="debt-sub">${d.overdue ? `<span class="tag tag-neg">просрочка ${d.days} ${plural(d.days, DAY_FORMS)}</span><span class="neg">${money(d.overdue)}</span>` : '<span class="tag tag-pos">в срок</span>'}</div>
          </div>
        </li>`).join('')}
      </ol>
      ${rep.rest > 0 ? `<div class="debt-rest"><span>Остальные покупатели</span><b>${money(rep.rest)}</b></div>` : ''}
    </section>`;
}

views.reports = async (params) => {
  const org = api.orgId();
  const tab = ['dds', 'plan', 'debtors'].includes(params[0]) ? params[0] : 'dds';
  const rep = await cached(`rep:${org}:${tab}`, 60e3, () => api.report(org, tab));
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
    ['Просрочка', `покупатели должны ${moneyShort(s.overdue)}`],
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
const TOGGLES = [
  ['summary', 'Утренняя сводка', 'Каждый день в 08:30'],
  ['requests', 'Новые заявки', 'Как только заявка дошла до вас'],
  ['payments', 'Поступления', 'Оплаты от 500 000 ₸'],
  ['gaps', 'Кассовые разрывы', 'За 3 дня до разрыва'],
  ['whatsapp', 'Дублировать в WhatsApp', 'Сводка и разрывы — в чат'],
];

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

views.profile = async () => {
  const [orgsData, toggles] = await Promise.all([api.orgs(), api.settings()]);
  const u = (api.session() && api.session().user) || (await api.me()) || {};
  const cur = api.orgId();
  return {
    key: 'profile', tab: 'profile', depth: 1, nav: true, title: 'Профиль',
    html: `<div class="scroll">
      <div class="page-head"><h1 class="page-title">Профиль</h1>${demoBadge()}</div>
      <section class="card me-card">
        ${personAva(u.initials, 'ava-xl ava-ink')}
        <div><b>${H(u.name || '')}</b><span>${H(u.role || '')}</span><span class="muted">${H(u.phone || '')}</span></div>
      </section>

      <div class="list-label">Организации</div>
      <section class="card list">
        ${(orgsData.items || []).map((o) => `<button class="li" data-act="switch-org" data-id="${H(o.id)}">
          ${ava(o)}
          <span class="li-main"><b>${H(o.name)}</b><small>${H([o.city, o.activity].filter(Boolean).join(' · '))}</small></span>
          ${o.id === cur ? `<span class="li-check">${I.check}</span>` : '<span class="li-radio"></span>'}
        </button>`).join('')}
      </section>

      <div class="list-label">Уведомления</div>
      <section class="card list">
        ${pushRow()}
        ${TOGGLES.map(([k, t, d]) => `<button class="li" data-act="toggle" data-k="${k}" role="switch" aria-checked="${!!toggles[k]}">
          <span class="li-main"><b>${t}</b><small>${d}</small></span>
          <span class="switch ${toggles[k] ? 'on' : ''}"><i></i></span>
        </button>`).join('')}
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
      </section>

      <div class="about">
        ${logoMark(28)}
        <span>ФинПульс 1.0${isDemo() ? ' · демо-версия<br>Все данные выдуманы' : '<br>Данные — из 1С в момент запроса'}</span>
        <span class="about-brand">SmartSol × FINTAX CONSULT</span>
      </div>
    </div>`,
  };
};

actions['switch-org'] = (t) => {
  if (api.orgId() === t.dataset.id) return;
  api.setOrgId(t.dataset.id);
  invalidate();
  nav.badge = null;
  nav.rerender();
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
  ui.phone = '';
  ui.otp = null;
  nav.badge = null;
  if (demo) setMode('server');
  replace('#/login', 'fade');
};

actions['sheet-close'] = () => {
  if (ui.busy) return; // решение отправляется — шторку не закрываем
  if (pdfUrl) {
    URL.revokeObjectURL(pdfUrl);
    pdfUrl = null;
  }
  closeSheet();
};
