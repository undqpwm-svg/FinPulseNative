// Точка входа: роутер на хешах, асинхронная загрузка экранов, ошибки без белого экрана, переходы, нижняя навигация.
import { CONFIG } from './config.js';
import { api, setMode, ApiError } from './api/index.js';
import { views, actions, errorView, onUnauthorized, invalidate } from './screens.js';
import { nav, navigate, back, closeSheet, sheetOpen, histIdx, loading } from './ui.js';
import { I, logoMark } from './icons.js';
import { syncPush } from './push.js';

const app = document.getElementById('app');
const screens = app.querySelector('.screens');
const tabbar = app.querySelector('.tabbar');
const metaTheme = document.querySelector('meta[name="theme-color"]');

const TABS = [
  { id: 'home', hash: '#/home', label: 'Главная', icon: I.home },
  { id: 'calendar', hash: '#/calendar', label: 'Календарь', icon: I.calendar },
  { id: 'requests', hash: '#/requests', label: 'Заявки', icon: I.requests },
  { id: 'reports', hash: '#/reports', label: 'Отчёты', icon: I.chart },
  { id: 'profile', hash: '#/profile', label: 'Профиль', icon: I.user },
];
const TAB_TITLES = { home: 'Главная', calendar: 'Календарь', requests: 'Заявки', reports: 'Отчёты', profile: 'Профиль' };
const DETAIL_META = { notifications: ['Уведомления', '#/home'], orgs: ['Организации', '#/home'], requests: ['Заявка', '#/requests'] };

let current = null; // { key, el, depth, tab }
let lastHash = null;
let seq = 0; // номер последней навигации: устаревшие ответы не рисуем
const DUR = 340;

function parse() {
  const [h, q = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = h.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch (e) {
      return p;
    }
  });
  return { name: parts[0] || '', params: parts.slice(1), query: new URLSearchParams(q) };
}

function guard(r) {
  if (!api.session()) return ['login', 'code'].includes(r.name) ? null : '#/login';
  if (!api.orgId()) return r.name === 'orgs' ? null : '#/orgs';
  if (!r.name || r.name === 'login' || r.name === 'code' || !views[r.name]) return '#/home';
  return null;
}

const replaceHash = (hash) => history.replaceState({ idx: histIdx() }, '', hash);

// Метаданные экрана для ошибки: вкладка — с заголовком раздела и нижней навигацией, остальное — с «Назад».
function errorMeta(r) {
  if (TAB_TITLES[r.name] && !(r.name === 'requests' && r.params[0])) {
    return { key: `error:${r.name}`, tab: r.name, title: TAB_TITLES[r.name] };
  }
  const [title, back_] = DETAIL_META[r.name] || ['ФинПульс', '#/home'];
  return { key: `error:${r.name}:${r.params.join('/')}`, title, back: back_, depth: 2 };
}

const splash = () => ({
  key: 'splash', depth: 0, title: 'ФинПульс',
  html: `<div class="splash">${logoMark(56)}<span class="spin dark" aria-hidden="true"></span><span class="splash-text">Загружаем данные…</span></div>`,
});

