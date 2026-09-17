# @dentbook/db

Схема Drizzle, миграции и сиды.

- `pnpm migrate:generate` (из корня) — сгенерировать миграцию из изменений схемы;
- `pnpm migrate` — применить миграции;
- `pnpm seed` — залить демо-данные.

Правила:

- SQL руками в БД не применяется, только drizzle-kit (CLAUDE.md §9);
- имена таблиц и полей — как в `schema.sql` в корне репозитория (CLAUDE.md §5);
- расширения `btree_gist`, `pgcrypto`, `citext` создаются первой миграцией;
- ограничение `appointments_no_dentist_overlap` (EXCLUDE USING gist) обязательно — см. CLAUDE.md §2.1.
