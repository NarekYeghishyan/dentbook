import { Redis } from 'ioredis';
import { createDatabase } from '@dentbook/db';
import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { providersFromEnv } from './services/providers.js';
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
const app = buildApp({
  env,
  db,
  redis,
  ...providersFromEnv(env),
  ...(telegram ? { telegram } : {}),
});

redis.on('error', (err: Error) => app.log.error({ err: err.message }, 'redis connection error'));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => outbox?.close())
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
