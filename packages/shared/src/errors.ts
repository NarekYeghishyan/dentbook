/**
 * Стабильные коды ошибок API (CLAUDE.md §7).
 * Коды — часть публичного контракта: не переименовывать, только добавлять.
 */
export const ERROR_CODES = [
  'invalid_key',
  'origin_not_allowed',
  'rate_limited',
  'slot_taken',
  'hold_expired',
  'verification_required',
  'verification_failed',
  'outside_working_hours',
  'validation_failed',
  // Админский API и изоляция тенантов (CLAUDE.md §2.2, Шаг 3)
  'unauthorized',
  'forbidden',
  'not_found',
  'internal_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Единый формат тела ошибки для публичного и админского API. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    /** Человекочитаемое сообщение. ПДн клиентов сюда не попадают (CLAUDE.md §2.6). */
    message: string;
  };
}
