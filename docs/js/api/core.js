// Общее для реализаций API: ошибка с кодом, безопасное хранилище браузера, идентификаторы.

// Коды ошибок, которые понимают экраны (сервер может прислать свой code в теле ответа):
//  network               — нет связи с сервером (fetch не дошёл)
//  timeout               — сервер не ответил за CONFIG.requestTimeoutMs
//  server_unavailable    — сервер-посредник недоступен (502/503/504 без тела)
//  upstream_unavailable  — 1С клиента недоступна (посредник ответил, 1С — нет)
//  unauthorized          — сессия истекла или отозвана → снова вход
//  forbidden             — нет прав (например, решение по заявке не ваше)
//  not_found             — объект не найден
//  already_decided       — по заявке уже приняли решение (в 1С или с другого устройства)
//  code_invalid / code_expired / too_many_attempts / rate_limited — вход по коду
//  comment_required      — отклонение без комментария
//  server_error          — прочее
export class ApiError extends Error {
  constructor(code, message = '', details = {}, status = 0, retryAfter = 0) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code;
    this.details = details || {};
    this.status = status;
    this.retryAfter = retryAfter; // секунды, если сервер прислал Retry-After
  }
}

// localStorage может быть недоступен (приватный режим, запрет cookies) — тогда работаем в памяти.
const memory = new Map();
export const storage = {
  get(key) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? (memory.has(key) ? memory.get(key) : null) : v;
    } catch (e) {
      return memory.has(key) ? memory.get(key) : null;
    }
  },
  set(key, value) {
    memory.set(key, value);
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* остаётся только в памяти */
    }
  },
  remove(key) {
    memory.delete(key);
    try {
      localStorage.removeItem(key);
    } catch (e) {
      /* нечего удалять */
    }
  },
  getJSON(key) {
    try {
      return JSON.parse(this.get(key) || 'null');
    } catch (e) {
      return null;
    }
  },
  setJSON(key, value) {
    this.set(key, JSON.stringify(value));
  },
};

// Ключ идемпотентности решения: повтор с тем же ключом сервер не применит дважды.
export function uuid() {
  try {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  } catch (e) {
    return `k-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

