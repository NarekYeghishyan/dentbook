import { randomUUID } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import type { Redis } from 'ioredis';
import type { Database } from '@dentbook/db';
import type { Env } from './env.js';
import { ApiError, errorHandler, sendError, serializeError } from './lib/errors.js';
import { adminStatic } from './plugins/admin-static.js';
import { sessionPlugin } from './plugins/session.js';
import { adminRoutes } from './routes/admin/index.js';
import { publicRoutes } from './routes/public/index.js';
import { RedisSlotCache } from './services/slot-cache.js';
import type { SmsSender } from './services/sms.js';
import { deriveVerificationKey } from './services/verification.js';

export interface AppDeps {
  env: Env;
  db: Database;
  /**
   * Redis: кеш слотов, лимиты запросов. Без него (часть тестов) нет кеша и публичного API —
   * лимит на ключ в §7 без общего счётчика не выполнить.
   */
  redis?: Redis;
  /** Отправка SMS; до Шага 6 провайдера нет — POST /verifications отвечает 503. */
  sms?: SmsSender;
  /** false — без логов (тесты). */
  logger?: LoggerOption;
}

type LoggerOption = NonNullable<FastifyServerOptions['logger']>;

/** Запрос в логе: токен записи из query (GET /appointments/:id?token=) не пишется. */
const serializeRequest = (request: FastifyRequest) => ({
  method: request.method,
  url: request.url.replace(/([?&]token=)[^&]*/g, '$1[redacted]'),
  remoteAddress: request.ip,
});

function loggerOptions(env: Env): LoggerOption {
  return {
    level: env.LOG_LEVEL,
    // ПДн клиентов не логируются (CLAUDE.md §2.6)
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'req.body.phone',
        'req.body.email',
        'req.body.client',
        'req.body.code',
        'req.body.token',
      ],
      censor: '[redacted]',
    },
    serializers: { err: serializeError, req: serializeRequest },
    ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  };
}

/**
 * Приложение без запуска сервера: index.ts слушает порт, тесты зовут inject().
 * Плагины регистрируются без await и загружаются на ready() — тест успевает
 * повесить свои хуки (например, onRoute) до загрузки роутов.
 */
export function buildApp({ env, db, redis, sms, logger }: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: logger ?? loggerOptions(env),
    // Сквозной request_id (CLAUDE.md §9)
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    // Перед API ровно один прокси — nginx: доверяем одному ближайшему звену. Всей цепочке
    // X-Forwarded-For доверять нельзя — её начало присылает клиент, лимиты по IP обходились бы.
    trustProxy: (_address: string, hop: number) => hop < 1,
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((_request, reply) =>
    sendError(reply, 404, 'not_found', 'Route not found'),
  );

  // Лимиты только там, где роут их объявил (config.rateLimit). С Redis счётчики общие
  // для всех процессов API, без него — в памяти процесса.
  app.register(rateLimit, {
    global: false,
    ...(redis ? { redis, nameSpace: 'ratelimit:route:' } : {}),
    errorResponseBuilder: (_request, context) =>
      new ApiError(429, 'rate_limited', `Too many requests, retry in ${context.after}`),
  });
  app.register(sessionPlugin, {
    db,
    secret: env.JWT_SECRET,
    ttlSec: env.JWT_ACCESS_TTL,
    secureCookie: env.NODE_ENV === 'production',
  });

  const cache = redis ? new RedisSlotCache(redis, app.log) : undefined;

  app.get('/health', async () => ({ status: 'ok' as const }));
  app.register(adminRoutes, {
    prefix: '/v1/admin',
    db,
    authRateLimitPerMin: env.AUTH_RATE_LIMIT,
    ...(cache ? { cache } : {}),
  });
  if (redis) {
    app.register(publicRoutes, {
      prefix: '/v1/public',
      db,
      redis,
      ...(cache ? { cache } : {}),
      ...(sms ? { sms } : {}),
      holdTtlSec: env.HOLD_TTL_SEC,
      perKeyPerMin: env.PUBLIC_KEY_RATE_LIMIT,
      perIpPerMin: env.PUBLIC_IP_RATE_LIMIT,
      verificationKey: deriveVerificationKey(env.JWT_SECRET),
    });
  }
  if (env.ADMIN_DIST_DIR) app.register(adminStatic, { root: env.ADMIN_DIST_DIR });

  return app;
}
