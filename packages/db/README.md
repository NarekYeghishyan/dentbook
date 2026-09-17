# @dentbook/db

Схема Drizzle, миграции, сиды и клиент БД. Решения — [ADR-0003](../../docs/adr/0003-schema-design.md).

## Команды (из корня репозитория)

| Команда                             | Что делает                                           |
| ----------------------------------- | ---------------------------------------------------- |
| `pnpm db:up`                        | поднять Postgres и Redis (docker compose)            |
| `pnpm migrate`                      | применить миграции                                   |
| `pnpm migrate:generate`             | сгенерировать миграцию из изменений `src/schema`     |
| `pnpm seed`                         | демо-клиника; повторный запуск ничего не меняет      |
| `pnpm --filter @dentbook/db studio` | drizzle-kit studio                                   |
| `pnpm exec vitest run packages/db`  | тесты пакета; интеграционным нужен запущенный Docker |

## Как менять схему

1. Поправить `src/schema/*.ts` **и** `schema.sql` в корне — одинаково.
2. `pnpm migrate:generate --name=<что_меняем>` и просмотреть SQL.
3. То, что Drizzle не выражает (EXCLUDE, gist по выражению, расширения):
   `pnpm --filter @dentbook/db exec drizzle-kit generate --custom --name=<что_меняем>`
   и написать SQL руками в созданном файле.
4. `pnpm test` — тест паритета сравнит мигрированную БД со `schema.sql`.

## Правила

- SQL руками в рабочую БД не применяется, только `drizzle-kit migrate` (CLAUDE.md §9).
  `drizzle-kit push` не используется: он сверяется с живой БД и удалил бы объекты из
  кастомных миграций.
- Имена таблиц, колонок и ограничений — как в `schema.sql` (CLAUDE.md §5).
- Ограничение `appointments_no_dentist_overlap` (миграция `0002`) — единственная защита от
  двойной брони (CLAUDE.md §2.1). Нарушение распознаётся через `isExclusionViolation(err)`.
- Каждое чтение и запись данных клиники фильтруется по `clinic_id` (CLAUDE.md §2.2).
- `createDatabase()` открывает сессии в UTC (CLAUDE.md §2.3).
