import { randomUUID } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Database } from '@dentbook/db';
import type { Env } from './env.js';
import { ApiError, errorHandler, sendError, serializeError } from './lib/errors.js';
import { adminStatic } from './plugins/admin-static.js';
import { sessionPlugin } from './plugins/session.js';
import { adminRoutes } from './routes/admin/index.js';

export interface AppDeps {
  env: Env;
  db: Database;
  /** false — без логов (тесты). */
  logger?: LoggerOption;
}

type LoggerOption = NonNullable<FastifyServerOptions['logger']>;

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
      ],
      censor: '[redacted]',
    },
    serializers: { err: serializeError },
    ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  };
}

/**
 * Приложение без запуска сервера: index.ts слушает порт, тесты зовут inject().
 * Плагины регистрируются без await и загружаются на ready() — тест успевает
 * повесить свои хуки (например, onRoute) до загрузки роутов.
 */
export function buildApp({ env, db, logger }: AppDeps): FastifyInstance {
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

  // Лимиты только там, где роут их объявил (config.rateLimit).
  // TODO(Шаг 5): хранилище в Redis — сейчас счётчики в памяти одного процесса API.
  app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) =>
      new ApiError(429, 'rate_limited', `Too many requests, retry in ${context.after}`),
  });
  app.register(sessionPlugin, {
    db,
    secret: env.JWT_SECRET,
    ttlSec: env.JWT_ACCESS_TTL,
    secureCookie: env.NODE_ENV === 'production',
  });

  app.get('/health', async () => ({ status: 'ok' as const }));
  app.register(adminRoutes, { prefix: '/v1/admin', db, authRateLimitPerMin: env.AUTH_RATE_LIMIT });
  if (env.ADMIN_DIST_DIR) app.register(adminStatic, { root: env.ADMIN_DIST_DIR });

  return app;
}
