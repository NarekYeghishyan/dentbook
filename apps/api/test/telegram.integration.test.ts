/**
 * Telegram (CLAUDE.md §8, Шаг 7): привязка врача, вебхук с дедупликацией, алерты с
 * кнопками, Mini App с проверкой initData и изоляцией врачей. Исходящие сообщения —
 * задачи очереди: здесь они складываются в TestOutbox, отправку проверяет тест worker'а.
 */
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, HTTPMethods, InjectOptions } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, isoWeekday, localDateOf, zonedTimeToUtc } from '@dentbook/core';
import { appointments, dentists, notifications, telegramLinkTokens } from '@dentbook/db';
import {
  startTestDatabase,
  startTestRedis,
  type TestDatabase,
  type TestRedis,
} from '@dentbook/db/testing';
import type { ConfirmedAppointment, Dentist, HoldResponse, TelegramLink } from '@dentbook/shared';
import {
  TestOutbox,
  TestSms,
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
const ORIGIN = 'https://mashna.am';
const ANNA_CHAT = 1001;
const BORIS_CHAT = 1002;
const OTHER_CHAT = 2001;

let database: TestDatabase;
let redisServer: TestRedis;
let redis: Redis;
let app: FastifyInstance;
const sms = new TestSms();
const outbox = new TestOutbox();
const telegram = testTelegram(outbox);
const miniappRoutes: { method: HTTPMethods; url: string }[] = [];

let owner: Session;
let data: ClinicFixture;
let boris: string;
let key: string;
let other: Session;
let otherData: ClinicFixture;

function upcoming(weekday: number): string {
  let date = addDays(localDateOf(new Date(), ZONE), 3);
  while (isoWeekday(date) !== weekday) date = addDays(date, 1);
  return date;
}
const at = (date: string, time: string) => {
  const [h, m] = time.split(':').map(Number);
  return zonedTimeToUtc(date, h! * 60 + m!, ZONE).toISOString();
};

let updateId = 5000;
function webhook(update: object, secret = telegram.webhookSecret) {
  return app.inject({
    method: 'POST',
    url: '/telegram/webhook',
    headers: { 'x-telegram-bot-api-secret-token': secret },
    payload: update,
  });
}
const message = (chatId: number, text: string, type = 'private') => ({
  update_id: ++updateId,
  message: {
    message_id: updateId,
    date: Math.floor(Date.now() / 1000),
    chat: { id: chatId, type },
    from: { id: chatId, is_bot: false, first_name: 'Anna' },
    text,
  },
});
const callback = (chatId: number, data: string) => ({
  update_id: ++updateId,
  callback_query: {
    id: `cb-${updateId}`,
    from: { id: chatId, is_bot: false, first_name: 'Anna' },
    chat_instance: 'x',
    data,
    message: { message_id: 1, date: 0, chat: { id: chatId, type: 'private' } },
  },
});

async function issueLink(session: Session, dentistId: string): Promise<string> {
  const link = await call<TelegramLink>(
    app,
    session,
    { method: 'POST', url: `/v1/admin/dentists/${dentistId}/telegram-link` },
    201,
  );
  return new URL(link.url).searchParams.get('start')!;
}

async function linkDentist(session: Session, dentistId: string, chatId: number) {
  const token = await issueLink(session, dentistId);
  expect((await webhook(message(chatId, `/start ${token}`))).statusCode).toBe(200);
}

function mini(chatId: number, options: InjectOptions) {
  return app.inject({
    ...options,
    headers: { authorization: `tma ${signInitData(chatId)}`, ...options.headers },
  });
}

let phoneCounter = 0;
/** Запись с сайта: холд → SMS-код → подтверждение. */
async function bookFromWebsite(startAt: string): Promise<ConfirmedAppointment> {
  const headers = { authorization: `Bearer ${key}`, origin: ORIGIN };
  const hold = await app.inject({
    method: 'POST',
    url: '/v1/public/holds',
    headers,
    payload: { service_id: data.serviceId, location_id: data.locationId, start_at: startAt },
  });
  expect(hold.statusCode, hold.body).toBe(201);
  const phone = `+1202555${String(3000 + ++phoneCounter)}`;
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

beforeAll(async () => {
  [database, redisServer] = await Promise.all([startTestDatabase(), startTestRedis()]);
  redis = new Redis(redisServer.url);
  app = testApp(database.db, {}, { redis, sms, telegram });
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD' && route.url.startsWith('/v1/miniapp'))
        miniappRoutes.push({ method, url: route.url });
    }
  });
  await app.ready();

  owner = await registerClinic(app, { clinicName: 'Smile Dental', timezone: ZONE });
  data = await createClinicData(app, owner, { dentistName: 'Dr. Anna' });
  const second = await call<Dentist>(
    app,
    owner,
    { method: 'POST', url: '/v1/admin/dentists', payload: { fullName: 'Dr. Boris' } },
    201,
  );
  boris = second.id;
  await call(app, owner, {
    method: 'PUT',
    url: `/v1/admin/dentists/${boris}/services`,
    payload: { serviceIds: [data.serviceId] },
  });
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
  other = await registerClinic(app, { clinicName: 'Other Dental', timezone: ZONE });
  otherData = await createClinicData(app, other, { dentistName: 'Dr. Other' });
}, 180_000);

