// Экраны приложения и обработчики действий
import * as S from './store.js';
import { I, logoMark } from './icons.js';
import { navigate, replace, openSheet, closeSheet, toast, success, nav } from './ui.js';
import {
  esc, cap, money, moneyShort, digits, mln, plural, iso, parseISO, diffDays, addDays,
  dayMonth, dayMonthShort, monthTitle, wdLong, wdShort, wdAcc, WD_HEAD, relDay, stamp, greeting, sum, NB,
} from './util.js';

export const views = {};
export const actions = {};

const H = esc;
const REQ_FORMS = ['заявка', 'заявки', 'заявок'];

// ---------- общие куски ----------
const ava = (o, cls = '') => `<span class="ava ${cls}" style="--ava:${o.color}">${H(o.initials)}</span>`;
const personAva = (initials, cls = '') => `<span class="ava ava-person ${cls}">${H(initials)}</span>`;

function topbar(title, fallback, right = '') {
  return `<header class="topbar">
    <button class="tb-btn" data-back="${fallback}" aria-label="Назад">${I.chevL}</button>
    <div class="tb-title">${title}</div>
    <div class="tb-right">${right}</div>
  </header>`;
}

function bigMoney(n, cls = '') {
  return `<span class="big-money ${cls}"><span class="bm-num">${digits(n)}</span><span class="bm-cur">₸</span></span>`;
}

function segmented(items, current, act) {
  const idx = Math.max(0, items.findIndex((i) => i.v === current));
  return `<div class="seg" style="--n:${items.length};--i:${idx}" role="tablist">
    <span class="seg-thumb" aria-hidden="true"></span>
    ${items.map((i) => `<button class="seg-btn ${i.v === current ? 'on' : ''}" role="tab" aria-selected="${i.v === current}" ${act(i.v)}>${i.label}</button>`).join('')}
  </div>`;
}

// Две крупнейшие статьи платежей дня: «зарплата и лизинг»
function topArticles(outs) {
  const m = new Map();
  outs.forEach((o) => m.set(o.article, (m.get(o.article) || 0) + o.amount));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([a]) => a.toLowerCase()).join(' и ');
}

function linkToHash(link) {
  if (!link) return null;
  const [kind, val] = link.split(':');
  if (kind === 'calendar') return `#/calendar/${iso(S.dateAt(Number(val)))}`;
  if (kind === 'request') return `#/requests/${val}`;
  if (kind === 'reports') return `#/reports/${val}`;
  if (kind === 'requests') return '#/requests';
  return null;
}

// ======================================================================
// ВХОД
// ======================================================================
function formatPhone(digitsStr) {
  const d = digitsStr.slice(0, 10);
  const parts = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 8), d.slice(8, 10)].filter(Boolean);
  return parts.join(' ');
}

views.login = () => {
  const ph = S.ui.pendingPhone;
  return {
    key: 'login', depth: 0, theme: 'dark', title: 'Вход',
    html: `<div class="scroll login">
      <div class="login-brand">${logoMark(44)}<span class="wordmark">ФинПульс</span></div>
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
        <button class="btn btn-primary btn-block" type="submit" data-submit ${ph.length === 10 ? '' : 'disabled'}>Получить код</button>
        <p class="login-hint">Демо: подойдёт любой номер</p>
      </form>
      <div class="login-foot">SmartSol × FINTAX CONSULT</div>
    </div>`,
    mount(el) {
      const input = el.querySelector('#phone');
      const btn = el.querySelector('[data-submit]');
      input.addEventListener('input', () => {
        let d = input.value.replace(/\D/g, '');
        if (d.length > 10 && (d[0] === '7' || d[0] === '8')) d = d.slice(1);
        d = d.slice(0, 10);
        S.ui.pendingPhone = d;
        input.value = formatPhone(d);
        btn.disabled = d.length !== 10;
      });
      el.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        if (S.ui.pendingPhone.length !== 10) return;
        input.blur();
        navigate('#/code');
      });
    },
  };
};

views.code = () => {
  const ph = S.ui.pendingPhone ? `+7 ${formatPhone(S.ui.pendingPhone)}` : S.data.user.phone;
  return {
    key: 'code', depth: 1, theme: 'dark', title: 'Код из SMS',
    html: `<header class="topbar topbar-dark"><button class="tb-btn" data-back="#/login" aria-label="Назад">${I.chevL}</button><div class="tb-title"></div><div class="tb-right"></div></header>
    <div class="scroll login code-screen">
      <h1 class="login-title sm">Введите код из&nbsp;SMS</h1>
      <p class="login-sub">Отправили на&nbsp;${H(ph)}</p>
      <label class="code-boxes" for="code">
        ${[0, 1, 2, 3].map((i) => `<span class="code-box" data-i="${i}"></span>`).join('')}
        <input id="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="4" aria-label="Код из SMS">
      </label>
      <div class="demo-chip">${I.info}<span>демо: любой код</span></div>
      <p class="resend" data-resend>Отправить ещё раз через <b>0:59</b></p>
    </div>`,
    mount(el) {
      const input = el.querySelector('#code');
      const boxes = [...el.querySelectorAll('.code-box')];
      const paint = () => {
        const v = input.value;
        boxes.forEach((b, i) => {
          b.textContent = v[i] || '';
          b.classList.toggle('filled', !!v[i]);
          b.classList.toggle('active', i === Math.min(v.length, 3) && document.activeElement === input);
        });
      };
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/g, '').slice(0, 4);
        paint();
        if (input.value.length === 4) {
          input.blur();
          el.querySelector('.code-boxes').classList.add('ok');
          setTimeout(() => {
            S.login(S.ui.pendingPhone ? `+7 ${formatPhone(S.ui.pendingPhone)}` : S.data.user.phone);
            navigate('#/orgs', 'push');
          }, 450);
        }
      });
      input.addEventListener('focus', paint);
      input.addEventListener('blur', paint);
      setTimeout(() => input.focus({ preventScroll: true }), 350);
      // таймер повторной отправки
      let left = 59;
      const r = el.querySelector('[data-resend]');
      const timer = setInterval(() => {
        if (!el.isConnected) return clearInterval(timer);
        left--;
        if (left <= 0) {
          clearInterval(timer);
          r.innerHTML = '<button class="link-btn" data-act="resend">Отправить код ещё раз</button>';
        } else r.innerHTML = `Отправить ещё раз через <b>0:${String(left).padStart(2, '0')}</b>`;
      }, 1000);
    },
  };
};

actions.resend = () => toast('Код отправлен повторно');

// ======================================================================
// ВЫБОР ОРГАНИЗАЦИИ
// ======================================================================
function orgSummary(o) {
  const ds = S.days(o);
  const g = S.gap(o, ds);
  return { total: S.opening(o).total, pend: S.pending(o).length, g };
}

