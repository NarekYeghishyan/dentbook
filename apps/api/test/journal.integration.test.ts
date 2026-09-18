/**
 * Журнал регистратуры (Шаг 9, Q17): запись сотрудником, перенос мышью, подтверждение,
 * отмена клиникой, отметки визитов, карточка клиента, CSV и дашборд. Критерий «Готово» —
 * перенос не создаёт пересечений: одновременные переносы на одно время дают ровно один.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, isoWeekday, localDateOf, zonedTimeToUtc } from '@dentbook/core';
import { appointments, blockedUntil, notifications } from '@dentbook/db';
import { startTestDatabase, type TestDatabase } from '@dentbook/db/testing';
import type {
  ClientCard,
  ClientSummary,
  DashboardResponse,
  Dentist,
  JournalResponse,
  TelegramLink,
} from '@dentbook/shared';
import {
  TestOutbox,
  TestSmsOutbox,
  as,
  call,
  createClinicData,
  registerClinic,
  testApp,
  testTelegram,
  type ClinicFixture,
  type Session,
} from './helpers.js';

const ZONE = 'America/New_York';
const ANNA_CHAT = 3001;
const BORIS_CHAT = 3002;

let database: TestDatabase;
let app: FastifyInstance;
const smsOutbox = new TestSmsOutbox();
const outbox = new TestOutbox();
const telegram = testTelegram(outbox);
let owner: Session;
let data: ClinicFixture;
let boris: string;

/** Будний день не раньше чем через 3 дня: оба напоминания впереди. */
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
async function book(
  date: string,
  time: string,
  options: { dentistId?: string; fullName?: string } = {},
) {
  return as(app, owner, {
    method: 'POST',
    url: '/v1/admin/appointments',
    payload: {
      locationId: data.locationId,
      serviceId: data.serviceId,
      dentistId: options.dentistId ?? data.dentistId,
      startAt: at(date, time),
      client: {
        fullName: options.fullName ?? 'Jane Client',
        phone: `+1202555${String(6000 + ++phoneCounter)}`,
      },
    },
  });
}
async function booked(date: string, time: string, options?: Parameters<typeof book>[2]) {
  const res = await book(date, time, options);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string }>().id;
}

const move = (id: string, payload: object) =>
  as(app, owner, { method: 'PATCH', url: `/v1/admin/appointments/${id}`, payload });
const post = (url: string, payload?: object) =>
  as(app, owner, { method: 'POST', url, ...(payload ? { payload } : {}) });

const journal = (date: string) =>
  call<JournalResponse>(app, owner, {
    method: 'GET',
    url: `/v1/admin/journal?locationId=${data.locationId}&from=${date}&to=${date}`,
  });

const smsKinds = async (appointmentId: string) =>
  (
    await database.db
      .select({ kind: notifications.kind, status: notifications.status })
      .from(notifications)
      .where(and(eq(notifications.appointmentId, appointmentId), eq(notifications.channel, 'sms')))
  ).map((r) => `${r.kind}:${r.status}`);

const lastMessageTo = (chatId: number) => outbox.messagesTo(chatId).at(-1)?.text ?? '';

async function linkDentist(dentistId: string, chatId: number, updateId: number) {
  const link = await call<TelegramLink>(
    app,
    owner,
    { method: 'POST', url: `/v1/admin/dentists/${dentistId}/telegram-link` },
    201,
  );
  await app.inject({
    method: 'POST',
    url: '/telegram/webhook',
    headers: { 'x-telegram-bot-api-secret-token': telegram.webhookSecret },
    payload: {
      update_id: updateId,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, is_bot: false, first_name: 'Dr' },
        text: `/start ${new URL(link.url).searchParams.get('start')}`,
      },
    },
  } satisfies InjectOptions);
}

