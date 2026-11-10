// Данные демо и состояние (решения по заявкам, прочитанные уведомления, настройки)
import { parseISO, addDays, money, nowHM, sum } from './util.js';

const KEY = 'finpuls-demo-v1';

export let data = null;
export let state = null;

// Временное состояние экранов — не сохраняется
export const ui = { calMode: 'week', reqTab: 'pending', ddsSel: null, leaving: null, pendingPhone: '' };

const defaults = () => ({
  auth: { logged: false, phone: '' },
  orgId: null,
  decisions: {},
  read: {},
  events: [],
  toggles: { summary: true, requests: true, payments: true, gaps: true, whatsapp: true },
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const d = defaults();
      return { ...d, ...s, auth: { ...d.auth, ...s.auth }, toggles: { ...d.toggles, ...s.toggles } };
    }
  } catch (e) {
    /* localStorage недоступен (приватный режим) — работаем в памяти */
  }
  return defaults();
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    /* без сохранения — демо продолжает работать в памяти */
  }
}

export async function init() {
  const res = await fetch('data/demo.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('Не удалось загрузить демо-данные');
  data = await res.json();
  state = load();
  if (state.orgId && !data.orgs.some((o) => o.id === state.orgId)) state.orgId = null;
}

// Сброс демо: решения, уведомления и настройки возвращаются в исходное состояние, вход сохраняется
export function resetDemo() {
  const keep = { auth: state.auth, orgId: state.orgId };
  state = { ...defaults(), ...keep };
  ui.leaving = null;
  ui.ddsSel = null;
  save();
}

export function login(phone) {
  state.auth = { logged: true, phone };
  save();
}

export function logout() {
  state.auth = { logged: false, phone: '' };
  state.orgId = null;
  save();
}

export function setOrg(id) {
  state.orgId = id;
  ui.ddsSel = null;
  save();
}

export function toggle(k) {
  state.toggles[k] = !state.toggles[k];
  save();
}

// ---------- даты ----------
export function today() {
  if (data.today) return parseISO(data.today);
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
export const dateAt = (d) => addDays(today(), d);
export const horizon = () => data.horizonDays || 28;

// ---------- организация ----------
export const org = (id = state.orgId) => data.orgs.find((o) => o.id === id) || data.orgs[0];

export function opening(o = org()) {
  const bank = sum(o.accounts.filter((a) => a.type === 'bank'), (a) => a.amount);
  const cash = sum(o.accounts.filter((a) => a.type === 'cash'), (a) => a.amount);
  return { bank, cash, total: bank + cash };
}

// ---------- заявки ----------
export function requests(o = org()) {
  return o.requests.map((r) => {
    const dec = state.decisions[r.id];
    return { ...r, status: dec?.status || r.status || 'pending', decision: dec || r.decided || null, mine: !!dec };
  });
}
export const request = (id, o = org()) => requests(o).find((r) => r.id === id);
export const pending = (o = org()) => requests(o).filter((r) => r.status === 'pending').sort((a, b) => a.due - b.due);
export function decided(o = org()) {
  const key = (r) => (r.decision?.d ?? 0) * 10000 + Number((r.decision?.t || '00:00').replace(':', ''));
  return requests(o).filter((r) => r.status !== 'pending').sort((a, b) => key(b) - key(a));
}
export function overLimit(r) {
  return Math.max(0, r.budget.used + r.amount - r.budget.limit);
}

export function decide(id, status, comment = '') {
  const o = org();
  const r = o.requests.find((x) => x.id === id);
  const t = nowHM();
  state.decisions[id] = { status, comment, d: 0, t };
  state.events.push({
    id: `e${Date.now()}`,
    org: o.id,
    type: status === 'approved' ? 'approved' : 'rejected',
    d: 0,
    t,
    title: status === 'approved' ? 'Вы согласовали заявку' : 'Вы отклонили заявку',
    text: `${r.contractor} · ${money(r.amount)}`,
    link: `request:${id}`,
    read: true,
  });
  save();
}

// ---------- платёжный календарь ----------
// Плановые движения + согласованные в демо заявки (встают в календарь на дату оплаты)
export function flows(o = org()) {
  const extra = requests(o)
    .filter((r) => r.status === 'approved' && r.mine)
    .map((r) => ({ d: r.due, type: 'out', who: r.contractor, article: r.article, note: r.purpose, amount: r.amount, req: r.id }));
  return [...o.flows, ...extra];
}

export function days(o = org()) {
  const fl = flows(o);
  let bal = opening(o).total;
  const res = [];
  for (let d = 0; d < horizon(); d++) {
    const items = fl.filter((f) => f.d === d);
    const ins = items.filter((i) => i.type === 'in').sort((a, b) => b.amount - a.amount);
    const outs = items.filter((i) => i.type === 'out').sort((a, b) => b.amount - a.amount);
    const sumIn = sum(ins, (i) => i.amount);
    const sumOut = sum(outs, (i) => i.amount);
    const start = bal;
    bal = start + sumIn - sumOut;
    res.push({ d, date: dateAt(d), start, end: bal, ins, outs, sumIn, sumOut });
  }
  return res;
}

// Первый день, когда остаток уходит в минус; дефицит — максимальная глубина минуса подряд
export function gap(o = org(), ds = days(o)) {
  const i = ds.findIndex((x) => x.end < 0);
  if (i < 0) return null;
  let j = i;
  let min = ds[i].end;
  while (j + 1 < ds.length && ds[j + 1].end < 0) {
    j++;
    min = Math.min(min, ds[j].end);
  }
  return { day: ds[i], deficit: -min };
}

export function minDay(ds) {
  return ds.reduce((m, x) => (x.end < m.end ? x : m), ds[0]);
}

// ---------- уведомления ----------
export function notifications(o = org()) {
  const ev = state.events.filter((e) => e.org === o.id);
  return [...ev, ...o.notifications]
    .map((n) => ({ ...n, read: !!n.read || !!state.read[n.id] }))
    .sort((a, b) => b.d - a.d || b.t.localeCompare(a.t));
}
export const unreadCount = (o = org()) => notifications(o).filter((n) => !n.read).length;

export function markRead(id) {
  state.read[id] = true;
  save();
}
export function markAllRead(o = org()) {
  notifications(o).forEach((n) => (state.read[n.id] = true));
  save();
}