views.orgs = () => {
  const inApp = !!S.state.orgId;
  const cards = S.data.orgs.map((o) => {
    const s = orgSummary(o);
    const active = inApp && o.id === S.state.orgId;
    return `<button class="org-card ${active ? 'active' : ''}" data-act="pick-org" data-id="${o.id}">
      <div class="oc-head">
        ${ava(o, 'ava-lg')}
        <div class="oc-name"><b>${H(o.name)}</b><span>${H(o.city)} · ${H(o.activity)}</span></div>
        <span class="oc-go">${active ? I.check : I.chevR}</span>
      </div>
      <div class="oc-stats">
        <div><span>Деньги</span><b>${moneyShort(s.total)}</b></div>
        <div><span>Заявки</span><b>${s.pend}</b></div>
        <div><span>Разрыв</span>${s.g ? `<b class="neg">${wdAcc(s.g.day.date).replace(/^во? /, '')}</b>` : '<b class="pos">нет</b>'}</div>
      </div>
    </button>`;
  }).join('');
  return {
    key: 'orgs', depth: inApp ? 2 : 2, title: 'Организации',
    html: `${inApp ? topbar('', '#/home') : ''}
    <div class="scroll ${inApp ? 'has-topbar' : ''}">
      ${inApp ? '' : `<div class="orgs-brand">${logoMark(36)}<span class="wordmark dark">ФинПульс</span></div>`}
      <h1 class="page-title">${inApp ? 'Организации' : 'Выберите организацию'}</h1>
      <p class="page-sub">Данные по каждой компании приходят из её базы 1С. Переключиться можно в любой момент.</p>
      <div class="org-list">${cards}</div>
    </div>`,
  };
};

actions['pick-org'] = (t) => {
  const id = t.dataset.id;
  const prev = S.state.orgId;
  S.setOrg(id);
  if (prev && prev !== id) toast(`Переключились на ${H(S.org(id).name)}`);
  navigate('#/home', 'fade');
};

