import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appointments } from '@dentbook/db';
import { startTestDatabase, type TestDatabase } from '@dentbook/db/testing';
import type { Dentist } from '@dentbook/shared';
import {
  addStaff,
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

beforeAll(async () => {
  database = await startTestDatabase();
  app = testApp(database.db);
  await app.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await database?.stop();
});

async function status(
  session: Session,
  method: 'POST' | 'PATCH' | 'PUT',
  url: string,
  payload: object,
) {
  return (await as(app, session, { method, url, payload })).statusCode;
}

describe('locations', () => {
  it('creates, lists and updates offices; empty text becomes null', async () => {
    const owner = await registerClinic(app);
    const created = await call<{ id: string; address: string | null }>(
      app,
      owner,
      {
        method: 'POST',
        url: '/v1/admin/locations',
        payload: { name: 'Downtown', address: '  ', timezone: null, sortOrder: 2 },
      },
      201,
    );
    expect(created).toMatchObject({
      name: 'Downtown',
      address: null,
      timezone: null,
      isActive: true,
    });
    await call(
      app,
      owner,
      { method: 'POST', url: '/v1/admin/locations', payload: { name: 'Uptown' } },
      201,
    );

    const list = await call<{ name: string }[]>(app, owner, {
      method: 'GET',
      url: '/v1/admin/locations',
    });
    expect(list.map((l) => l.name)).toEqual(['Uptown', 'Downtown']);

    const updated = await call(app, owner, {
      method: 'PATCH',
      url: `/v1/admin/locations/${created.id}`,
      payload: { timezone: 'America/Denver', isActive: false },
    });
    expect(updated).toMatchObject({ timezone: 'America/Denver', isActive: false });
  });

  it('validates the office', async () => {
    const owner = await registerClinic(app);
    expect(await status(owner, 'POST', '/v1/admin/locations', { name: '' })).toBe(400);
    expect(
      await status(owner, 'POST', '/v1/admin/locations', { name: 'X', timezone: 'Nowhere' }),
    ).toBe(400);
  });
});

describe('services', () => {
  it('keeps the price as an exact decimal string', async () => {
    const owner = await registerClinic(app);
    const service = await call<{ id: string }>(
      app,
      owner,
      {
        method: 'POST',
        url: '/v1/admin/services',
        payload: { name: 'Whitening', durationMin: 60, bufferMin: 15, price: '199.9' },
      },
      201,
    );
    expect(service).toMatchObject({ price: '199.90', bufferMin: 15, isPublic: true });
    const hidden = await call(app, owner, {
      method: 'PATCH',
      url: `/v1/admin/services/${service.id}`,
      payload: { price: null, isPublic: false },
    });
    expect(hidden).toMatchObject({ price: null, isPublic: false });
  });

  it.each([
    ['a float price', { price: 12.5 }],
    ['three decimals', { price: '1.005' }],
    ['zero duration', { durationMin: 0 }],
    ['a negative buffer', { bufferMin: -5 }],
  ])('rejects %s', async (_case, override) => {
    const owner = await registerClinic(app);
    const payload = { name: 'X', durationMin: 30, ...override };
    expect(await status(owner, 'POST', '/v1/admin/services', payload)).toBe(400);
  });
});

describe('dentists and priority', () => {
  it('appends new dentists to the end and reorders by the full list', async () => {
    const owner = await registerClinic(app);
    const create = (fullName: string) =>
      call<Dentist>(
        app,
        owner,
        { method: 'POST', url: '/v1/admin/dentists', payload: { fullName } },
        201,
      );
    const anna = await create('Anna');
    const boris = await create('Boris');
    const clara = await create('Clara');
    expect([anna.priority, boris.priority, clara.priority]).toEqual([10, 20, 30]);

    const reordered = await call<Dentist[]>(app, owner, {
      method: 'PUT',
      url: '/v1/admin/dentists/order',
      payload: { dentistIds: [clara.id, anna.id, boris.id] },
    });
    expect(reordered.map((d) => [d.fullName, d.priority])).toEqual([
      ['Clara', 10],
      ['Anna', 20],
      ['Boris', 30],
    ]);
  });

  it('rejects a partial, repeated or unknown order', async () => {
    const owner = await registerClinic(app);
    const { dentistId } = await createClinicData(app, owner);
    const other = await call<Dentist>(
      app,
      owner,
      { method: 'POST', url: '/v1/admin/dentists', payload: { fullName: 'Other' } },
      201,
    );
    const order = (dentistIds: string[]) =>
      status(owner, 'PUT', '/v1/admin/dentists/order', { dentistIds });
    expect(await order([dentistId])).toBe(400);
    expect(await order([dentistId, dentistId, other.id])).toBe(404);
    expect(await order([dentistId, crypto.randomUUID()])).toBe(404);
  });

  it('replaces the services of a dentist', async () => {
    const owner = await registerClinic(app);
    const { dentistId, serviceId } = await createClinicData(app, owner);
    const extra = await call<{ id: string }>(
      app,
      owner,
      { method: 'POST', url: '/v1/admin/services', payload: { name: 'Implant', durationMin: 90 } },
      201,
    );
    const url = `/v1/admin/dentists/${dentistId}/services`;
    const both = await call<Dentist>(app, owner, {
      method: 'PUT',
      url,
      payload: { serviceIds: [serviceId, extra.id, extra.id] },
    });
    expect(both.serviceIds.sort()).toEqual([serviceId, extra.id].sort());
    const none = await call<Dentist>(app, owner, {
      method: 'PUT',
      url,
      payload: { serviceIds: [] },
    });
    expect(none.serviceIds).toEqual([]);
  });
});

describe('working hours', () => {
  it('replaces the weekly template, including night shifts', async () => {
    const owner = await registerClinic(app);
    const { dentistId, locationId } = await createClinicData(app, owner);
    const hours = await call<{ weekday: number; startTime: string; endTime: string }[]>(
      app,
      owner,
      {
        method: 'PUT',
        url: `/v1/admin/dentists/${dentistId}/working-hours`,
        payload: {
          items: [
            { locationId, weekday: 6, startTime: '20:00', endTime: '02:00' },
            { locationId, weekday: 1, startTime: '09:00', endTime: '13:00' },
          ],
        },
      },
    );
    expect(hours.map((h) => [h.weekday, h.startTime, h.endTime])).toEqual([
      [1, '09:00', '13:00'],
      [6, '20:00', '02:00'],
    ]);
  });

  it('rejects overlapping shifts, also across offices', async () => {
    const owner = await registerClinic(app);
    const { dentistId, locationId } = await createClinicData(app, owner);
    const second = await call<{ id: string }>(
      app,
      owner,
      { method: 'POST', url: '/v1/admin/locations', payload: { name: 'Second' } },
      201,
    );
    const res = await as(app, owner, {
      method: 'PUT',
      url: `/v1/admin/dentists/${dentistId}/working-hours`,
      payload: {
        items: [
          { locationId, weekday: 2, startTime: '09:00', endTime: '13:00' },
          { locationId: second.id, weekday: 2, startTime: '12:00', endTime: '18:00' },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'validation_failed' }, overlap: [0, 1] });
  });

  it.each([
    ['an empty shift', { startTime: '09:00', endTime: '09:00' }],
    ['a bad time', { startTime: '9:00', endTime: '17:00' }],
    ['24:00', { startTime: '09:00', endTime: '24:00' }],
    ['a bad weekday', { weekday: 8 }],
  ])('rejects %s', async (_case, override) => {
    const owner = await registerClinic(app);
    const { dentistId, locationId } = await createClinicData(app, owner);
    const item = { locationId, weekday: 1, startTime: '09:00', endTime: '17:00', ...override };
    const code = await status(owner, 'PUT', `/v1/admin/dentists/${dentistId}/working-hours`, {
      items: [item],
    });
    expect(code).toBe(400);
  });
});

describe('schedule exceptions', () => {
  let owner: Session;
  let data: ClinicFixture;
  const exceptionsUrl = () => `/v1/admin/dentists/${data.dentistId}/exceptions`;

  beforeAll(async () => {
    owner = await registerClinic(app);
    data = await createClinicData(app, owner);
    // Живой холд врача 2030-03-04 10:00–10:30 UTC занимает время
    await database.db.insert(appointments).values({
      clinicId: owner.clinicId,
      locationId: data.locationId,
      dentistId: data.dentistId,
      serviceId: data.serviceId,
      startAt: new Date('2030-03-04T10:00:00Z'),
      endAt: new Date('2030-03-04T10:30:00Z'),
      blockedUntil: new Date('2030-03-04T10:30:00Z'),
      status: 'hold',
      holdExpiresAt: new Date('2099-01-01T00:00:00Z'),
      source: 'admin',
    });
  });

  it('adds and lists exceptions within a range', async () => {
    const block = await call<{ id: string }>(
      app,
      owner,
      {
        method: 'POST',
        url: exceptionsUrl(),
        payload: {
          type: 'block',
          startAt: '2030-03-05T09:00:00-05:00',
          endAt: '2030-03-05T12:00:00-05:00',
          reason: 'Dentist conference',
        },
      },
      201,
    );
    expect(block).toMatchObject({
      type: 'block',
      startAt: '2030-03-05T14:00:00.000Z',
      endAt: '2030-03-05T17:00:00.000Z',
      locationId: null,
      reason: 'Dentist conference',
    });
    const list = await call<{ id: string }[]>(app, owner, {
      method: 'GET',
      url: `${exceptionsUrl()}?from=2030-03-05T00:00:00Z&to=2030-03-06T00:00:00Z`,
    });
    expect(list.map((e) => e.id)).toEqual([block.id]);
  });

  it('refuses to block time that has appointments and lists them (§8)', async () => {
    const res = await as(app, owner, {
      method: 'POST',
      url: exceptionsUrl(),
      payload: { type: 'block', startAt: '2030-03-04T09:00:00Z', endAt: '2030-03-04T12:00:00Z' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: { code: 'slot_taken' },
      conflicts: [
        { startAt: '2030-03-04T10:00:00.000Z', endAt: '2030-03-04T10:30:00.000Z', status: 'hold' },
      ],
    });
  });

  it('refuses to delete extra time that has appointments, deletes free extra time', async () => {
    const add = (startAt: string, endAt: string) =>
      call<{ id: string }>(
        app,
        owner,
        {
          method: 'POST',
          url: exceptionsUrl(),
          payload: { type: 'extra', locationId: data.locationId, startAt, endAt },
        },
        201,
      );
    const busy = await add('2030-03-04T09:00:00Z', '2030-03-04T11:00:00Z');
    const free = await add('2030-03-09T09:00:00Z', '2030-03-09T11:00:00Z');
    const remove = (id: string) =>
      as(app, owner, { method: 'DELETE', url: `${exceptionsUrl()}/${id}` });
    expect((await remove(busy.id)).statusCode).toBe(409);
    expect((await remove(free.id)).statusCode).toBe(204);
    expect((await remove(free.id)).statusCode).toBe(404);
  });

  it.each([
    ['extra without an office', { type: 'extra' }],
    ['end before start', { type: 'block', endAt: '2030-03-01T08:00:00Z' }],
    ['a time without an offset', { type: 'block', startAt: '2030-03-01T09:00:00' }],
  ])('rejects %s', async (_case, override) => {
    const payload = {
      startAt: '2030-03-01T09:00:00Z',
      endAt: '2030-03-01T10:00:00Z',
      ...override,
    };
    expect(await status(owner, 'POST', exceptionsUrl(), payload)).toBe(400);
  });
});

describe('registrar', () => {
  it('reads the clinic data', async () => {
    const owner = await registerClinic(app);
    const data = await createClinicData(app, owner);
    const registrar = await addStaff(app, owner, 'registrar');
    for (const url of [
      '/v1/admin/locations',
      '/v1/admin/services',
      '/v1/admin/dentists',
      `/v1/admin/dentists/${data.dentistId}/working-hours`,
    ]) {
      expect((await as(app, registrar, { method: 'GET', url })).statusCode, url).toBe(200);
    }
  });
});
