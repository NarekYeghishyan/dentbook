/** Общее для интеграционных тестов API: приложение на тестовой БД и регистрация клиник. */
import { createHmac, randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { Redis } from 'ioredis';
import { expect } from 'vitest';
import type { Database } from '@dentbook/db';
import type { RegisterClinicInput } from '@dentbook/shared';
import type { TelegramJob } from '@dentbook/shared/queues';
import type { SmsSender } from '@dentbook/shared/sms';
import { buildApp } from '../src/app.js';
import type { Env } from '../src/env.js';
import { SESSION_COOKIE } from '../src/plugins/session.js';
import type { CaptchaVerifier } from '../src/services/captcha.js';
import type { QueueInspector } from '../src/services/queues.js';
import type { SmsOutbox } from '../src/services/sms-outbox.js';
import type { TelegramConfig, TelegramOutbox } from '../src/telegram/outbox.js';

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    API_HOST: '127.0.0.1',
    API_PORT: 3000,
    DATABASE_URL: 'postgres://unused',
    REDIS_URL: 'redis://unused',
    JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    JWT_ACCESS_TTL: 3600,
    // Тесты регистрируют много клиник и ставят много холдов с одного адреса
    AUTH_RATE_LIMIT: 10_000,
    HOLD_TTL_SEC: 600,
    PUBLIC_KEY_RATE_LIMIT: 10_000,
    PUBLIC_IP_RATE_LIMIT: 10_000,
    ...overrides,
  };
}

export function testApp(
  db: Database,
  overrides: Partial<Env> = {},
  extras: {
    redis?: Redis;
    sms?: SmsSender;
    smsOutbox?: SmsOutbox;
    queues?: QueueInspector;
    captcha?: CaptchaVerifier;
    telegram?: TelegramConfig;
  } = {},
): FastifyInstance {
  return buildApp({ env: testEnv(overrides), db, logger: false, ...extras });
}

/** Очередь SMS-уведомлений в тестах: задачи и снятия складываются в память. */
export class TestSmsOutbox implements SmsOutbox {
  readonly jobs: { notificationId: string; delayMs: number | undefined }[] = [];
  readonly removed: string[] = [];

  async enqueue(notificationId: string, options: { delayMs?: number } = {}): Promise<void> {
    this.jobs.push({ notificationId, delayMs: options.delayMs });
  }

  async remove(notificationId: string): Promise<void> {
    this.removed.push(notificationId);
  }
}

/** SMS в тестах: письма складываются в память, код достаётся из текста. */
export class TestSms implements SmsSender {
  readonly sent: { to: string; text: string }[] = [];

  async send(message: { to: string; text: string }): Promise<{ id: string }> {
    this.sent.push(message);
    return { id: `SM${this.sent.length}` };
  }

  lastCode(phone: string): string {
    const message = this.sent.findLast((m) => m.to === phone);
    const code = message?.text.match(/\b\d{6}\b/)?.[0];
    expect(code, `SMS code for ${phone}`).toBeDefined();
    return code!;
  }
}

export const PASSWORD = 'correct-horse-battery';

export interface Session {
  clinicId: string;
  userId: string;
  email: string;
  /** Заголовок Cookie с сессией. */
  cookie: string;
}

export const uniqueEmail = (label: string) => `${label}-${randomUUID()}@example.com`;

export function sessionCookie(setCookie: { name: string; value: string }[]): string {
  const cookie = setCookie.find((c) => c.name === SESSION_COOKIE);
  expect(cookie, 'session cookie is set').toBeDefined();
  return `${SESSION_COOKIE}=${cookie!.value}`;
}