// ======================================================================
// ГЛАВНАЯ
// ======================================================================
function spark(ds) {
  const vals = [ds[0].start, ...ds.map((d) => d.end)];
  const W = 300;
  const Hh = 64;
  const pad = 6;
  const max = Math.max(...vals);
  const min = Math.min(...vals, 0);
  const x = (i) => (i * W) / (vals.length - 1);
  const y = (v) => pad + ((max - v) / (max - min || 1)) * (Hh - 2 * pad);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${pts.join('L')}`;
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

views.home = () => {
  const o = S.org();
  const u = S.data.user;
  const op = S.opening(o);
  const ds = S.days(o);
  const g = S.gap(o, ds);
  const pend = S.pending(o);
  const unread = S.unreadCount(o);
  const week = ds.slice(0, 7);
  const wIn = sum(week, (d) => d.sumIn);
  const wOut = sum(week, (d) => d.sumOut);
  const maxBar = Math.max(...week.map((d) => Math.max(d.sumIn, d.sumOut)), 1);
  const today = S.today();

  // предупреждение о разрыве или «всё спокойно»
  let alert;
  if (g) {
    const d = g.day;
    const when = d.d === 0 ? 'Сегодня' : cap(wdAcc(d.date));
    alert = `<button class="alert-card" data-go="#/calendar/${iso(d.date)}">
      <span class="alert-ic">${I.alert}</span>
      <span class="alert-body">
        <b>${when} не хватит ${moneyShort(g.deficit)}</b>
        <span>${cap(relDay(d.d))}, ${dayMonth(d.date)}: ${topArticles(d.outs)} на ${moneyShort(d.sumOut)}</span>
        <span class="alert-cta">Открыть календарь ${I.arrowR}</span>
      </span>
    </button>`;
  } else {
    const m = S.minDay(ds);
    alert = `<button class="calm-card" data-go="#/calendar/${iso(m.date)}">
      <span class="calm-ic">${I.shield}</span>
      <span class="alert-body">
        <b>Разрывов нет на ${S.horizon() / 7} недели</b>
        <span>Минимальный остаток — ${moneyShort(m.end)}, ${dayMonth(m.date)}</span>
      </span>
      ${I.chevR}
    </button>`;
  }

  // плашка согласования
  const pendSum = sum(pend, (r) => r.amount);
  const overCnt = pend.filter((r) => S.overLimit(r) > 0).length;
  const appr = pend.length
    ? `<button class="appr-card" data-go="#/requests">
        <span class="appr-count">${pend.length}</span>
        <span class="appr-body"><b>На согласовании: ${pend.length}</b>
        <span>${pend.length} ${plural(pend.length, REQ_FORMS)} на ${moneyShort(pendSum)}${overCnt ? ` · ${overCnt} сверх лимита` : ''}</span></span>
        <span class="appr-go">${I.chevR}</span>
      </button>`
    : `<button class="appr-card is-empty" data-go="#/requests">
        <span class="appr-count ok">${I.check}</span>
        <span class="appr-body"><b>Всё согласовано</b><span>Новых заявок пока нет</span></span>
        <span class="appr-go">${I.chevR}</span>
      </button>`;

  const bars = week.map((d) => {
    const neg = d.end < 0;
    return `<button class="wk-col ${neg ? 'neg' : ''}" data-go="#/calendar/${iso(d.date)}" aria-label="${wdLong(d.date)}, ${dayMonth(d.date)}">
      <span class="wk-bars">
        <i class="b-in" style="height:${Math.max(d.sumIn ? 6 : 0, (d.sumIn / maxBar) * 100)}%"></i>
        <i class="b-out" style="height:${Math.max(d.sumOut ? 6 : 0, (d.sumOut / maxBar) * 100)}%"></i>
      </span>
      <span class="wk-d">${d.d === 0 ? 'Сег' : wdShort(d.date)}</span>
    </button>`;
  }).join('');

  const rec = o.receivables;
  const overPct = Math.round((rec.overdue / rec.total) * 100);
  const worst = [...o.debtors].sort((a, b) => b.days - a.days)[0];

  return {
    key: 'home', tab: 'home', depth: 1, nav: true, title: 'Главная',
    html: `<div class="scroll">
      <div class="home-top">
        <button class="org-pill" data-go="#/orgs">${ava(o)}<span class="org-pill-name">${H(o.short)}</span>${I.chevD}</button>
        <button class="icon-btn" data-go="#/notifications" aria-label="Уведомления${unread ? `, новых: ${unread}` : ''}">${I.bell}${unread ? `<span class="icon-badge">${unread}</span>` : ''}</button>
      </div>
      <div class="greet">
        <h1>${greeting()}, ${H(u.firstName)}</h1>
        <p>${cap(wdLong(today))}, ${dayMonth(today)}</p>
      </div>

      <button class="hero" data-act="accounts">
        <span class="hero-row"><span class="hero-label">Деньги на сегодня</span><span class="hero-more">Счета ${I.chevR}</span></span>
        ${bigMoney(op.total, 'on-dark')}
        <span class="hero-split">
          <span><i class="dot" style="background:var(--lav)"></i><small>Банк</small><b>${money(op.bank)}</b></span>
          <span><i class="dot" style="background:var(--mint)"></i><small>Касса</small><b>${money(op.cash)}</b></span>
        </span>
        <span class="hero-spark">
          ${spark(ds.slice(0, 14))}
          <span class="spark-cap"><span>Прогноз остатка на 2 недели</span><span>до ${dayMonthShort(ds[13].date)}</span></span>
        </span>
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
        ${worst && worst.days ? `<span class="rec-worst">${I.clock}<span>Дольше всех: ${H(worst.name)} — ${worst.days} ${plural(worst.days, ['день', 'дня', 'дней'])}</span></span>` : ''}
      </button>

      <p class="foot-note">${I.refresh}<span>Обновлено из 1С сегодня в ${H(S.data.updatedAt || '08:30')}</span></p>
    </div>`,
  };
};

actions.accounts = () => {
  const o = S.org();
  const op = S.opening(o);
  openSheet(`<div class="sheet-title">Деньги на сегодня</div>
    <div class="sheet-sub">${H(o.name)}</div>
    <div class="acc-list">
      ${o.accounts.map((a) => `<div class="acc-row">
        <span class="acc-ic ${a.type}">${a.type === 'cash' ? I.cash : I.bank}</span>
        <span class="acc-name"><b>${H(a.name)}</b><small>${H(a.note)}</small></span>
        <b class="acc-sum">${money(a.amount)}</b>
      </div>`).join('')}
    </div>
    <div class="acc-total"><span>Итого</span><b>${money(op.total)}</b></div>
    <button class="btn btn-secondary btn-block" data-act="sheet-close">Понятно</button>`);
};

// ======================================================================
// ПЛАТЁЖНЫЙ КАЛЕНДАРЬ
// ======================================================================
function flowRow(f) {
  const isIn = f.type === 'in';
  return `<div class="flow">
    <span class="flow-ic ${isIn ? 'in' : 'out'}">${isIn ? I.arrowIn : I.arrowOut}</span>
    <span class="flow-main"><b>${H(f.who)}</b><small>${H(f.article)}${f.note ? ` · ${H(f.note)}` : ''}</small>
      ${f.req ? '<span class="tag tag-lav">по заявке</span>' : ''}</span>
    <span class="flow-sum ${isIn ? 'pos' : ''}">${money(isIn ? f.amount : -f.amount, { sign: true })}</span>
  </div>`;
}

function dayDetail(day, ds) {
  const neg = day.end < 0;
  let hint = '';
  if (neg) {
    const next = ds.slice(day.d + 1).find((x) => x.sumIn > 0);
    hint = `<div class="gap-hint">
      <span class="gap-hint-ic">${I.alert}</span>
      <div><b>Не хватает ${money(-day.end)}</b>
      <span>${next ? `${cap(wdAcc(next.date))} ждём ${moneyShort(next.sumIn)} от покупателей — часть платежей можно перенести на этот день.` : 'Перенесите часть платежей или ускорьте поступления.'}</span></div>
    </div>`;
  }
  const empty = !day.ins.length && !day.outs.length;
  return `<section class="card day-card ${neg ? 'is-neg' : ''}">
    <div class="day-head">
      <div><h2>${cap(wdLong(day.date))}, ${dayMonth(day.date)}</h2>
      <span class="muted">${cap(relDay(day.d))}</span></div>
    </div>
    <div class="bal-line"><span>Остаток на начало дня</span><b>${money(day.start)}</b></div>
    ${empty ? `<div class="empty-mini">${I.calendar}<span>Платежей и поступлений нет</span></div>` : ''}
    ${day.ins.length ? `<div class="flow-group"><div class="fg-head"><span>Поступления</span><b class="pos">${money(day.sumIn, { sign: true })}</b></div>${day.ins.map(flowRow).join('')}</div>` : ''}
    ${day.outs.length ? `<div class="flow-group"><div class="fg-head"><span>Платежи</span><b>${money(-day.sumOut)}</b></div>${day.outs.map(flowRow).join('')}</div>` : ''}
    <div class="bal-line bal-end ${neg ? 'neg' : ''}"><span>Остаток на конец дня</span><b>${money(day.end)}</b></div>
    ${hint}
  </section>`;
}

views.calendar = (params) => {
  const o = S.org();
  const ds = S.days(o);
  const Hn = ds.length;
  const today = S.today();
  let sel = 0;
  if (params[0] && /^\d{4}-\d{2}-\d{2}$/.test(params[0])) sel = diffDays(parseISO(params[0]), today);
  if (!(sel >= 0 && sel < Hn)) sel = 0;
  const day = ds[sel];
  const mode = S.ui.calMode;
  const g = S.gap(o, ds);

  let picker;
  if (mode === 'week') {
    const page = Math.floor(sel / 7);
    const pages = Math.ceil(Hn / 7);
    const from = ds[page * 7];
    const to = ds[Math.min(page * 7 + 6, Hn - 1)];
    const rows = ds.slice(page * 7, page * 7 + 7).map((d) => {
      const neg = d.end < 0;
      return `<button class="wk-row ${d.d === sel ? 'on' : ''} ${neg ? 'neg' : ''}" data-go="#/calendar/${iso(d.date)}" data-dir="same">
        <span class="wr-date"><b>${d.date.getDate()}</b><small>${d.d === 0 ? 'сег' : wdShort(d.date).toLowerCase()}</small></span>
        <span class="wr-flows">${d.sumIn ? `<span class="pos">${moneyShort(d.sumIn, { sign: true })}</span>` : ''}${d.sumOut ? `<span>${moneyShort(-d.sumOut)}</span>` : ''}${!d.sumIn && !d.sumOut ? '<span class="muted">нет движений</span>' : ''}</span>
        <span class="wr-bal"><b class="${d.start < 0 ? 'neg' : ''}">${moneyShort(d.start)}</b>${neg ? `<small class="neg">к вечеру ${moneyShort(d.end)}</small>` : ''}</span>
      </button>`;
    }).join('');
    picker = `<div class="period-nav">
        <button class="pn-btn" ${page > 0 ? `data-go="#/calendar/${iso(ds[(page - 1) * 7].date)}" data-dir="same"` : 'disabled'} aria-label="Предыдущая неделя">${I.chevL}</button>
        <span class="pn-title">${from.date.getMonth() !== to.date.getMonth() ? dayMonth(from.date) : from.date.getDate()} — ${dayMonth(to.date)}</span>
        <button class="pn-btn" ${page < pages - 1 ? `data-go="#/calendar/${iso(ds[(page + 1) * 7].date)}" data-dir="same"` : 'disabled'} aria-label="Следующая неделя">${I.chevR}</button>
      </div>
      <div class="card wk-table">
        <div class="wt-head"><span>День</span><span>Движение</span><span>На начало дня</span></div>
        ${rows}
      </div>`;
  } else {
    const sd = day.date;
    const mStart = new Date(sd.getFullYear(), sd.getMonth(), 1);
    const mEnd = new Date(sd.getFullYear(), sd.getMonth() + 1, 0);
    const lead = (mStart.getDay() + 6) % 7;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<span class="mc mc-blank"></span>');
    for (let dnum = 1; dnum <= mEnd.getDate(); dnum++) {
      const dt = new Date(sd.getFullYear(), sd.getMonth(), dnum);
      const off = diffDays(dt, today);
      if (off >= 0 && off < Hn) {
        const d = ds[off];
        const neg = d.end < 0;
        cells.push(`<button class="mc ${off === sel ? 'on' : ''} ${neg ? 'neg' : ''} ${off === 0 ? 'today' : ''}" data-go="#/calendar/${iso(dt)}" data-dir="same">
          <span class="mc-num">${dnum}</span><span class="mc-bal">${mln(d.start)}</span>
        </button>`);
      } else {
        cells.push(`<span class="mc mc-off ${off < 0 ? 'past' : ''}"><span class="mc-num">${dnum}</span></span>`);
      }
    }
    const prevM = new Date(sd.getFullYear(), sd.getMonth() - 1, 1);
    const nextM = new Date(sd.getFullYear(), sd.getMonth() + 1, 1);
    const prevOk = diffDays(new Date(sd.getFullYear(), sd.getMonth(), 0), today) >= 0;
    const nextOk = diffDays(nextM, today) < Hn;
    const prevTarget = prevOk ? (diffDays(prevM, today) > 0 ? prevM : today) : null;
    picker = `<div class="period-nav">
        <button class="pn-btn" ${prevTarget ? `data-go="#/calendar/${iso(prevTarget)}" data-dir="same"` : 'disabled'} aria-label="Предыдущий месяц">${I.chevL}</button>
        <span class="pn-title">${monthTitle(sd)}</span>
        <button class="pn-btn" ${nextOk ? `data-go="#/calendar/${iso(nextM)}" data-dir="same"` : 'disabled'} aria-label="Следующий месяц">${I.chevR}</button>
      </div>
      <div class="card month">
        <div class="month-head">${WD_HEAD.map((w, i) => `<span class="${i > 4 ? 'we' : ''}">${w}</span>`).join('')}</div>
        <div class="month-grid">${cells.join('')}</div>
        <div class="month-legend"><span>Остаток на начало дня, млн ₸</span><span><i class="sw sw-neg"></i>не хватает денег</span></div>
      </div>`;
  }

  return {
    key: 'calendar', tab: 'calendar', depth: 1, nav: true, title: 'Календарь',
    html: `<div class="scroll">
      <div class="page-head">
        <h1 class="page-title">Календарь</h1>
        ${segmented([{ v: 'week', label: 'Неделя' }, { v: 'month', label: 'Месяц' }], mode, (v) => `data-act="cal-mode" data-v="${v}"`)}
      </div>
      ${g ? `<button class="gap-strip" data-go="#/calendar/${iso(g.day.date)}" data-dir="same">${I.alert}<span>${cap(wdAcc(g.day.date))}, ${dayMonth(g.day.date)}, не хватит <b>${moneyShort(g.deficit)}</b></span>${I.chevR}</button>` : ''}
      ${picker}
      ${dayDetail(day, ds)}
    </div>`,
  };
};

actions['cal-mode'] = (t) => {
  if (S.ui.calMode === t.dataset.v) return;
  S.ui.calMode = t.dataset.v;
  nav.rerender();
};

// ======================================================================
// ЗАЯВКИ
// ======================================================================
function dueLabel(r) {
  const dt = S.dateAt(r.due);
  if (r.due < 0) return `срок был ${dayMonth(dt)}`;
  return `до ${dayMonth(dt)} · ${relDay(r.due)}`;
}

function reqCard(r, leaving = false) {
  const over = S.overLimit(r) > 0;
  const urgent = r.due <= 2 && r.status === 'pending';
  const statusTag = r.status === 'approved'
    ? '<span class="tag tag-pos">Согласована</span>'
    : r.status === 'rejected' ? '<span class="tag tag-neg">Отклонена</span>' : '';
  return `<div class="req-wrap ${leaving ? 'leaving' : ''}" data-id="${r.id}">
    <button class="req-card" data-go="#/requests/${r.id}">
      <span class="req-top"><b class="req-who">${H(r.contractor)}</b><b class="req-sum">${money(r.amount)}</b></span>
      <span class="req-purpose">${H(r.purpose)}</span>
      <span class="req-tags"><span class="tag">${H(r.article)}</span>${over && r.status === 'pending' ? `<span class="tag tag-warn">${I.alert}Сверх лимита</span>` : ''}${statusTag}</span>
      <span class="req-foot">
        <span class="req-person">${personAva(r.initiator.initials, 'ava-xs')}${H(r.initiator.name)}</span>
        ${r.status === 'pending'
    ? `<span class="req-due ${urgent ? 'urgent' : ''}">${I.clock}${dueLabel(r)}</span>`
    : `<span class="req-due">${stamp(S.dateAt(r.decision.d), r.decision.d, r.decision.t)}</span>`}
      </span>
    </button>
  </div>`;
}

views.requests = (params) => (params[0] ? requestDetail(params[0]) : requestList());

function requestList() {
  const o = S.org();
  const tab = S.ui.reqTab;
  const pend = S.pending(o);
  const done = S.decided(o);
  let list;
  if (tab === 'pending') {
    const lv = S.ui.leaving && S.request(S.ui.leaving, o);
    // карточка, по которой только что приняли решение: показываем на своём месте и анимированно убираем
    const rows = lv && lv.status !== 'pending' ? [...pend, { ...lv, status: 'pending', leaving: true }].sort((a, b) => a.due - b.due) : pend;
    const items = rows.map((r) => reqCard(r, !!r.leaving));
    list = items.length ? items.join('') : '';
    if (!pend.length) {
      list += `<div class="empty ${S.ui.leaving ? 'delay' : ''}">
        <span class="empty-ic ok">${I.check}</span>
        <b>Всё согласовано</b>
        <span>Новые заявки появятся здесь и&nbsp;в&nbsp;уведомлениях</span>
      </div>`;
    }
  } else {
    list = done.length ? done.map((r) => reqCard(r)).join('') : `<div class="empty"><span class="empty-ic">${I.requests}</span><b>Пока пусто</b><span>Здесь будут заявки, по которым вы приняли решение</span></div>`;
  }
  const pendSum = sum(pend, (r) => r.amount);
  return {
    key: 'requests', tab: 'requests', depth: 1, nav: true, title: 'Заявки',
    html: `<div class="scroll">
      <div class="page-head"><h1 class="page-title">Заявки</h1></div>
      ${segmented([{ v: 'pending', label: `Ждут решения${pend.length ? ` · ${pend.length}` : ''}` }, { v: 'done', label: 'Решённые' }], tab, (v) => `data-act="req-tab" data-v="${v}"`)}
      ${tab === 'pending' && pend.length ? `<p class="list-sum">${pend.length} ${plural(pend.length, REQ_FORMS)} на ${money(pendSum)}</p>` : '<div class="list-gap"></div>'}
      <div class="req-list">${list}</div>
    </div>`,
    mount(el) {
      const lv = el.querySelector('.req-wrap.leaving');
      if (!lv) return;
      const id = S.ui.leaving;
      setTimeout(() => {
        const h = lv.offsetHeight;
        lv.style.height = `${h}px`;
        void lv.offsetHeight;
        lv.classList.add('go');
        lv.style.height = '0px';
        setTimeout(() => {
          lv.remove();
          if (S.ui.leaving === id) S.ui.leaving = null;
        }, 480);
      }, 380);
    },
  };
}

actions['req-tab'] = (t) => {
  if (S.ui.reqTab === t.dataset.v) return;
  S.ui.reqTab = t.dataset.v;
  S.ui.leaving = null;
  nav.rerender();
};

function routeStep(s, r) {
  const name = s.me ? `${S.data.user.name} (вы)` : s.name;
  let status = s.status;
  let at = s.at;
  let comment = s.comment;
  if (s.me && r.mine) {
    status = r.decision.status;
    at = { d: r.decision.d, t: r.decision.t };
    comment = r.decision.comment;
  } else if (s.me && r.status !== 'pending' && r.decision) {
    comment = r.decision.comment;
  }
  const label = { created: 'Заявка создана', approved: 'Согласовано', rejected: 'Отклонено', pending: 'Ждёт вашего решения' }[status];
  const ic = { created: I.file, approved: I.check, rejected: I.x, pending: I.clock }[status];
  return `<li class="rt rt-${status}">
    <span class="rt-dot">${ic}</span>
    <div class="rt-body">
      <b>${H(name)}</b>
      <span class="rt-role">${H(s.role)}</span>
      <span class="rt-status">${label}${at ? ` · ${stamp(S.dateAt(at.d), at.d, at.t)}` : ''}</span>
      ${comment ? `<span class="rt-comment">«${H(comment)}»</span>` : ''}
    </div>
  </li>`;
}

function requestDetail(id) {
  const o = S.org();
  const r = S.request(id, o);
  if (!r) {
    return {
      key: `req:${id}`, depth: 2, title: 'Заявка',
      html: `${topbar('Заявка', '#/requests')}<div class="scroll has-topbar"><div class="empty"><span class="empty-ic">${I.info}</span><b>Заявка не найдена</b><span>Возможно, она относится к другой организации</span><button class="btn btn-secondary" data-go="#/requests">К списку заявок</button></div></div>`,
    };
  }
  const b = r.budget;
  const after = b.used + r.amount;
  const over = after - b.limit;
  const scale = Math.max(b.limit, after);
  const pct = (v) => ((v / scale) * 100).toFixed(2);
  const overPct = Math.round((over / b.limit) * 100);

  // влияние на остаток в день оплаты
  let impact = '';
  if (r.due >= 0 && r.due < S.horizon() && r.status !== 'rejected') {
    const ds = S.days(o);
    const day = ds[r.due];
    const inCal = r.mine && r.status === 'approved';
    const before = inCal ? day.end + r.amount : day.end;
    const aft = before - r.amount;
    impact = `<section class="card impact">
      <div class="card-head"><h2>Остаток на ${dayMonth(day.date)}</h2><span class="muted">${inCal ? 'уже в календаре' : 'если оплатить'}</span></div>
      <div class="imp-row">
        <span class="imp-val"><small>до оплаты</small><b>${moneyShort(before)}</b></span>
        <span class="imp-arrow">${I.arrowR}</span>
        <span class="imp-val"><small>после</small><b class="${aft < 0 ? 'neg' : ''}">${moneyShort(aft)}</b></span>
      </div>
      <p class="imp-note ${aft < 0 ? 'neg' : 'pos'}">${aft < 0 ? `${I.alert}Оплата создаст кассовый разрыв` : `${I.check}Разрыва не будет`}</p>
    </section>`;
  }

  const statusChip = r.status === 'pending'
    ? '<span class="status-chip st-wait">Ждёт вашего решения</span>'
    : r.status === 'approved' ? '<span class="status-chip st-ok">Согласована</span>' : '<span class="status-chip st-neg">Отклонена</span>';

  return {
    key: `req:${id}`, depth: 2, title: `Заявка № ${r.num}`,
    html: `${topbar(`Заявка № ${H(r.num)}`, '#/requests')}
    <div class="scroll has-topbar ${r.status === 'pending' ? 'has-actionbar' : ''}">
      <section class="req-hero">
        ${statusChip}
        <div class="rh-who">${H(r.contractor)}</div>
        <div class="rh-sum">${bigMoney(r.amount)}</div>
        <div class="rh-purpose">${H(r.purpose)}</div>
      </section>

      <section class="card kv">
        <div class="kv-row"><span>Статья</span><b>${H(r.article)}</b></div>
        <div class="kv-row"><span>Оплатить</span><b class="${r.due <= 2 && r.status === 'pending' ? 'warn-text' : ''}">${r.due >= 0 ? `до ${dayMonth(S.dateAt(r.due))}, ${relDay(r.due)}` : dayMonth(S.dateAt(r.due))}</b></div>
        <div class="kv-row"><span>Со счёта</span><b>${H(r.payFrom)}</b></div>
        <div class="kv-row"><span>Инициатор</span><b class="kv-person">${personAva(r.initiator.initials, 'ava-xs')}<span>${H(r.initiator.name)}<small>${H(r.initiator.role)}</small></span></b></div>
        <div class="kv-row"><span>Создана</span><b>${stamp(S.dateAt(r.created.d), r.created.d, r.created.t)}</b></div>
      </section>

      <section class="card budget ${over > 0 ? 'is-over' : ''}">
        <div class="card-head"><h2>Бюджет статьи</h2><span class="muted">${H(r.article)} · ${H(b.period)}</span></div>
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
    ? `<div class="over-note">${I.alert}<div><b>Превышение лимита на ${money(over)}</b><span>+${overPct}% к бюджету статьи на ${H(b.period)}. Согласование пройдёт сверх лимита.</span></div></div>`
    : `<div class="ok-note">${I.check}<span>В пределах лимита. Останется ${money(b.limit - after)}</span></div>`}
      </section>

      ${impact}

      <section class="card">
        <div class="card-head"><h2>Комментарий инициатора</h2></div>
        <div class="quote">${personAva(r.initiator.initials)}<div class="bubble">${H(r.comment)}</div></div>
      </section>

      <section class="card">
        <div class="card-head"><h2>Вложения</h2></div>
        <button class="attach" data-act="open-pdf" data-id="${r.id}">
          <span class="pdf-ic">PDF</span>
          <span class="attach-name"><b>${H(r.attachment.file)}</b><small>${H(r.attachment.size)} · счёт на оплату</small></span>
          ${I.chevR}
        </button>
      </section>

      <section class="card">
        <div class="card-head"><h2>Маршрут согласования</h2></div>
        <ol class="route">${r.route.map((s) => routeStep(s, r)).join('')}</ol>
      </section>
    </div>
    ${r.status === 'pending' ? `<div class="actionbar">
      <button class="btn btn-ghost" data-act="reject" data-id="${r.id}">Отклонить</button>
      <button class="btn btn-primary" data-act="approve" data-id="${r.id}">${I.check}Согласовать</button>
    </div>` : ''}`,
  };
}

actions['open-pdf'] = (t) => {
  const r = S.request(t.dataset.id);
  const a = r.attachment;
  const o = S.org();
  const total = sum(a.items, (i) => i.qty * i.price);
  const vat = Math.round((total * 16) / 116);
  openSheet(`<div class="pdf-bar"><span class="pdf-ic sm">PDF</span><b>${H(a.file)}</b><button class="tb-btn" data-act="sheet-close" aria-label="Закрыть">${I.x}</button></div>
    <div class="paper-scroll">
      <div class="paper">
        <div class="paper-stamp">ДЕМО</div>
        <div class="paper-top">
          <div><small>Поставщик</small><b>${H(r.contractor)}</b><span>БИН ••••••••••••</span></div>
          <div class="ta-r"><small>Счёт на оплату</small><b>№ ${H(a.number)}</b><span>от ${dayMonth(S.dateAt(a.d))} ${S.dateAt(a.d).getFullYear()} г.</span></div>
        </div>
        <div class="paper-party"><small>Покупатель</small><b>${H(o.name)}</b></div>
        <table class="paper-table">
          <thead><tr><th>Наименование</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead>
          <tbody>${a.items.map((i) => `<tr><td>${H(i.name)}</td><td>${digits(i.qty)} ${H(i.unit)}</td><td>${digits(i.price)}</td><td>${digits(i.qty * i.price)}</td></tr>`).join('')}</tbody>
        </table>
        <div class="paper-total"><span>Итого к оплате</span><b>${money(total)}</b></div>
        <div class="paper-vat">в т. ч. НДС 16%: ${money(vat)}</div>
        <div class="paper-sign"><span>Руководитель ____________</span><span>Бухгалтер ____________</span></div>
      </div>
    </div>
    <p class="sheet-note">Это заглушка вложения. В рабочей версии здесь откроется PDF счёта из&nbsp;1С.</p>`, { tall: true });
};

actions.approve = (t) => {
  const r = S.request(t.dataset.id);
  const over = S.overLimit(r);
  openSheet(`<div class="sheet-title">Согласовать оплату?</div>
    <div class="confirm-sum">${money(r.amount)}</div>
    <p class="confirm-sub">${H(r.contractor)} · до ${dayMonth(S.dateAt(r.due))}</p>
    ${over ? `<div class="over-note compact">${I.alert}<div><b>Сверх лимита на ${money(over)}</b><span>Статья «${H(r.article)}»</span></div></div>` : ''}
    <div class="sheet-actions">
      <button class="btn btn-primary btn-block" data-act="approve-confirm" data-id="${r.id}">Да, согласовать</button>
      <button class="btn btn-text btn-block" data-act="sheet-close">Отмена</button>
    </div>`);
};

actions['approve-confirm'] = async (t) => {
  const r = S.request(t.dataset.id);
  if (!r || r.status !== 'pending') return;
  S.decide(r.id, 'approved');
  await closeSheet();
  await success({ kind: 'approved', title: 'Заявка согласована', text: `Платёж ${money(r.amount)} стоит в календаре на ${dayMonth(S.dateAt(r.due))}` });
  finishDecision(r.id);
};

const REASONS = ['Нет денег в бюджете', 'Перенесём на следующий месяц', 'Нужен другой поставщик', 'Уточните сумму'];

actions.reject = (t) => {
  const r = S.request(t.dataset.id);
  const first = r.initiator.name.split(' ')[0];
  openSheet(`<div class="sheet-title">Отклонить заявку</div>
    <p class="sheet-sub">Напишите причину — её увидит ${H(first)}. Без комментария отклонить нельзя.</p>
    <div class="chips">${REASONS.map((c) => `<button class="chip" data-act="reason" data-v="${c}">${c}</button>`).join('')}</div>
    <textarea class="textarea" id="reject-text" rows="3" maxlength="300" placeholder="Причина отказа"></textarea>
    <div class="field-err" id="reject-err" hidden>${I.alert}<span>Напишите причину отказа</span></div>
    <div class="sheet-actions">
      <button class="btn btn-danger btn-block" data-act="reject-confirm" data-id="${r.id}">Отклонить заявку</button>
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

