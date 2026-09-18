/**
 * Доступ к /v1/public по публикуемому ключу (CLAUDE.md §2.5): Authorization: Bearer pk_…
 * и заголовок Origin из allowed_origins ключа, иначе 403. Ключ даёт только чтение
 * доступности и создание записи — других роутов в этой области нет.
 *
 * Регистрируется внутри области /v1/public (не fastify-plugin): хуки не касаются админки.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { apiKeys, clinics, type Database } from '@dentbook/db';
import { ApiError } from '../lib/errors.js';

export interface PublicContext {
  keyId: string;
  clinicId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    publicKey: PublicContext | null;
  }
}

export interface PublicAuthOptions {
  db: Database;
  redis: Redis;
  /** Запросов в минуту на ключ (Q4: 60). */
  perKeyPerMin: number;
}

const BEARER = /^Bearer (pk_[A-Za-z0-9_-]{8,128})$/;
const LAST_USED_EVERY_MS = 10 * 60_000;

export const invalidKey = () => new ApiError(401, 'invalid_key', 'Invalid or revoked API key');

export function publicOf(request: FastifyRequest): PublicContext {
  if (!request.publicKey) throw invalidKey();
  return request.publicKey;
}

export function registerPublicAuth(
  app: FastifyInstance,
  { db, redis, perKeyPerMin }: PublicAuthOptions,
) {
  app.decorateRequest('publicKey', null);

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    // Ответ читаем для любого Origin, в том числе ошибка: данных в нём нет, пока ключ и
    // Origin не проверены ниже
    if (origin) {
      reply.header('access-control-allow-origin', origin);
      reply.header('access-control-expose-headers', 'retry-after');
      reply.header('vary', 'Origin');
    }
    if (request.method === 'OPTIONS') return;

    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw invalidKey();
    const [key] = await db
      .select({
        id: apiKeys.id,
        clinicId: apiKeys.clinicId,
        allowedOrigins: apiKeys.allowedOrigins,
        lastUsedAt: apiKeys.lastUsedAt,
        clinicStatus: clinics.status,
      })
      .from(apiKeys)
      .innerJoin(clinics, eq(clinics.id, apiKeys.clinicId))
      .where(and(eq(apiKeys.token, token), isNull(apiKeys.revokedAt)))
      .limit(1);
    if (!key || key.clinicStatus !== 'active') throw invalidKey();
    if (!origin || !key.allowedOrigins.includes(origin.toLowerCase())) {
      throw new ApiError(403, 'origin_not_allowed', 'This website is not allowed to use the key');
    }

    // Фиксированное окно в минуту на ключ, счётчик в Redis — общий для всех процессов API
    const window = Math.floor(Date.now() / 60_000);
    const bucket = `ratelimit:pk:${key.id}:${window}`;
    const count = await redis.incr(bucket);
    if (count === 1) await redis.expire(bucket, 60);
    if (count > perKeyPerMin) {
      reply.header('retry-after', String(60 - (Math.floor(Date.now() / 1000) % 60)));
      throw new ApiError(429, 'rate_limited', 'Too many requests for this key');
    }

    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > LAST_USED_EVERY_MS) {
      void db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, key.id))
        .catch((err: Error) =>
          request.log.warn({ err: err.message }, 'last_used_at update failed'),
        );
    }
    request.publicKey = { keyId: key.id, clinicId: key.clinicId };
  });

  // Preflight: Authorization в запросе браузера → OPTIONS без ключа. Сам запрос проверяется
  app.options('/*', async (_request, reply) =>
    reply
      .status(204)
      .header('access-control-allow-methods', 'GET, POST, DELETE')
      .header('access-control-allow-headers', 'authorization, content-type')
      .header('access-control-max-age', '600')
      .send(),
  );
}