async function route() {
  let r = parse();
  // #/demo — включить демо для показов (ссылка «Посмотреть демо», QR на презентации).
  if (r.name === 'demo') {
    setMode('demo');
    invalidate();
  }
  try {
    await api.init(); // демо: загрузка data/demo.json; сервер — ничего
  } catch (e) {
    console.error(e);
    lastHash = location.hash;
    show(errorView(e, { key: 'error:init', title: 'ФинПульс', back: '#/login', depth: 0 }), current ? 'fade' : 'none');
    return;
  }
  if (r.name === 'demo') {
    replaceHash(api.session() ? '#/home' : '#/login');
    r = parse();
  }
  // ?org=…&n=… — из push: открыть заявку нужной организации и отметить уведомление прочитанным (контракт, 9.3).
  const qOrg = r.query.get('org');
  const qNote = r.query.get('n');
  if ((qOrg || qNote) && api.session()) {
    if (qOrg && api.orgId() !== qOrg) {
      api.setOrgId(qOrg);
      invalidate();
      nav.badge = null;
    }
    if (qNote) api.markRead(api.orgId(), qNote).catch(() => {});
    replaceHash(location.hash.split('?')[0]);
  }
  const redirect = guard(r);
  if (redirect) {
    replaceHash(redirect);
    return route();
  }
  lastHash = location.hash;
  const my = ++seq;
  if (sheetOpen()) closeSheet(true);
  app.querySelectorAll('.done-overlay').forEach((e) => e.remove());
  let dir = nav.pendingDir;
  nav.pendingDir = null;

  const timer = setTimeout(() => {
    if (my !== seq) return;
    if (!current) show(splash(), 'none');
    else loading(true);
  }, CONFIG.loadingDelayMs);
  let v;
  try {
    v = await views[r.name](r.params);
  } catch (e) {
    if (e instanceof ApiError && (e.code === 'unauthorized' || e.code === 'access_revoked')) {
      clearTimeout(timer);
      loading(false);
      if (my === seq) onUnauthorized(e);
      return;
    }
    if (!(e instanceof ApiError)) console.error(e); // ожидаемые ошибки API показываем на экране, не в консоли
    v = errorView(e, errorMeta(r));
  } finally {
    clearTimeout(timer);
    if (my === seq) loading(false);
  }
  if (my !== seq) return; // пока грузили, пользователь ушёл на другой экран
  if (v.redirect) {
    replaceHash(v.redirect);
    return route();
  }
  if (!current || current.key === 'splash') dir = current ? 'fade' : 'none';
  else if (current.key === v.key) dir = 'same';
  else if (!dir || dir === 'same') {
    if (current.tab && v.tab) dir = 'fade';
    else if ((v.depth ?? 1) < current.depth) dir = 'pop';
    else if ((v.depth ?? 1) > current.depth) dir = 'push';
    else dir = 'fade';
  }
  show(v, dir);
}

nav.route = route;
nav.rerender = route; // тот же экран — перерисовка на месте, без анимации перехода
// назад/вперёд в браузере и ручная правка адреса
const onHistory = () => {
  if (location.hash !== lastHash) route();
};

function show(v, dir) {
  if (dir === 'same' && current) {
    const sc = current.el.querySelector('.scroll');
    const top = sc ? sc.scrollTop : 0;
    const segs = [...current.el.querySelectorAll('.seg')].map((e) => e.style.getPropertyValue('--i'));
    current.el.innerHTML = v.html;
    current.el.querySelectorAll('.seg').forEach((e, i) => {
      const to = e.style.getPropertyValue('--i');
      if (segs[i] === undefined || segs[i] === to) return;
      e.style.setProperty('--i', segs[i]);
      void e.offsetWidth;
      e.style.setProperty('--i', to);
    });
    current.el.classList.toggle('dark', v.theme === 'dark');
    const ns = current.el.querySelector('.scroll');
    if (ns) ns.scrollTop = top;
    v.mount?.(current.el);
    Object.assign(current, { key: v.key, depth: v.depth ?? 1, tab: v.tab });
    chrome(v);
    return;
  }

  // убираем экраны, которые ещё доигрывают прошлую анимацию
  screens.querySelectorAll('.screen.leaving').forEach((e) => e.remove());

  const el = document.createElement('section');
  el.className = `screen${v.theme === 'dark' ? ' dark' : ''}`;
  el.innerHTML = v.html;
  const old = current?.el;
  screens.appendChild(el);
  v.mount?.(el);
  current = { key: v.key, el, depth: v.depth ?? 1, tab: v.tab };
  chrome(v);

  if (!old || dir === 'none') {
    if (old) old.remove();
    return;
  }
  const [inC, outC] = { push: ['in-push', 'out-push'], pop: ['in-pop', 'out-pop'], fade: ['in-fade', 'out-fade'] }[dir] || ['in-fade', 'out-fade'];
  old.classList.add('leaving', outC);
  el.classList.add(inC);
  if (dir === 'pop') old.style.zIndex = 3;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => {
    old.remove();
    el.classList.remove(inC);
  }, reduced ? 0 : DUR + 30);
}

