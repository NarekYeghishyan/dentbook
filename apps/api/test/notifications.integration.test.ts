/**
 * SMS-уведомления клиентам (Шаг 8): напоминания ставятся при записи и снимаются при
 * отмене, подтверждение записи — SMS клиенту (Q12). Отправку и повторы проверяет тест
 * worker'а; здесь — что API кладёт в очередь и в notifications.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, isoWeekday, localDateOf, zonedTimeToUtc } from '@dentbook/core';
import { notifications } from '@dentbook/db';
import {
  startTestDatabase,
  startTestRedis,
  type TestDatabase,
  type TestRedis,
} from '@dentbook/db/testing';
import type {
  ConfirmedAppointment,
  HoldResponse,
  MiniappSlots,
  TelegramLink,
} from '@dentbook/shared';
import { SMS_QUEUE } from '@dentbook/shared/queues';
import { BullSmsOutbox } from '../src/services/sms-outbox.js';
import {
  TestOutbox,
  TestSms,
  TestSmsOutbox,
  call,
  createClinicData,
  registerClinic,
  signInitData,
  testApp,
  testTelegram,
  type ClinicFixture,
  type Session,
} from './helpers.js';

const ZONE = 'America/New_York';
const ORIGIN = 'https://clinic.example';
const ANNA_CHAT = 1001;
const HOUR = 3_600_000;

let database: TestDatabase;
let redisServer: TestRedis;
let redis: Redis;
let app: FastifyInstance;
const sms = new TestSms();
const smsOutbox = new TestSmsOutbox();
const outbox = new TestOutbox();
const telegram = testTelegram(outbox);
let owner: Session;
let data: ClinicFixture;
let key: string;

/** Будний день недели weekday не раньше чем через 3 дня: оба напоминания впереди. */
function upcoming(weekday: number): string {
  let date = addDays(localDateOf(new Date(), ZONE), 3);
  while (isoWeekday(date) !== weekday) date = addDays(date, 1);
  return date;
}
const at = (date: string, time: string) => {
  const [h, m] = time.split(':').map(Number);
  return zonedTimeToUtc(date, h! * 60 + m!, ZONE).toISOString();
};

let phoneCounter = 0;
async function bookFromWebsite(startAt: string): Promise<ConfirmedAppointment> {
  const headers = { authorization: `Bearer ${key}`, origin: ORIGIN };
  const hold = await app.inject({
    method: 'POST',
    url: '/v1/public/holds',
    headers,
    payload: { service_id: data.serviceId, location_id: data.locationId, start_at: startAt },
  });
  expect(hold.statusCode, hold.body).toBe(201);
  const phone = `+1202555${String(4000 + ++phoneCounter)}`;
  const verification = await app.inject({
    method: 'POST',
    url: '/v1/public/verifications',
    headers,
    payload: { phone },
  });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/public/appointments',
    headers,
    payload: {
      hold_id: hold.json<HoldResponse>().hold_id,
      verification_id: verification.json().verification_id,
      code: sms.lastCode(phone),
      client: { full_name: 'Jane Client', phone },
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<ConfirmedAppointment>();
}

const smsOf = (appointmentId: string) =>
  database.db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      status: notifications.status,
      scheduledFor: notifications.scheduledFor,
      jobId: notifications.jobId,
      patientId: notifications.patientId,
    })
    .from(notifications)
    .where(and(eq(notifications.appointmentId, appointmentId), eq(notifications.channel, 'sms')))
    .orderBy(asc(notifications.scheduledFor));

const mini = (path: string, method: 'GET' | 'POST' = 'GET', payload?: object) =>
  app.inject({
    method,
    url: `/v1/miniapp${path}`,
    headers: { authorization: `tma ${signInitData(ANNA_CHAT)}` },
    ...(payload ? { payload } : {}),
  });

async function requireConfirmation(on: boolean) {
  await call(app, owner, {
    method: 'PATCH',
    url: '/v1/admin/clinic',
    payload: { bookingRequiresConfirmation: on },
  });
}

beforeAll(async () => {
  [database, redisServer] = await Promise.all([startTestDatabase(), startTestRedis()]);
  redis = new Redis(redisServer.url);
  app = testApp(database.db, {}, { redis, sms, smsOutbox, telegram });
  await app.ready();

  owner = await registerClinic(app, { clinicName: 'Smile Dental', timezone: ZONE });
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
        chat: { id: ANNA_CHAT, type: 'private' },
        from: { id: ANNA_CHAT, is_bot: false, first_name: 'Anna' },
        text: `/start ${new URL(link.url).searchParams.get('start')}`,
      },
    },
  });
}, 180_000);

afterAll(async () => {
  await app?.close();
  redis?.disconnect();
  await Promise.all([database?.stop(), redisServer?.stop()]);
});

