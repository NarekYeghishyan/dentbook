import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { createDatabase } from '@dentbook/db';
import { loadEnv } from './env.js';
import { EXPIRE_HOLDS_EVERY_MS, EXPIRE_HOLDS_QUEUE, expireHolds } from './jobs/expire-holds.js';

const env = loadEnv();

const log = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
});

// BullMQ требует maxRetriesPerRequest: null, иначе теряет блокирующие команды
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', (err: Error) => log.error({ err: err.message }, 'redis connection error'));

const { db, pool } = createDatabase(env.DATABASE_URL, { max: 2 });

/**
 * Обработчики по шагам: очистка истёкших холдов (Шаг 5), отправка в Telegram (Шаг 7),
 * SMS и напоминания за 24 ч / 2 ч (Шаг 8).
 */
const holdsQueue = new Queue(EXPIRE_HOLDS_QUEUE, { connection });
// Одно расписание на все процессы worker: повторная регистрация его не дублирует
await holdsQueue.upsertJobScheduler(EXPIRE_HOLDS_QUEUE, { every: EXPIRE_HOLDS_EVERY_MS });

const workers = [
  new Worker(
    EXPIRE_HOLDS_QUEUE,
    async () => {
      const expired = await expireHolds(db, connection);
      if (expired > 0) log.info({ expired }, 'holds expired');
    },
    { connection },
  ),
];
for (const worker of workers) {
  worker.on('failed', (job, err) =>
    log.error({ queue: job?.queueName, err: err.message }, 'job failed'),
  );
}

log.info({ queues: [EXPIRE_HOLDS_QUEUE] }, 'worker started');

async function shutdown(): Promise<void> {
  await Promise.all(workers.map((worker) => worker.close()));
  await holdsQueue.close();
  await connection.quit();
  await pool.end();
  log.info('worker stopped');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown().then(() => process.exit(0));
  });
}
