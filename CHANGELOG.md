# Changelog

All notable changes to this project are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); entries are grouped
by the [Conventional Commits](https://www.conventionalcommits.org/) type of the change that
produced them (CLAUDE.md §9).

Один раздел на шаг плана из CLAUDE.md §10. Раздел закрывается только когда выполнен
критерий «Готово» этого шага.

## [Unreleased]

### Шаг 3 — аутентификация и тенантность (закрыт 2026-09-18)

#### Added

- `feat(shared): add admin api schemas` — `validators.ts` (пояс, валюта, email, пароль, языки
  en/ru/hy), `admin.ts` (регистрация, вход, настройки клиники, сотрудники, формы ответов).
- `feat(api): add app factory and error handling` — `buildApp()` для сервера и тестов, единый
  формат ошибок §7, `parse()` через zod, ошибки БД в логах без ПДн (§2.6), `trustProxy` на одно
  звено.
- `feat(api): add admin sessions` — JWT в httpOnly-cookie (`SameSite=Strict`), пароли на
  `scrypt`, роль и активность из БД на каждом запросе, `config.roles` на роутах.
- `feat(api): add clinic registration and login` — `/v1/admin/auth/register|login|logout`,
  лимит попыток по IP, `GET /v1/admin/me`.
- `feat(api): add clinic settings and staff management` — `GET|PATCH /v1/admin/clinic`,
  `GET|POST /v1/admin/users`, `GET|PATCH /v1/admin/users/:id`.
- `test(db): add test database helper` — `@dentbook/db/testing`: Postgres в Testcontainers
  с миграциями.
- `test(api): cover auth, staff and tenant isolation` — изоляция тенантов на каждом роуте
  `/v1/admin`, сессии (истёкшая, чужая подпись, отключённый сотрудник, смена роли),
  приостановленная клиника, оператор платформы, лимит попыток.
- `docs: add ADR-0006` — сессии, роли, изоляция тенантов.

#### Changed

- `.env.example`: `JWT_SECRET`, `JWT_ACCESS_TTL`, `AUTH_RATE_LIMIT`; `JWT_REFRESH_TTL` убран —
  refresh-токенов нет (ADR-0006). `deploy/README.md`: `JWT_SECRET` на сервере.

#### Fixed

- до коммита: срок сессии задавался числом, и `@fastify/jwt` понимал его как секунды вместо
  миллисекунд — сессия жила бы в 1000 раз дольше. Срок передаётся строкой (`43200s`),
  тест на истёкшую сессию это проверяет.

#### Verified

- 166 тестов, `pnpm lint`, `pnpm typecheck` зелёные;
- тест изоляции падает, если убрать фильтр по `clinic_id` из запроса сотрудника.

### Шаг 2 — движок доступности (закрыт 2026-09-18)

#### Added

- `feat(core): add interval arithmetic and time zone helpers` — `intervals.ts` (полуоткрытые
  интервалы: нормализация, вычитание), `tz.ts` (настенное время ↔ UTC через `Intl`, границы
  местных суток, поведение в дни перевода часов как Temporal `compatible`).
- `feat(core): expand weekly working hours to utc` — `working-hours.ts`: шаблон `working_hours`
  → UTC-интервалы на дату, ночные смены (`end <= start`), `24:00`.
- `feat(core): pick dentist by priority and load` — `pickDentist` (§6).
- `feat(core): compute available slots` — `computeSlots` в порядке §6, `computeDaySlots`
  (слоты на местную дату), `mergeSlots` («любой врач»).
- `test(core): enforce coverage threshold` — порог 90% для `packages/core` в `vitest.config.ts`.
- `docs: add ADR-0005` — сетка, сутки, часовые пояса.

#### Verified

- 95 unit-тестов: буферы (услуги и записи), `block`/`extra`, границы рабочих часов,
  `notBefore`, полночь, DST в Нью-Йорке и Берлине, пояса без DST и с получасовым смещением;
- покрытие логики `packages/core` 100% (`index.ts` и `types.ts` — без исполняемого кода);
- тесты ловят поломки: без буфера записи, без ночной смены прошлого дня, при выборе второго
  из двух времён осенью.

### Тестовый стенд (вне порядка шагов, 2026-09-17)

#### Added

- `build: add app docker image` — `Dockerfile` и `.dockerignore`: один образ для api, worker,
  миграций и сидов; запуск через `node --import tsx` (ADR-0004).
- `build(deploy): add server compose stack` — `deploy/docker-compose.yml`: Postgres 16,
  Redis 7 (`noeviction` для BullMQ), `migrate` перед `api`/`worker`, API только на
  `127.0.0.1`, лимиты памяти.
- `build(deploy): add deploy script` — `deploy/deploy.sh`: загрузка рабочей копии без
  игнорируемых файлов, сборка образа с тегом коммита, миграции, перезапуск, очистка старых
  образов.
- `build(deploy): add nginx template` — `deploy/nginx/dentbook.conf.template`: TLS,
  ACME webroot, редирект с HTTP, прокси с `X-Request-Id` (§9).
- `docs: add deployment guide and ADR-0004` — `deploy/README.md`: подготовка сервера,
  nginx и certbot, выкладка, эксплуатация.
- `.env.example`: `POSTGRES_PASSWORD`, `API_HOST_PORT` для серверного стека.
- `docs: record test stand domains` — Q13 (закрыт: `mashna.am` — тестовый сайт клиники для
  виджета, платформа на `dentbook.mashna.am`) и Q14 (открыт: один домен или поддомены для
  частей платформы).
- `docs: record telegram link delivery` — Q15 (закрыт: ссылка привязки врача — кнопка
  «Скопировать» и QR-код в карточке врача, Шаг 7).
- `docs: resolve resources question` — Q10 (закрыт: `resources` — справочник филиала,
  в назначении врача и расчёте доступности не участвует).
- `docs: record answers to open questions` — закрыты Q4 (значения по умолчанию), Q6 (en/ru/hy,
  JSON + `t()`), Q7 (сервер — Node 22), Q11 (буфер защищается в БД, Шаг 5), Q12 (`pending` +
  повторный алерт, SMS при подтверждении), Q14 (один домен, пути). Q5: клиенты в США, капча
  Turnstile; SMS-провайдер — к Шагу 6.

#### Verified

- локально: образ собирается; стек поднимается с `--wait`; 3 миграции, 16 таблиц,
  расширения и `appointments_no_dentist_overlap` на месте; сид дважды без дублей;
  повторный `up` ничего не меняет; `/health` → 200; стек ~115 МБ RAM;
- стенд `https://dentbook.mashna.am`: `deploy.sh` проходит; `/health` → 200 через nginx,
  сертификат Let's Encrypt валиден, HTTP → HTTPS; наружу открыт только `127.0.0.1:3100`;
  соседние сайты сервера отвечают как до изменений.

### Шаг 1 — каркас и БД (закрыт 2026-09-17)

#### Added

- `chore: scaffold monorepo` — pnpm workspaces, структура `apps/*` и `packages/*` по
  CLAUDE.md §4, `tsconfig.base.json` (strict + `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), project references, ESLint,
  Prettier, Vitest, `.env.example`, `.editorconfig`.
- `chore: add docker compose` — Postgres 16 и Redis 7 с healthcheck, `TZ=UTC`/`PGTZ=UTC`
  на контейнере БД (CLAUDE.md §2.3).
- `chore: add project working docs` — `README.md`, `CHANGELOG.md`, `docs/PROGRESS.md`,
  `docs/OPEN-QUESTIONS.md`, журнал решений `docs/adr/` (ADR-0001, ADR-0002).
- `feat(shared): add stable api error codes` — `packages/shared/src/errors.ts`: коды из
  CLAUDE.md §7 и тип тела ошибки `ApiErrorBody`.
- `feat(core): add availability engine types` — `packages/core/src/types.ts`: `Interval`,
  `ScheduleException`, `BusyAppointment`, `ComputeSlotsInput` по CLAUDE.md §6.
  Пакет без зависимостей и без I/O.
- `feat(api): add fastify bootstrap` — разбор окружения через zod с падением при
  отсутствии обязательных переменных (§9), сквозной `request_id`, редакция
  `authorization`/`cookie`/`phone`/`email` в логах (§2.6), `GET /health`,
  корректное завершение по SIGINT/SIGTERM.
- `feat(worker): add worker bootstrap` — подключение к Redis с
  `maxRetriesPerRequest: null` для BullMQ, корректное завершение. Обработчики задач
  добавляются на шагах 5, 7 и 8.
- `feat(db): add drizzle-kit config` — `packages/db/drizzle.config.ts`, миграции в
  `packages/db/src/migrations`, чтение `.env` из корня монорепо.
- `test(shared): lock error codes contract` — тест на состав и отсутствие дублей в
  `ERROR_CODES`.
- `feat(db): add reference schema` — `schema.sql`: 16 таблиц из CLAUDE.md §5, ограничение
  `appointments_no_dentist_overlap` из §2.1, составные FK `(clinic_id, x_id)` для изоляции
  тенантов на уровне БД (§2.2), холды как строки `appointments`. Решения — ADR-0003,
  вопросы к согласованию — Q9-Q11.
- `feat(db): add drizzle schema and migrations` — схема Drizzle 1:1 со `schema.sql`
  (`packages/db/src/schema`), миграции `0000_extensions`, `0001_init`,
  `0002_appointments_no_overlap` (EXCLUDE из §2.1 и gist-индекс — кастомной миграцией
  drizzle-kit), клиент `createDatabase()` с сессией в UTC, `pgErrorCode()` /
  `isExclusionViolation()` с разворачиванием `DrizzleQueryError.cause`.
- `feat(db): add demo seed` — идемпотентный сид демо-клиники (Europe/Berlin — пояс с
  переходом на летнее время; есть смена через полночь).
- `feat(shared): add domain enums` — `packages/shared/src/domain.ts`: статусы, роли, виды
  уведомлений; из них же строятся CHECK-ограничения схемы.
- `test(db): add schema integration tests` — Testcontainers + `postgres:16-alpine`: 50
  конкурентных записей на один слот → ровно одна; частичное пересечение и касание границ;
  холд освобождает слот после `expired`; запись со ссылкой на чужую клинику → `23503`;
  идемпотентность сида; полный паритет каталога БД после миграций со `schema.sql`.

#### Changed

- `feat(db): add booking confirmation setting` — `clinics.booking_requires_confirmation`
  (решение заказчика, Q9): подтверждать ли записи из виджета.
- `chore: make compose host ports configurable` — `POSTGRES_PORT` / `REDIS_PORT` в `.env`
  (по умолчанию 5432 / 6379), чтобы DentBook не конфликтовал с другими проектами.
- `chore(db): remove push script` — схема меняется только миграциями (§9).
- `feat(shared): add auth and not-found error codes` — `unauthorized`, `forbidden`,
  `not_found`, `internal_error` в `ERROR_CODES` и в CLAUDE.md §7 (решение заказчика, Q2).

#### Verified

- `pnpm install` — 9 workspace-проектов, постинсталл-скрипты разрешены поимённо
  (`allowBuilds`);
- `pnpm typecheck`, `pnpm lint`, `pnpm test` — проходят;
- `docker compose config` — валиден;
- падение API при отсутствии `DATABASE_URL`/`REDIS_URL` — проверено запуском;
- `schema.sql` — 61 проверка на встроенном Postgres (PGlite, PostgreSQL 18.3): EXCLUDE,
  составные FK между клиниками, CHECK/UNIQUE, значения по умолчанию.
- на чистой БД из docker compose: `pnpm migrate` (3 миграции), `pnpm seed` дважды,
  повторный `pnpm migrate` — без изменений, `drizzle-kit generate` — «No schema changes»;
- `pnpm test` — 14 тестов, из них 7 интеграционных на PostgreSQL 16;
- чувствительность тестов: без EXCLUDE-ограничения падают 2 теста конкурентности,
  при расхождении со `schema.sql` падает тест паритета.
