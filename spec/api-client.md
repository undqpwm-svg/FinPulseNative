# API для приложения ФинПульс — что ждёт клиент (черновик до контракта)

Этот файл — **не контракт**, а то, как приложение сейчас вызывает сервер-посредник и какие ответы умеет показывать.
Когда придёт утверждённый контракт, меняются только `docs/js/api/server.js` (пути — в объекте `PATHS`, места сверки
помечены «КОНТРАКТ») и, если отличаются формы ответов, — преобразование в нём же. Экраны трогать не нужно.

> Папка `/docs` публикуется на finpulse.smartsol.pro — документацию туда не кладём.

## Устройство клиента

| Файл | Что делает |
|---|---|
| `docs/js/config.js` | адрес API (`apiBase`), режим по умолчанию (`server` / `demo`), таймаут |
| `docs/js/api/index.js` | единый клиент `api.*`, переключение режима (`setMode`) |
| `docs/js/api/server.js` | fetch к серверу-посреднику, токен сессии, разбор ошибок |
| `docs/js/api/demo.js` | те же методы на выдуманных данных (`data/demo.json`), без сети |
| `docs/js/push.js` | разрешение и подписка web push |
| `docs/sw.js` | показ push и открытие заявки по нажатию |

Режим: по умолчанию `server` (настоящий вход). Демо — ссылка «Посмотреть демо» на экране входа или адрес `#/demo`;
«Выйти из демо» в профиле возвращает к настоящему входу. В демо приложение не обращается к API ни разу (есть тест).

## Транспорт

- База: `https://api.smartsol.pro/v1` (`config.js`; при смене — и `connect-src` в CSP в `docs/index.html`).
- JSON, UTF-8. Даты — `YYYY-MM-DD` (бизнес-дата 1С), время — `YYYY-MM-DDTHH:MM:SS` без зоны (время Алматы).
  Суммы — числа в тенге.
- Авторизация: `Authorization: Bearer <token>`. Токен — в памяти и в `localStorage` (`finpuls-session`, с try/catch).
  Cookie не используются (`credentials: 'omit'`); если сервер выберет HttpOnly-cookie — поменять в `server.js`.
- Таймаут 20 с. Ответы API service worker не кэширует.
- CORS: сервер должен разрешить origin `https://finpulse.smartsol.pro`, заголовки `Authorization`, `Content-Type`,
  `Idempotency-Key`, методы `GET, POST, PATCH, DELETE`.

### Ошибки

Тело: `{ "error": { "code": "…", "message": "…", "details": { … } } }`. Если тела нет — код берётся из HTTP-статуса.

| code | HTTP | Что показывает приложение |
|---|---|---|
| `unauthorized` | 401 | стирает токен → экран входа, «Сессия истекла — войдите снова» |
| `forbidden` | 403 | «Нет доступа» / в решении — «Нет прав на это решение» |
| `not_found` | 404 | «Не найдено» / «Заявка не найдена» |
| `already_decided` | 409 | «Решение уже принято»; `details: { status, by, at }` — кто и когда |
| `comment_required` | 422 | подсветка поля причины отказа |
| `code_invalid` | 422 | «Неверный код»; `details.attemptsLeft` — сколько попыток осталось |
| `code_expired` | 422 | «Код истёк — запросите новый» и кнопка повторной отправки |
| `too_many_attempts` | 429 | «Слишком много попыток», ввод блокируется; `Retry-After` или `details.retryAfter` (с) |
| `rate_limited` | 429 | «Слишком много запросов кода. Повторите через N минут» |
| `invalid_phone` | 422 | «Проверьте номер» |
| `upstream_unavailable` | 503 | «1С сейчас недоступна» + «Обновить» |
| — (нет тела) | 502/503/504 | «Сервер ФинПульс недоступен» + «Обновить» |
| сеть / таймаут | — | «Нет связи» / «Сервер долго не отвечает» + «Обновить» |

## Вход

`POST /auth/otp/request` — без токена.
```json
{ "phone": "+77015551234" }
```
Ответ (одинаковый для подключённых и неподключённых номеров):
```json
{ "requestId": "otp-…", "codeLength": 6, "expiresIn": 300, "resendIn": 60, "phoneMasked": "+7 701 ··· 12 34", "channel": "whatsapp" }
```