describe('client SMS notifications (Step 8)', () => {
  it('a website booking schedules reminders 24 h and 2 h before the visit', async () => {
    const booked = await bookFromWebsite(at(upcoming(1), '10:00'));
    const start = Date.parse(booked.start_at);
    const rows = await smsOf(booked.id);

    // Запись без подтверждения — клиент видел её на экране, отдельного SMS нет
    expect(rows.map((r) => r.kind)).toEqual(['reminder_24h', 'reminder_2h']);
    expect(rows.map((r) => r.scheduledFor.getTime())).toEqual([
      start - 24 * HOUR,
      start - 2 * HOUR,
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({ status: 'scheduled', jobId: row.id });
      expect(row.patientId).not.toBeNull();
      const job = smsOutbox.jobs.find((j) => j.notificationId === row.id)!;
      // Задержка — до времени напоминания, с поправкой на время теста
      expect(Math.abs(Date.now() + job.delayMs! - row.scheduledFor.getTime())).toBeLessThan(60_000);
    }
  });

  it('a cancellation by the client takes the reminders off the queue', async () => {
    const booked = await bookFromWebsite(at(upcoming(2), '10:00'));
    const res = await app.inject({
      method: 'POST',
      url: `/v1/public/appointments/${booked.id}/cancel`,
      headers: { authorization: `Bearer ${key}`, origin: ORIGIN },
      payload: { token: booked.token },
    });
    expect(res.statusCode, res.body).toBe(200);
    const rows = await smsOf(booked.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.status)).toEqual(['cancelled', 'cancelled']);
    expect(smsOutbox.removed).toEqual(expect.arrayContaining(rows.map((r) => r.id)));
  });

  it('confirming a pending booking in Telegram texts the client (Q12)', async () => {
    await requireConfirmation(true);
    try {
      const booked = await bookFromWebsite(at(upcoming(3), '10:00'));
      expect(booked.status).toBe('pending');
      // Напоминания ставятся и для pending: worker отправит их, только если запись подтвердят
      expect((await smsOf(booked.id)).map((r) => r.kind)).toEqual(['reminder_24h', 'reminder_2h']);

      await app.inject({
        method: 'POST',
        url: '/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': telegram.webhookSecret },
        payload: {
          update_id: 2,
          callback_query: {
            id: 'cb-2',
            from: { id: ANNA_CHAT, is_bot: false, first_name: 'Anna' },
            chat_instance: 'x',
            data: `confirm:${booked.id}`,
            message: { message_id: 1, date: 0, chat: { id: ANNA_CHAT, type: 'private' } },
          },
        },
      });
      const confirmed = (await smsOf(booked.id)).filter((r) => r.kind === 'appointment_confirmed');
      expect(confirmed).toHaveLength(1);
      expect(smsOutbox.jobs.find((j) => j.notificationId === confirmed[0]!.id)!.delayMs).toBe(0);
    } finally {
      await requireConfirmation(false);
    }
  });

  it('confirming in the Mini App texts the client too', async () => {
    await requireConfirmation(true);
    try {
      const booked = await bookFromWebsite(at(upcoming(4), '10:00'));
      const res = await mini(`/appointments/${booked.id}/confirm`, 'POST');
      expect(res.statusCode, res.body).toBe(200);
      const kinds = (await smsOf(booked.id)).map((r) => r.kind);
      expect(kinds).toContain('appointment_confirmed');
    } finally {
      await requireConfirmation(false);
    }
  });

  it("the dentist's own booking gets reminders, and the dentist no alert", async () => {
    const day = upcoming(5);
    const slots = await mini(
      `/slots?serviceId=${data.serviceId}&locationId=${data.locationId}&date=${day}`,
    );
    const startAt = slots.json<MiniappSlots>().slots[0]!;
    const alertsBefore = outbox.messagesTo(ANNA_CHAT).length;
    const res = await mini('/appointments', 'POST', {
      serviceId: data.serviceId,
      locationId: data.locationId,
      startAt,
      client: { fullName: 'Bob Walk-in', phone: '+12025559001' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const kinds = (await smsOf(res.json<{ id: string }>().id)).map((r) => r.kind);
    expect(kinds).toEqual(['reminder_24h', 'reminder_2h']);
    expect(outbox.messagesTo(ANNA_CHAT)).toHaveLength(alertsBefore);
  });
});

describe('BullSmsOutbox', () => {
  it('delays a reminder under the notification id and takes it back', async () => {
    const queueRedis = new Redis(redisServer.url);
    const bull = new BullSmsOutbox(queueRedis);
    const queue = new Queue(SMS_QUEUE, { connection: queueRedis });
    try {
      const id = '6a0c5c64-4f55-4d33-a0b7-8a9d7b6b8f01';
      await bull.enqueue(id, { delayMs: 3 * HOUR });
      const job = await queue.getJob(id);
      expect(job?.data).toEqual({ notificationId: id });
      expect(await job!.getState()).toBe('delayed');
      expect(job!.opts.attempts).toBe(5);

      await bull.remove(id);
      expect(await queue.getJob(id)).toBeUndefined();
      // Уже снятое или неизвестное — без ошибки
      await expect(bull.remove(id)).resolves.toBeUndefined();
    } finally {
      await bull.close();
      await queue.close();
      queueRedis.disconnect();
    }
  });
});
