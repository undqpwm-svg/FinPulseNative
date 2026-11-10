// Точка входа: роутер на хешах, переходы между экранами, нижняя навигация
import * as S from './store.js';
import { views, actions } from './views.js';
import { nav, navigate, back, closeSheet, sheetOpen, histIdx } from './ui.js';
import { I } from './icons.js';

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

let current = null; // { key, el, depth, tab }
let lastHash = null;
const DUR = 340;

function parse() {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  const parts = h.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || '', params: parts.slice(1) };
}

function guard(r) {
  const st = S.state;
  if (!st.auth.logged) return ['login', 'code'].includes(r.name) ? null : '#/login';
  if (!st.orgId) return r.name === 'orgs' ? null : '#/orgs';
  if (!r.name || r.name === 'login' || r.name === 'code' || !views[r.name]) return '#/home';
  return null;
}

function route() {
  const r = parse();
  const redirect = guard(r);
  if (redirect) {
    history.replaceState({ idx: histIdx() }, '', redirect);
    return route();
  }
  lastHash = location.hash;
  if (sheetOpen()) closeSheet(true);
  app.querySelectorAll('.done-overlay').forEach((e) => e.remove());
  const v = views[r.name](r.params);
  let dir = nav.pendingDir;
  nav.pendingDir = null;
  if (!current) dir = 'none';
  else if (current.key === v.key) dir = 'same';
  else if (!dir || dir === 'same') {
    if (current.tab && v.tab) dir = 'fade';
    else if ((v.depth ?? 1) < current.depth) dir = 'pop';
    else if ((v.depth ?? 1) > current.depth) dir = 'push';
    else dir = 'fade';
  }
  show(v, dir);
}

function rerender() {
  const r = parse();
  if (guard(r)) return route();
  show(views[r.name](r.params), 'same');
}
nav.rerender = rerender;
nav.route = route;
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
  const done = () => {
    old.remove();
    el.classList.remove(inC);
  };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(done, reduced ? 0 : DUR + 30);
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
  const pend = S.state.orgId ? S.pending().length : 0;
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
      fn(t, e);
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetOpen()) closeSheet();
});

// ---------- рамка телефона на компьютере ----------
function fitDevice() {
  const stage = document.querySelector('.stage');
  if (!stage) return;
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
async function boot() {
  try {
    await S.init();
  } catch (err) {
    screens.innerHTML = `<section class="screen"><div class="scroll"><div class="empty"><span class="empty-ic">${I.alert}</span><b>Не удалось загрузить демо</b><span>Проверьте интернет и обновите страницу</span><button class="btn btn-secondary" onclick="location.reload()">Обновить</button></div></div></section>`;
    console.error(err);
    return;
  }
  window.addEventListener('popstate', onHistory);
  window.addEventListener('hashchange', onHistory);
  if (!history.state) history.replaceState({ idx: 0 }, '', location.hash || '#/');
  route();
  document.documentElement.classList.add('ready');
}
boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
