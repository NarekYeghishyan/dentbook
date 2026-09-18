/**
 * Публичный API /v1/public (CLAUDE.md §7) и критерий «Готово» Шага 5:
 * холд истекает и слот возвращается; конкурентное подтверждение одного слота даёт
 * ровно одну запись. Плюс ключ и Origin (§2.5), лимиты, изоляция клиник (§2.2).
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, HTTPMethods, InjectOptions } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, isoWeekday, localDateOf, zonedTimeToUtc } from '@dentbook/core';
import { appointments, clinics, dentists, patients } from '@dentbook/db';
import {
  startTestDatabase,
  startTestRedis,
  type TestDatabase,
  type TestRedis,
} from '@dentbook/db/testing';
import type {
  ApiKey,
  ConfirmedAppointment,
  Dentist,
  HoldResponse,
  PublicAvailability,
  VerificationResponse,
} from '@dentbook/shared';
import {
  TestSms,
  call,
  createClinicData,
  registerClinic,
  testApp,
  type ClinicFixture,
  type Session,
} from './helpers.js';

const ZONE = 'America/New_York';
const ORIGIN = 'https://mashna.am';

let database: TestDatabase;
let redisServer: TestRedis;
let redis: Redis;
let app: FastifyInstance;
const sms = new TestSms();
const publicRoutes: { method: HTTPMethods; url: string }[] = [];

let owner: Session;
let data: ClinicFixture;
let anna: string;
let boris: string;
let key: string;

/** Местная дата ближайшего дня недели не раньше чем через 3 дня: запас §6 не мешает. */
function upcoming(weekday: number): string {
  let date = addDays(localDateOf(new Date(), ZONE), 3);
  while (isoWeekday(date) !== weekday) date = addDays(date, 1);
  return date;
}
const MON = () => upcoming(1);
const at = (date: string, time: string) => {
  const [h, m] = time.split(':').map(Number);
  return zonedTimeToUtc(date, h! * 60 + m!, ZONE).toISOString();
};

async function issueKey(session: Session, origins = [ORIGIN]): Promise<ApiKey> {
  return call<ApiKey>(
    app,
    session,
    {
      method: 'POST',
      url: '/v1/admin/api-keys',
      payload: { name: 'Website', allowedOrigins: origins },
    },
    201,
  );
}

/** Запрос формы записи: ключ и Origin сайта клиники. */
function pub(options: InjectOptions, token = key, origin = ORIGIN) {
  return app.inject({
    ...options,
    headers: { authorization: `Bearer ${token}`, origin, ...options.headers },
  });
}

const hold = (startAt: string, token = key, fixture = data) =>
  pub(
    {
      method: 'POST',
      url: '/v1/public/holds',
      payload: {
        service_id: fixture.serviceId,
        location_id: fixture.locationId,
        start_at: startAt,
      },
    },
    token,
  );

const slotsOf = async (date: string, token = key, fixture = data) => {
  const res = await pub(
    {
      method: 'GET',
      url: `/v1/public/availability?service_id=${fixture.serviceId}&location_id=${fixture.locationId}&from=${date}&to=${date}`,
    },
    token,
  );
  expect(res.statusCode, res.body).toBe(200);
  return res.json<PublicAvailability>().days[0]!.slots;
};

let phoneCounter = 0;
/** Уникальный номер США на каждый тест: лимит SMS считается по номеру. */
const newPhone = () => `+1202555${String(1000 + ++phoneCounter).padStart(4, '0')}`;

async function verify(phone: string, token = key): Promise<string> {
  const res = await pub(
    { method: 'POST', url: '/v1/public/verifications', payload: { phone } },
    token,
  );
  expect(res.statusCode, res.body).toBe(201);
  return res.json<VerificationResponse>().verification_id;
}

function confirm(holdId: string, verificationId: string, phone: string, code: string, token = key) {
  return pub(
    {
      method: 'POST',
      url: '/v1/public/appointments',
      payload: {
        hold_id: holdId,
        verification_id: verificationId,
        code,
        client: { full_name: 'Jane Client', phone, email: 'jane@example.com' },
      },
    },
    token,
  );
}