actions['reject-confirm'] = async (t) => {
  const r = S.request(t.dataset.id);
  if (!r || r.status !== 'pending') return;
  const ta = document.getElementById('reject-text');
  const text = ta.value.trim();
  if (!text) {
    document.getElementById('reject-err').hidden = false;
    ta.classList.add('invalid');
    ta.classList.remove('shake');
    void ta.offsetWidth;
    ta.classList.add('shake');
    ta.focus();
    return;
  }
  S.decide(r.id, 'rejected', text);
  await closeSheet();
  await success({ kind: 'rejected', title: 'Заявка отклонена', text: `${H(r.initiator.name)} получит уведомление с вашим комментарием` });
  finishDecision(r.id);
};

function finishDecision(id) {
  S.ui.leaving = id;
  S.ui.reqTab = 'pending';
  replace('#/requests', 'pop');
}

// ======================================================================
// ОТЧЁТЫ
// ======================================================================
function niceMax(v) {
  const step = v > 20e6 ? 5e6 : v > 8e6 ? 2e6 : 1e6;
  return Math.ceil(v / step) * step;
}

function ddsReport(o) {
  const rep = o.reports;
  const w = rep.dds;
  const tin = sum(w, (x) => x.in);
  const tout = sum(w, (x) => x.out);
  const sel = S.ui.ddsSel ?? w.length - 1;
  const max = niceMax(Math.max(...w.map((x) => Math.max(x.in, x.out))));
  const W = 326;
  const Hc = 180;
  const left = 30;
  const bottom = 22;
  const top = 8;
  const plotW = W - left;
  const plotH = Hc - bottom - top;
  const gw = plotW / w.length;
  const bw = Math.min(16, gw * 0.26);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => k * max);
  const y = (v) => top + plotH - (v / max) * plotH;
  const svg = `<svg class="dds-chart" viewBox="0 0 ${W} ${Hc}" role="img" aria-label="Поступления и выплаты по неделям">
    ${ticks.map((t) => `<line class="grid" x1="${left}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${left - 6}" y="${y(t) + 3.5}" text-anchor="end">${t ? Math.round(t / 1e6) : 0}</text>`).join('')}
    ${w.map((x, i) => {
    const cx = left + gw * i + gw / 2;
    const on = i === sel;
    return `<g class="dds-g ${on ? 'on' : ''}">
        <rect class="hit" x="${left + gw * i}" y="0" width="${gw}" height="${Hc}" data-act="dds-sel" data-i="${i}"/>
        ${on ? `<rect class="sel-bg" x="${left + gw * i + 3}" y="${top - 4}" width="${gw - 6}" height="${plotH + 4}" rx="10"/>` : ''}
        <rect class="b-in" x="${cx - bw - 1.5}" y="${y(x.in)}" width="${bw}" height="${(x.in / max) * plotH}" rx="4"/>
        <rect class="b-out" x="${cx + 1.5}" y="${y(x.out)}" width="${bw}" height="${(x.out / max) * plotH}" rx="4"/>
        <text class="axis x ${on ? 'on' : ''}" x="${cx}" y="${Hc - 6}" text-anchor="middle">${x.label}</text>
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
        <div class="ds-title">${H(s.full)}</div>
        <div class="ds-row"><span>Поступления</span><b class="pos">${money(s.in, { sign: true })}</b></div>
        <div class="ds-row"><span>Выплаты</span><b>${money(-s.out)}</b></div>
        <div class="ds-row total"><span>Итог недели</span><b class="${net < 0 ? 'neg' : 'pos'}">${money(net, { sign: true })}</b></div>
      </div>
    </section>
    <p class="hint-line">${I.info}<span>Нажмите на неделю, чтобы увидеть суммы</span></p>`;
}

function pfRow(x, income = false) {
  const p = Math.round((x.fact / x.plan) * 100);
  const over = !income && x.fact > x.plan;
  const scale = Math.max(x.plan, x.fact);
  const fillW = (Math.min(x.fact, x.plan) / scale) * 100;
  const overW = over ? ((x.fact - x.plan) / scale) * 100 : 0;
  const planAt = (x.plan / scale) * 100;
  return `<div class="pf ${over ? 'over' : ''} ${income ? 'income' : ''}">
    <div class="pf-top"><span>${H(x.article)}</span><b>${p}%</b></div>
    <div class="pf-bar">
      <i class="pf-fill" style="width:${fillW}%"></i>
      ${over ? `<i class="pf-over" style="left:${fillW}%;width:${overW}%"></i><span class="pf-plan" style="left:${planAt}%"></span>` : ''}
    </div>
    <div class="pf-sub"><span>${moneyShort(x.fact)} из ${moneyShort(x.plan)}</span>${over ? `<span class="neg">+${money(x.fact - x.plan)} сверх плана</span>` : income && x.fact < x.plan ? `<span class="muted">${moneyShort(x.fact - x.plan)} до плана</span>` : ''}</div>
  </div>`;
}

function planFact(o) {
  const rep = o.reports;
  const overs = rep.expense.filter((x) => x.fact > x.plan);
  return `${overs.length ? `<div class="over-note">${I.alert}<div><b>${overs.length} ${plural(overs.length, ['статья', 'статьи', 'статей'])} сверх плана</b><span>${overs.map((x) => `${H(x.article)} +${Math.round((x.fact / x.plan - 1) * 100)}%`).join(', ')}</span></div></div>` : ''}
    <section class="card">
      <div class="card-head"><h2>Поступления</h2></div>
      ${rep.income.map((x) => pfRow(x, true)).join('')}
    </section>
    <section class="card">
      <div class="card-head"><h2>Выплаты по статьям</h2><span class="muted">факт / план</span></div>
      ${rep.expense.map((x) => pfRow(x)).join('')}
    </section>`;
}

function debtors(o) {
  const rec = o.receivables;
  const list = [...o.debtors].sort((a, b) => b.amount - a.amount).slice(0, 5);
  const max = list[0].amount;
  const rest = rec.total - sum(list, (d) => d.amount);
  const overPct = Math.round((rec.overdue / rec.total) * 100);
  return `<section class="card">
      <div class="card-head"><h2>Дебиторка на ${dayMonth(S.today())}</h2></div>
      <div class="rec-sum">${moneyShort(rec.total)}</div>
      <div class="rec-bar"><i style="width:${overPct}%"></i></div>
      <div class="rec-legend">
        <span><i class="sw sw-neg"></i>Просрочено ${moneyShort(rec.overdue)} · ${overPct}%</span>
        <span><i class="sw sw-ok"></i>В срок ${moneyShort(rec.total - rec.overdue)}</span>
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
            <div class="debt-sub">${d.overdue ? `<span class="tag tag-neg">просрочка ${d.days} ${plural(d.days, ['день', 'дня', 'дней'])}</span><span class="neg">${money(d.overdue)}</span>` : '<span class="tag tag-pos">в срок</span>'}</div>
          </div>
        </li>`).join('')}
      </ol>
      ${rest > 0 ? `<div class="debt-rest"><span>Остальные покупатели</span><b>${money(rest)}</b></div>` : ''}
    </section>`;
}