export async function registerClinic(
  app: FastifyInstance,
  overrides: Partial<RegisterClinicInput> = {},
): Promise<Session> {
  const email = overrides.email ?? uniqueEmail('owner');
  const res = await app.inject({
    method: 'POST',
    url: '/v1/admin/auth/register',
    payload: {
      clinicName: 'Smile Dental',
      timezone: 'America/New_York',
      currency: 'USD',
      fullName: 'Olivia Owner',
      password: PASSWORD,
      ...overrides,
      email,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const { clinicId, userId } = res.json<{ clinicId: string; userId: string }>();
  return { clinicId, userId, email, cookie: sessionCookie(res.cookies) };
}

/** Сотрудник клиники с заданной ролью, созданный владельцем, и его сессия. */
export async function addStaff(
  app: FastifyInstance,
  owner: Session,
  role: 'admin' | 'registrar',
): Promise<Session> {
  const email = uniqueEmail(role);
  const created = await app.inject({
    method: 'POST',
    url: '/v1/admin/users',
    headers: { cookie: owner.cookie },
    payload: { email, fullName: `Sam ${role}`, password: PASSWORD, role },
  });
  expect(created.statusCode, created.body).toBe(201);
  const login = await app.inject({
    method: 'POST',
    url: '/v1/admin/auth/login',
    payload: { email, password: PASSWORD },
  });
  expect(login.statusCode, login.body).toBe(200);
  return {
    clinicId: owner.clinicId,
    userId: created.json<{ id: string }>().id,
    email,
    cookie: sessionCookie(login.cookies),
  };
}

/** Запрос от имени сессии. */
export function as(app: FastifyInstance, session: Session | null, options: InjectOptions) {
  return app.inject({
    ...options,
    headers: { ...options.headers, ...(session ? { cookie: session.cookie } : {}) },
  });
}

/** Запрос от имени сессии с проверкой статуса; возвращает тело. */
export async function call<T = unknown>(
  app: FastifyInstance,
  session: Session,
  options: InjectOptions,
  expectedStatus = 200,
): Promise<T> {
  const res = await as(app, session, options);
  expect(res.statusCode, `${options.method} ${options.url}: ${res.body}`).toBe(expectedStatus);
  return (res.body ? res.json() : undefined) as T;
}

export interface ClinicFixture {
  locationId: string;
  serviceId: string;
  dentistId: string;
}

/**
 * Минимальная клиника: филиал, услуга 30 мин, врач с этой услугой и сменами пн–пт
 * 09:00–17:00 по времени филиала.
 */
export async function createClinicData(
  app: FastifyInstance,
  owner: Session,
  options: { timezone?: string; dentistName?: string } = {},
): Promise<ClinicFixture> {
  const location = await call<{ id: string }>(
    app,
    owner,
    {
      method: 'POST',
      url: '/v1/admin/locations',
      payload: { name: 'Main office', timezone: options.timezone ?? 'America/New_York' },
    },
    201,
  );
  const service = await call<{ id: string }>(
    app,
    owner,
    {
      method: 'POST',
      url: '/v1/admin/services',
      payload: { name: 'Checkup', durationMin: 30, price: '80.00' },
    },
    201,
  );
  const dentist = await call<{ id: string }>(
    app,
    owner,
    {
      method: 'POST',
      url: '/v1/admin/dentists',
      payload: { fullName: options.dentistName ?? 'Dr. Anna' },
    },
    201,
  );
  await call(app, owner, {
    method: 'PUT',
    url: `/v1/admin/dentists/${dentist.id}/services`,
    payload: { serviceIds: [service.id] },
  });
  await call(app, owner, {
    method: 'PUT',
    url: `/v1/admin/dentists/${dentist.id}/working-hours`,
    payload: {
      items: [1, 2, 3, 4, 5].map((weekday) => ({
        locationId: location.id,
        weekday,
        startTime: '09:00',
        endTime: '17:00',
      })),
    },
  });
  return { locationId: location.id, serviceId: service.id, dentistId: dentist.id };
}

/** Очередь Telegram в тестах: задачи складываются в память вместо BullMQ. */
export class TestOutbox implements TelegramOutbox {
  readonly jobs: { job: TelegramJob; delayMs: number | undefined }[] = [];

  async enqueue(job: TelegramJob, options: { delayMs?: number } = {}): Promise<void> {
    this.jobs.push({ job, delayMs: options.delayMs });
  }

  /** Сообщения в чат, без отложенных. */
  messagesTo(chatId: number) {
    return this.jobs
      .filter((j) => j.delayMs === undefined && j.job.type === 'message' && j.job.chatId === chatId)
      .map((j) => j.job as Extract<TelegramJob, { type: 'message' }>);
  }
}

export const TEST_BOT_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';

export function testTelegram(outbox: TelegramOutbox): TelegramConfig {
  return {
    botToken: TEST_BOT_TOKEN,
    botUsername: 'dentbook_test_bot',
    webhookSecret: 'test-webhook-secret-1234567890',
    miniAppUrl: 'https://dentbook.example/miniapp/',
    outbox,
  };
}

/** initData Mini App, подписанная так же, как её подписывает Telegram. */
export function signInitData(
  userId: number,
  options: { authDate?: Date; token?: string } = {},
): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor((options.authDate ?? new Date()).getTime() / 1000)),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify({ id: userId, first_name: 'Anna', language_code: 'en' }),
  };
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData')
    .update(options.token ?? TEST_BOT_TOKEN)
    .digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}
