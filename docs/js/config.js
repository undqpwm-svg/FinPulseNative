// Единственное место настроек приложения. Секретов здесь нет и быть не должно:
// ключи доступа к 1С и токены WhatsApp живут только на сервере-посреднике.
export const CONFIG = {
  // Адрес API сервера-посредника (контракт v1). Эта сборка — рабочий сервер.
  // При смене хоста — поправить и connect-src в Content-Security-Policy (index.html).
  apiBase: 'https://api.smartsol.pro/api/v1',

  // Тестовый сервер. Включается только явно: адрес страницы с ?api=test (см. detectEnv ниже) — и только для этой вкладки.
  apiBaseTest: 'https://api-test.smartsol.pro/api/v1',

  // 'prod' — рабочий сервер; 'test' — тестовый (плашка «ТЕСТ» на всех экранах). Выставляется ниже, руками не менять.
  env: 'prod',

  // Версия приложения — уходит в X-App-Version; сервер сравнивает её с min_app_version (GET /version).
  // 1.1.0 — вход по номеру телефона и одноразовому коду из Telegram (POST /auth/telegram/confirm).
  // 1.1.1 — экран «Новое устройство» (поле device в ответе start). Серверу достаточно min_app_version 1.1.0.
  appVersion: '1.1.1',

  // Режим по умолчанию: 'server' — настоящий вход и данные из 1С; 'demo' — выдуманные данные из data/demo.json.
  // Демо всегда доступно ссылкой «Посмотреть демо» на экране входа и адресом #/demo.
  defaultMode: 'server',

  // Сколько ждать ответа сервера, мс. Дольше — «Сервер долго не отвечает» и кнопка «Обновить».
  // Больше, чем ждёт сам сервер (20 с до 504 source_timeout), чтобы его ответ успел прийти.
  requestTimeoutMs: 25000,

  // Через сколько мс показывать индикатор загрузки (быстрые ответы — без мигания).
  loadingDelayMs: 180,
};

// ---------- тестовый сервер для проверки на телефонах ----------
// Как включить: открыть приложение по адресу с ?api=test (например https://finpulse.smartsol.pro/?api=test).
// Как выключить: кнопка «Выйти» на плашке «ТЕСТ», адрес с ?api=prod или закрыть вкладку.
// Правила:
//  - по умолчанию и без явного действия — только рабочий сервер; значение параметра сверяется со словом test,
//    адрес сервера из адресной строки не берётся никогда;
//  - выбор живёт в sessionStorage, то есть только в этой вкладке: соседние вкладки и приложение, установленное
//    на экран «Домой» (оно открывается по start_url без параметра), остаются на рабочем сервере;
//  - в тестовом режиме признак входа и выбранная организация хранятся отдельно от рабочих (api/core.js),
//    push не трогаем (push.js) — рабочая подписка телефона не страдает.
const ENV_KEY = 'finpuls-api';

function detectEnv() {
  let q = null;
  try {
    q = new URLSearchParams(location.search).get('api');
  } catch (e) {
    q = null;
  }
  try {
    if (q === 'test') sessionStorage.setItem(ENV_KEY, 'test');
    else if (q !== null) sessionStorage.removeItem(ENV_KEY); // ?api=prod и любое другое значение — рабочий сервер
    return sessionStorage.getItem(ENV_KEY) === 'test' ? 'test' : 'prod';
  } catch (e) {
    return q === 'test' ? 'test' : 'prod'; // sessionStorage недоступен — режим держится только на параметре адреса
  }
}

CONFIG.env = detectEnv();
if (CONFIG.env === 'test') CONFIG.apiBase = CONFIG.apiBaseTest;

export const isTestEnv = () => CONFIG.env === 'test';

// Вернуться на рабочий сервер: забыть выбор и всё, что тестовая вкладка сохранила, и открыть приложение без параметра.
export function leaveTestEnv() {
  try {
    sessionStorage.clear();
  } catch (e) {
    /* нечего забывать */
  }
  location.replace(`${location.pathname}#/login`);
}
