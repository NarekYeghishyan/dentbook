import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { pgErrorCode } from '@dentbook/db';
import type { ApiErrorBody, ErrorCode } from '@dentbook/shared';

/** Ошибка с кодом из @dentbook/shared (CLAUDE.md §7). */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const unauthorized = (message = 'Authentication required') =>
  new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'Not allowed for this role') =>
  new ApiError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new ApiError(404, 'not_found', message);

/** Разбор входа zod-схемой из @dentbook/shared; ошибка — validation_failed. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    // В сообщение — только пути полей: значения могут быть ПДн (§2.6)
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.') || '(body)'))];
    throw new ApiError(400, 'validation_failed', `Invalid fields: ${fields.join(', ')}`);
  }
  return result.data;
}

/** Ошибка в логе: pino ждёт type, message и stack. */
export interface SerializedError {
  type: string;
  message: string;
  stack: string;
  [key: string]: unknown;
}

/**
 * Ошибка для лога без ПДн (§2.6). У ошибок БД в message, detail и stack — параметры
 * запроса и значения ключей (email, телефон), поэтому от них остаются только код,
 * таблица и ограничение.
 */
export function serializeError(err: unknown): SerializedError {
  const sqlState = pgErrorCode(err);
  if (sqlState !== undefined || (err instanceof Error && err.name === 'DrizzleQueryError')) {
    const cause = (err as { cause?: { constraint?: string; table?: string } }).cause;
    return {
      type: 'DatabaseError',
      message: 'Database error',
      stack: '',
      code: sqlState,
      table: cause?.table,
      constraint: cause?.constraint,
    };
  }
  if (err instanceof Error) return { type: err.name, message: err.message, stack: err.stack ?? '' };
  return { type: typeof err, message: '', stack: '' };
}

function statusToCode(statusCode: number): ErrorCode {
  if (statusCode === 401) return 'unauthorized';
  if (statusCode === 403) return 'forbidden';
  if (statusCode === 404) return 'not_found';
  if (statusCode === 429) return 'rate_limited';
  return 'validation_failed';
}

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: ErrorCode,
  message: string,
) {
  const body: ApiErrorBody = { error: { code, message } };
  return reply.status(statusCode).send(body);
}

/** Единый формат ошибок для всех роутов. */
export function errorHandler(err: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ApiError) {
    return sendError(reply, err.statusCode, err.code, err.message);
  }
  // Ошибки Fastify и плагинов уровня запроса: битый JSON, 415, лимит запросов
  const statusCode = err.statusCode ?? 500;
  if (statusCode >= 400 && statusCode < 500) {
    return sendError(reply, statusCode, statusToCode(statusCode), err.message);
  }
  request.log.error({ err: serializeError(err) }, 'unhandled error');
  return sendError(reply, 500, 'internal_error', 'Internal server error');
}
