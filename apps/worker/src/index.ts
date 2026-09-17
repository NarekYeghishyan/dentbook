import { Redis } from 'ioredis';
import { pino } from 'pino';
import { loadEnv } from './env.js';

const env = loadEnv();

const log = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
});

// BullMQ требует maxRetriesPerRequest: null, иначе теряет блокирующие команды
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

connection.on('error', (err: Error) => log.error({ err: err.message }, 'redis connection error'));

/**
 * Обработчики регистрируются на своих шагах:
 * очистка истёкших холдов (Шаг 5), отправка в Telegram (Шаг 7),
 * SMS и напоминания за 24 ч / 2 ч (Шаг 8).
 */
const workers: { close(): Promise<void> }[] = [];

log.info({ registered: workers.length }, 'worker started');

async function shutdown(): Promise<void> {
  await Promise.all(workers.map((worker) => worker.close()));
  await connection.quit();
  log.info('worker stopped');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown().then(() => process.exit(0));
  });
}