beforeAll(async () => {
  database = await startTestDatabase();
  app = testApp(database.db, {}, { smsOutbox, telegram });
  await app.ready();
  owner = await registerClinic(app, { clinicName: 'Smile Dental', timezone: ZONE });
  data = await createClinicData(app, owner, { dentistName: 'Dr. Anna' });
  boris = (
    await call<Dentist>(
      app,
      owner,
      { method: 'POST', url: '/v1/admin/dentists', payload: { fullName: 'Dr. Boris' } },
      201,
    )
  ).id;
  await call(app, owner, {
    method: 'PUT',
    url: `/v1/admin/dentists/${boris}/services`,
    payload: { serviceIds: [data.serviceId] },
  });
  await call(app, owner, {
    method: 'PUT',
    url: `/v1/admin/dentists/${boris}/working-hours`,
    payload: {
      items: [1, 2, 3, 4, 5].map((weekday) => ({
        locationId: data.locationId,
        weekday,
        startTime: '09:00',
        endTime: '17:00',
      })),
    },
  });
  await linkDentist(data.dentistId, ANNA_CHAT, 1);
  await linkDentist(boris, BORIS_CHAT, 2);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await database?.stop();
});

describe('journal (Step 9)', () => {
  it('shows working hours, bookings and closed time of the office', async () => {
    const day = upcoming(1);
    const id = await booked(day, '10:00');
    await call(
      app,
      owner,
      {
        method: 'POST',
        url: `/v1/admin/dentists/${boris}/exceptions`,
        payload: { type: 'block', startAt: at(day, '12:00'), endAt: at(day, '13:00') },
      },
      201,
    );

    const view = await journal(day);
    expect(view).toMatchObject({ timeZone: ZONE, slotStepMin: 15 });
    expect(view.dentists.map((d) => d.fullName)).toEqual(['Dr. Anna', 'Dr. Boris']);
    expect(view.dentists[0]!.working).toEqual([
      { date: day, start: at(day, '09:00'), end: at(day, '17:00') },
    ]);
    expect(view.blocks).toEqual([
      expect.objectContaining({ dentistId: boris, startAt: at(day, '12:00') }),
    ]);
    expect(view.appointments).toEqual([
      expect.objectContaining({
        id,
        status: 'confirmed',
        source: 'admin',
        startAt: at(day, '10:00'),
        dentistId: data.dentistId,
        service: 'Checkup',
        client: expect.objectContaining({ fullName: 'Jane Client' }),
      }),
    ]);
  });

  it('books a client at once: reminders for the client, an alert for the dentist', async () => {
    const day = upcoming(2);
    const id = await booked(day, '10:00');
    expect(await smsKinds(id)).toEqual(['reminder_24h:scheduled', 'reminder_2h:scheduled']);
    expect(lastMessageTo(ANNA_CHAT)).toMatch(/^New booking\n/);
  });

  it('books only free working time of the dentist', async () => {
    const day = upcoming(3);
    await booked(day, '10:00');

    for (const time of ['10:00', '10:15']) {
      const res = await book(day, time);
      expect(res.statusCode, time).toBe(409);
      expect(res.json().error.code).toBe('slot_taken');
      expect(res.json().alternatives.length).toBeGreaterThan(0);
    }
    // До начала смены, не влезает до конца смены, закрытое время
    for (const time of ['08:00', '16:45']) {
      const res = await book(day, time);
      expect(res.statusCode, time).toBe(400);
      expect(res.json().error.code).toBe('outside_working_hours');
    }
    await call(
      app,
      owner,
      {
        method: 'POST',
        url: `/v1/admin/dentists/${boris}/exceptions`,
        payload: { type: 'block', startAt: at(day, '12:00'), endAt: at(day, '13:00') },
      },
      201,
    );
    const blocked = await book(day, '12:00', { dentistId: boris });
    expect(blocked.json().error.code).toBe('outside_working_hours');

    const yesterday = addDays(localDateOf(new Date(), ZONE), -1);
    expect((await book(yesterday, '10:00')).statusCode).toBe(400);
  });

  it('moves a booking in time: the client is told and reminded about the new time', async () => {
    const day = upcoming(4);
    const id = await booked(day, '10:00');
    const before = smsOutbox.jobs.length;

    const res = await move(id, { startAt: at(day, '11:00') });
    expect(res.statusCode, res.body).toBe(204);
    const view = await journal(day);
    expect(view.appointments.find((x) => x.id === id)).toMatchObject({
      startAt: at(day, '11:00'),
      endAt: at(day, '11:30'),
    });
    expect(await smsKinds(id)).toEqual(
      expect.arrayContaining([
        'reminder_24h:cancelled',
        'reminder_2h:cancelled',
        'appointment_rescheduled:scheduled',
        'reminder_24h:scheduled',
        'reminder_2h:scheduled',
      ]),
    );
    expect(smsOutbox.removed.length).toBeGreaterThanOrEqual(2);
    expect(smsOutbox.jobs.length).toBe(before + 3);
    expect(lastMessageTo(ANNA_CHAT)).toMatch(/^Booking moved\n.*11:00/);
  });

  it('moves a booking to another dentist at the same time', async () => {
    const day = upcoming(5);
    const id = await booked(day, '10:00');
    const smsBefore = smsOutbox.jobs.length;

    const res = await move(id, { startAt: at(day, '10:00'), dentistId: boris });
    expect(res.statusCode, res.body).toBe(204);
    expect((await journal(day)).appointments.find((x) => x.id === id)?.dentistId).toBe(boris);
    expect(lastMessageTo(BORIS_CHAT)).toMatch(/^Booking moved\n/);
    expect(lastMessageTo(ANNA_CHAT)).toMatch(/^Booking moved to another dentist\n/);
    // Время у клиента прежнее — SMS нет, напоминания остаются
    expect(smsOutbox.jobs.length).toBe(smsBefore);
  });

  it('refuses a move onto another booking, closed time or a past visit', async () => {
    const day = addDays(upcoming(1), 7);
    const first = await booked(day, '10:00');
    const second = await booked(day, '14:00');

    const onto = await move(second, { startAt: at(day, '10:15') });
    expect(onto.statusCode).toBe(409);
    expect(onto.json().error.code).toBe('slot_taken');
    await call(
      app,
      owner,
      {
        method: 'POST',
        url: `/v1/admin/dentists/${data.dentistId}/exceptions`,
        payload: { type: 'block', startAt: at(day, '15:00'), endAt: at(day, '16:00') },
      },
      201,
    );
    expect((await move(second, { startAt: at(day, '15:00') })).json().error.code).toBe(
      'outside_working_hours',
    );
    // Перенос внутри своего же времени — можно: запись сама себе не мешает
    expect((await move(first, { startAt: at(day, '10:15') })).statusCode).toBe(204);

    const view = await journal(day);
    expect(view.appointments.map((x) => x.startAt).sort()).toEqual([
      at(day, '10:15'),
      at(day, '14:00'),
    ]);
  });

  it('concurrent moves onto one time give exactly one booking there', async () => {
    const day = addDays(upcoming(2), 7);
    const times = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '13:00', '13:30'];
    const ids = [];
    for (const time of times) ids.push(await booked(day, time));

    // Все — на 15:00 к Dr. Boris одновременно
    const results = await Promise.all(
      ids.map((id) => move(id, { startAt: at(day, '15:00'), dentistId: boris })),
    );
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 204)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(ids.length - 1);

    const atThree = await database.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.dentistId, boris),
          eq(appointments.startAt, new Date(at(day, '15:00'))),
          inArray(appointments.status, ['pending', 'confirmed']),
        ),
      );
    expect(atThree).toHaveLength(1);
  });

  it('confirms a pending booking and texts the client (Q12)', async () => {
    const day = addDays(upcoming(3), 7);
    const id = await booked(day, '10:00');
    await database.db
      .update(appointments)
      .set({ status: 'pending' })
      .where(eq(appointments.id, id));

    expect((await post(`/v1/admin/appointments/${id}/confirm`)).statusCode).toBe(204);
    expect((await journal(day)).appointments.find((x) => x.id === id)?.status).toBe('confirmed');
    expect(await smsKinds(id)).toContain('appointment_confirmed:scheduled');
    expect((await post(`/v1/admin/appointments/${id}/confirm`)).statusCode).toBe(409);
  });

  it('cancels on behalf of the clinic: SMS to the client, reminders off, dentist told', async () => {
    const day = addDays(upcoming(4), 7);
    const id = await booked(day, '10:00');

    expect((await post(`/v1/admin/appointments/${id}/cancel`)).statusCode).toBe(204);
    const [row] = await database.db
      .select({ status: appointments.status, by: appointments.cancelledBy })
      .from(appointments)
      .where(eq(appointments.id, id));
    expect(row).toEqual({ status: 'cancelled', by: 'clinic' });
    expect(await smsKinds(id)).toEqual(
      expect.arrayContaining([
        'reminder_24h:cancelled',
        'reminder_2h:cancelled',
        'appointment_cancelled:scheduled',
      ]),
    );
    expect(lastMessageTo(ANNA_CHAT)).toMatch(/^Booking cancelled by the clinic\n/);
    // Время снова свободно
    expect((await book(day, '10:00')).statusCode).toBe(201);
    expect((await post(`/v1/admin/appointments/${id}/cancel`)).statusCode).toBe(409);
  });

  it('marks a past visit as came or no-show, not a future one', async () => {
    const future = await booked(addDays(upcoming(5), 7), '10:00');
    const outcome = (id: string, status: string) =>
      post(`/v1/admin/appointments/${id}/outcome`, { status });
    expect((await outcome(future, 'completed')).statusCode).toBe(409);

    const startAt = new Date(Date.now() - 26 * 3_600_000);
    const endAt = new Date(startAt.getTime() + 30 * 60_000);
    const [past] = await database.db
      .insert(appointments)
      .values({
        clinicId: owner.clinicId,
        locationId: data.locationId,
        dentistId: boris,
        serviceId: data.serviceId,
        patientId: (
          await call<ClientSummary[]>(app, owner, { method: 'GET', url: '/v1/admin/clients' })
        )[0]!.id,
        startAt,
        endAt,
        blockedUntil: blockedUntil(endAt, 0),
        status: 'confirmed',
        source: 'widget',
      })
      .returning({ id: appointments.id });
    expect((await outcome(past!.id, 'no_show')).statusCode).toBe(204);
    expect((await outcome(past!.id, 'completed')).statusCode).toBe(204);
    const [row] = await database.db
      .select({ status: appointments.status })
      .from(appointments)
      .where(eq(appointments.id, past!.id));
    expect(row!.status).toBe('completed');
  });
});

