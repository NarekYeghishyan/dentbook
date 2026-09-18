/**
 * Календарь доступности (критерий «Готово» Шага 4): клиника заводит данные через API
 * и видит правильные слоты. «Сейчас» фиксировано — computeAvailability принимает now.
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appointments, clinics } from '@dentbook/db';
import { startTestDatabase, type TestDatabase } from '@dentbook/db/testing';
import type { AvailabilityResponse, Dentist } from '@dentbook/shared';
import { computeAvailability } from '../src/services/availability.js';
import {
  as,
  call,
  createClinicData,
  registerClinic,
  testApp,
  type ClinicFixture,
  type Session,
} from './helpers.js';

let database: TestDatabase;
let app: FastifyInstance;
let owner: Session;
let data: ClinicFixture;
/** Врачи с услугой: Anna (выше приоритет) и Boris; у Clara услуги нет. */
let anna: string;
let boris: string;
let clara: string;

// Вторник 2030-01-01, 07:00 в Нью-Йорке
const NOW = new Date('2030-01-01T12:00:00Z');
const MONDAY = '2030-01-07';

beforeAll(async () => {
  database = await startTestDatabase();
  app = testApp(database.db);
  await app.ready();
  owner = await registerClinic(app, { timezone: 'America/New_York' });
  data = await createClinicData(app, owner, { dentistName: 'Anna' });
  anna = data.dentistId;

  const addDentist = async (fullName: string, serviceIds: string[]) => {
    const dentist = await call<Dentist>(
      app,
      owner,
      { method: 'POST', url: '/v1/admin/dentists', payload: { fullName } },
      201,
    );
    await call(app, owner, {
      method: 'PUT',
      url: `/v1/admin/dentists/${dentist.id}/services`,
      payload: { serviceIds },
    });
    await call(app, owner, {
      method: 'PUT',
      url: `/v1/admin/dentists/${dentist.id}/working-hours`,
      payload: {
        items: [1, 2, 3, 4, 5].map((weekday) => ({
          locationId: data.locationId,
          weekday,
          startTime: '09:00',
          endTime: '17:00',
        })),
      },
    });
    return dentist.id;
  };
  boris = await addDentist('Boris', [data.serviceId]);
  clara = await addDentist('Clara', []);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await database?.stop();
});

function availability(
  options: { from?: string; to?: string; dentistId?: string; now?: Date } = {},
) {
  return computeAvailability(database.db, {
    clinicId: owner.clinicId,
    serviceId: data.serviceId,
    locationId: data.locationId,
    dentistId: options.dentistId,
    from: options.from ?? MONDAY,
    to: options.to ?? options.from ?? MONDAY,
    now: options.now ?? NOW,
    includeHidden: true,
  });
}

const slotsOf = (response: AvailabilityResponse, day = 0) => response.days[day]!.slots;
const times = (response: AvailabilityResponse, day = 0) =>
  slotsOf(response, day).map((s) => s.start.slice(11, 16));

