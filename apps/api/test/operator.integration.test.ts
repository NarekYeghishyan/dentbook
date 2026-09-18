/**
 * Панель оператора платформы (Шаг 10, Q18): вход оператора, сводка по клиникам без данных
 * клиентов, приостановка клиники (панель, форма записи, бот и Mini App перестают работать,
 * возобновление возвращает всё), состояние очередей и отказов уведомлений.
 */
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appointments, blockedUntil, notifications, patients, users } from '@dentbook/db';
import {
  startTestDatabase,
  startTestRedis,
  type TestDatabase,
  type TestRedis,
} from '@dentbook/db/testing';
import type { OperatorClinic, PlatformHealth, TelegramLink } from '@dentbook/shared';
import { hashPassword } from '../src/lib/password.js';
import { BullQueueInspector } from '../src/services/queues.js';
import { BullSmsOutbox } from '../src/services/sms-outbox.js';
import {
  PASSWORD,
  TestOutbox,
  TestSms,
  as,
  call,
  createClinicData,
  registerClinic,
  sessionCookie,
  signInitData,
  testApp,
  testTelegram,
  type ClinicFixture,
  type Session,
} from './helpers.js';

const ORIGIN = 'https://clinic.example';
const DENTIST_CHAT = 5001;

let database: TestDatabase;
let redisServer: TestRedis;
let redis: Redis;
let queues: BullQueueInspector;
let app: FastifyInstance;
const outbox = new TestOutbox();
const telegram = testTelegram(outbox);
let operator: Session;
let owner: Session;
let data: ClinicFixture;
let key: string;

beforeAll(async () => {
  [database, redisServer] = await Promise.all([startTestDatabase(), startTestRedis()]);
  redis = new Redis(redisServer.url);
  queues = new BullQueueInspector(redis);
  app = testApp(database.db, {}, { redis, sms: new TestSms(), queues, telegram });
  await app.ready();

  const email = 'operator@dentbook.example';
  await database.db.insert(users).values({
    clinicId: null,
    email,
    passwordHash: await hashPassword(PASSWORD),
    fullName: 'Platform Owner',
    role: 'operator',
  });
  const login = await app.inject({
    method: 'POST',
    url: '/v1/admin/auth/login',
    payload: { email, password: PASSWORD },
  });
  expect(login.json()).toEqual({ role: 'operator' });
  operator = { clinicId: '', userId: '', email, cookie: sessionCookie(login.cookies) };

  owner = await registerClinic(app, { clinicName: 'Smile Dental' });
  data = await createClinicData(app, owner, { dentistName: 'Dr. Anna' });
  key = (
    await call<{ token: string }>(
      app,
      owner,
      {
        method: 'POST',
        url: '/v1/admin/api-keys',
        payload: { name: 'Site', allowedOrigins: [ORIGIN] },
      },
      201,
    )
  ).token;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await queues?.close();
  redis?.disconnect();
  await Promise.all([database?.stop(), redisServer?.stop()]);
});

const setStatus = (status: string) =>
  as(app, operator, {
    method: 'PATCH',
    url: `/v1/admin/operator/clinics/${owner.clinicId}`,
    payload: { status },
  });