afterAll(async () => {
  await app?.close();
  redis?.disconnect();
  await Promise.all([database?.stop(), redisServer?.stop()]);
});

describe('linking a dentist to Telegram (§8, Q15)', () => {
  it('issues a one-time link for a day and stores only its hash', async () => {
    const link = await call<TelegramLink>(
      app,
      owner,
      { method: 'POST', url: `/v1/admin/dentists/${data.dentistId}/telegram-link` },
      201,
    );
    expect(link.url).toMatch(/^https:\/\/t\.me\/dentbook_test_bot\?start=[\w-]{43}$/);
    const hoursLeft = (Date.parse(link.expiresAt) - Date.now()) / 3_600_000;
    expect(hoursLeft).toBeGreaterThan(23.9);
    const token = new URL(link.url).searchParams.get('start')!;
    const stored = await database.db
      .select({ hash: telegramLinkTokens.tokenHash })
      .from(telegramLinkTokens)
      .where(eq(telegramLinkTokens.dentistId, data.dentistId));
    expect(stored.map((s) => s.hash)).not.toContain(token);
  });

  it('links the dentist by /start <token> and greets with the schedule button', async () => {
    await linkDentist(owner, data.dentistId, ANNA_CHAT);
    const [row] = await database.db
      .select({ chat: dentists.telegramChatId })
      .from(dentists)
      .where(eq(dentists.id, data.dentistId));
    expect(row!.chat).toBe(ANNA_CHAT);
    const greeting = outbox.messagesTo(ANNA_CHAT).at(-1)!;
    expect(greeting.text).toContain('Dr. Anna');
    expect(greeting.text).toContain('Smile Dental');
    expect(greeting.buttons).toEqual([
      [{ text: '📅 Open schedule', webAppUrl: telegram.miniAppUrl }],
    ]);
    const card = await call<Dentist>(app, owner, {
      method: 'GET',
      url: `/v1/admin/dentists/${data.dentistId}`,
    });
    expect(card).toMatchObject({ telegramLinked: true, telegramBlocked: false });
  });

  it('handles a repeated delivery of the same update once', async () => {
    const update = message(ANNA_CHAT, '/start');
    const before = outbox.messagesTo(ANNA_CHAT).length;
    expect((await webhook(update)).statusCode).toBe(200);
    expect((await webhook(update)).statusCode).toBe(200);
    expect(outbox.messagesTo(ANNA_CHAT).length).toBe(before + 1);
  });

  it('refuses a used, unknown or expired link', async () => {
    const token = await issueLink(owner, boris);
    await database.db
      .update(telegramLinkTokens)
      .set({ expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 2000) })
      .where(eq(telegramLinkTokens.dentistId, boris));
    for (const payload of [token, 'x'.repeat(43)]) {
      await webhook(message(BORIS_CHAT, `/start ${payload}`));
      expect(outbox.messagesTo(BORIS_CHAT).at(-1)!.text).toContain('invalid or has expired');
    }
  });

  it('one Telegram account cannot belong to two dentists (Q9)', async () => {
    const token = await issueLink(owner, boris);
    await webhook(message(ANNA_CHAT, `/start ${token}`));
    expect(outbox.messagesTo(ANNA_CHAT).at(-1)!.text).toContain('already connected');
    await linkDentist(owner, boris, BORIS_CHAT);
  });

  it('rejects a webhook call without the secret', async () => {
    const res = await webhook(message(ANNA_CHAT, '/start'), 'wrong-secret-wrong-secret');
    expect(res.statusCode).toBe(401);
  });

  it('greets a linked dentist on /start and clears the blocked flag', async () => {
    await database.db
      .update(dentists)
      .set({ telegramBlocked: true })
      .where(eq(dentists.id, data.dentistId));
    await webhook(message(ANNA_CHAT, '/start'));
    expect(outbox.messagesTo(ANNA_CHAT).at(-1)!.text).toBe('You are connected to Smile Dental.');
    const [row] = await database.db
      .select({ blocked: dentists.telegramBlocked })
      .from(dentists)
      .where(eq(dentists.id, data.dentistId));
    expect(row!.blocked).toBe(false);
  });

  it('stays silent in group chats', async () => {
    const before = outbox.jobs.length;
    await webhook(message(-100500, '/start', 'group'));
    expect(outbox.jobs.length).toBe(before);
  });
});