describe('admin availability calendar', () => {
  it('shows the working day of both dentists in priority order, in local time', async () => {
    const result = await availability();
    expect(result).toMatchObject({ timeZone: 'America/New_York', durationMin: 30 });
    const slots = slotsOf(result);
    // 09:00–16:30 EST = 14:00–21:30 UTC, шаг 15 мин
    expect(slots).toHaveLength(31);
    expect(slots[0]).toEqual({ start: '2030-01-07T14:00:00.000Z', dentistIds: [anna, boris] });
    expect(slots.at(-1)!.start).toBe('2030-01-07T21:30:00.000Z');
    expect(slots.flatMap((s) => s.dentistIds)).not.toContain(clara);
  });

  it('follows the priority order set by drag and drop', async () => {
    await call(app, owner, {
      method: 'PUT',
      url: '/v1/admin/dentists/order',
      payload: { dentistIds: [boris, anna, clara] },
    });
    try {
      expect(slotsOf(await availability())[0]!.dentistIds).toEqual([boris, anna]);
    } finally {
      await call(app, owner, {
        method: 'PUT',
        url: '/v1/admin/dentists/order',
        payload: { dentistIds: [anna, boris, clara] },
      });
    }
  });

  it('shows one dentist when asked', async () => {
    const slots = slotsOf(await availability({ dentistId: boris }));
    expect(new Set(slots.flatMap((s) => s.dentistIds))).toEqual(new Set([boris]));
  });

  it('has nothing on the weekend without working hours', async () => {
    const result = await availability({ from: '2030-01-05', to: '2030-01-06' });
    expect(result.days).toEqual([
      { date: '2030-01-05', slots: [] },
      { date: '2030-01-06', slots: [] },
    ]);
  });

  it("an appointment and a block take the dentist's time", async () => {
    const tuesday = '2030-01-08';
    // Anna: живой холд 10:00–10:30 EST; просроченный холд в 11:00 время не держит
    await database.db.insert(appointments).values([
      {
        clinicId: owner.clinicId,
        locationId: data.locationId,
        dentistId: anna,
        serviceId: data.serviceId,
        startAt: new Date('2030-01-08T15:00:00Z'),
        endAt: new Date('2030-01-08T15:30:00Z'),
        blockedUntil: new Date('2030-01-08T15:30:00Z'),
        status: 'hold' as const,
        holdExpiresAt: new Date('2099-01-01T00:00:00Z'),
        source: 'admin' as const,
      },
      {
        clinicId: owner.clinicId,
        locationId: data.locationId,
        dentistId: anna,
        serviceId: data.serviceId,
        startAt: new Date('2030-01-08T16:00:00Z'),
        endAt: new Date('2030-01-08T16:30:00Z'),
        blockedUntil: new Date('2030-01-08T16:30:00Z'),
        status: 'hold' as const,
        holdExpiresAt: new Date('2029-12-31T00:00:00Z'),
        source: 'admin' as const,
      },
    ]);
    // Boris: закрыт весь день
    await call(
      app,
      owner,
      {
        method: 'POST',
        url: `/v1/admin/dentists/${boris}/exceptions`,
        payload: {
          type: 'block',
          startAt: '2030-01-08T00:00:00-05:00',
          endAt: '2030-01-09T00:00:00-05:00',
        },
      },
      201,
    );

    const slots = slotsOf(await availability({ from: tuesday }));
    const at = (utc: string) => slots.find((s) => s.start === `2030-01-08T${utc}:00.000Z`);
    expect(slots.flatMap((s) => s.dentistIds)).not.toContain(boris);
    expect(at('14:30')?.dentistIds).toEqual([anna]); // 09:30–10:00 — впритык перед записью
    expect(at('14:45')).toBeUndefined();
    expect(at('15:00')).toBeUndefined();
    expect(at('15:30')?.dentistIds).toEqual([anna]);
    expect(at('16:00')?.dentistIds).toEqual([anna]);
  });

  it('extra time opens a day off', async () => {
    const saturday = '2030-01-12';
    await call(
      app,
      owner,
      {
        method: 'POST',
        url: `/v1/admin/dentists/${anna}/exceptions`,
        payload: {
          type: 'extra',
          locationId: data.locationId,
          startAt: '2030-01-12T10:00:00-05:00',
          endAt: '2030-01-12T11:00:00-05:00',
        },
      },
      201,
    );
    expect(times(await availability({ from: saturday }))).toEqual(['15:00', '15:15', '15:30']);
  });

  it('respects the minimum lead time', async () => {
    // Сейчас 10:05 EST, запас 120 мин → первый слот 12:15
    const result = await availability({ now: new Date('2030-01-07T15:05:00Z') });
    expect(slotsOf(result)[0]!.start).toBe('2030-01-07T17:15:00.000Z');
  });

  it('shows nothing in the past or beyond max_advance_days', async () => {
    // 31.12.2029 — рабочий понедельник, но уже прошёл
    const past = await availability({ from: '2029-12-30', to: '2029-12-31' });
    expect(past.days.every((d) => d.slots.length === 0)).toBe(true);
    await database.db
      .update(clinics)
      .set({ maxAdvanceDays: 7 })
      .where(eq(clinics.id, owner.clinicId));
    try {
      const result = await availability({ from: '2030-01-08', to: '2030-01-09' });
      expect(result.days[0]!.slots.length).toBeGreaterThan(0); // 01.01 + 7 = 08.01
      expect(result.days[1]!.slots).toEqual([]);
    } finally {
      await database.db
        .update(clinics)
        .set({ maxAdvanceDays: 60 })
        .where(eq(clinics.id, owner.clinicId));
    }
  });

  it('keeps 09:00 local across the autumn clock change', async () => {
    // 3 ноября 2030 — конец летнего времени в США
    const now = new Date('2030-10-25T12:00:00Z');
    const friday = await availability({ from: '2030-11-01', now });
    const monday = await availability({ from: '2030-11-04', now });
    expect(slotsOf(friday)[0]!.start).toBe('2030-11-01T13:00:00.000Z'); // EDT
    expect(slotsOf(monday)[0]!.start).toBe('2030-11-04T14:00:00.000Z'); // EST
  });

  it('an inactive dentist has no slots', async () => {
    await call(app, owner, {
      method: 'PATCH',
      url: `/v1/admin/dentists/${boris}`,
      payload: { isActive: false },
    });
    try {
      const slots = slotsOf(await availability());
      expect(slots.flatMap((s) => s.dentistIds)).not.toContain(boris);
    } finally {
      await call(app, owner, {
        method: 'PATCH',
        url: `/v1/admin/dentists/${boris}`,
        payload: { isActive: true },
      });
    }
  });
});

describe('GET /v1/admin/availability', () => {
  const url = (from: string, to: string) =>
    `/v1/admin/availability?${new URLSearchParams({
      serviceId: data.serviceId,
      locationId: data.locationId,
      from,
      to,
    })}`;

  it('answers for a range of dates', async () => {
    const res = await as(app, owner, { method: 'GET', url: url('2030-01-07', '2030-01-13') });
    expect(res.statusCode).toBe(200);
    expect(res.json<AvailabilityResponse>().days).toHaveLength(7);
  });

  it.each([
    ['to before from', '2030-01-07', '2030-01-06'],
    ['more than 31 days', '2030-01-01', '2030-02-01'],
    ['a bad date', '2030-02-30', '2030-03-01'],
  ])('rejects %s', async (_case, from, to) => {
    const res = await as(app, owner, { method: 'GET', url: url(from, to) });
    expect(res.statusCode).toBe(400);
  });
});
