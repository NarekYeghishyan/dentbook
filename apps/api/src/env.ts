import { z } from 'zod';

/**
 * Конфигурация — только переменные окружения, разбор при старте (CLAUDE.md §9).
 * Здесь перечислено то, что нужно API сегодня; переменные шагов 5–8
 * (TELEGRAM_*, SMS_*, CAPTCHA_*) добавляются на своих шагах — см. .env.example.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  // TODO: строгая проверка формата DSN — когда будет выбран пул соединений (Шаг 1)
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  // Подпись сессий админки (HS256): не короче 32 символов — `openssl rand -hex 32`
  JWT_SECRET: z.string().min(32),
  // Время жизни сессии админки, секунды (по умолчанию 12 ч)
  JWT_ACCESS_TTL: z.coerce
    .number()
    .int()
    .positive()
    .default(12 * 60 * 60),
  // Попыток входа и регистрации в минуту с одного IP
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  // Каталог собранной админки (vite build); не задан — /admin не раздаётся
  ADMIN_DIST_DIR: z.string().min(1).optional(),
  // Сколько секунд держится слот после POST /holds (Q4: 10 мин)
  HOLD_TTL_SEC: z.coerce.number().int().positive().default(600),
  // Лимиты публичного API (Q4): запросов в минуту на ключ; холдов и SMS в минуту с IP
  PUBLIC_KEY_RATE_LIMIT: z.coerce.number().int().positive().default(60),
  PUBLIC_IP_RATE_LIMIT: z.coerce.number().int().positive().default(10),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Пустое значение — «не задано»: .env, скопированный из .env.example, получает умолчания
  const defined = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const parsed = envSchema.safeParse(defined);
  if (!parsed.success) {
    // В сообщение попадают только имена переменных: значения — секреты
    const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return parsed.data;
}
