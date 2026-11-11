// Реализация API «демо»: выдуманные данные из data/demo.json (расчёты — store.js), ответы в той же форме DTO, что
// ждём от сервера (spec/api-client.md). Сеть не используется; решения и прочитанное — в хранилище браузера.
import * as S from '../store.js';
import { ApiError } from './core.js';
import { iso, sum } from '../util.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const isoAt = (d) => iso(S.dateAt(d));
const stampIso = (d, t) => `${isoAt(d)}T${t || '00:00'}:00`;

export async function init() {
  if (!S.data) await S.init();
}

// ---------- вход ----------
function userDto() {
  const u = S.data.user;
  return { id: 'demo-user', name: u.name, firstName: u.firstName, initials: u.initials, role: u.role, phone: S.state.auth.phone || u.phone };
}

export function session_() {
  return S.state.auth.logged ? { token: 'demo', expiresAt: null, user: userDto() } : null;
}

// Вход через Telegram — имитация сценария контракта (2): число, «бот» с тремя кнопками (шторка в приложении),
// опрос. Верное число — вход; неверное — challenge_rejected (wrong_number), третье неверное подряд — blocked на 15 мин.
// Состояние — в памяти: перезагрузка страницы сбрасывает блокировку демо.
const tg = { ch: null, wrong: 0, blockedUntil: 0 };

export async function startLogin() {
  await wait(350);
  const code = String(10 + Math.floor(Math.random() * 90));
  tg.ch = { id: `demo_${Date.now()}`, code, picked: null, until: Date.now() + 300e3 };
  return { challengeId: tg.ch.id, botUrl: null, matchCode: code, expiresIn: 300, pollInterval: 2, demoBot: true };
}

// Что «бот» показывает: верное число и два других, в случайном порядке.
export function demoBotOptions() {
  if (!tg.ch) return [];
  const set = new Set([tg.ch.code]);
  while (set.size < 3) set.add(String(10 + Math.floor(Math.random() * 90)));
  return [...set].sort(() => Math.random() - 0.5);
}

export async function demoBotPick(code) {
  if (tg.ch) tg.ch.picked = String(code);
}

const rejected = (reason, message, retry) => new ApiError('challenge_rejected', message,
  { reason, contractCode: 'challenge_rejected', ...(retry ? { retry_after: retry } : {}) }, 409, retry || 0);

export async function pollLogin(challengeId) {
  await wait(150);
  const ch = tg.ch;
  if (!ch || ch.id !== challengeId) throw new ApiError('not_found', 'Вход не найден', { contractCode: 'not_found' }, 404);
  if (tg.blockedUntil > Date.now()) {
    throw rejected('blocked', 'Слишком много неверных попыток. Вход через Telegram заблокирован на 15 минут.', Math.ceil((tg.blockedUntil - Date.now()) / 1000));
  }
  if (!ch.picked) {
    if (Date.now() > ch.until + 30e3) throw new ApiError('challenge_expired', 'Время входа истекло. Начните заново.', { contractCode: 'challenge_expired' }, 410);
    return { status: 'pending' };
  }
  tg.ch = null;
  if (ch.picked !== ch.code) {
    tg.wrong++;
    if (tg.wrong >= 3) {
      tg.wrong = 0;
      tg.blockedUntil = Date.now() + 900e3;
      throw rejected('blocked', 'Три раза подряд выбрано неверное число. Вход через Telegram заблокирован на 15 минут.', 900);
    }
    throw rejected('wrong_number', 'В Telegram выбрано другое число. Начните вход заново.');
  }
  tg.wrong = 0;
  S.login(S.data.user.phone);
  return { status: 'ok', session: session_() };
}

export async function logout() {
  S.logout();
  tg.ch = null;
}

// В демо одно «устройство» — выход везде равен обычному выходу.
export async function logoutAll() {
  await wait(400);
  await logout();
}

export async function me() {
  return userDto();
}

// ---------- организация ----------
export const orgId = () => S.state.orgId;
export const setOrgId = (id) => S.setOrg(id);

function orgDto(o) {
  const ds = S.days(o);
  const g = S.gap(o, ds);
  return {
    id: o.id, name: o.name, short: o.short, initials: o.initials, city: o.city, activity: o.activity,
    summary: { money: S.opening(o).total, pending: S.pending(o).length, gap: g ? { date: iso(g.day.date), deficit: g.deficit } : null },
  };
}

function org(id) {
  const o = S.data.orgs.find((x) => x.id === id);
  if (!o) throw new ApiError('not_found', 'Организация не найдена');
  return o;
}

export async function orgs() {
  return { items: S.data.orgs.map(orgDto), partial: false };
}

