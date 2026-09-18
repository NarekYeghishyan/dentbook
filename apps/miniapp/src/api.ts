/** Запросы Mini App к /v1/miniapp: подпись Telegram в заголовке `tma` (§8). */
import type { ErrorCode } from '@dentbook/shared/errors';
import { initData } from './telegram';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'network_error',
    readonly body: Record<string, unknown> | null,
  ) {
    super(code);
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { authorization: `tma ${initData()}` } };
  if (body !== undefined) {
    init.headers = { ...init.headers, 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`/v1/miniapp${path}`, init);
  } catch {
    throw new ApiError(0, 'network_error', null);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const code = (data?.error as { code?: ErrorCode } | undefined)?.code ?? 'internal_error';
    throw new ApiError(res.status, code, data);
  }
  return data as T;
}
