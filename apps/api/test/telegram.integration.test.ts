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
import { appointments, dentists, notifications, patients, telegramLinkTokens } from '@dentbook/db';
import {
  startTestDatabase,
  startTestRedis,
  type TestDatabase,
  type TestRedis,
} from '@dentbook/db/testing';
import type {
  AppointmentHistory,
  ClientCard,
  ClientNote,
  ConfirmedAppointment,
  Dentist,
  HoldResponse,
  MiniappBusyTime,
  MiniappMe,
  MiniappSchedule,
  MiniappSlots,
  PublicService,
  Service,
  TelegramLink,
} from '@dentbook/shared';
import { describeAppointment } from '../src/telegram/texts.js';
import {
  TestOutbox,
  TestSms,
  as,
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

/** История записи глазами врача в Mini App: тип, кто и что изменил. */
async function historyOf(chatId: number, id: string) {
  const res = await mini(chatId, { method: 'GET', url: `/v1/miniapp/appointments/${id}/history` });
  expect(res.statusCode, res.body).toBe(200);
  return res
    .json<AppointmentHistory>()
    .events.map(({ type, actor, actorName, changes }) => ({ type, actor, actorName, changes }));
}

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

async function localeOf(dentistId: string): Promise<string | null> {
  const [row] = await database.db
    .select({ locale: dentists.locale })
    .from(dentists)
    .where(eq(dentists.id, dentistId));
  return row!.locale ?? null;
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
      expect((await historyOf(ANNA_CHAT, booked.id)).map((e) => [e.type, e.actor])).toEqual([
        ['created', 'client'],
        ['confirmed', 'dentist'],
      ]);
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
    expect(await historyOf(ANNA_CHAT, booked.id)).toEqual([
      {
        type: 'created',
        actor: 'client',
        actorName: null,
        changes: { startAt: { from: null, to: booked.start_at } },
      },
      { type: 'cancelled', actor: 'client', actorName: null, changes: null },
    ]);
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
    // Закрытое время — одной серой клеткой на время начала
    expect(slots.json().busy).toContainEqual({ startAt: at(day, '13:00'), kind: 'closed' });
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
      notes: 'Bring the X-ray',
    };
    const res = await mini(ANNA_CHAT, { method: 'POST', url: '/v1/miniapp/appointments', payload });
    expect(res.statusCode, res.body).toBe(201);
    const [row] = await database.db
      .select({
        status: appointments.status,
        source: appointments.source,
        notes: appointments.notes,
      })
      .from(appointments)
      .where(eq(appointments.id, res.json().id));
    expect(row).toEqual({ status: 'confirmed', source: 'telegram', notes: 'Bring the X-ray' });
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

  it('edits the client and the comment of any own booking', async () => {
    const [own] = await database.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.dentistId, data.dentistId), eq(appointments.source, 'telegram')));
    const edit = (id: string, payload: object) =>
      mini(ANNA_CHAT, { method: 'PATCH', url: `/v1/miniapp/appointments/${id}`, payload });
    const scheduleOf = async (day: string) =>
      (
        await mini(ANNA_CHAT, { method: 'GET', url: `/v1/miniapp/schedule?from=${day}&to=${day}` })
      ).json().appointments as { id: string }[];

    const res = await edit(own!.id, {
      client: { fullName: 'Own Client Junior', phone: '+12025559002' },
      notes: 'Allergic to latex',
    });
    expect(res.statusCode, res.body).toBe(204);
    expect(await scheduleOf(upcoming(5))).toContainEqual(
      expect.objectContaining({
        id: own!.id,
        serviceId: data.serviceId,
        locationId: data.locationId,
        client: { fullName: 'Own Client Junior', phone: '+12025559002' },
        notes: 'Allergic to latex',
      }),
    );
    // Комментарий — он же заметка в истории клиента (Q19): новый текст поправил её, а не
    // добавил новую, и она ушла к новому клиенту записи
    const notesOf = async (phone: string) => {
      const [client] = await database.db
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.clinicId, owner.clinicId), eq(patients.phone, phone)));
      const card = await call<ClientCard>(app, owner, {
        method: 'GET',
        url: `/v1/admin/clients/${client!.id}`,
      });
      return card.notes.map(({ text, author, authorName, edited }) => ({
        text,
        author,
        authorName,
        edited,
      }));
    };
    const anna = { author: 'dentist', authorName: 'Dr. Anna' };
    expect(await notesOf('+12025559000')).toEqual([]);
    expect(await notesOf('+12025559002')).toEqual([
      { text: 'Allergic to latex', ...anna, edited: true },
    ]);

    // Пустой комментарий убирает его — и из истории клиента; клиент без поля client не меняется
    expect((await edit(own!.id, { notes: '' })).statusCode).toBe(204);
    const [row] = await database.db
      .select({ notes: appointments.notes, phone: patients.phone })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .where(eq(appointments.id, own!.id));
    expect(row).toEqual({ notes: null, phone: '+12025559002' });
    expect((await edit(own!.id, {})).statusCode).toBe(400);

    // Запись с сайта врач правит так же
    const [website] = await scheduleOf(upcoming(1));
    expect((await edit(website!.id, { notes: 'Call before the visit' })).statusCode).toBe(204);
    expect(await scheduleOf(upcoming(1))).toContainEqual(
      expect.objectContaining({ id: website!.id, notes: 'Call before the visit' }),
    );

    expect(await notesOf('+12025559002')).toEqual([]);
  });

  it('shows the dentist every note about the client of an own booking (Q19)', async () => {
    const booked = await mini(ANNA_CHAT, {
      method: 'POST',
      url: '/v1/miniapp/appointments',
      payload: {
        serviceId: data.serviceId,
        locationId: data.locationId,
        startAt: at(addDays(upcoming(3), 14), '15:00'),
        client: { fullName: 'Noted Client', phone: '+12025559050' },
        notes: 'Sensitive teeth',
      },
    });
    expect(booked.statusCode, booked.body).toBe(201);
    const id = booked.json<{ id: string }>().id;
    const [client] = await database.db
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.clinicId, owner.clinicId), eq(patients.phone, '+12025559050')));
    // Заметка регистратуры в карточке клиента
    await call(
      app,
      owner,
      {
        method: 'POST',
        url: `/v1/admin/clients/${client!.id}/notes`,
        payload: { text: 'Pays in cash' },
      },
      201,
    );

    const notesUrl = `/v1/miniapp/appointments/${id}/client-notes`;
    const res = await mini(ANNA_CHAT, { method: 'GET', url: notesUrl });
    expect(res.statusCode, res.body).toBe(200);
    expect(
      res.json<ClientNote[]>().map(({ text, author, authorName, appointment }) => ({
        text,
        author,
        authorName,
        appointment: appointment?.id ?? null,
      })),
    ).toEqual([
      { text: 'Pays in cash', author: 'staff', authorName: 'Olivia Owner', appointment: null },
      { text: 'Sensitive teeth', author: 'dentist', authorName: 'Dr. Anna', appointment: id },
    ]);

    // Отменить: дальше тесты изоляции берут любую подтверждённую запись врача
    const cancelled = await mini(ANNA_CHAT, {
      method: 'POST',
      url: `/v1/miniapp/appointments/${id}/cancel`,
    });
    expect(cancelled.statusCode, cancelled.body).toBe(204);
    // Отменённая запись — заметки клиента по-прежнему видны
    expect((await mini(ANNA_CHAT, { method: 'GET', url: notesUrl })).json()).toHaveLength(2);
  });

  it('moves and cancels an own booking without alerting the dentist', async () => {
    const day = upcoming(5);
    const [own] = await database.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.dentistId, data.dentistId), eq(appointments.source, 'telegram')));
    const website = await bookFromWebsite(at(day, '14:00'));
    const slots = async (extra = '') =>
      (
        await mini(ANNA_CHAT, {
          method: 'GET',
          url: `/v1/miniapp/slots?serviceId=${data.serviceId}&locationId=${data.locationId}&date=${day}${extra}`,
        })
      ).json().slots as string[];
    const move = (startAt: string) =>
      mini(ANNA_CHAT, {
        method: 'POST',
        url: `/v1/miniapp/appointments/${own!.id}/move`,
        payload: { startAt },
      });
    const cancel = () =>
      mini(ANNA_CHAT, { method: 'POST', url: `/v1/miniapp/appointments/${own!.id}/cancel` });
    const stored = async () =>
      (
        await database.db
          .select({
            startAt: appointments.startAt,
            endAt: appointments.endAt,
            status: appointments.status,
            cancelledBy: appointments.cancelledBy,
          })
          .from(appointments)
          .where(eq(appointments.id, own!.id))
      )[0]!;
    const alerts = outbox.messagesTo(ANNA_CHAT).length;

    // Своё время записи свободно только для её переноса
    expect(await slots()).not.toContain(at(day, '11:00'));
    expect(await slots(`&appointmentId=${own!.id}`)).toContain(at(day, '11:00'));
    // Занятое время — одной клеткой на время начала записи, не на каждый шаг сетки
    const busy = async (extra = '') =>
      (
        await mini(ANNA_CHAT, {
          method: 'GET',
          url: `/v1/miniapp/slots?serviceId=${data.serviceId}&locationId=${data.locationId}&date=${day}${extra}`,
        })
      ).json().busy as MiniappBusyTime[];
    // Клетка записи знает её id — по нажатию Mini App открывает запись
    expect(await busy()).toEqual([
      { startAt: at(day, '11:00'), kind: 'booked', appointmentId: own!.id },
      { startAt: at(day, '14:00'), kind: 'booked', appointmentId: website.id },
    ]);
    expect(await busy(`&appointmentId=${own!.id}`)).toEqual([
      { startAt: at(day, '14:00'), kind: 'booked', appointmentId: website.id },
    ]);
    const opened = await mini(ANNA_CHAT, {
      method: 'GET',
      url: `/v1/miniapp/appointments/${website.id}`,
    });
    expect(opened.statusCode, opened.body).toBe(200);
    const [inSchedule] = (
      await mini(ANNA_CHAT, { method: 'GET', url: `/v1/miniapp/schedule?from=${day}&to=${day}` })
    )
      .json<MiniappSchedule>()
      .appointments.filter((a) => a.id === website.id);
    expect(opened.json()).toEqual(inSchedule);

    // Холд — клиент как раз записывается на сайте: клетка красная, но открывать нечего
    const headers = { authorization: `Bearer ${key}`, origin: ORIGIN };
    const hold = await app.inject({
      method: 'POST',
      url: '/v1/public/holds',
      headers,
      payload: {
        service_id: data.serviceId,
        location_id: data.locationId,
        start_at: at(day, '16:00'),
      },
    });
    expect(hold.statusCode, hold.body).toBe(201);
    const holdId = hold.json<HoldResponse>().hold_id;
    expect(await busy()).toContainEqual({ startAt: at(day, '16:00'), kind: 'booked' });
    expect(
      (await mini(ANNA_CHAT, { method: 'GET', url: `/v1/miniapp/appointments/${holdId}` }))
        .statusCode,
    ).toBe(404);
    const released = await app.inject({
      method: 'DELETE',
      url: `/v1/public/holds/${holdId}`,
      headers,
    });
    expect(released.statusCode, released.body).toBe(204);

    // Перенос на 15 минут: новое время задевает старое, запись сама себе не мешает
    const moved = await move(at(day, '11:15'));
    expect(moved.statusCode, moved.body).toBe(204);
    expect(await stored()).toMatchObject({
      startAt: new Date(at(day, '11:15')),
      endAt: new Date(at(day, '11:45')),
      status: 'confirmed',
    });

    // На чужую запись не переносится — это держит EXCLUDE (§2.1)
    const taken = await move(at(day, '14:00'));
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe('slot_taken');

    expect((await cancel()).statusCode).toBe(204);
    expect(await stored()).toMatchObject({ status: 'cancelled', cancelledBy: 'dentist' });
    expect(await slots()).toContain(at(day, '11:15'));
    // Отменённую не отменить, не перенести и не поправить
    expect((await cancel()).statusCode).toBe(409);
    expect((await move(at(day, '16:00'))).statusCode).toBe(409);
    const edited = await mini(ANNA_CHAT, {
      method: 'PATCH',
      url: `/v1/miniapp/appointments/${own!.id}`,
      payload: { notes: 'Too late' },
    });
    expect(edited.statusCode).toBe(404);

    // Всё это сделал сам врач — сообщать ему не о чем
    expect(outbox.messagesTo(ANNA_CHAT)).toHaveLength(alerts);
  });

  it('shows cancelled bookings in the schedule only when asked, with who cancelled', async () => {
    const day = upcoming(5);
    const schedule = (extra = '') =>
      mini(ANNA_CHAT, {
        method: 'GET',
        url: `/v1/miniapp/schedule?from=${day}&to=${day}${extra}`,
      });
    const appointmentsOf = async (extra = '') =>
      (await schedule(extra)).json().appointments as {
        status: string;
        cancelledBy: string | null;
      }[];

    // Без флажка — как раньше: отменённых нет
    expect((await appointmentsOf()).map((a) => [a.status, a.cancelledBy])).toEqual([
      ['confirmed', null],
    ]);
    // С флажком — и отменённые, по времени начала, с тем, кто отменил
    expect((await appointmentsOf('&cancelled=true')).map((a) => [a.status, a.cancelledBy])).toEqual(
      [
        ['cancelled', 'dentist'],
        ['confirmed', null],
      ],
    );
    expect((await appointmentsOf('&cancelled=false')).map((a) => a.status)).toEqual(['confirmed']);
    expect((await schedule('&cancelled=yes')).statusCode).toBe(400);
  });

  it('shows the dentist the whole history of the own booking', async () => {
    const day = upcoming(5);
    const [own] = await database.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.dentistId, data.dentistId), eq(appointments.source, 'telegram')));
    const anna = { actor: 'dentist', actorName: 'Dr. Anna' };
    // Отклонённые попытки (занятое время, пустая правка, повторная отмена) следов не оставили
    expect(await historyOf(ANNA_CHAT, own!.id)).toEqual([
      { type: 'created', ...anna, changes: { startAt: { from: null, to: at(day, '11:00') } } },
      { type: 'confirmed', ...anna, changes: null },
      {
        type: 'updated',
        ...anna,
        changes: {
          client: {
            from: { fullName: 'Own Client', phone: '+12025559000' },
            to: { fullName: 'Own Client Junior', phone: '+12025559002' },
          },
          notes: { from: 'Bring the X-ray', to: 'Allergic to latex' },
        },
      },
      {
        type: 'updated',
        ...anna,
        changes: { notes: { from: 'Allergic to latex', to: null } },
      },
      {
        type: 'moved',
        ...anna,
        changes: { startAt: { from: at(day, '11:00'), to: at(day, '11:15') } },
      },
      { type: 'cancelled', ...anna, changes: null },
    ]);

    // Запись с сайта: создал клиент, комментарий добавил врач
    const [website] = (
      await mini(ANNA_CHAT, {
        method: 'GET',
        url: `/v1/miniapp/schedule?from=${upcoming(1)}&to=${upcoming(1)}`,
      })
    ).json().appointments as { id: string }[];
    expect((await historyOf(ANNA_CHAT, website!.id)).map((e) => [e.type, e.actor])).toEqual([
      ['created', 'client'],
      ['updated', 'dentist'],
    ]);
  });

  it('takes the client phone in any form the dentist types', async () => {
    const book = (phone: string) =>
      mini(ANNA_CHAT, {
        method: 'POST',
        url: '/v1/miniapp/appointments',
        payload: {
          serviceId: data.serviceId,
          locationId: data.locationId,
          startAt: at(upcoming(2), '15:00'),
          client: { fullName: 'Walk-in Client', phone },
        },
      });
    const phoneOf = async (id: string) =>
      (
        await database.db
          .select({ phone: patients.phone })
          .from(appointments)
          .innerJoin(patients, eq(patients.id, appointments.patientId))
          .where(eq(appointments.id, id))
      )[0]!.phone;

    // Номер не в E.164 хранится как введён, без пробелов по краям
    const res = await book(' 077 12-34-56 ');
    expect(res.statusCode, res.body).toBe(201);
    const id = res.json().id as string;
    expect(await phoneOf(id)).toBe('077 12-34-56');

    // Правка: номер, который читается как американский, приводится к E.164
    const edited = await mini(ANNA_CHAT, {
      method: 'PATCH',
      url: `/v1/miniapp/appointments/${id}`,
      payload: { client: { fullName: 'Walk-in Client', phone: '(202) 555-0177' } },
    });
    expect(edited.statusCode, edited.body).toBe(204);
    expect(await phoneOf(id)).toBe('+12025550177');

    // Отменить: дальше тесты изоляции берут любую подтверждённую запись врача
    const cancelled = await mini(ANNA_CHAT, {
      method: 'POST',
      url: `/v1/miniapp/appointments/${id}/cancel`,
    });
    expect(cancelled.statusCode, cancelled.body).toBe(204);
  });

  it('books a client without a phone, and keeps that client to the one booking', async () => {
    const day = upcoming(2);
    const clientOf = async (id: string) =>
      (
        await database.db
          .select({ id: patients.id, fullName: patients.fullName, phone: patients.phone })
          .from(appointments)
          .innerJoin(patients, eq(patients.id, appointments.patientId))
          .where(eq(appointments.id, id))
      )[0]!;
    const edit = (id: string, phone: string) =>
      mini(ANNA_CHAT, {
        method: 'PATCH',
        url: `/v1/miniapp/appointments/${id}`,
        payload: { client: { fullName: 'No Phone Client', phone } },
      });

    // Без поля phone, с пустым и с пробелами — клиент без номера, у каждой записи свой
    const ids: string[] = [];
    for (const [time, client] of [
      ['12:00', { fullName: 'No Phone' }],
      ['13:00', { fullName: 'No Phone', phone: '' }],
      ['14:00', { fullName: 'No Phone', phone: '   ' }],
    ] as const) {
      const res = await mini(ANNA_CHAT, {
        method: 'POST',
        url: '/v1/miniapp/appointments',
        payload: {
          serviceId: data.serviceId,
          locationId: data.locationId,
          startAt: at(day, time),
          client,
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      ids.push(res.json().id as string);
    }
    const first = await clientOf(ids[0]!);
    expect(first).toMatchObject({ fullName: 'No Phone', phone: null });
    expect(new Set(await Promise.all(ids.map(async (id) => (await clientOf(id)).id))).size).toBe(3);
    const schedule = await mini(ANNA_CHAT, {
      method: 'GET',
      url: `/v1/miniapp/schedule?from=${day}&to=${day}`,
    });
    expect(schedule.json<MiniappSchedule>().appointments).toContainEqual(
      expect.objectContaining({ id: ids[0], client: { fullName: 'No Phone', phone: null } }),
    );

    // Имя клиента без номера правится на месте — новых клиентов не появляется
    expect((await edit(ids[0]!, '')).statusCode).toBe(204);
    expect(await clientOf(ids[0]!)).toEqual({ ...first, fullName: 'No Phone Client' });
    // Номер можно добавить, а потом убрать: клиент с этим номером остаётся, как был
    expect((await edit(ids[0]!, '(202) 555-0166')).statusCode).toBe(204);
    const withPhone = await clientOf(ids[0]!);
    expect(withPhone.phone).toBe('+12025550166');
    expect((await edit(ids[0]!, '')).statusCode).toBe(204);
    const removed = await clientOf(ids[0]!);
    expect(removed.phone).toBeNull();
    expect(removed.id).not.toBe(withPhone.id);
    const [kept] = await database.db
      .select({ phone: patients.phone })
      .from(patients)
      .where(eq(patients.id, withPhone.id));
    expect(kept).toEqual({ phone: '+12025550166' });

    // Алерт о переносе регистратурой — с одним именем, без «null»
    await call(
      app,
      owner,
      {
        method: 'PATCH',
        url: `/v1/admin/appointments/${ids[0]}`,
        payload: { startAt: at(day, '16:00') },
      },
      204,
    );
    expect(outbox.messagesTo(ANNA_CHAT).at(-1)!.text).toMatch(/\nClient: No Phone Client$/);

    // Отменить: дальше тесты изоляции берут любую подтверждённую запись врача
    for (const id of ids) {
      const cancelled = await mini(ANNA_CHAT, {
        method: 'POST',
        url: `/v1/miniapp/appointments/${id}/cancel`,
      });
      expect(cancelled.statusCode, cancelled.body).toBe(204);
    }
  });

  it('books a service with its own duration for this booking, and moves it with it', async () => {
    const day = addDays(upcoming(4), 7);
    const grid = async (query: string) =>
      (
        await mini(ANNA_CHAT, {
          method: 'GET',
          url: `/v1/miniapp/slots?serviceId=${data.serviceId}&locationId=${data.locationId}&date=${day}&${query}`,
        })
      ).json<MiniappSlots>().slots;
    const book = (durationMin: number) =>
      mini(ANNA_CHAT, {
        method: 'POST',
        url: '/v1/miniapp/appointments',
        payload: {
          serviceId: data.serviceId,
          durationMin,
          locationId: data.locationId,
          startAt: at(day, '09:00'),
          client: { fullName: 'Long Visit' },
        },
      });

    // Услуга — 30 минут; на 2 часа сетка последним предлагает 15:00 (смена до 17:00)
    expect(await grid('durationMin=120')).toContain(at(day, '15:00'));
    expect(await grid('durationMin=120')).not.toContain(at(day, '15:15'));
    expect(await grid('')).toContain(at(day, '16:30'));
    expect((await book(3)).statusCode).toBe(400);

    const res = await book(120);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().endAt).toBe(at(day, '11:00'));
    const id = res.json().id as string;
    const opened = await mini(ANNA_CHAT, { method: 'GET', url: `/v1/miniapp/appointments/${id}` });
    expect(opened.json()).toMatchObject({ service: 'Checkup', endAt: at(day, '11:00') });
    // В каталоге услуга осталась 30-минутной
    const me = await mini(ANNA_CHAT, { method: 'GET', url: '/v1/miniapp/me' });
    expect(me.json<MiniappMe>().services).toEqual([
      expect.objectContaining({ id: data.serviceId, durationMin: 30 }),
    ]);

    // Перенос — со своей длительностью: сетка и проверка считают 2 часа, а не 30 минут
    expect(await grid(`appointmentId=${id}`)).not.toContain(at(day, '15:15'));
    const move = (time: string) =>
      mini(ANNA_CHAT, {
        method: 'POST',
        url: `/v1/miniapp/appointments/${id}/move`,
        payload: { startAt: at(day, time) },
      });
    expect((await move('15:15')).statusCode).toBe(400);
    expect((await move('15:00')).statusCode).toBe(204);
    const [row] = await database.db
      .select({ endAt: appointments.endAt })
      .from(appointments)
      .where(eq(appointments.id, id));
    expect(row).toEqual({ endAt: new Date(at(day, '17:00')) });

    // Отменить: дальше тесты изоляции берут любую подтверждённую запись врача
    const cancelled = await mini(ANNA_CHAT, {
      method: 'POST',
      url: `/v1/miniapp/appointments/${id}/cancel`,
    });
    expect(cancelled.statusCode, cancelled.body).toBe(204);
  });

  it('books "Other" with its own duration once, and it never shows up in a list', async () => {
    const day = upcoming(3);
    const slotsFor = (query: string) =>
      mini(ANNA_CHAT, {
        method: 'GET',
        url: `/v1/miniapp/slots?locationId=${data.locationId}&date=${day}&${query}`,
      });
    const book = (payload: object) =>
      mini(ANNA_CHAT, {
        method: 'POST',
        url: '/v1/miniapp/appointments',
        payload: {
          locationId: data.locationId,
          startAt: at(day, '12:00'),
          client: { fullName: 'Custom Client', phone: '+12025559300' },
          ...payload,
        },
      });
    const other = { durationMin: 50 };

    // Сетка — по введённой длительности и шагу клиники (15 мин) после неё: 50 + 15 минут
    // влезают до 17:00 с 15:45, но не с 16:00
    const grid = await slotsFor('durationMin=50');
    expect(grid.statusCode, grid.body).toBe(200);
    expect(grid.json().slots).toContain(at(day, '15:45'));
    expect(grid.json().slots).not.toContain(at(day, '16:00'));
    // Услуга — ровно одна из двух, длительность — от 5 минут до 8 часов
    expect((await slotsFor('durationMin=3')).statusCode).toBe(400);
    expect((await slotsFor('')).statusCode).toBe(400);
    expect((await book({ customService: { durationMin: 481 } })).statusCode).toBe(400);
    expect((await book({ customService: other, serviceId: data.serviceId })).statusCode).toBe(400);
    // Длительность «Другого» — внутри customService, второй рядом не бывает
    expect((await book({ customService: other, durationMin: 50 })).statusCode).toBe(400);
    expect((await book({})).statusCode).toBe(400);

    // Название — всегда «Другое» на языке клиники; присланное (старый Mini App) не берётся
    const res = await book({ customService: { ...other, name: 'Night guard fitting' } });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().endAt).toBe(at(day, '12:50'));
    // После визита запись держит ещё шаг сетки, как буфер после услуги
    const [held] = await database.db
      .select({ bufferMin: appointments.bufferMin, blockedUntil: appointments.blockedUntil })
      .from(appointments)
      .where(eq(appointments.id, res.json().id));
    expect(held).toEqual({ bufferMin: 15, blockedUntil: new Date(at(day, '13:05')) });
    const id = res.json().id as string;
    const opened = await mini(ANNA_CHAT, { method: 'GET', url: `/v1/miniapp/appointments/${id}` });
    expect(opened.json()).toMatchObject({
      service: 'Other',
      endAt: at(day, '12:50'),
    });
    const customId = opened.json().serviceId as string;
    expect(customId).not.toBe(data.serviceId);

    // В следующий раз этой услуги нет ни в одном списке, и записать на неё снова нельзя
    const me = await mini(ANNA_CHAT, { method: 'GET', url: '/v1/miniapp/me' });
    expect(me.json<MiniappMe>().services.map((s) => s.id)).toEqual([data.serviceId]);
    const catalog = await call<Service[]>(app, owner, { method: 'GET', url: '/v1/admin/services' });
    expect(catalog.map((s) => s.id)).not.toContain(customId);
    await call(app, owner, { method: 'GET', url: `/v1/admin/services/${customId}` }, 404);
    await call(
      app,
      owner,
      { method: 'PATCH', url: `/v1/admin/services/${customId}`, payload: { isPublic: true } },
      404,
    );
    await call(
      app,
      owner,
      {
        method: 'PUT',
        url: `/v1/admin/dentists/${data.dentistId}/services`,
        payload: { serviceIds: [data.serviceId, customId] },
      },
      404,
    );
    const headers = { authorization: `Bearer ${key}`, origin: ORIGIN };
    const published = await app.inject({ method: 'GET', url: '/v1/public/services', headers });
    expect(published.statusCode).toBe(200);
    expect(published.json<PublicService[]>().map((s) => s.id)).not.toContain(customId);
    const hold = await app.inject({
      method: 'POST',
      url: '/v1/public/holds',
      headers,
      payload: { service_id: customId, location_id: data.locationId, start_at: at(day, '15:00') },
    });
    expect(hold.statusCode).toBe(404);
    expect((await book({ serviceId: customId })).statusCode).toBe(404);
    const again = await as(app, owner, {
      method: 'POST',
      url: '/v1/admin/appointments',
      payload: {
        locationId: data.locationId,
        serviceId: customId,
        dentistId: data.dentistId,
        startAt: at(day, '15:00'),
        client: { fullName: 'Custom Client', phone: '+12025559300' },
      },
    });
    expect(again.statusCode).toBe(400);

    // Запись на свою услугу переносится, как любая: врачом и регистратурой
    const moved = await mini(ANNA_CHAT, {
      method: 'POST',
      url: `/v1/miniapp/appointments/${id}/move`,
      payload: { startAt: at(day, '13:00') },
    });
    expect(moved.statusCode, moved.body).toBe(204);
    await call(
      app,
      owner,
      {
        method: 'PATCH',
        url: `/v1/admin/appointments/${id}`,
        payload: { startAt: at(day, '14:00') },
      },
      204,
    );
    const [row] = await database.db
      .select({ startAt: appointments.startAt, endAt: appointments.endAt })
      .from(appointments)
      .where(eq(appointments.id, id));
    expect(row).toEqual({ startAt: new Date(at(day, '14:00')), endAt: new Date(at(day, '14:50')) });

    // Отменить: дальше тесты изоляции берут любую подтверждённую запись врача
    const cancelled = await mini(ANNA_CHAT, {
      method: 'POST',
      url: `/v1/miniapp/appointments/${id}/cancel`,
    });
    expect(cancelled.statusCode, cancelled.body).toBe(204);
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
    'PATCH /v1/miniapp/me': async () => {
      const before = await localeOf(data.dentistId);
      const res = await mini(BORIS_CHAT, {
        method: 'PATCH',
        url: '/v1/miniapp/me',
        payload: { locale: 'hy' },
      });
      expect(res.statusCode).toBe(200);
      expect(await localeOf(boris)).toBe('hy');
      // Язык чужого врача не тронут
      expect(await localeOf(data.dentistId)).toBe(before);
      await database.db.update(dentists).set({ locale: null }).where(eq(dentists.id, boris));
    },
    'GET /v1/miniapp/schedule': async () => {
      const from = upcoming(1);
      const to = addDays(from, 20);
      // Отменённые записи Anna тоже не видны чужому врачу — и с флажком
      const annaCancelled = await database.db
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(eq(appointments.dentistId, data.dentistId), eq(appointments.status, 'cancelled')),
        );
      expect(annaCancelled.length).toBeGreaterThan(0);
      for (const chat of [BORIS_CHAT, OTHER_CHAT]) {
        for (const extra of ['', '&cancelled=true']) {
          const res = await mini(chat, {
            method: 'GET',
            url: `/v1/miniapp/schedule?from=${from}&to=${to}${extra}`,
          });
          expect(res.statusCode).toBe(200);
          expect(res.body).not.toContain(annaAppointment);
          expect(res.body).not.toContain('Jane Client');
          for (const { id } of annaCancelled) expect(res.body).not.toContain(id);
        }
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
    'PATCH /v1/miniapp/appointments/:id': async () => {
      for (const chat of [BORIS_CHAT, OTHER_CHAT]) {
        const res = await mini(chat, {
          method: 'PATCH',
          url: `/v1/miniapp/appointments/${annaAppointment}`,
          payload: {
            client: { fullName: 'Intruder', phone: '+12025559111' },
            notes: 'Hijacked',
          },
        });
        expect(res.statusCode).toBe(404);
      }
      const [row] = await database.db
        .select({ notes: appointments.notes, name: patients.fullName })
        .from(appointments)
        .innerJoin(patients, eq(patients.id, appointments.patientId))
        .where(eq(appointments.id, annaAppointment));
      expect(row!.notes).not.toBe('Hijacked');
      expect(row!.name).not.toBe('Intruder');
    },
    'POST /v1/miniapp/appointments/:id/move': async () => {
      const startAt = async () =>
        (
          await database.db
            .select({ startAt: appointments.startAt })
            .from(appointments)
            .where(eq(appointments.id, annaAppointment))
        )[0]!.startAt;
      const before = await startAt();
      for (const chat of [BORIS_CHAT, OTHER_CHAT]) {
        const res = await mini(chat, {
          method: 'POST',
          url: `/v1/miniapp/appointments/${annaAppointment}/move`,
          payload: { startAt: at(upcoming(3), '15:00') },
        });
        expect(res.statusCode).toBe(404);
      }
      expect(await startAt()).toEqual(before);
    },
    'GET /v1/miniapp/appointments/:id': async () => {
      for (const chat of [BORIS_CHAT, OTHER_CHAT]) {
        const res = await mini(chat, {
          method: 'GET',
          url: `/v1/miniapp/appointments/${annaAppointment}`,
        });
        expect(res.statusCode).toBe(404);
      }
    },
    'GET /v1/miniapp/appointments/:id/history': async () => {
      for (const chat of [BORIS_CHAT, OTHER_CHAT]) {
        const res = await mini(chat, {
          method: 'GET',
          url: `/v1/miniapp/appointments/${annaAppointment}/history`,
        });
        expect(res.statusCode).toBe(404);
      }
    },
    'GET /v1/miniapp/appointments/:id/client-notes': async () => {
      for (const chat of [BORIS_CHAT, OTHER_CHAT]) {
        const res = await mini(chat, {
          method: 'GET',
          url: `/v1/miniapp/appointments/${annaAppointment}/client-notes`,
        });
        expect(res.statusCode).toBe(404);
      }
    },
    'POST /v1/miniapp/appointments/:id/cancel': async () => {
      for (const chat of [BORIS_CHAT, OTHER_CHAT]) {
        const res = await mini(chat, {
          method: 'POST',
          url: `/v1/miniapp/appointments/${annaAppointment}/cancel`,
        });
        expect(res.statusCode).toBe(404);
      }
      const [row] = await database.db
        .select({ status: appointments.status })
        .from(appointments)
        .where(eq(appointments.id, annaAppointment));
      expect(row!.status).toBe('confirmed');
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

describe('the dentist chooses the language in Telegram (§9)', () => {
  const lastTo = (chatId: number) => outbox.messagesTo(chatId).at(-1)!;
  const answers = () =>
    outbox.jobs.filter((j) => j.job.type === 'answer').map((j) => j.job) as {
      type: 'answer';
      text?: string;
    }[];

  afterAll(async () => {
    // Остальные блоки ждут английский: возвращаем врача к языку клиники
    await database.db.update(dentists).set({ locale: null }).where(eq(dentists.id, data.dentistId));
  });

  it('/language offers every supported language, named in itself', async () => {
    expect((await webhook(message(ANNA_CHAT, '/language'))).statusCode).toBe(200);
    const prompt = lastTo(ANNA_CHAT);
    expect(prompt.text).toBe('Choose the language for the bot and the schedule:');
    expect(prompt.buttons).toEqual([
      [{ text: 'English', callbackData: 'lang:en' }],
      [{ text: 'Русский', callbackData: 'lang:ru' }],
      [{ text: 'Հայերեն', callbackData: 'lang:hy' }],
    ]);
  });

  it('stores the choice and answers in the new language', async () => {
    expect((await webhook(callback(ANNA_CHAT, 'lang:hy'))).statusCode).toBe(200);
    expect(await localeOf(data.dentistId)).toBe('hy');
    expect(answers().at(-1)!.text).toContain('Հայերեն');
    const confirmation = lastTo(ANNA_CHAT);
    expect(confirmation.text).toContain('Հայերեն');
    // Кнопка расписания — тоже на новом языке
    expect(confirmation.buttons).toEqual([
      [{ text: '📅 Բացել գրաֆիկը', webAppUrl: telegram.miniAppUrl }],
    ]);
  });

  it('keeps speaking the chosen language, not the clinic one', async () => {
    await webhook(message(ANNA_CHAT, '/start'));
    expect(lastTo(ANNA_CHAT).text).toBe('Դուք միացված եք Smile Dental կլինիկային։');
    // /language тоже спрашивает уже по-армянски
    await webhook(message(ANNA_CHAT, '/language'));
    expect(lastTo(ANNA_CHAT).text).toBe('Ընտրեք բոտի և գրաֆիկի լեզուն՝');
  });

  it('describes appointments to the dentist in the chosen language (§2.3)', async () => {
    const [row] = await database.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(eq(appointments.dentistId, data.dentistId));
    const details = await describeAppointment(database.db, owner.clinicId, row!.id);
    expect(details!.locale).toBe('hy');
    // Язык клиники остаётся для сообщений другим врачам
    expect(details!.clinicLocale).toBe('en');
  });

  it('the Mini App reports the choice and changes it, one preference for both', async () => {
    const before = await mini(ANNA_CHAT, { method: 'GET', url: '/v1/miniapp/me' });
    expect(before.json().dentist.locale).toBe('hy');

    const patched = await mini(ANNA_CHAT, {
      method: 'PATCH',
      url: '/v1/miniapp/me',
      payload: { locale: 'ru' },
    });
    expect(patched.statusCode).toBe(200);
    expect(
      (await mini(ANNA_CHAT, { method: 'GET', url: '/v1/miniapp/me' })).json().dentist.locale,
    ).toBe('ru');
    // Выбор в Mini App слышит и бот
    await webhook(message(ANNA_CHAT, '/start'));
    expect(lastTo(ANNA_CHAT).text).toBe('Вы подключены к клинике Smile Dental.');
  });

  it('refuses a language the platform does not have', async () => {
    const res = await mini(ANNA_CHAT, {
      method: 'PATCH',
      url: '/v1/miniapp/me',
      payload: { locale: 'de' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
    expect(await localeOf(data.dentistId)).toBe('ru');
  });

  it('ignores a language button from a stranger', async () => {
    const before = outbox.jobs.length;
    await webhook(callback(9999, 'lang:hy'));
    const added = outbox.jobs.slice(before).map((j) => j.job);
    expect(added.every((j) => j.type !== 'message')).toBe(true);
  });
});
