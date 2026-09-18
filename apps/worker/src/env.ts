import { z } from 'zod';

/** Разбор конфигурации при старте, падение при отсутствии обязательных (CLAUDE.md §9). */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    // Бот Telegram (§8): без токена очередь telegram не обрабатывается
    TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
    // SMS клиентам (Шаг 8), те же переменные, что у API: без провайдера очередь sms стоит
    SMS_PROVIDER: z.enum(['twilio']).optional(),
    TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
    TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
    SMS_SENDER: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.SMS_PROVIDER !== 'twilio') return;
    for (const name of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SMS_SENDER'] as const) {
      if (!env[name]) ctx.addIssue({ code: 'custom', path: [name], message: 'Required' });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Пустое значение — «не задано», как в API
  const defined = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const parsed = envSchema.safeParse(defined);
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return parsed.data;
}
