# Changelog

All notable changes to this project are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); entries are grouped
by the [Conventional Commits](https://www.conventionalcommits.org/) type of the change that
produced them (CLAUDE.md §9).

Один раздел на шаг плана из CLAUDE.md §10. Раздел закрывается только когда выполнен
критерий «Готово» этого шага.

## [Unreleased]

### Шаг 1 — каркас и БД (в работе)

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

#### Changed

- `feat(shared): add auth and not-found error codes` — `unauthorized`, `forbidden`,
  `not_found`, `internal_error` в `ERROR_CODES` и в CLAUDE.md §7 (решение заказчика, Q2).

#### Verified

- `pnpm install` — 9 workspace-проектов, постинсталл-скрипты разрешены поимённо
  (`allowBuilds`);
- `pnpm typecheck`, `pnpm lint`, `pnpm test` — проходят;
- `docker compose config` — валиден;
- падение API при отсутствии `DATABASE_URL`/`REDIS_URL` — проверено запуском.

#### Pending

Критерий «Готово» Шага 1 не выполнен: нет `schema.sql`, схемы Drizzle, миграций, сидов и
теста на конкурентную вставку. Блокер — `docs/OPEN-QUESTIONS.md` § Q1.