describe('alerts to dentists', () => {
  it('a website booking alerts the assigned dentist with the client', async () => {
    const booked = await bookFromWebsite(at(upcoming(1), '10:00'));
    expect(booked.dentist.full_name).toBe('Dr. Anna');
    const alert = outbox.messagesTo(ANNA_CHAT).at(-1)!;
    expect(alert.text).toMatch(
      /^New booking\n.*10:00 AM\nCheckup · Main office\nClient: Jane Client/,
    );
    expect(alert.buttons).toHaveLength(1);
    const [row] = await database.db
      .select({ kind: notifications.kind, dentistId: notifications.dentistId })
      .from(notifications)
      .where(eq(notifications.id, alert.notificationId!));
    expect(row).toEqual({ kind: 'appointment_created', dentistId: data.dentistId });
  });

  it('a booking awaiting confirmation gets a Confirm button and a reminder in 2 hours', async () => {
    await call(app, owner, {
      method: 'PATCH',
      url: '/v1/admin/clinic',
      payload: { bookingRequiresConfirmation: true },
    });
    try {
      const booked = await bookFromWebsite(at(upcoming(2), '10:00'));
      expect(booked.status).toBe('pending');
      const alert = outbox.messagesTo(ANNA_CHAT).at(-1)!;
      expect(alert.text).toMatch(/^New booking awaits your confirmation/);
      expect(alert.buttons![0]).toEqual([
        { text: '✅ Confirm', callbackData: `confirm:${booked.id}` },
      ]);
      const reminder = outbox.jobs.at(-1)!;
      expect(reminder.delayMs).toBe(2 * 60 * 60 * 1000);
      expect(reminder.job).toMatchObject({ onlyIfPending: booked.id, chatId: ANNA_CHAT });

      // Врач жмёт «Подтвердить»
      await webhook(callback(ANNA_CHAT, `confirm:${booked.id}`));
      const [row] = await database.db
        .select({ status: appointments.status })
        .from(appointments)
        .where(eq(appointments.id, booked.id));
      expect(row!.status).toBe('confirmed');
      const answer = outbox.jobs.find(
        (j) => j.job.type === 'answer' && j.job.text?.startsWith('Confirmed'),
      );
      expect(answer).toBeDefined();

      // Повторное нажатие и чужой врач ничего не меняют
      await webhook(callback(ANNA_CHAT, `confirm:${booked.id}`));
      expect(outbox.jobs.at(-1)!.job).toMatchObject({
        type: 'answer',
        text: 'This booking no longer awaits confirmation.',
      });
      await webhook(callback(BORIS_CHAT, `confirm:${booked.id}`));
      expect(outbox.jobs.at(-1)!.job).toMatchObject({
        type: 'answer',
        text: 'This booking no longer awaits confirmation.',
      });
    } finally {
      await call(app, owner, {
        method: 'PATCH',
        url: '/v1/admin/clinic',
        payload: { bookingRequiresConfirmation: false },
      });
    }
  });

  it('a cancellation by the client alerts the dentist', async () => {
    const booked = await bookFromWebsite(at(upcoming(3), '10:00'));
    await app.inject({
      method: 'POST',
      url: `/v1/public/appointments/${booked.id}/cancel`,
      headers: { authorization: `Bearer ${key}`, origin: ORIGIN },
      payload: { token: booked.token },
    });
    expect(outbox.messagesTo(ANNA_CHAT).at(-1)!.text).toMatch(/^Booking cancelled by the client/);
  });
});