// ---------- главная ----------
function topArticles(outs) {
  const m = new Map();
  outs.forEach((x) => m.set(x.article, (m.get(x.article) || 0) + x.amount));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([a]) => a);
}

export async function home(id) {
  const o = org(id);
  const ds = S.days(o);
  const g = S.gap(o, ds);
  const pend = S.pending(o);
  const m = S.minDay(ds);
  const oldest = [...o.debtors].sort((a, b) => b.oldest_days - a.oldest_days)[0];
  return {
    today: iso(S.today()),
    asOf: `${iso(S.today())}T${S.data.updatedAt || '08:30'}:00`,
    horizonDays: S.horizon(),
    user: userDto(),
    org: orgDto(o),
    money: S.opening(o),
    threshold: 0,
    forecast: { start: ds[0].start, days: ds.slice(0, 14).map((d) => ({ date: iso(d.date), end: d.end })) },
    gap: g ? { date: iso(g.day.date), deficit: g.deficit, outflow: g.day.sumOut, articles: topArticles(g.day.outs) } : null,
    minBalance: { date: iso(m.date), amount: m.end },
    approvals: { count: pend.length, sum: sum(pend, (r) => r.amount), overLimit: pend.filter((r) => S.overLimit(r) > 0).length },
    week: ds.slice(0, 7).map((d) => ({ date: iso(d.date), in: d.sumIn, out: d.sumOut, end: d.end })),
    receivables: { total: o.receivables.total, aging: { ...o.receivables.aging }, oldest: oldest ? { name: oldest.name, days: oldest.oldest_days } : null },
    unread: S.unreadCount(o),
  };
}

export async function accounts(id) {
  const o = org(id);
  return { orgName: o.name, total: S.opening(o).total, items: o.accounts.map((a) => ({ name: a.name, note: a.note, type: a.type, amount: a.amount })) };
}

// ---------- календарь ----------
const flowDto = (f) => ({ dir: f.type, who: f.who, article: f.article, note: f.note || '', amount: f.amount, requestId: f.req || null });

export async function calendar(id) {
  const o = org(id);
  return {
    today: iso(S.today()),
    threshold: 0,
    days: S.days(o).map((d) => ({ date: iso(d.date), start: d.start, end: d.end, in: d.sumIn, out: d.sumOut, items: [...d.ins, ...d.outs].map(flowDto) })),
  };
}

// ---------- заявки ----------
function reqDto(r) {
  return {
    id: r.id, num: r.num, contractor: r.contractor, amount: r.amount, currency: 'KZT', article: r.article, purpose: r.purpose,
    initiator: { name: r.initiator.name, initials: r.initiator.initials, role: r.initiator.role },
    due: isoAt(r.due), overLimit: S.overLimit(r), status: r.status,
    decidedAt: r.decision ? stampIso(r.decision.d, r.decision.t) : null,
  };
}

export async function requests(id, tab) {
  const o = org(id);
  const items = tab === 'done' ? S.decided(o) : S.pending(o);
  return { today: iso(S.today()), items: items.map(reqDto) };
}

export async function request_(id, reqId) {
  const o = org(id);
  const r = S.request(reqId, o);
  if (!r) throw new ApiError('not_found', 'Заявка не найдена');
  let impact = null;
  if (r.due >= 0 && r.due < S.horizon() && r.status !== 'rejected') {
    const day = S.days(o)[r.due];
    const inCalendar = r.mine && r.status === 'approved';
    const before = inCalendar ? day.end + r.amount : day.end;
    impact = { date: iso(day.date), before, after: before - r.amount, inCalendar };
  }
  const u = userDto();
  const route = r.route.map((s) => {
    let status = s.status;
    let at = s.at ? stampIso(s.at.d, s.at.t) : null;
    let comment = s.comment || '';
    if (s.me && r.mine) {
      status = r.decision.status;
      at = stampIso(r.decision.d, r.decision.t);
      comment = r.decision.comment || '';
    } else if (s.me && r.status !== 'pending' && r.decision) {
      comment = r.decision.comment || '';
    }
    return { name: s.me ? u.name : s.name, role: s.role, me: !!s.me, status, at, comment };
  });
  return {
    today: iso(S.today()),
    ...reqDto(r),
    payFrom: r.payFrom,
    createdAt: stampIso(r.created.d, r.created.t),
    comment: r.comment,
    budget: { period: r.budget.period, limit: r.budget.limit, used: r.budget.used },
    impact,
    attachments: [{ id: 'invoice', name: r.attachment.file, size: r.attachment.size, kind: 'invoice' }],
    route,
    canDecide: r.status === 'pending',
  };
}