function chrome(v) {
  document.title = v.title ? `${v.title} · ФинПульс` : 'ФинПульс';
  const dark = v.theme === 'dark';
  app.classList.toggle('theme-dark', dark);
  document.documentElement.classList.toggle('theme-dark', dark);
  metaTheme?.setAttribute('content', dark ? '#141414' : '#F4F1EA');
  app.classList.toggle('nav-hidden', !v.nav);
  if (v.nav) renderTabbar(v.tab);
}

function renderTabbar(active) {
  const pend = nav.badge || 0;
  tabbar.innerHTML = TABS.map((t) => `<button class="tab ${t.id === active ? 'on' : ''}" data-go="${t.hash}" aria-label="${t.label}" ${t.id === active ? 'aria-current="page"' : ''}>
      <span class="tab-ic">${t.icon}${t.id === 'requests' && pend ? `<span class="tab-badge">${pend}</span>` : ''}</span>
      <span class="tab-label">${t.label}</span>
    </button>`).join('');
}

// ---------- делегирование кликов ----------
app.addEventListener('click', (e) => {
  const t = e.target.closest('[data-go],[data-back],[data-act]');
  if (!t || !app.contains(t) || t.disabled) return;
  if (t.dataset.go) {
    e.preventDefault();
    // повторное нажатие на активную вкладку — прокрутка наверх
    if (t.classList.contains('tab') && t.classList.contains('on') && location.hash.split('/')[1] === t.dataset.go.split('/')[1]) {
      const sc = current?.el.querySelector('.scroll');
      if (location.hash === t.dataset.go) sc?.scrollTo({ top: 0, behavior: 'smooth' });
      else navigate(t.dataset.go, 'same');
      return;
    }
    navigate(t.dataset.go, t.dataset.dir);
  } else if (t.dataset.back !== undefined) {
    e.preventDefault();
    back(t.dataset.back || '#/home');
  } else if (t.dataset.act) {
    const fn = actions[t.dataset.act];
    if (fn) {
      e.preventDefault();
      Promise.resolve()
        .then(() => fn(t, e))
        .catch((err) => console.error(err));
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetOpen()) actions['sheet-close']();
});

// Нажатие на push, когда приложение уже открыто: service worker присылает адрес экрана.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'open' && typeof d.hash === 'string' && d.hash.startsWith('#/')) navigate(d.hash, 'push');
  });
}

// ---------- рамка телефона на компьютере ----------
function fitDevice() {
  if (!document.querySelector('.stage')) return;
  const framed = window.matchMedia('(min-width: 700px) and (min-height: 560px)').matches;
  document.documentElement.classList.toggle('framed', framed);
  const scale = framed ? Math.min(1, (window.innerHeight - 48) / 868) : 1;
  document.documentElement.style.setProperty('--scale', scale.toFixed(4));
}
window.addEventListener('resize', fitDevice);
fitDevice();

// часы в строке состояния (только в рамке на компьютере)
function tick() {
  const el = document.querySelector('.sb-time');
  if (el) {
    const n = new Date();
    el.textContent = `${n.getHours()}:${String(n.getMinutes()).padStart(2, '0')}`;
  }
}
tick();
setInterval(tick, 20000);

// ---------- запуск ----------
window.addEventListener('popstate', onHistory);
window.addEventListener('hashchange', onHistory);
if (!history.state) history.replaceState({ idx: 0 }, '', location.hash || '#/');
route().finally(() => {
  document.documentElement.classList.add('ready');
  if (api.session()) syncPush(); // контракт, 9.1: актуальная подписка при каждом запуске
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