`POST /auth/otp/verify` — без токена.
```json
{ "requestId": "otp-…", "phone": "+77015551234", "code": "123456", "device": { "name": "iOS, приложение" } }
```
```json
{ "token": "…", "expiresAt": "2026-12-11T10:00:00Z",
  "user": { "id": "…", "name": "Арман Жумабаев", "firstName": "Арман", "initials": "АЖ", "role": "Директор", "phone": "+7 701 *** ** 34" } }
```

`POST /auth/logout`, `GET /me` (→ `user`), `GET /me/settings`, `PATCH /me/settings`
(`{ summary, requests, payments, gaps, whatsapp }` — булевы).

## Организации и экраны

`GET /orgs` → `{ items: [Org] }`. Одна организация — приложение открывает её сразу, без выбора.
```json
{ "id": "…", "name": "ТОО «…»", "short": "…", "initials": "АЛ", "city": "Алматы", "activity": "грузоперевозки",
  "summary": { "money": 12480000, "pending": 3, "gap": { "date": "2026-11-12", "deficit": 1200000 } } }
```

`GET /orgs/{org}/home`
```json
{ "today": "2026-11-11", "asOf": "2026-11-11T08:30:00", "horizonDays": 28,
  "user": { … }, "org": { "id": "…", "name": "…", "short": "…", "initials": "…" },
  "money": { "total": 12480000, "bank": 11830000, "cash": 650000 },
  "threshold": 0,
  "forecast": { "start": 12480000, "days": [{ "date": "2026-11-11", "end": 11780000 }] },
  "gap": { "date": "2026-11-12", "deficit": 1200000, "outflow": 13400000, "articles": ["Зарплата", "Лизинг"] },
  "minBalance": { "date": "…", "amount": 0 },
  "approvals": { "count": 3, "sum": 3325000, "overLimit": 1 },
  "week": [{ "date": "2026-11-11", "in": 2450000, "out": 3150000, "end": 11780000 }],
  "receivables": { "total": 18640000, "overdue": 5120000, "worst": { "name": "ТОО «…»", "days": 46 } },
  "unread": 5 }
```
`threshold` — неснижаемый остаток: день «красный», если `end < threshold`. `gap = null` — разрывов нет.

`GET /orgs/{org}/accounts` → `{ orgName, total, items: [{ name, note, type: "bank"|"cash", amount }] }`

`GET /orgs/{org}/calendar` → весь горизонт (28 дней) одним ответом:
```json
{ "today": "…", "threshold": 0,
  "days": [{ "date": "…", "start": 0, "end": 0, "in": 0, "out": 0,
             "items": [{ "dir": "in"|"out", "who": "…", "article": "…", "note": "…", "amount": 0, "requestId": null }] }] }
```

`GET /orgs/{org}/requests?state=pending|decided` → `{ today, items: [RequestShort] }`
```json
{ "id": "…", "num": "412", "contractor": "ТОО «…»", "amount": 2300000, "currency": "KZT", "article": "ГСМ и топливо",
  "purpose": "…", "initiator": { "name": "…", "initials": "…", "role": "…" }, "due": "2026-11-13",
  "overLimit": 500000, "status": "pending"|"approved"|"rejected"|"returned", "decidedAt": null }
```

`GET /orgs/{org}/requests/{id}` → `RequestShort` и дополнительно:
```json
{ "today": "…", "payFrom": "Halyk Bank · KZ•• 4521", "createdAt": "…", "comment": "…",
  "budget": { "period": "ноябрь", "limit": 6000000, "used": 4200000 },
  "impact": { "date": "…", "before": 4930000, "after": 2630000, "inCalendar": false },
  "attachments": [{ "id": "…", "name": "Счёт № 1847.pdf", "size": "182 КБ", "kind": "invoice" }],
  "route": [{ "name": "…", "role": "…", "me": false, "status": "created"|"approved"|"rejected"|"returned"|"pending", "at": "…", "comment": "…" }],
  "canDecide": true }
```
Кнопки «Согласовать / Отклонить» показываются только при `canDecide: true` — права определяет 1С.

