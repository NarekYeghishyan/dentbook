import { z } from 'zod';

/**
 * Конфигурация — только переменные окружения, разбор при старте (CLAUDE.md §9).
 * Здесь перечислено то, что нужно API сегодня; переменные шагов 5–8
 * (TELEGRAM_*, SMS_*, CAPTCHA_*, JWT_*) добавляются на своих шагах — см. .env.example.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  // TODO: строгая проверка формата DSN — когда будет выбран пул соединений (Шаг 1)
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // В сообщение попадают только имена переменных: значения — секреты
    const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return parsed.data;
}