/** Холд и подтверждённая запись на это время. */
async function book(startAt: string, token = key, fixture = data) {
  const held = await hold(startAt, token, fixture);
  expect(held.statusCode, held.body).toBe(201);
  const phone = newPhone();
  const verificationId = await verify(phone, token);
  const res = await confirm(
    held.json<HoldResponse>().hold_id,
    verificationId,
    phone,
    sms.lastCode(phone),
    token,
  );
  expect(res.statusCode, res.body).toBe(201);
  return res.json<ConfirmedAppointment>();
}

beforeAll(async () => {
  [database, redisServer] = await Promise.all([startTestDatabase(), startTestRedis()]);
  redis = new Redis(redisServer.url);
  app = testApp(database.db, {}, { redis, sms });
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD' && route.url.startsWith('/v1/public'))
        publicRoutes.push({ method, url: route.url });
    }
  });
  await app.ready();

  owner = await registerClinic(app, { clinicName: 'Smile Dental', timezone: ZONE });
  data = await createClinicData(app, owner, { dentistName: 'Dr. Anna' });
  anna = data.dentistId;
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
  key = (await issueKey(owner)).token;
}, 180_000);

afterAll(async () => {
  await app?.close();
  redis?.disconnect();
  await Promise.all([database?.stop(), redisServer?.stop()]);
});

