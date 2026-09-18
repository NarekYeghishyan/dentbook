/** Запросы формы к /v1/public (§7) с ключом pk_. Типы — из @dentbook/shared, без zod. */
import type { ErrorCode } from '@dentbook/shared/errors';

export class WidgetApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'network_error',
    readonly body: Record<string, unknown> | null,
  ) {
    super(code);
  }
}

export interface Api {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  del(path: string): Promise<void>;
}

export function createApi(baseUrl: string, key: string): Api {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, headers: { authorization: `Bearer ${key}` } };
    if (body !== undefined) {
      init.headers = { ...init.headers, 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/v1/public${path}`, init);
    } catch {
      throw new WidgetApiError(0, 'network_error', null);
    }
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const code = (data?.error as { code?: ErrorCode } | undefined)?.code ?? 'internal_error';
      throw new WidgetApiError(res.status, code, data);
    }
    return data as T;
  }
  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    del: (path) => request('DELETE', path),
  };
}