describe('client card (Step 9)', () => {
  it('finds a client by name or phone and shows the history', async () => {
    const day = addDays(upcoming(1), 14);
    const id = await booked(day, '11:00', { fullName: 'Maria Lopez' });
    const phone = `+1202555${String(6000 + phoneCounter)}`;

    const byName = await call<ClientSummary[]>(app, owner, {
      method: 'GET',
      url: '/v1/admin/clients?q=lopez',
    });
    expect(byName).toEqual([
      expect.objectContaining({ fullName: 'Maria Lopez', phone, nextVisitAt: at(day, '11:00') }),
    ]);
    const byPhone = await call<ClientSummary[]>(app, owner, {
      method: 'GET',
      url: `/v1/admin/clients?q=${encodeURIComponent(`(202) 555-${phone.slice(-4)}`)}`,
    });
    expect(byPhone.map((c) => c.fullName)).toEqual(['Maria Lopez']);
    // «%» ищется как символ, а не как «что угодно»
    expect(
      await call<ClientSummary[]>(app, owner, { method: 'GET', url: '/v1/admin/clients?q=%25' }),
    ).toEqual([]);

    const clientId = byName[0]!.id;
    const card = await call<ClientCard>(app, owner, {
      method: 'GET',
      url: `/v1/admin/clients/${clientId}`,
    });
    expect(card).toMatchObject({
      fullName: 'Maria Lopez',
      stats: { completed: 0, noShow: 0, cancelled: 0, upcoming: 1 },
      appointments: [
        expect.objectContaining({ id, status: 'confirmed', dentist: 'Dr. Anna', timeZone: ZONE }),
      ],
    });

    const updated = await call<ClientCard>(app, owner, {
      method: 'PATCH',
      url: `/v1/admin/clients/${clientId}`,
      payload: { email: 'maria@example.com', notes: 'Prefers mornings' },
    });
    expect(updated).toMatchObject({ email: 'maria@example.com', notes: 'Prefers mornings' });
    const bad = await as(app, owner, {
      method: 'PATCH',
      url: `/v1/admin/clients/${clientId}`,
      payload: { email: 'not-an-email' },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('reports (Step 9)', () => {
  it('exports the period to CSV in the office time and without formulas', async () => {
    const day = addDays(upcoming(2), 14);
    await booked(day, '09:30', { fullName: '=HYPERLINK("http://evil")' });
    await booked(day, '13:00', { fullName: 'Smith, John' });

    const res = await as(app, owner, {
      method: 'GET',
      url: `/v1/admin/appointments/export?from=${day}&to=${day}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="appointments-${day}-${day}.csv"`,
    );
    expect(res.body.charCodeAt(0)).toBe(0xfeff);
    const lines = res.body.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe(
      'Date,Time,Office,Dentist,Service,Client,Phone,Email,Status,Source,Notes',
    );
    expect(lines[1]).toMatch(
      new RegExp(`^${day},09:30,Main office,Dr. Anna,Checkup,"'=HYPERLINK\\(""http://evil""\\)",`),
    );
    expect(lines[1]).toContain(',Confirmed,Front desk,');
    expect(lines[2]).toContain(`${day},13:00,Main office,Dr. Anna,Checkup,"Smith, John",`);
  });

  it('counts bookings, outcomes and the load of each dentist', async () => {
    const day = addDays(upcoming(3), 14);
    await booked(day, '09:00');
    await booked(day, '10:00');
    const cancelled = await booked(day, '11:00', { dentistId: boris });
    await post(`/v1/admin/appointments/${cancelled}/cancel`);

    const dashboard = await call<DashboardResponse>(app, owner, {
      method: 'GET',
      url: `/v1/admin/dashboard?from=${day}&to=${day}`,
    });
    expect(dashboard).toMatchObject({
      timeZone: ZONE,
      bookings: { total: 3, bySource: { widget: 0, telegram: 0, admin: 3 } },
      cancelled: 1,
      noShow: 0,
      completed: 0,
    });
    // Смена 9–17 — 480 минут; у Анны две записи по 30 минут, отменённая не занимает время
    expect(dashboard.dentists).toEqual([
      { id: data.dentistId, fullName: 'Dr. Anna', workingMin: 480, bookedMin: 60 },
      { id: boris, fullName: 'Dr. Boris', workingMin: 480, bookedMin: 0 },
    ]);
  });

  it('lists the upcoming bookings that await confirmation', async () => {
    const day = addDays(upcoming(4), 14);
    const id = await booked(day, '10:00');
    await database.db
      .update(appointments)
      .set({ status: 'pending' })
      .where(eq(appointments.id, id));
    const dashboard = await call<DashboardResponse>(app, owner, {
      method: 'GET',
      url: `/v1/admin/dashboard?from=${day}&to=${day}`,
    });
    expect(dashboard.pending).toEqual(
      expect.arrayContaining([
        { id, startAt: at(day, '10:00'), dentist: 'Dr. Anna', client: 'Jane Client' },
      ]),
    );
  });

  it('refuses a range that is too long or reversed', async () => {
    for (const range of ['from=2030-01-02&to=2030-01-01', 'from=2030-01-01&to=2031-06-01']) {
      const res = await as(app, owner, { method: 'GET', url: `/v1/admin/dashboard?${range}` });
      expect(res.statusCode, range).toBe(400);
    }
  });
});
