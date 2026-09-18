/** Запросы к /v1/admin. Сессия — httpOnly-cookie того же домена (ADR-0006). */
import type { ErrorCode } from '@dentbook/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'network_error',
    message: string,
    /** Тело ответа целиком: у 409 там бывают conflicts, у 400 — overlap. */
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`/v1/admin${path}`, init);
  } catch {
    throw new ApiError(0, 'network_error', 'Network error', null);
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (data as { error?: { code?: ErrorCode; message?: string } } | null)?.error;
    throw new ApiError(
      res.status,
      error?.code ?? 'internal_error',
      error?.message ?? res.statusText,
      data,
    );
  }
  return data as T;
}

export const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;