describe('platform operator (Step 10)', () => {
  it('signs in to the operator panel, not to a clinic', async () => {
    expect(
      await call(app, operator, { method: 'GET', url: '/v1/admin/operator/me' }),
    ).toMatchObject({ fullName: 'Platform Owner', email: 'operator@dentbook.example' });
    const clinicRoute = await as(app, operator, { method: 'GET', url: '/v1/admin/me' });
    expect(clinicRoute.statusCode).toBe(403);
  });

  it('lists clinics with totals but without client data', async () => {
    // Запись клиента за прошлую неделю — попадает в «за 30 дней»
    const startAt = new Date(Date.now() - 7 * 24 * 3_600_000);
    const endAt = new Date(startAt.getTime() + 30 * 60_000);
    const [patient] = await database.db
      .insert(patients)
      .values({ clinicId: owner.clinicId, fullName: 'Secret Client', phone: '+12025559901' })
      .returning({ id: patients.id });
    await database.db.insert(appointments).values({
      clinicId: owner.clinicId,
      locationId: data.locationId,
      dentistId: data.dentistId,
      serviceId: data.serviceId,
      patientId: patient!.id,
      startAt,
      endAt,
      blockedUntil: blockedUntil(endAt, 0),
      status: 'completed',
      source: 'widget',
    });

    const res = await as(app, operator, { method: 'GET', url: '/v1/admin/operator/clinics' });
    expect(res.statusCode).toBe(200);
    const clinic = res.json<OperatorClinic[]>().find((c) => c.id === owner.clinicId);
    expect(clinic).toMatchObject({
      name: 'Smile Dental',
      status: 'active',
      owner: { email: owner.email },
      dentists: 1,
      telegramDentists: 0,
      bookings30d: 1,
    });
    expect(res.body).not.toContain('Secret Client');
    expect(res.body).not.toContain('+12025559901');
  });

  it('a suspended clinic loses its panel, booking form, bot and mini app until resumed', async () => {
    // Врач подключён к боту до приостановки
    const link = await call<TelegramLink>(
      app,
      owner,
      { method: 'POST', url: `/v1/admin/dentists/${data.dentistId}/telegram-link` },
      201,
    );
    await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': telegram.webhookSecret },
      payload: {
        update_id: 1,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: DENTIST_CHAT, type: 'private' },
          from: { id: DENTIST_CHAT, is_bot: false, first_name: 'Anna' },
          text: `/start ${new URL(link.url).searchParams.get('start')}`,
        },
      },
    });

    const secondLink = await call<TelegramLink>(
      app,
      owner,
      { method: 'POST', url: `/v1/admin/dentists/${data.dentistId}/telegram-link` },
      201,
    );

    expect((await setStatus('suspended')).statusCode).toBe(200);
    // Ссылка, выданная до приостановки, не подключает
    await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': telegram.webhookSecret },
      payload: {
        update_id: 2,
        message: {
          message_id: 2,
          date: Math.floor(Date.now() / 1000),
          chat: { id: DENTIST_CHAT + 1, type: 'private' },
          from: { id: DENTIST_CHAT + 1, is_bot: false, first_name: 'Anna' },
          text: `/start ${new URL(secondLink.url).searchParams.get('start')}`,
        },
      },
    });
    expect(outbox.messagesTo(DENTIST_CHAT + 1).at(-1)?.text).toMatch(/suspended/);
    const panel = await as(app, owner, { method: 'GET', url: '/v1/admin/me' });
    expect(panel.statusCode).toBe(403);
    const form = await app.inject({
      method: 'GET',
      url: '/v1/public/services',
      headers: { authorization: `Bearer ${key}`, origin: ORIGIN },
    });
    expect(form.json().error.code).toBe('invalid_key');
    const miniapp = await app.inject({
      method: 'GET',
      url: '/v1/miniapp/me',
      headers: { authorization: `tma ${signInitData(DENTIST_CHAT)}` },
    });
    expect(miniapp.statusCode).toBe(403);

    expect((await setStatus('active')).statusCode).toBe(200);
    expect((await as(app, owner, { method: 'GET', url: '/v1/admin/me' })).statusCode).toBe(200);
    const again = await app.inject({
      method: 'GET',
      url: '/v1/public/services',
      headers: { authorization: `Bearer ${key}`, origin: ORIGIN },
    });
    expect(again.statusCode).toBe(200);
  });

  it('refuses an unknown status and an unknown clinic', async () => {
    expect((await setStatus('deleted')).statusCode).toBe(400);
    const res = await as(app, operator, {
      method: 'PATCH',
      url: '/v1/admin/operator/clinics/00000000-0000-4000-8000-00000000abcd',
      payload: { status: 'suspended' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('shows queues, configured providers and delivery failures of the last day', async () => {
    const sms = new BullSmsOutbox(redis);
    try {
      await sms.enqueue('4b1c7d1e-2a33-4c5e-9f00-000000000001', { delayMs: 3_600_000 });
      await database.db.insert(notifications).values({
        clinicId: owner.clinicId,
        channel: 'telegram',
        kind: 'appointment_created',
        dentistId: data.dentistId,
        status: 'failed',
        attempts: 6,
        lastError: 'telegram_429',
      });

      const health = await call<PlatformHealth>(app, operator, {
        method: 'GET',
        url: '/v1/admin/operator/health',
      });
      expect(health.providers).toEqual({ sms: true, captcha: false, telegram: true });
      expect(health.queues.find((q) => q.name === 'sms')).toMatchObject({
        enabled: true,
        delayed: 1,
      });
      expect(health.failures24h).toEqual([
        { channel: 'telegram', lastError: 'telegram_429', count: 1 },
      ]);
    } finally {
      await sms.close();
    }
  });
});