views.reports = (params) => {
  const o = S.org();
  const tab = ['dds', 'plan', 'debtors'].includes(params[0]) ? params[0] : 'dds';
  const body = tab === 'dds' ? ddsReport(o) : tab === 'plan' ? planFact(o) : debtors(o);
  return {
    key: 'reports', tab: 'reports', depth: 1, nav: true, title: 'Отчёты',
    html: `<div class="scroll">
      <div class="page-head"><h1 class="page-title">Отчёты</h1><span class="period-chip">${tab === 'debtors' ? 'на сегодня' : H(o.reports.period)}</span></div>
      ${segmented([{ v: 'dds', label: 'ДДС' }, { v: 'plan', label: 'План-факт' }, { v: 'debtors', label: 'Должники' }], tab, (v) => `data-go="#/reports/${v}" data-dir="same"`)}
      <div class="rep-body">${body}</div>
    </div>`,
  };
};

actions['dds-sel'] = (t) => {
  S.ui.ddsSel = Number(t.dataset.i);
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

views.notifications = () => {
  const o = S.org();
  const list = S.notifications(o);
  const unread = list.filter((n) => !n.read).length;
  const groups = [];
  list.forEach((n) => {
    const label = n.d === 0 ? 'Сегодня' : n.d === -1 ? 'Вчера' : cap(dayMonth(S.dateAt(n.d)));
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { label, items: [] }));
    g.items.push(n);
  });
  return {
    key: 'notifications', depth: 2, title: 'Уведомления',
    html: `${topbar('Уведомления', '#/home', unread ? '<button class="link-btn" data-act="read-all">Прочитать все</button>' : '')}
    <div class="scroll has-topbar">
      ${groups.map((g) => `<div class="n-group"><div class="n-label">${g.label}</div>
        <div class="card n-card">${g.items.map((n) => {
    const [cls, ic] = N_IC[n.type] || ['sum', I.bell];
    return `<button class="notif ${n.read ? '' : 'unread'}" data-act="open-notif" data-id="${n.id}">
            <span class="n-ic n-${cls}">${ic}</span>
            <span class="n-main"><b>${H(n.title)}</b><span>${H(n.text)}</span><time>${n.t}</time></span>
            ${n.read ? '' : '<i class="n-dot" aria-label="Новое"></i>'}
          </button>`;
  }).join('')}</div></div>`).join('')}
      <p class="foot-note">${I.chat}<span>Утренняя сводка и разрывы дублируются в WhatsApp</span></p>
    </div>`,
  };
};

