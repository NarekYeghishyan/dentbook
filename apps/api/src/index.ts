import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { loadEnv } from './env.js';

const env = loadEnv();

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    // ПДн клиентов не логируются (CLAUDE.md §2.6)
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.phone',
        'req.body.email',
      ],
      censor: '[redacted]',
    },
    ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  },
  // Сквозной request_id (CLAUDE.md §9)
  requestIdHeader: 'x-request-id',
  genReqId: () => randomUUID(),
  trustProxy: true,
});

app.get('/health', async () => ({ status: 'ok' as const }));

// Роуты /v1/public и /v1/admin регистрируются на шагах 3–5.

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
