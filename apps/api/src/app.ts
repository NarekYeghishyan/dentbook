import { randomUUID } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import type { Redis } from 'ioredis';
import type { Database } from '@dentbook/db';
import type { SmsSender } from '@dentbook/shared/sms';
import type { Env } from './env.js';
import { ApiError, errorHandler, sendError, serializeError } from './lib/errors.js';
import { ADMIN_HEADERS, MINIAPP_HEADERS, spaStatic } from './plugins/spa-static.js';
import { widgetStatic } from './plugins/widget-static.js';
import { sessionPlugin } from './plugins/session.js';
import { adminRoutes } from './routes/admin/index.js';
import { miniappRoutes } from './routes/miniapp/index.js';
import { publicRoutes } from './routes/public/index.js';
import type { CaptchaVerifier } from './services/captcha.js';
import { createNotifier } from './services/notifier.js';
import type { SmsOutbox } from './services/sms-outbox.js';
import { RedisSlotCache } from './services/slot-cache.js';
import { deriveVerificationKey } from './services/verification.js';
import type { TelegramConfig } from './telegram/outbox.js';
import { telegramWebhook } from './telegram/webhook.js';

export interface AppDeps {
  env: Env;
  db: Database;
  /**
   * Redis: кеш слотов, лимиты запросов. Без него (часть тестов) нет кеша и публичного API —
   * лимит на ключ в §7 без общего счётчика не выполнить.
   */
  redis?: Redis;
  /** Отправка SMS; без провайдера POST /verifications отвечает 503. */
  sms?: SmsSender;
  /** Очередь SMS-уведомлений клиентам (Шаг 8); без неё напоминаний нет. */
  smsOutbox?: SmsOutbox;
  /** Капча перед SMS; без неё код отправляется без капчи. */
  captcha?: CaptchaVerifier;
  /** Бот Telegram (§8); без него нет вебхука, Mini App и алертов врачам. */
  telegram?: TelegramConfig;
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
export function buildApp({
  env,
  db,
  redis,
  sms,
  smsOutbox,
  captcha,
  telegram,
  logger,
}: AppDeps): FastifyInstance {
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
  const notifier = createNotifier({ db, telegram, sms: smsOutbox, log: app.log });

  app.get('/health', async () => ({ status: 'ok' as const }));
  app.register(adminRoutes, {
    prefix: '/v1/admin',
    db,
    authRateLimitPerMin: env.AUTH_RATE_LIMIT,
    notifier,
    ...(cache ? { cache } : {}),
    ...(telegram ? { telegramBot: telegram.botUsername } : {}),
  });
  if (redis) {
    app.register(publicRoutes, {
      prefix: '/v1/public',
      db,
      redis,
      ...(cache ? { cache } : {}),
      ...(sms ? { sms } : {}),
      ...(captcha ? { captcha } : {}),
      holdTtlSec: env.HOLD_TTL_SEC,
      perKeyPerMin: env.PUBLIC_KEY_RATE_LIMIT,
      perIpPerMin: env.PUBLIC_IP_RATE_LIMIT,
      verificationKey: deriveVerificationKey(env.JWT_SECRET),
      notifier,
    });
  }
  if (telegram) {
    app.register(telegramWebhook, { prefix: '/telegram', db, telegram, notifier });
    app.register(miniappRoutes, {
      prefix: '/v1/miniapp',
      db,
      botToken: telegram.botToken,
      notifier,
      ...(cache ? { cache } : {}),
    });
  }
  if (env.ADMIN_DIST_DIR) {
    app.register(spaStatic, {
      root: env.ADMIN_DIST_DIR,
      basePath: '/admin/',
      headers: ADMIN_HEADERS,
    });
  }
  if (env.MINIAPP_DIST_DIR) {
    app.register(spaStatic, {
      root: env.MINIAPP_DIST_DIR,
      basePath: '/miniapp/',
      headers: MINIAPP_HEADERS,
    });
  }
  if (env.WIDGET_DIST_DIR) app.register(widgetStatic, { root: env.WIDGET_DIST_DIR });

  return app;
}
