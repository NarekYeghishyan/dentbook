import { z } from 'zod';

/**
 * Конфигурация — только переменные окружения, разбор при старте (CLAUDE.md §9).
 * Шаблон с пояснениями — .env.example.
 */
const envSchema = z
  .object({
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
    // Каталог собранного виджета; не задан — /widget не раздаётся
    WIDGET_DIST_DIR: z.string().min(1).optional(),
    // Капча Cloudflare Turnstile перед SMS (Q5); без ключей — выключена
    CAPTCHA_SITE_KEY: z.string().min(1).optional(),
    CAPTCHA_SECRET: z.string().min(1).optional(),
    // SMS (Q5): twilio; не задан — POST /v1/public/verifications отвечает 503
    SMS_PROVIDER: z.enum(['twilio']).optional(),
    TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
    TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
    // Отправитель: номер в E.164 или Messaging Service SID (MG…)
    SMS_SENDER: z.string().min(1).optional(),
    // Адрес платформы снаружи: вебхук Telegram и Mini App (https://dentbook.mashna.am)
    PUBLIC_BASE_URL: z.url().optional(),
    // Бот Telegram (§8); без токена бот, вебхук и Mini App выключены
    TELEGRAM_BOT_TOKEN: z
      .string()
      .regex(/^\d+:[\w-]{30,}$/)
      .optional(),
    TELEGRAM_BOT_USERNAME: z
      .string()
      .regex(/^\w{5,32}$/)
      .optional(),
    // Секрет заголовка X-Telegram-Bot-Api-Secret-Token: openssl rand -hex 32
    TELEGRAM_WEBHOOK_SECRET: z
      .string()
      .regex(/^[\w-]{16,256}$/)
      .optional(),
    // Каталог собранного Mini App; не задан — /miniapp не раздаётся
    MINIAPP_DIST_DIR: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    const missing = (names: (keyof typeof env)[]) =>
      names
        .filter((name) => !env[name])
        .forEach((name) => ctx.addIssue({ code: 'custom', path: [name], message: 'Required' }));
    if (env.CAPTCHA_SITE_KEY || env.CAPTCHA_SECRET) missing(['CAPTCHA_SITE_KEY', 'CAPTCHA_SECRET']);
    if (env.SMS_PROVIDER === 'twilio')
      missing(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SMS_SENDER']);
    if (env.TELEGRAM_BOT_TOKEN) {
      missing(['TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET', 'PUBLIC_BASE_URL']);
    }
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