export async function attachment(id, reqId) {
  const o = org(id);
  const r = S.request(reqId, o);
  if (!r) throw new ApiError('not_found');
  const a = r.attachment;
  const total = sum(a.items, (i) => i.qty * i.price);
  return {
    kind: 'invoice', name: a.file, number: a.number, date: isoAt(a.d), supplier: r.contractor, buyer: o.name,
    items: a.items.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, price: i.price })), total, vatRate: 16, vat: Math.round((total * 16) / 116),
  };
}

// Решение: имитация сервера — задержка, идемпотентность по ключу, конфликт, если решение уже принято.
const applied = new Map(); // ключ идемпотентности → ответ

export async function decide(id, reqId, { decision, comment, idempotencyKey }) {
  await wait(700);
  if (applied.has(idempotencyKey)) return applied.get(idempotencyKey);
  const o = org(id);
  const r = S.request(reqId, o);
  if (!r) throw new ApiError('not_found', 'Заявка не найдена');
  if ((decision === 'reject' || decision === 'return') && !String(comment || '').trim()) throw new ApiError('comment_required', 'Укажите комментарий');
  if (r.status !== 'pending') {
    throw new ApiError('already_decided', 'По заявке уже принято решение', {
      status: r.status, by: r.mine ? S.data.user.name : 'другой согласующий', at: r.decision ? stampIso(r.decision.d, r.decision.t) : null,
    }, 409);
  }
  S.setOrg(id);
  const status = { approve: 'approved', reject: 'rejected', return: 'returned' }[decision];
  S.decide(r.id, status, comment || '');
  const res = {
    decision: status,
    requestStatus: status,
    paymentDate: decision === 'approve' ? isoAt(r.due) : null,
    nextApprover: null,
  };
  applied.set(idempotencyKey, res);
  return res;
}

// ---------- отчёты ----------
export async function report(id, kind) {
  const o = org(id);
  const rep = o.reports;
  if (kind === 'plan') return { period: rep.period, hasPlan: rep.hasPlan !== false, income: rep.income, expense: rep.expense };
  if (kind === 'debtors') {
    const top = [...o.debtors].sort((a, b) => b.amount - a.amount).slice(0, 5)
      .map((d) => ({ name: d.name, amount: d.amount, aging: { ...d.aging }, days: d.oldest_days }));
    return { asOf: iso(S.today()), total: o.receivables.total, aging: { ...o.receivables.aging }, top, rest: o.receivables.total - sum(top, (d) => d.amount) };
  }
  return { period: rep.period, weeks: rep.dds };
}

// ---------- уведомления ----------
function linkDto(link) {
  if (!link) return null;
  const [k, v] = link.split(':');
  return k === 'calendar' ? `calendar:${isoAt(Number(v))}` : link;
}

export async function notifications(id) {
  const o = org(id);
  return {
    today: iso(S.today()),
    items: S.notifications(o).map((n) => ({ id: n.id, type: n.type, at: stampIso(n.d, n.t), title: n.title, text: n.text, read: n.read, link: linkDto(n.link) })),
  };
}

export async function markRead(id, nId) {
  S.markRead(nId);
}

export async function markAllRead(id) {
  S.markAllRead(org(id));
}

export async function summary(id) {
  const o = org(id);
  const ds = S.days(o);
  const g = S.gap(o, ds);
  const pend = S.pending(o);
  return {
    asOf: `${iso(S.today())}T08:30:00`, orgName: o.name, money: S.opening(o),
    today: { in: ds[0].sumIn, out: ds[0].sumOut },
    gap: g ? { date: iso(g.day.date), deficit: g.deficit } : null,
    approvals: { count: pend.length, sum: sum(pend, (r) => r.amount) },
    over60: o.receivables.aging.days_over_60,
  };
}

// ---------- настройки ----------
// Как в контракте v1: WhatsApp настраивает администратор компании — в приложении только для показа.
const LOCKED = ['whatsapp'];
const settingsDto = () => ({ toggles: { ...S.state.toggles }, locked: [...LOCKED], info: { summaryTime: '08:30', paymentsMin: 500000, gapsDays: 3 } });

export async function settings() {
  return settingsDto();
}

export async function saveSettings(patch) {
  if (Object.keys(patch).some((k) => LOCKED.includes(k))) throw new ApiError('forbidden', 'Этот переключатель настраивает администратор компании');
  Object.assign(S.state.toggles, patch);
  S.save();
  return settingsDto();
}

// ---------- push: в демо ничего не отправляется ----------
export async function pushConfig() {
  return { vapidPublicKey: null, demo: true };
}
export async function savePushSubscription() {}
export async function deletePushSubscription() {}

// ---------- только демо ----------
export async function resetDemo() {
  S.resetDemo();
  applied.clear();
}
