import { createDatabase } from '@dentbook/db';
import { buildApp } from './app.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const { db, pool } = createDatabase(env.DATABASE_URL);
const app = buildApp({ env, db });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
}

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
