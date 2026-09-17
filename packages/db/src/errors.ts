/** SQLSTATE-коды Postgres, которые код обрабатывает явно. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';
/** Нарушение appointments_no_dentist_overlap → slot_taken (CLAUDE.md §2.1). */
export const PG_EXCLUSION_VIOLATION = '23P01';

const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * SQLSTATE ошибки Postgres. drizzle-orm (>= 0.44) оборачивает ошибку драйвера
 * в DrizzleQueryError, исходная лежит в cause — поэтому идём по цепочке.
 */
export function pgErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && SQLSTATE.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export const isExclusionViolation = (err: unknown): boolean =>
  pgErrorCode(err) === PG_EXCLUSION_VIOLATION;
