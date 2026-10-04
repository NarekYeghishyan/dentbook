/**
 * Журнал регистратуры (Шаг 9, Q17): запись сотрудником, перенос мышью, подтверждение,
 * отмена клиникой, отметки визитов, карточка клиента и её заметки (Q19), CSV и дашборд.
 * Критерий «Готово» — перенос не создаёт пересечений: одновременные переносы на одно время
 * дают ровно один.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, isoWeekday, localDateOf, zonedTimeToUtc } from '@dentbook/core';
import { appointments, blockedUntil, notifications, patients } from '@dentbook/db';
import { startTestDatabase, type TestDatabase } from '@dentbook/db/testing';
import type {
  AppointmentHistory,
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
  addStaff,
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
  options: {
    dentistId?: string;
    fullName?: string;
    phone?: string;
    durationMin?: number;
    notes?: string;
  } = {},
) {
  return as(app, owner, {
    method: 'POST',
    url: '/v1/admin/appointments',
    payload: {
      locationId: data.locationId,
      serviceId: data.serviceId,
      dentistId: options.dentistId ?? data.dentistId,
      startAt: at(date, time),
      ...(options.durationMin ? { durationMin: options.durationMin } : {}),
      ...(options.notes ? { notes: options.notes } : {}),
      client: {
        fullName: options.fullName ?? 'Jane Client',
        phone: options.phone ?? `+1202555${String(6000 + ++phoneCounter)}`,
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
/** «Изменить» в карточке записи — тот же PATCH, что и перенос мышью. */
const edit = move;
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
const historyOf = async (id: string) =>
  call<AppointmentHistory>(app, owner, {
    method: 'GET',
    url: `/v1/admin/appointments/${id}/history`,
  });

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

  it('takes the client phone in any form, or none', async () => {
    const day = addDays(upcoming(2), 21);
    const clientOf = async (id: string) =>
      (
        await database.db
          .select({ id: patients.id, phone: patients.phone })
          .from(appointments)
          .innerJoin(patients, eq(patients.id, appointments.patientId))
          .where(eq(appointments.id, id))
      )[0]!;

    // Не в E.164 — как введено; американский номер — в E.164, на него уйдут SMS
    expect((await clientOf(await booked(day, '13:00', { phone: ' 077 12-34-56 ' }))).phone).toBe(
      '077 12-34-56',
    );
    expect((await clientOf(await booked(day, '14:00', { phone: '(202) 555-0144' }))).phone).toBe(
      '+12025550144',
    );
    expect((await book(day, '15:00', { phone: 'x'.repeat(51) })).statusCode).toBe(400);

    // Пусто — клиент без номера: у каждой такой записи свой клиент, в журнале он виден
    const blank = await booked(day, '15:00', { fullName: 'No Phone', phone: '   ' });
    const blankAgain = await booked(day, '16:00', { fullName: 'No Phone', phone: '' });
    const first = await clientOf(blank);
    expect(first.phone).toBeNull();
    expect((await clientOf(blankAgain)).id).not.toBe(first.id);
    expect((await journal(day)).appointments).toContainEqual(
      expect.objectContaining({
        id: blank,
        client: { id: first.id, fullName: 'No Phone', phone: null, email: null },
      }),
    );
    // Алерт врачу — с именем, без номера; SMS-напоминаниям некуда уйти, их снимет worker
    expect(lastMessageTo(ANNA_CHAT)).toContain('No Phone');
  });

  it('books a service with its own duration, and moves it with that duration', async () => {
    const day = addDays(upcoming(3), 21);
    expect((await book(day, '09:00', { durationMin: 3 })).statusCode).toBe(400);
    // Своя длительность тоже должна влезть в смену (до 17:00)
    const tooLong = await book(day, '16:30', { durationMin: 45 });
    expect(tooLong.json().error.code).toBe('outside_working_hours');

    const id = await booked(day, '09:00', { durationMin: 45 });
    const shown = (await journal(day)).appointments.find((a) => a.id === id);
    expect(shown).toMatchObject({ startAt: at(day, '09:00'), endAt: at(day, '09:45') });

    // Перенос — со своими 45 минутами: в 16:30 они уже не влезают, в 16:15 — да
    expect((await move(id, { startAt: at(day, '16:30') })).json().error.code).toBe(
      'outside_working_hours',
    );
    expect((await move(id, { startAt: at(day, '16:15') })).statusCode).toBe(204);
    const moved = (await journal(day)).appointments.find((a) => a.id === id);
    expect(moved).toMatchObject({ startAt: at(day, '16:15'), endAt: at(day, '17:00') });
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
    // Повторная та же отметка в историю не попадает
    expect((await outcome(past!.id, 'completed')).statusCode).toBe(204);
    expect((await historyOf(past!.id)).events.map((e) => e.type)).toEqual(['no_show', 'completed']);
  });

  it('keeps the history of a booking: what changed, who did it and when', async () => {
    const day = addDays(upcoming(5), 14);
    const id = await booked(day, '10:00');
    await database.db
      .update(appointments)
      .set({ status: 'pending' })
      .where(eq(appointments.id, id));
    expect((await post(`/v1/admin/appointments/${id}/confirm`)).statusCode).toBe(204);
    expect((await move(id, { startAt: at(day, '11:00') })).statusCode).toBe(204);
    expect((await move(id, { startAt: at(day, '11:00'), dentistId: boris })).statusCode).toBe(204);
    // Перенос туда же, где запись уже стоит, ничего не меняет — в истории его нет
    expect((await move(id, { startAt: at(day, '11:00'), dentistId: boris })).statusCode).toBe(204);
    expect((await post(`/v1/admin/appointments/${id}/cancel`)).statusCode).toBe(204);

    const history = await historyOf(id);
    expect(history.timeZone).toBe(ZONE);
    const staff = { actor: 'staff', actorName: 'Olivia Owner' };
    expect(
      history.events.map(({ type, actor, actorName, changes }) => ({
        type,
        actor,
        actorName,
        changes,
      })),
    ).toEqual([
      { type: 'created', ...staff, changes: { startAt: { from: null, to: at(day, '10:00') } } },
      { type: 'confirmed', ...staff, changes: null },
      {
        type: 'moved',
        ...staff,
        changes: { startAt: { from: at(day, '10:00'), to: at(day, '11:00') } },
      },
      { type: 'moved', ...staff, changes: { dentist: { from: 'Dr. Anna', to: 'Dr. Boris' } } },
      { type: 'cancelled', ...staff, changes: null },
    ]);
    const times = history.events.map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
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
      payload: { email: 'maria@example.com' },
    });
    expect(updated).toMatchObject({ email: 'maria@example.com', notes: [] });
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