actions['read-all'] = () => {
  S.markAllRead();
  nav.rerender();
};

actions['open-notif'] = (t) => {
  const n = S.notifications().find((x) => x.id === t.dataset.id);
  if (!n) return;
  S.markRead(n.id);
  if (n.link === 'summary') {
    nav.rerender();
    openSummary();
    return;
  }
  const h = linkToHash(n.link);
  if (h) navigate(h, 'push');
  else nav.rerender();
};

function openSummary() {
  const o = S.org();
  const op = S.opening(o);
  const ds = S.days(o);
  const g = S.gap(o, ds);
  const pend = S.pending(o);
  const t0 = ds[0];
  const lines = [
    ['Деньги', `${moneyShort(op.total)} (банк ${moneyShort(op.bank)}, касса ${moneyShort(op.cash)})`],
    ['Сегодня', `поступления ${moneyShort(t0.sumIn)}, платежи ${moneyShort(t0.sumOut)}`],
    g ? ['Разрыв', `${wdAcc(g.day.date)}, ${dayMonth(g.day.date)}, не хватит ${moneyShort(g.deficit)}`] : ['Разрывы', 'на 4 недели не ожидаются'],
    ['Заявки', pend.length ? `${pend.length} ${plural(pend.length, REQ_FORMS)} ${pend.length % 10 === 1 && pend.length % 100 !== 11 ? 'ждёт' : 'ждут'} решения на ${moneyShort(sum(pend, (r) => r.amount))}` : 'всё согласовано'],
    ['Просрочка', `покупатели должны ${moneyShort(o.receivables.overdue)}`],
  ];
  openSheet(`<div class="sheet-title">Утренняя сводка</div>
    <div class="sheet-sub">${H(o.name)} · ${dayMonth(S.today())}, 08:30</div>
    <div class="summary-chat">
      <div class="sc-bubble">
        <p>${greeting()}, ${H(S.data.user.firstName)}! Коротко о деньгах на сегодня:</p>
        ${lines.map(([k, v]) => `<p><b>${k}:</b> ${v}</p>`).join('')}
        <span class="sc-time">08:30 ${I.check}</span>
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

views.profile = () => {
  const u = S.data.user;
  const cur = S.org();
  return {
    key: 'profile', tab: 'profile', depth: 1, nav: true, title: 'Профиль',
    html: `<div class="scroll">
      <div class="page-head"><h1 class="page-title">Профиль</h1></div>
      <section class="card me-card">
        ${personAva(u.initials, 'ava-xl ava-ink')}
        <div><b>${H(u.name)}</b><span>${H(u.role)}</span><span class="muted">${H(S.state.auth.phone || u.phone)}</span></div>
      </section>

      <div class="list-label">Организации</div>
      <section class="card list">
        ${S.data.orgs.map((o) => `<button class="li" data-act="switch-org" data-id="${o.id}">
          ${ava(o)}
          <span class="li-main"><b>${H(o.name)}</b><small>${H(o.city)} · ${H(o.activity)}</small></span>
          ${o.id === cur.id ? `<span class="li-check">${I.check}</span>` : '<span class="li-radio"></span>'}
        </button>`).join('')}
      </section>

      <div class="list-label">Уведомления</div>
      <section class="card list">
        ${TOGGLES.map(([k, t, d]) => `<button class="li" data-act="toggle" data-k="${k}" role="switch" aria-checked="${!!S.state.toggles[k]}">
          <span class="li-main"><b>${t}</b><small>${d}</small></span>
          <span class="switch ${S.state.toggles[k] ? 'on' : ''}"><i></i></span>
        </button>`).join('')}
      </section>

      <div class="list-label">Демо</div>
      <section class="card list">
        <button class="li" data-act="reset-demo">
          <span class="li-ic">${I.refresh}</span>
          <span class="li-main"><b>Сбросить демо</b><small>Вернуть заявки и уведомления в исходное состояние</small></span>
          ${I.chevR}
        </button>
        <button class="li li-danger" data-act="logout">
          <span class="li-ic">${I.logout}</span>
          <span class="li-main"><b>Выйти</b></span>
        </button>
      </section>

      <div class="about">
        ${logoMark(28)}
        <span>ФинПульс 1.0 · демо-версия<br>Все данные выдуманы</span>
        <span class="about-brand">SmartSol × FINTAX CONSULT</span>
      </div>
    </div>`,
  };
};

actions['switch-org'] = (t) => {
  if (S.state.orgId === t.dataset.id) return;
  S.setOrg(t.dataset.id);
  nav.rerender();
  toast(`Переключились на ${H(S.org().name)}`);
};

actions.toggle = (t) => {
  S.toggle(t.dataset.k);
  const on = !!S.state.toggles[t.dataset.k];
  t.setAttribute('aria-checked', on);
  t.querySelector('.switch').classList.toggle('on', on);
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
  S.resetDemo();
  await closeSheet();
  nav.rerender();
  toast('Демо сброшено');
};

actions.logout = () => {
  S.logout();
  S.ui.pendingPhone = '';
  replace('#/login', 'fade');
};

actions['sheet-close'] = () => closeSheet();
