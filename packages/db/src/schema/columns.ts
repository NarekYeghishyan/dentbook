import { sql, type SQL } from 'drizzle-orm';
import { customType, timestamp } from 'drizzle-orm/pg-core';

/** Регистронезависимый текст (расширение citext) — для email. */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/** timestamptz. В приложении — Date, момент времени в UTC (CLAUDE.md §2.3). */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const createdAt = () => timestamptz('created_at').notNull().defaultNow();

/** updated_at выставляет приложение, триггеров в БД нет (ADR-0003). */
export const updatedAt = () =>
  timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/**
 * Условие `column IN ('a', 'b')` для CHECK из списка констант @dentbook/shared,
 * чтобы допустимые значения в БД и в коде не расходились.
 */
export function oneOf(column: string, values: readonly string[]): SQL {
  const list = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');
  return sql.raw(`${column} IN (${list})`);
}

/** Условие CHECK на телефон в формате E.164. */
export const e164 = (column: string): SQL => sql.raw(`${column} ~ '^\\+[1-9][0-9]{6,14}$'`);