describe('editing a booking (journal "Edit")', () => {
  /** Вторая услуга — только у Dr. Anna: 60 минут и 15 минут буфера после визита. */
  let cleaning: string;
  const stored = async (id: string) =>
    (
      await database.db
        .select({
          bufferMin: appointments.bufferMin,
          blockedUntil: appointments.blockedUntil,
          patientId: appointments.patientId,
          notes: appointments.notes,
        })
        .from(appointments)
        .where(eq(appointments.id, id))
    )[0]!;
  const shown = async (day: string, id: string) =>
    (await journal(day)).appointments.find((a) => a.id === id);
  const changesOf = async (id: string) =>
    (await historyOf(id)).events.map(({ type, changes }) => ({ type, changes }));

  beforeAll(async () => {
    cleaning = (
      await call<{ id: string }>(
        app,
        owner,
        {
          method: 'POST',
          url: '/v1/admin/services',
          payload: { name: 'Cleaning', durationMin: 60, bufferMin: 15 },
        },
        201,
      )
    ).id;
    await call(app, owner, {
      method: 'PUT',
      url: `/v1/admin/dentists/${data.dentistId}/services`,
      payload: { serviceIds: [data.serviceId, cleaning] },
    });
  });

  it('changes the service, duration and notes: the dentist is told, the client is not', async () => {
    const day = addDays(upcoming(1), 28);
    const id = await booked(day, '10:00');
    const sms = smsOutbox.jobs.length;

    // Новая услуга без своей длительности — длительность и буфер услуги
    const res = await edit(id, { serviceId: cleaning, notes: 'Bring the X-ray' });
    expect(res.statusCode, res.body).toBe(204);
    expect(await shown(day, id)).toMatchObject({
      serviceId: cleaning,
      service: 'Cleaning',
      startAt: at(day, '10:00'),
      endAt: at(day, '11:00'),
      notes: 'Bring the X-ray',
    });
    expect(await stored(id)).toMatchObject({
      bufferMin: 15,
      blockedUntil: new Date(at(day, '11:15')),
    });
    expect(lastMessageTo(ANNA_CHAT)).toMatch(/^Booking changed\n/);
    // Время у клиента прежнее — SMS нет
    expect(smsOutbox.jobs.length).toBe(sms);

    // Своя длительность; буфер услуги защищает время после визита (§2.1, Q11)
    expect((await edit(id, { durationMin: 45 })).statusCode).toBe(204);
    expect(await shown(day, id)).toMatchObject({ endAt: at(day, '10:45') });
    expect((await book(day, '10:45')).json().error.code).toBe('slot_taken');
    expect((await book(day, '11:00')).statusCode).toBe(201);
    // Не влезает до следующей записи — занято, рядом есть свободное время
    const tooLong = await edit(id, { durationMin: 90 });
    expect(tooLong.statusCode).toBe(409);
    expect(tooLong.json().alternatives.length).toBeGreaterThan(0);

    expect(await changesOf(id)).toEqual([
      { type: 'created', changes: { startAt: { from: null, to: at(day, '10:00') } } },
      {
        type: 'updated',
        changes: {
          service: { from: 'Checkup', to: 'Cleaning' },
          durationMin: { from: 30, to: 60 },
          notes: { from: null, to: 'Bring the X-ray' },
        },
      },
      { type: 'updated', changes: { durationMin: { from: 60, to: 45 } } },
    ]);
  });

  it('moves a booking to another dentist and time in one edit, only to free time', async () => {
    const day = addDays(upcoming(2), 28);
    const id = await booked(day, '10:00');
    await booked(day, '14:00', { dentistId: boris });

    // Dr. Boris не оказывает Cleaning; на 14:00 у него запись
    expect((await edit(id, { serviceId: cleaning, dentistId: boris })).statusCode).toBe(400);
    const taken = await edit(id, { dentistId: boris, startAt: at(day, '14:00') });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe('slot_taken');

    // Те же поля, что и сейчас, ничего не меняют
    const unchanged = { dentistId: data.dentistId, serviceId: data.serviceId, durationMin: 30 };
    expect((await edit(id, { ...unchanged, startAt: at(day, '10:00') })).statusCode).toBe(204);

    const res = await edit(id, {
      dentistId: boris,
      startAt: at(day, '15:00'),
      serviceId: data.serviceId,
      durationMin: 30,
      notes: '',
    });
    expect(res.statusCode, res.body).toBe(204);
    expect(await shown(day, id)).toMatchObject({ dentistId: boris, startAt: at(day, '15:00') });
    expect(await smsKinds(id)).toContain('appointment_rescheduled:scheduled');
    expect(lastMessageTo(BORIS_CHAT)).toMatch(/^Booking moved\n/);
    expect(lastMessageTo(ANNA_CHAT)).toMatch(/^Booking moved to another dentist\n/);
    // Прежнее время свободно
    expect((await book(day, '10:00')).statusCode).toBe(201);

    expect((await changesOf(id)).slice(1)).toEqual([
      {
        type: 'moved',
        changes: {
          startAt: { from: at(day, '10:00'), to: at(day, '15:00') },
          dentist: { from: 'Dr. Anna', to: 'Dr. Boris' },
        },
      },
    ]);
  });

  it('changes the client: a new phone moves the booking and its reminders to that client', async () => {
    const day = addDays(upcoming(3), 28);
    const id = await booked(day, '10:00', { fullName: 'First Client' });
    const other = await booked(day, '11:00', { fullName: 'Second Client' });
    const target = await stored(other);
    const phone = `+1202555${String(6000 + phoneCounter)}`;

    const res = await edit(id, { client: { fullName: 'Second Client', phone } });
    expect(res.statusCode, res.body).toBe(204);
    expect((await stored(id)).patientId).toBe(target.patientId);
    const reminders = await database.db
      .select({ patientId: notifications.patientId })
      .from(notifications)
      .where(
        and(
          eq(notifications.appointmentId, id),
          eq(notifications.channel, 'sms'),
          eq(notifications.status, 'scheduled'),
        ),
      );
    expect(reminders).toHaveLength(2);
    expect(reminders.every((r) => r.patientId === target.patientId)).toBe(true);

    // Только email — в карточку клиента; в истории записи его нет
    const email = await edit(id, {
      client: { fullName: 'Second Client', phone, email: 'second@example.com' },
    });
    expect(email.statusCode).toBe(204);
    const [client] = await database.db
      .select({ email: patients.email })
      .from(patients)
      .where(eq(patients.id, target.patientId!));
    expect(client!.email).toBe('second@example.com');
    expect((await shown(day, id))?.client).toMatchObject({ email: 'second@example.com' });
    expect((await changesOf(id)).map((e) => e.type)).toEqual(['created', 'updated']);
  });

  it('after the visit only the client and notes change; a cancelled booking does not', async () => {
    const id = await booked(addDays(upcoming(4), 28), '10:00');
    const startAt = new Date(Date.now() - 26 * 3_600_000);
    const endAt = new Date(startAt.getTime() + 30 * 60_000);
    const [past] = await database.db
      .insert(appointments)
      .values({
        clinicId: owner.clinicId,
        locationId: data.locationId,
        dentistId: data.dentistId,
        serviceId: data.serviceId,
        patientId: (await stored(id)).patientId,
        startAt,
        endAt,
        blockedUntil: blockedUntil(endAt, 0),
        status: 'completed',
        source: 'admin',
      })
      .returning({ id: appointments.id });

    expect((await edit(past!.id, { durationMin: 45 })).statusCode).toBe(409);
    const res = await edit(past!.id, {
      client: { fullName: 'Walk-in', phone: '' },
      notes: 'Paid at the desk',
      // Те же время и длительность — не правка расписания
      startAt: startAt.toISOString(),
      durationMin: 30,
    });
    expect(res.statusCode, res.body).toBe(204);
    expect(await stored(past!.id)).toMatchObject({ notes: 'Paid at the desk' });
    expect((await stored(past!.id)).patientId).not.toBe((await stored(id)).patientId);
    expect((await changesOf(past!.id)).at(-1)).toEqual({
      type: 'updated',
      changes: {
        client: {
          from: { fullName: 'Jane Client', phone: expect.any(String) },
          to: { fullName: 'Walk-in', phone: null },
        },
        notes: { from: null, to: 'Paid at the desk' },
      },
    });

    expect((await post(`/v1/admin/appointments/${id}/cancel`)).statusCode).toBe(204);
    const cancelled = await edit(id, { notes: 'Too late' });
    expect(cancelled.statusCode).toBe(409);
    expect((await stored(id)).notes).toBeNull();
    expect((await edit(id, {})).statusCode).toBe(400);
  });
});