describe('Mini App (§8)', () => {
  it('lets in only a linked dentist with fresh, genuine init data', async () => {
    const me = (headers: Record<string, string>) =>
      app.inject({ method: 'GET', url: '/v1/miniapp/me', headers });
    expect((await me({})).statusCode).toBe(401);
    const forged = new URLSearchParams(signInitData(OTHER_CHAT));
    forged.set('user', JSON.stringify({ id: ANNA_CHAT, first_name: 'Mallory' }));
    expect((await me({ authorization: `tma ${forged}` })).statusCode).toBe(401);
    const stale = signInitData(ANNA_CHAT, { authDate: new Date(Date.now() - 2 * 3600_000) });
    expect((await me({ authorization: `tma ${stale}` })).statusCode).toBe(401);
    expect((await me({ authorization: `tma ${signInitData(999_999)}` })).statusCode).toBe(403);

    const res = await mini(ANNA_CHAT, { method: 'GET', url: '/v1/miniapp/me' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      dentist: { id: data.dentistId, fullName: 'Dr. Anna' },
      clinic: { name: 'Smile Dental', timezone: ZONE },
      services: [{ id: data.serviceId, name: 'Checkup', durationMin: 30 }],
    });
  });

  it('shows the own schedule with clients', async () => {
    const day = upcoming(1);
    const res = await mini(ANNA_CHAT, {
      method: 'GET',
      url: `/v1/miniapp/schedule?from=${day}&to=${day}`,
    });
    expect(res.statusCode).toBe(200);
    const [first] = res.json().appointments;
    expect(first).toMatchObject({
      status: 'confirmed',
      startAt: at(day, '10:00'),
      timeZone: ZONE,
      service: 'Checkup',
      client: { fullName: 'Jane Client' },
    });
  });

  it('refuses to close time that has appointments and lists them (§8)', async () => {
    const day = upcoming(1);
    const res = await mini(ANNA_CHAT, {
      method: 'POST',
      url: '/v1/miniapp/blocks',
      payload: { startAt: at(day, '09:00'), endAt: at(day, '12:00'), reason: 'Dentist' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: { code: 'slot_taken' },
      conflicts: [{ startAt: at(day, '10:00') }],
    });
  });

  it('closes free time and reopens it', async () => {
    const day = upcoming(4);
    const created = await mini(ANNA_CHAT, {
      method: 'POST',
      url: '/v1/miniapp/blocks',
      payload: { startAt: at(day, '13:00'), endAt: at(day, '15:00'), reason: 'Lunch' },
    });
    expect(created.statusCode).toBe(201);
    const schedule = await mini(ANNA_CHAT, {
      method: 'GET',
      url: `/v1/miniapp/schedule?from=${day}&to=${day}`,
    });
    expect(schedule.json().blocks).toEqual([
      {
        id: created.json().id,
        startAt: at(day, '13:00'),
        endAt: at(day, '15:00'),
        reason: 'Lunch',
      },
    ]);
    const slots = await mini(ANNA_CHAT, {
      method: 'GET',
      url: `/v1/miniapp/slots?serviceId=${data.serviceId}&locationId=${data.locationId}&date=${day}`,
    });
    expect(slots.json().slots).not.toContain(at(day, '13:00'));
    const removed = await mini(ANNA_CHAT, {
      method: 'DELETE',
      url: `/v1/miniapp/blocks/${created.json().id}`,
    });
    expect(removed.statusCode).toBe(204);
  });

  it('books the own client straight away, and not twice on one time', async () => {
    const day = upcoming(5);
    const payload = {
      serviceId: data.serviceId,
      locationId: data.locationId,
      startAt: at(day, '11:00'),
      client: { fullName: 'Own Client', phone: '+12025559000' },
    };
    const res = await mini(ANNA_CHAT, { method: 'POST', url: '/v1/miniapp/appointments', payload });
    expect(res.statusCode, res.body).toBe(201);
    const [row] = await database.db
      .select({ status: appointments.status, source: appointments.source })
      .from(appointments)
      .where(eq(appointments.id, res.json().id));
    expect(row).toEqual({ status: 'confirmed', source: 'telegram' });
    const again = await mini(ANNA_CHAT, {
      method: 'POST',
      url: '/v1/miniapp/appointments',
      payload,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('slot_taken');
  });

  it('confirms a pending booking from the Mini App', async () => {
    const [own] = await database.db
      .update(appointments)
      .set({ status: 'pending' })
      .where(and(eq(appointments.dentistId, data.dentistId), eq(appointments.source, 'telegram')))
      .returning({ id: appointments.id });
    const res = await mini(ANNA_CHAT, {
      method: 'POST',
      url: `/v1/miniapp/appointments/${own!.id}/confirm`,
    });
    expect(res.json()).toEqual({ id: own!.id, status: 'confirmed' });
  });
});

describe('Mini App isolation (§2.2)', () => {
  let otherBlock: string;
  let annaAppointment: string;

  beforeAll(async () => {
    await linkDentist(other, otherData.dentistId, OTHER_CHAT);
    const day = upcoming(4);
    otherBlock = (
      await mini(OTHER_CHAT, {
        method: 'POST',
        url: '/v1/miniapp/blocks',
        payload: { startAt: at(day, '09:00'), endAt: at(day, '10:00') },
      })
    ).json().id;
    const [row] = await database.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.dentistId, data.dentistId), eq(appointments.status, 'confirmed')));
    annaAppointment = row!.id;
  });

  /** Попытка врача Boris (та же клиника) или Other (другая) достать чужое. */
  const attacks: Record<string, () => Promise<void>> = {
    'GET /v1/miniapp/me': async () => {
      const res = await mini(BORIS_CHAT, { method: 'GET', url: '/v1/miniapp/me' });
      expect(res.json().dentist.id).toBe(boris);
    },
    'GET /v1/miniapp/schedule': async () => {
      const from = upcoming(1);
      const to = addDays(from, 20);
      for (const chat of [BORIS_CHAT, OTHER_CHAT]) {
        const res = await mini(chat, {
          method: 'GET',
          url: `/v1/miniapp/schedule?from=${from}&to=${to}`,
        });
        expect(res.body).not.toContain(annaAppointment);
        expect(res.body).not.toContain('Jane Client');
      }
    },
    'POST /v1/miniapp/blocks': async () => {
      // Блок ставится только себе: чужой dentistId в теле игнорируется
      const day = upcoming(3);
      const res = await mini(BORIS_CHAT, {
        method: 'POST',
        url: '/v1/miniapp/blocks',
        payload: { startAt: at(day, '16:00'), endAt: at(day, '16:30'), dentistId: data.dentistId },
      });
      expect(res.statusCode).toBe(201);
      const annaSchedule = await mini(ANNA_CHAT, {
        method: 'GET',
        url: `/v1/miniapp/schedule?from=${day}&to=${day}`,
      });
      expect(annaSchedule.body).not.toContain(res.json().id);
    },
    'DELETE /v1/miniapp/blocks/:id': async () => {
      for (const chat of [ANNA_CHAT, BORIS_CHAT]) {
        const res = await mini(chat, { method: 'DELETE', url: `/v1/miniapp/blocks/${otherBlock}` });
        expect(res.statusCode).toBe(404);
      }
    },
    'GET /v1/miniapp/slots': async () => {
      const res = await mini(OTHER_CHAT, {
        method: 'GET',
        url: `/v1/miniapp/slots?serviceId=${data.serviceId}&locationId=${data.locationId}&date=${upcoming(1)}`,
      });
      expect(res.statusCode).toBe(404);
    },
    'POST /v1/miniapp/appointments': async () => {
      const res = await mini(OTHER_CHAT, {
        method: 'POST',
        url: '/v1/miniapp/appointments',
        payload: {
          serviceId: data.serviceId,
          locationId: data.locationId,
          startAt: at(upcoming(5), '14:00'),
          client: { fullName: 'Intruder', phone: '+12025559111' },
        },
      });
      expect(res.statusCode).toBe(404);
    },
    'POST /v1/miniapp/appointments/:id/confirm': async () => {
      await database.db
        .update(appointments)
        .set({ status: 'pending' })
        .where(eq(appointments.id, annaAppointment));
      try {
        for (const chat of [BORIS_CHAT, OTHER_CHAT]) {
          const res = await mini(chat, {
            method: 'POST',
            url: `/v1/miniapp/appointments/${annaAppointment}/confirm`,
          });
          expect(res.statusCode).toBe(404);
        }
      } finally {
        await database.db
          .update(appointments)
          .set({ status: 'confirmed' })
          .where(eq(appointments.id, annaAppointment));
      }
    },
  };

  it('every Mini App route has an isolation check', () => {
    const keys = miniappRoutes.map((r) => `${r.method} ${r.url}`);
    expect(keys.filter((k) => !(k in attacks))).toEqual([]);
    expect(Object.keys(attacks).filter((k) => !keys.includes(k))).toEqual([]);
  });

  it.each(Object.keys(attacks))('%s does not reach another dentist', async (route) => {
    await attacks[route]!();
  });

  it('unlinking the dentist closes the Mini App', async () => {
    await call(app, other, {
      method: 'DELETE',
      url: `/v1/admin/dentists/${otherData.dentistId}/telegram`,
    });
    expect((await mini(OTHER_CHAT, { method: 'GET', url: '/v1/miniapp/me' })).statusCode).toBe(403);
  });
});
