import { Redis } from 'ioredis';
import { createDatabase } from '@dentbook/db';
import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { providersFromEnv } from './services/providers.js';
import { BullQueueInspector } from './services/queues.js';
import { BullSmsOutbox } from './services/sms-outbox.js';
import { BullTelegramOutbox } from './telegram/outbox.js';

const env = loadEnv();
const { db, pool } = createDatabase(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL);
// Бот Telegram (§8): наличие имени, секрета и адреса при токене проверяет loadEnv()
const outbox = env.TELEGRAM_BOT_TOKEN ? new BullTelegramOutbox(redis) : undefined;
const telegram = outbox
  ? {
      botToken: env.TELEGRAM_BOT_TOKEN!,
      botUsername: env.TELEGRAM_BOT_USERNAME!,
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET!,
      miniAppUrl: new URL('/miniapp/', env.PUBLIC_BASE_URL).toString(),
      outbox,
    }
  : undefined;
// SMS-уведомления клиентам (Шаг 8) — при настроенном провайдере, как и коды подтверждения
const smsOutbox = env.SMS_PROVIDER ? new BullSmsOutbox(redis) : undefined;
const queues = new BullQueueInspector(redis);
const app = buildApp({
  env,
  db,
  redis,
  ...providersFromEnv(env),
  ...(smsOutbox ? { smsOutbox } : {}),
  queues,
  ...(telegram ? { telegram } : {}),
});

redis.on('error', (err: Error) => app.log.error({ err: err.message }, 'redis connection error'));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => Promise.all([outbox?.close(), smsOutbox?.close(), queues.close()]))
      .then(() => Promise.all([pool.end(), redis.quit()]))
      .then(() => process.exit(0));
  });
}

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