describe('client notes (Q19)', () => {
  const cardOf = (clientId: string) =>
    call<ClientCard>(app, owner, { method: 'GET', url: `/v1/admin/clients/${clientId}` });
  const addNote = (session: Session, clientId: string, text: string) =>
    as(app, session, {
      method: 'POST',
      url: `/v1/admin/clients/${clientId}/notes`,
      payload: { text },
    });
  const clientOf = async (appointmentId: string) =>
    (
      await database.db
        .select({ patientId: appointments.patientId })
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
    )[0]!.patientId!;

  it('keeps every note as history: added on the card and written on bookings', async () => {
    const day = addDays(upcoming(5), 28);
    const id = await booked(day, '10:00', { notes: 'Allergic to latex' });
    const clientId = await clientOf(id);
    expect((await edit(id, { notes: 'Allergic to latex and penicillin' })).statusCode).toBe(204);
    // Убранная заметка к записи — не новая заметка; прежние остаются в истории
    expect((await edit(id, { notes: '' })).statusCode).toBe(204);
    for (const text of ['Prefers mornings', '  Pays in cash  ']) {
      expect((await addNote(owner, clientId, text)).statusCode).toBe(201);
    }

    const staff = { author: 'staff', authorName: 'Olivia Owner' };
    const onBooking = { id, startAt: at(day, '10:00'), timeZone: ZONE };
    const { notes } = await cardOf(clientId);
    expect(
      notes.map(({ text, author, authorName, appointment }) => ({
        text,
        author,
        authorName,
        appointment,
      })),
    ).toEqual([
      { text: 'Pays in cash', ...staff, appointment: null },
      { text: 'Prefers mornings', ...staff, appointment: null },
      { text: 'Allergic to latex and penicillin', ...staff, appointment: onBooking },
      { text: 'Allergic to latex', ...staff, appointment: onBooking },
    ]);
    const times = notes.map((n) => Date.parse(n.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));

    expect((await addNote(owner, clientId, '   ')).statusCode).toBe(400);
    expect((await addNote(owner, clientId, 'x'.repeat(2001))).statusCode).toBe(400);
    expect((await addNote(owner, randomUUID(), 'Nobody')).statusCode).toBe(404);
  });

  it('lets the front desk add notes, and only the owner or an admin delete them', async () => {
    const clientId = await clientOf(await booked(addDays(upcoming(1), 35), '10:00'));
    const registrar = await addStaff(app, owner, 'registrar');
    const added = await addNote(registrar, clientId, 'Called to confirm');
    expect(added.statusCode, added.body).toBe(201);
    const noteId = added.json<{ id: string }>().id;
    expect((await cardOf(clientId)).notes).toEqual([
      expect.objectContaining({ id: noteId, author: 'staff', authorName: 'Sam registrar' }),
    ]);

    const remove = (session: Session, id = noteId) =>
      as(app, session, { method: 'DELETE', url: `/v1/admin/clients/${clientId}/notes/${id}` });
    expect((await remove(registrar)).statusCode).toBe(403);
    expect((await cardOf(clientId)).notes).toHaveLength(1);
    expect((await remove(await addStaff(app, owner, 'admin'))).statusCode).toBe(204);
    expect((await cardOf(clientId)).notes).toEqual([]);
    expect((await remove(owner)).statusCode).toBe(404);
    expect((await remove(owner, 'not-a-uuid')).statusCode).toBe(404);
  });
});