`GET /orgs/{org}/requests/{id}/attachments/{att}` → PDF (`application/pdf`), открывается в приложении.

`GET /orgs/{org}/reports/dds` → `{ period, weeks: [{ label, full, in, out }] }`
`GET /orgs/{org}/reports/plan` → `{ period, income: [{ article, plan, fact }], expense: [{ article, plan, fact }] }`
`GET /orgs/{org}/reports/debtors` → `{ asOf, total, overdue, top: [{ name, amount, overdue, days }], rest }`

`GET /orgs/{org}/notifications` → `{ today, items: [{ id, type, at, title, text, read, link }] }`;
`type`: `payment | request | gap | summary | debt | approved | rejected`; `link`: `calendar:YYYY-MM-DD`,
`request:<id>`, `reports:dds|plan|debtors`, `requests`, `summary`.
`POST /orgs/{org}/notifications/{id}/read`, `POST /orgs/{org}/notifications/read-all`.

`GET /orgs/{org}/summary` → `{ asOf, orgName, money: { total, bank, cash }, today: { in, out }, gap, approvals: { count, sum }, overdue }`

## Решение по заявке

`POST /orgs/{org}/requests/{id}/decision`, заголовок `Idempotency-Key: <uuid>`:
```json
{ "decision": "approve"|"reject", "comment": "…" }
```
```json
{ "decision": "approved", "requestStatus": "approved"|"in_approval"|"rejected", "paymentDate": "2026-11-13", "nextApprover": "Гульнара Бекова" }
```

Поведение приложения:
1. После «Да, согласовать» кнопка — «Отправляется…», шторка не закрывается, «Согласовано» не показывается.
2. Ответ 200 → анимация «Заявка согласована» (или «Вы согласовали — заявка ушла на следующий этап», если
   `requestStatus = in_approval`), заявка уходит из списка.
3. `409 already_decided` → «Решение уже принято: кто, когда», «К списку заявок».
4. `403 forbidden` → «Нет прав на это решение», «Обновить заявку».
5. Сеть, таймаут, 5xx → «Повторить». **Повтор уходит с тем же `Idempotency-Key`** — сервер обязан вернуть
   результат первого применения, а не применить второй раз.
6. Отклонение без комментария приложение не отправляет; `comment_required` от сервера тоже обрабатывается.

## Push

- `GET /push/config` → `{ "vapidPublicKey": "<base64url>" }` (пока `null` — приложение пишет «заработают после подключения
  сервера»).
- `POST /push/subscriptions` — `{ subscription: PushSubscription.toJSON(), device }`; повторяется после каждого входа.
- `DELETE /push/subscriptions` — `{ endpoint }`, при выходе.
- Содержимое push: `{ "type": "request", "orgId": "…", "requestId": "…", "amount": 2300000 }` — только ИД и сумма.
  Уведомление: «Новая заявка на согласование · 2 300 000 ₸»; нажатие открывает `#/requests/<id>?org=<orgId>`.
- Разрешение спрашивается после входа (своя шторка, затем системный запрос); на iPhone — только у приложения на экране
  «Домой» (iOS 16.4+), иначе в профиле — подсказка установить.

## Ждёт контракта

- Пути и формы ответов (`PATHS` в `server.js`), формат ошибок, коды и `details`.
- Где живёт сессия: Bearer-токен (сейчас) или HttpOnly-cookie; срок, продление (refresh) — сейчас истёкший токен = вход.
- Длина кода, сроки, лимиты повторной отправки.
- Вложения: PDF целиком или ссылка с коротким сроком.
- Настройки уведомлений: где хранятся (1С или посредник) и какие есть.
- Ключ VAPID и формат push.
- Скорость: календарь и отчёты кэшируются в приложении на 60 с в пределах экрана; главная — всегда свежая.

## Проверки

```bash
node tests/e2e.cjs                 # демо: все экраны, iPhone 13 и десктоп
node tests/server-mock.cjs         # режим «сервер» на подменённых ответах API (без сервера)
node tests/server-mock.cjs --shots # + скриншоты состояний в screenshots/server
```
