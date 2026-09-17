# ADR-0001. Инструменты монорепо

Дата: 2026-09-17
Статус: принято

## Контекст

CLAUDE.md §3 фиксирует стек, но не версии инструментов и не способ сборки TypeScript
в монорепо. Нужен один набор правил для пяти приложений и трёх пакетов.

## Решение

- pnpm workspaces, `apps/*` и `packages/*`, внутренние зависимости через `workspace:*`.
- Пакеты экспортируют исходники (`"exports": "./src/index.ts"`), а не собранный `dist`.
  Для внутреннего монорепо это убирает шаг сборки из цикла разработки; публикации в npm
  не планируется. TODO: если появится отдельный деплой пакетов — перейти на `dist`.
- TypeScript project references (`composite: true`) для `shared`, `core`, `db`, `api`,
  `worker`. Фронтенды (`admin`, `miniapp`, `widget`) собирает Vite, у них `noEmit`.
- Один общий `tsconfig.base.json`: strict плюс `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.
- Vitest один на корень (`vitest.config.ts`), покрытие считается по `packages/core`,
  `packages/shared`, `apps/api`.
- Драйвер Postgres — `pg` (node-postgres). Он даёт `error.code` напрямую, что нужно
  для обработки `23P01` из §2.1.

## Последствия

- `pnpm lint && pnpm test` из корня покрывают весь репозиторий — как требует §10.
- Экспорт исходников означает, что потребитель пакета компилирует его сам; для
  `apps/api` это нормально (`tsx` в dev, `tsc -b` в build).
