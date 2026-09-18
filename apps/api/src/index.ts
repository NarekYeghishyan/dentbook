import { Redis } from 'ioredis';
import { createDatabase } from '@dentbook/db';
import { buildApp } from './app.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const { db, pool } = createDatabase(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL);
// TODO(Шаг 6): провайдер SMS (Q5) — до него POST /v1/public/verifications отвечает 503
const app = buildApp({ env, db, redis });

redis.on('error', (err: Error) => app.log.error({ err: err.message }, 'redis connection error'));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app
      .close()
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