describe('publishable key and Origin (§2.5)', () => {
  it('rejects a missing, unknown or revoked key', async () => {
    const noKey = await app.inject({
      method: 'GET',
      url: '/v1/public/config',
      headers: { origin: ORIGIN },
    });
    expect(noKey.statusCode).toBe(401);
    expect(noKey.json()).toEqual({
      error: { code: 'invalid_key', message: 'Invalid or revoked API key' },
    });
    expect(
      (await pub({ method: 'GET', url: '/v1/public/config' }, 'pk_unknownunknown')).statusCode,
    ).toBe(401);

    const revoked = await issueKey(owner);
    await call(app, owner, { method: 'POST', url: `/v1/admin/api-keys/${revoked.id}/revoke` });
    expect((await pub({ method: 'GET', url: '/v1/public/config' }, revoked.token)).statusCode).toBe(
      401,
    );
  });

  it('answers 403 to a website that is not on the list, or without Origin', async () => {
    const foreign = await pub(
      { method: 'GET', url: '/v1/public/config' },
      key,
      'https://evil.example',
    );
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().error.code).toBe('origin_not_allowed');
    const serverToServer = await app.inject({
      method: 'GET',
      url: '/v1/public/config',
      headers: { authorization: `Bearer ${key}` },
    });
    expect(serverToServer.statusCode).toBe(403);
  });

  it('serves the allowed website with CORS headers and answers preflight', async () => {
    const res = await pub({ method: 'GET', url: '/v1/public/config' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/v1/public/holds',
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-headers']).toContain('authorization');
  });
});

describe('config, services, availability', () => {
  it('gives the booking form its settings and offices, nothing private', async () => {
    const res = await pub({ method: 'GET', url: '/v1/public/config' });
    expect(res.json()).toEqual({
      clinic: { name: 'Smile Dental', locale: 'en', currency: 'USD' },
      theme: {},
      locations: [
        { id: data.locationId, name: 'Main office', address: null, phone: null, time_zone: ZONE },
      ],
    });
    expect(res.body).not.toContain(owner.email);
  });

  it('lists only public, active services', async () => {
    await call(
      app,
      owner,
      {
        method: 'POST',
        url: '/v1/admin/services',
        payload: { name: 'Internal', durationMin: 15, isPublic: false },
      },
      201,
    );
    const res = await pub({ method: 'GET', url: '/v1/public/services' });
    expect(res.json()).toEqual([
      {
        id: data.serviceId,
        name: 'Checkup',
        description: null,
        duration_min: 30,
        price: '80.00',
        currency: 'USD',
      },
    ]);
  });

  it('shows free start times of any dentist, without dentists', async () => {
    const slots = await slotsOf(MON());
    expect(slots).toHaveLength(31);
    expect(slots[0]).toBe(at(MON(), '09:00'));
    const res = await pub({
      method: 'GET',
      url: `/v1/public/availability?service_id=${data.serviceId}&location_id=${data.locationId}&from=${MON()}&to=${MON()}`,
    });
    expect(res.body).not.toContain(anna);
  });

  it('rejects a bad range', async () => {
    const res = await pub({
      method: 'GET',
      url: `/v1/public/availability?service_id=${data.serviceId}&location_id=${data.locationId}&from=${MON()}&to=${addDays(MON(), -1)}`,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('holds', () => {
  it('assigns the free dentist by priority, then the next one, then says slot_taken', async () => {
    const tuesday = upcoming(2);
    const start = at(tuesday, '10:00');
    await slotsOf(tuesday); // прогреть кеш: холд обязан его сбросить

    const first = await hold(start);
    expect(first.statusCode, first.body).toBe(201);
    const body = first.json<HoldResponse>();
    expect(body.dentist).toEqual({ id: anna, full_name: 'Dr. Anna' });
    expect(body.end_at).toBe(at(tuesday, '10:30'));
    expect(Date.parse(body.expires_at) - Date.now()).toBeGreaterThan(590_000);
    expect(await slotsOf(tuesday)).toContain(start); // Boris ещё свободен

    expect((await hold(start)).json<HoldResponse>().dentist.id).toBe(boris);
    const slots = await slotsOf(tuesday);
    expect(slots).not.toContain(start);
    expect(slots).not.toContain(at(tuesday, '09:45'));

    const taken = await hold(start);
    expect(taken.statusCode).toBe(409);
    const alternatives = taken.json<{ alternatives: string[] }>().alternatives;
    expect(taken.json().error.code).toBe('slot_taken');
    expect(alternatives).toHaveLength(6);
    expect(alternatives).toContain(at(tuesday, '10:30'));
    expect(alternatives).not.toContain(start);
  });

  it('on equal priority gives the hold to the dentist with fewer appointments that day', async () => {
    const wednesday = upcoming(3);
    expect((await hold(at(wednesday, '09:00'))).json<HoldResponse>().dentist.id).toBe(anna);
    await database.db.update(dentists).set({ priority: 10 }).where(eq(dentists.id, boris));
    try {
      expect((await hold(at(wednesday, '11:00'))).json<HoldResponse>().dentist.id).toBe(boris);
    } finally {
      await database.db.update(dentists).set({ priority: 20 }).where(eq(dentists.id, boris));
    }
  });

  it('refuses a time that is not a free slot', async () => {
    const res = await hold(at(MON(), '03:00'));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('slot_taken');
  });

  it('frees the slot on DELETE', async () => {
    const thursday = upcoming(4);
    const start = at(thursday, '09:00');
    const held = (await hold(start)).json<HoldResponse>();
    await hold(start);
    expect((await hold(start)).statusCode).toBe(409);

    const release = () => pub({ method: 'DELETE', url: `/v1/public/holds/${held.hold_id}` });
    expect((await release()).statusCode).toBe(204);
    expect(await slotsOf(thursday)).toContain(start);
    expect((await hold(start)).statusCode).toBe(201);
    expect((await release()).statusCode).toBe(404);
  });

  it('a hold expires and the slot comes back (Step 5 criterion)', async () => {
    const friday = upcoming(5);
    const start = at(friday, '09:00');
    const held = [
      (await hold(start)).json<HoldResponse>(),
      (await hold(start)).json<HoldResponse>(),
    ];
    expect(await slotsOf(friday)).not.toContain(start);

    // Время прошло: срок холдов истёк, worker их ещё не снял
    await database.db
      .update(appointments)
      .set({ holdExpiresAt: new Date(Date.now() - 1000) })
      .where(
        inArray(
          appointments.id,
          held.map((h) => h.hold_id),
        ),
      );

    const again = await hold(start);
    expect(again.statusCode, again.body).toBe(201);
    const statuses = await database.db
      .select({ status: appointments.status })
      .from(appointments)
      .where(
        inArray(
          appointments.id,
          held.map((h) => h.hold_id),
        ),
      );
    expect(statuses.map((s) => s.status)).toContain('expired');
  });
});

describe('verification and booking', () => {
  it('books with a correct SMS code; the client card is created', async () => {
    const start = at(MON(), '14:00');
    const held = (await hold(start)).json<HoldResponse>();
    const phone = newPhone();
    const verificationId = await verify(phone);
    expect(sms.sent.at(-1)).toEqual({
      to: phone,
      text: expect.stringMatching(/^\d{6} is your Smile Dental booking code/),
    });

    const res = await confirm(held.hold_id, verificationId, phone, sms.lastCode(phone));
    expect(res.statusCode, res.body).toBe(201);
    const appointment = res.json<ConfirmedAppointment>();
    expect(appointment).toMatchObject({
      id: held.hold_id,
      status: 'confirmed',
      start_at: start,
      time_zone: ZONE,
      service: { id: data.serviceId, name: 'Checkup' },
      dentist: { id: anna, full_name: 'Dr. Anna' },
      location: { id: data.locationId, name: 'Main office' },
    });
    expect(appointment.token).toMatch(/^[0-9a-f]{48}$/);
    const [client] = await database.db
      .select({ fullName: patients.fullName, verifiedAt: patients.phoneVerifiedAt })
      .from(patients)
      .where(and(eq(patients.clinicId, owner.clinicId), eq(patients.phone, phone)));
    expect(client).toMatchObject({ fullName: 'Jane Client', verifiedAt: expect.any(Date) });

    // Один код — одна запись
    const next = (await hold(at(MON(), '15:00'))).json<HoldResponse>();
    const reuse = await confirm(next.hold_id, verificationId, phone, sms.lastCode(phone));
    expect(reuse.statusCode).toBe(400);
    expect(reuse.json().error.code).toBe('verification_failed');
  });

  it('allows three attempts, then even the right code fails', async () => {
    const held = (await hold(at(MON(), '15:30'))).json<HoldResponse>();
    const phone = newPhone();
    const verificationId = await verify(phone);
    const code = sms.lastCode(phone);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i++) {
      const res = await confirm(held.hold_id, verificationId, phone, wrong);
      expect(res.json().error.code).toBe('verification_failed');
    }
    expect((await confirm(held.hold_id, verificationId, phone, code)).statusCode).toBe(400);
  });

  it('checks that the code belongs to this phone and exists', async () => {
    const held = (await hold(at(MON(), '16:00'))).json<HoldResponse>();
    const phone = newPhone();
    const verificationId = await verify(phone);
    const otherPhone = await confirm(held.hold_id, verificationId, newPhone(), sms.lastCode(phone));
    expect(otherPhone.json().error.code).toBe('verification_failed');
    const unknown = await confirm(held.hold_id, crypto.randomUUID(), phone, '123456');
    expect(unknown.json().error.code).toBe('verification_required');
  });

  it('an expired hold cannot be booked, and the code stays usable', async () => {
    const held = (await hold(at(MON(), '16:30'))).json<HoldResponse>();
    await database.db
      .update(appointments)
      .set({ holdExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(appointments.id, held.hold_id));
    const phone = newPhone();
    const verificationId = await verify(phone);
    const res = await confirm(held.hold_id, verificationId, phone, sms.lastCode(phone));
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('hold_expired');

    const fresh = (await hold(at(MON(), '16:30'))).json<HoldResponse>();
    expect(
      (await confirm(fresh.hold_id, verificationId, phone, sms.lastCode(phone))).statusCode,
    ).toBe(201);
  });

  it('waits for the clinic when it confirms bookings itself (Q9)', async () => {
    await call(app, owner, {
      method: 'PATCH',
      url: '/v1/admin/clinic',
      payload: { bookingRequiresConfirmation: true },
    });
    try {
      expect((await book(at(upcoming(2), '15:00'))).status).toBe('pending');
    } finally {
      await call(app, owner, {
        method: 'PATCH',
        url: '/v1/admin/clinic',
        payload: { bookingRequiresConfirmation: false },
      });
    }
  });

  it('limits codes per phone number', async () => {
    const phone = newPhone();
    for (let i = 0; i < 5; i++) await verify(phone);
    const sixth = await pub({
      method: 'POST',
      url: '/v1/public/verifications',
      payload: { phone },
    });
    expect(sixth.statusCode).toBe(429);
  });

  it('answers 503 while no SMS provider is configured', async () => {
    const withoutSms = testApp(database.db, {}, { redis });
    try {
      const res = await withoutSms.inject({
        method: 'POST',
        url: '/v1/public/verifications',
        headers: { authorization: `Bearer ${key}`, origin: ORIGIN },
        payload: { phone: newPhone() },
      });
      expect(res.statusCode).toBe(503);
    } finally {
      await withoutSms.close();
    }
  });
});

describe('concurrency (Step 5 criterion)', () => {
  it('20 simultaneous holds of one slot: one per free dentist, the rest slot_taken', async () => {
    const start = at(upcoming(4), '14:00');
    const results = await Promise.all(Array.from({ length: 20 }, () => hold(start)));
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 201)).toHaveLength(2);
    expect(codes.filter((c) => c === 409)).toHaveLength(18);
    const dentistsHeld = results
      .filter((r) => r.statusCode === 201)
      .map((r) => r.json<HoldResponse>().dentist.id)
      .sort();
    expect(dentistsHeld).toEqual([anna, boris].sort());
  });

  it('two clients confirming one hold at once: exactly one appointment', async () => {
    const held = (await hold(at(upcoming(4), '15:00'))).json<HoldResponse>();
    const [phoneA, phoneB] = [newPhone(), newPhone()];
    const [verA, verB] = await Promise.all([verify(phoneA), verify(phoneB)]);
    const results = await Promise.all([
      confirm(held.hold_id, verA, phoneA, sms.lastCode(phoneA)),
      confirm(held.hold_id, verB, phoneB, sms.lastCode(phoneB)),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 410]);
    const rows = await database.db
      .select({ status: appointments.status, patientId: appointments.patientId })
      .from(appointments)
      .where(eq(appointments.id, held.hold_id));
    expect(rows).toEqual([{ status: 'confirmed', patientId: expect.any(String) }]);
  });
});

describe('status and cancel by the client', () => {
  it('shows the appointment by its token and lets the client cancel it', async () => {
    const start = at(upcoming(5), '11:00');
    const booked = await book(start);
    const url = `/v1/public/appointments/${booked.id}`;

    const status = await pub({ method: 'GET', url: `${url}?token=${booked.token}` });
    expect(status.json()).toMatchObject({ id: booked.id, status: 'confirmed' });
    expect(status.body).not.toContain(booked.token);
    expect((await pub({ method: 'GET', url: `${url}?token=${'0'.repeat(48)}` })).statusCode).toBe(
      404,
    );

    const cancel = () =>
      pub({ method: 'POST', url: `${url}/cancel`, payload: { token: booked.token } });
    expect((await cancel()).json().status).toBe('cancelled');
    expect((await cancel()).statusCode).toBe(200);
    const [row] = await database.db
      .select({ by: appointments.cancelledBy })
      .from(appointments)
      .where(eq(appointments.id, booked.id));
    expect(row!.by).toBe('client');
    // Время врача снова свободно
    expect((await hold(start)).json<HoldResponse>().dentist.id).toBe(booked.dentist.id);
  });

  it('does not show a hold as an appointment', async () => {
    const held = (await hold(at(upcoming(5), '12:00'))).json<HoldResponse>();
    const res = await pub({
      method: 'GET',
      url: `/v1/public/appointments/${held.hold_id}?token=${'a'.repeat(48)}`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('rate limits (Q4)', () => {
  it('limits requests per key', async () => {
    const limited = testApp(database.db, { PUBLIC_KEY_RATE_LIMIT: 3 }, { redis, sms });
    const fresh = await issueKey(owner);
    try {
      const get = () =>
        limited.inject({
          method: 'GET',
          url: '/v1/public/config',
          headers: { authorization: `Bearer ${fresh.token}`, origin: ORIGIN },
        });
      for (let i = 0; i < 3; i++) expect((await get()).statusCode).toBe(200);
      const blocked = await get();
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error.code).toBe('rate_limited');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      await limited.close();
    }
  });

  it('limits holds per IP', async () => {
    const limited = testApp(database.db, { PUBLIC_IP_RATE_LIMIT: 2 }, { redis, sms });
    try {
      const attempt = () =>
        limited.inject({
          method: 'POST',
          url: '/v1/public/holds',
          headers: {
            authorization: `Bearer ${key}`,
            origin: ORIGIN,
            'x-forwarded-for': '203.0.113.7',
          },
          payload: {
            service_id: data.serviceId,
            location_id: data.locationId,
            start_at: at(MON(), '03:00'),
          },
        });
      expect((await attempt()).statusCode).toBe(409);
      expect((await attempt()).statusCode).toBe(409);
      expect((await attempt()).statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });
});

describe('tenant isolation of the public API (§2.2)', () => {
  let other: Session;
  let otherData: ClinicFixture;
  let otherKey: string;
  let aHold: HoldResponse;
  let aBooked: ConfirmedAppointment;

  beforeAll(async () => {
    other = await registerClinic(app, { clinicName: 'Other Dental', timezone: ZONE });
    otherData = await createClinicData(app, other, { dentistName: 'Dr. Other' });
    otherKey = (await issueKey(other)).token;
    aHold = (await hold(at(upcoming(3), '14:00'))).json<HoldResponse>();
    aBooked = await book(at(upcoming(3), '14:30'));
  });

  /** Попытка ключа клиники B дотянуться до данных клиники A. */
  const attacks: Record<string, () => Promise<void>> = {
    'GET /v1/public/config': async () => {
      const res = await pub({ method: 'GET', url: '/v1/public/config' }, otherKey);
      expect(res.json().clinic.name).toBe('Other Dental');
      expect(res.body).not.toContain(data.locationId);
    },
    'GET /v1/public/services': async () => {
      const res = await pub({ method: 'GET', url: '/v1/public/services' }, otherKey);
      expect(res.body).not.toContain(data.serviceId);
    },
    'GET /v1/public/availability': async () => {
      const res = await pub(
        {
          method: 'GET',
          url: `/v1/public/availability?service_id=${data.serviceId}&location_id=${data.locationId}&from=${MON()}&to=${MON()}`,
        },
        otherKey,
      );
      expect(res.statusCode).toBe(404);
    },
    'POST /v1/public/holds': async () => {
      expect((await hold(at(MON(), '09:00'), otherKey, data)).statusCode).toBe(404);
      // Своя услуга, чужой филиал
      const mixed = await hold(at(MON(), '09:00'), otherKey, {
        ...otherData,
        locationId: data.locationId,
      });
      expect(mixed.statusCode).toBe(404);
    },
    'DELETE /v1/public/holds/:id': async () => {
      const res = await pub(
        { method: 'DELETE', url: `/v1/public/holds/${aHold.hold_id}` },
        otherKey,
      );
      expect(res.statusCode).toBe(404);
      const [row] = await database.db
        .select({ status: appointments.status })
        .from(appointments)
        .where(eq(appointments.id, aHold.hold_id));
      expect(row!.status).toBe('hold');
    },
    'POST /v1/public/verifications': async () => {
      // Код создаётся в клинике ключа и к клинике A не подходит
      const phone = newPhone();
      const verificationId = await verify(phone, otherKey);
      const res = await confirm(aHold.hold_id, verificationId, phone, sms.lastCode(phone), key);
      expect(res.json().error.code).toBe('verification_required');
    },
    'POST /v1/public/appointments': async () => {
      const phone = newPhone();
      const verificationId = await verify(phone, otherKey);
      const res = await confirm(
        aHold.hold_id,
        verificationId,
        phone,
        sms.lastCode(phone),
        otherKey,
      );
      expect(res.statusCode).toBe(410);
      const [row] = await database.db
        .select({ status: appointments.status })
        .from(appointments)
        .where(eq(appointments.id, aHold.hold_id));
      expect(row!.status).toBe('hold');
    },
    'GET /v1/public/appointments/:id': async () => {
      const res = await pub(
        { method: 'GET', url: `/v1/public/appointments/${aBooked.id}?token=${aBooked.token}` },
        otherKey,
      );
      expect(res.statusCode).toBe(404);
    },
    'POST /v1/public/appointments/:id/cancel': async () => {
      const res = await pub(
        {
          method: 'POST',
          url: `/v1/public/appointments/${aBooked.id}/cancel`,
          payload: { token: aBooked.token },
        },
        otherKey,
      );
      expect(res.statusCode).toBe(404);
      const [row] = await database.db
        .select({ status: appointments.status })
        .from(appointments)
        .where(eq(appointments.id, aBooked.id));
      expect(row!.status).toBe('confirmed');
    },
  };

  it('every public route has an isolation check', () => {
    const keys = publicRoutes
      .filter((r) => r.method !== 'OPTIONS')
      .map((r) => `${r.method} ${r.url}`);
    expect(keys.filter((k) => !(k in attacks))).toEqual([]);
    expect(Object.keys(attacks).filter((k) => !keys.includes(k))).toEqual([]);
  });

  it.each(Object.keys(attacks))('%s does not reach another clinic', async (route) => {
    await attacks[route]!();
  });

  it('a suspended clinic loses its key', async () => {
    await database.db
      .update(clinics)
      .set({ status: 'suspended' })
      .where(eq(clinics.id, other.clinicId));
    expect((await pub({ method: 'GET', url: '/v1/public/config' }, otherKey)).statusCode).toBe(401);
  });
});
