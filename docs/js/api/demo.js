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

// Вход — имитация сценария контракта (2): номер в приложении, код от «бота» (шторка в приложении) тем же текстом,
// что у настоящего. Первый вход — через бота («Поделиться номером»); после удачного входа устройство «знакомо»,
// и на следующих входах бот присылает код сам. Неверный код — code_invalid с числом оставшихся попыток, пятый —
// challenge_rejected (wrong_code), три таких входа подряд — blocked на 15 минут.
// Состояние — в памяти: перезагрузка страницы сбрасывает и блокировку, и «знакомое устройство». Номер и код нигде
// не сохраняются.
const CODE_LENGTH = 6;
const CODE_TTL = 300; // секунд — как на сервере
const TRIES = 5;
const tg = { ch: null, rejected: 0, blockedUntil: 0, shared: false, device: false };

function newCode() {
  let c = '';
  for (let i = 0; i < CODE_LENGTH; i++) c += Math.floor(Math.random() * 10);
  return c;
}

const loginError = (status, code, message, details = {}, retry = 0) => new ApiError(code, message, { ...details, contractCode: code }, status, retry);

// Номер демо-пользователя — им заполнено поле на экране входа; подойдёт и любой другой.
export const demoPhone = () => (S.data ? S.data.user.phone : '');

const sendCode = (ch) => {
  ch.sentAt = Date.now();
  ch.until = ch.sentAt + CODE_TTL * 1000; // код живёт 5 минут с момента, когда бот его прислал
};

export async function startLogin(phone) {
  await wait(350);
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = `7${d.slice(1)}`;
  if (d.length !== 11) throw loginError(422, 'validation_error', 'Проверьте номер телефона.', { fields: { phone: 'Не номер' } });
  const ch = { id: `demo_${Date.now()}`, code: newCode(), phone: `+${d}`, sentAt: 0, opens: 0, triesLeft: TRIES, until: Date.now() + CODE_TTL * 1000, auto: tg.device && tg.shared };
  tg.ch = ch;
  // Знакомое устройство: бот сам пишет в чат через пару секунд после начала входа.
  if (ch.auto) setTimeout(() => tg.ch === ch && !ch.sentAt && sendCode(ch), 1200);
  // Ответ одинаков для любого номера; demoAuto — только для демо: когда показать «уведомление Telegram».
  return { challengeId: ch.id, botUrl: null, codeLength: CODE_LENGTH, expiresIn: CODE_TTL, pollInterval: 2, demoBot: true, demoAuto: ch.auto };
}

// Что показывает «бот», когда его открыли по кнопке «Войти через Telegram» (или пришло его сообщение):
//  contact — первый вход с этого аккаунта: просит «Поделиться номером»;
//  code    — прислал код (текст сообщения — как у настоящего бота); auto — прислал сам, устройство знакомо;
//  again   — бота открыли ещё раз: код не повторяется, «он выше в этом чате»;
//  blocked — слишком много попыток; none — входа нет.
export function demoBotOpen() {
  const ch = tg.ch;
  if (!ch) return { step: 'none' };
  if (tg.blockedUntil > Date.now()) return { step: 'blocked', minutes: Math.ceil((tg.blockedUntil - Date.now()) / 60000) };
  if (!tg.shared) return { step: 'contact' };
  ch.opens++;
  if (!ch.sentAt) sendCode(ch);
  return { step: ch.opens > 1 ? 'again' : 'code', auto: ch.auto && ch.opens === 1, code: ch.code, site: 'finpulse.smartsol.pro', minutes: CODE_TTL / 60 };
}

// «Поделиться номером» в боте — дальше бот этого аккаунта номер не спрашивает (до перезагрузки страницы).
export function demoBotShare() {
  tg.shared = true;
  return { ...demoBotOpen(), phone: tg.ch ? tg.ch.phone : '' };
}

const rejected = (reason, message, retry) => loginError(409, 'challenge_rejected', message, { reason, ...(retry ? { retry_after: retry } : {}) }, retry || 0);
const blockedError = () => {
  const left = Math.ceil((tg.blockedUntil - Date.now()) / 1000);
  return rejected('blocked', `Слишком много попыток входа. Попробуйте через ${Math.max(1, Math.ceil(left / 60))} мин.`, left);
};

function challenge(challengeId) {
  const ch = tg.ch;
  if (!ch || ch.id !== challengeId) throw loginError(404, 'not_found', 'Вход не найден');
  if (tg.blockedUntil > Date.now()) throw blockedError();
  if (Date.now() > ch.until) {
    tg.ch = null;
    throw loginError(410, 'challenge_expired', 'Время входа вышло. Начните вход заново.');
  }
  return ch;
}

// Опрос: вход жив. О том, отправлен ли код, не сообщает — как настоящий сервер.
export async function pollLogin(challengeId) {
  await wait(150);
  challenge(challengeId);
  return { status: 'pending' };
}

export async function confirmLogin(challengeId, code) {
  await wait(450);
  const ch = challenge(challengeId);
  const entered = String(code || '').replace(/[\s-]/g, '');
  if (entered.length !== CODE_LENGTH || /[^0-9]/.test(entered)) throw loginError(422, 'validation_error', `Код — ${CODE_LENGTH} цифр.`);
  if (!ch.sentAt) throw loginError(409, 'code_not_sent', 'Код ещё не отправлен. Откройте Telegram — бот пришлёт код.');
  if (entered !== ch.code) {
    ch.triesLeft--;
    if (ch.triesLeft > 0) {
      throw loginError(422, 'code_invalid', `Неверный код. Осталось попыток: ${ch.triesLeft}.`, { attempts_left: ch.triesLeft, attemptsLeft: ch.triesLeft });
    }
    tg.ch = null;
    tg.rejected++;
    if (tg.rejected >= 3) {
      tg.rejected = 0;
      tg.blockedUntil = Date.now() + 900e3;
      throw blockedError();
    }
    throw rejected('wrong_code', 'Код введён неверно несколько раз. Начните вход заново.');
  }
  tg.ch = null;
  tg.rejected = 0;
  tg.device = true; // «метка устройства»: в следующий раз бот пришлёт код сам
  S.login(S.data.user.phone); // в сохраняемое состояние демо идёт номер демо-пользователя, не введённый
  return { status: 'ok', session: session_() };
}

export async function logout() {
  S.logout();
  tg.ch = null;
}

// В демо одно «устройство» — выход везде равен обычному выходу.
export async function logoutAll() {
  await wait(400);
  tg.device = false; // метка устройства удаляется: следующий вход снова через бота
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
    // Как в ответе сервера: доля заявки по основной статье (this_request) и превышение лимита (over_by).
    budget: { article: r.article, period: r.budget.period, limit: r.budget.limit, used: r.budget.used, request: S.budgetPart(r), overBy: S.overLimit(r) },
    articles: (r.lines || []).length || 1,
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
