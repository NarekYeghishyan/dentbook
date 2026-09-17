# Changelog

All notable changes to this project are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); entries are grouped
by the [Conventional Commits](https://www.conventionalcommits.org/) type of the change that
produced them (CLAUDE.md §9).

Один раздел на шаг плана из CLAUDE.md §10. Раздел закрывается только когда выполнен
критерий «Готово» этого шага.

## [Unreleased]

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
