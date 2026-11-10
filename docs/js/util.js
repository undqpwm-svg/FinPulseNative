// Форматирование сумм, дат и строк для интерфейса ФинПульс
export const NB = ' '; // неразрывный пробел — суммы не переносятся по строкам

const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTH_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WD_LONG = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const WD_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const WD_ACC = ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу'];

// Экранирование всего, что попадает в innerHTML
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function groups(n) {
  return Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NB);
}

// 12 480 000 ₸
export function money(n, { sign = false } = {}) {
  const pre = n < 0 ? '−' : sign && n > 0 ? '+' : '';
  return `${pre}${groups(n)}${NB}₸`;
}

// Только цифры с разрядами, без валюты — для крупных заголовков
export const digits = (n) => (n < 0 ? '−' : '') + groups(n);

// 12,5 млн ₸ — для крупных сумм; меньше миллиона показываем полностью
export function moneyShort(n, { sign = false } = {}) {
  const abs = Math.abs(n);
  const pre = n < 0 ? '−' : sign && n > 0 ? '+' : '';
  if (abs >= 1e9) return `${pre}${dec(abs / 1e9)}${NB}млрд${NB}₸`;
  if (abs >= 1e6) return `${pre}${dec(abs / 1e6)}${NB}млн${NB}₸`;
  return `${pre}${groups(abs)}${NB}₸`;
}

// Компактное число в миллионах для ячеек календаря: 11,8
export function mln(n) {
  const v = (Math.round(n / 1e5) / 10).toFixed(1).replace('.', ',');
  return (n < 0 ? '−' : '') + v.replace('-', '');
}

function dec(v) {
  const r = Math.round(v * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace('.', ',');
}

export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

// ---------- даты ----------
export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function iso(dt) {
  const p = (x) => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}
export function addDays(dt, n) {
  const r = new Date(dt);
  r.setDate(r.getDate() + n);
  return r;
}
export function diffDays(a, b) {
  return Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 864e5);
}
export const dayMonth = (dt) => `${dt.getDate()}${NB}${MONTH_GEN[dt.getMonth()]}`;
export const dayMonthShort = (dt) => `${dt.getDate()}${NB}${MONTH_SHORT[dt.getMonth()]}`;
export const monthTitle = (dt) => `${MONTH_NOM[dt.getMonth()]} ${dt.getFullYear()}`;
export const wdLong = (dt) => WD_LONG[dt.getDay()];
export const wdShort = (dt) => WD_SHORT[dt.getDay()];
export const wdAcc = (dt) => WD_ACC[dt.getDay()];
export const WD_HEAD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// «сегодня», «завтра», «через 3 дня»
export function relDay(d) {
  if (d === 0) return 'сегодня';
  if (d === 1) return 'завтра';
  if (d === -1) return 'вчера';
  if (d === 2) return 'послезавтра';
  if (d > 0) return `через ${d} ${plural(d, ['день', 'дня', 'дней'])}`;
  return `${-d} ${plural(-d, ['день', 'дня', 'дней'])} назад`;
}

// «сегодня, 09:12» / «вчера, 17:24» / «8 ноября, 10:02»
export function stamp(dt, d, t) {
  const day = d === 0 ? 'сегодня' : d === -1 ? 'вчера' : dayMonth(dt);
  return t ? `${day}, ${t}` : day;
}

export function nowHM() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
}

export function greeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Доброе утро';
  if (h >= 12 && h < 18) return 'Добрый день';
  if (h >= 18 && h < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + f(x), 0);
