/**
 * Изоляция тенантов (CLAUDE.md §2.2, критерий «Готово» Шага 3): на каждый роут /v1/admin —
 * попытка сотрудника клиники B добраться до данных клиники A. Роуты берутся из самого
 * приложения, поэтому новый роут без проверки здесь роняет тест покрытия.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, HTTPMethods, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '@dentbook/db/testing';
import {
  PASSWORD,
  addStaff,
  as,
  call,
  createClinicData,
  registerClinic,
  testApp,
  uniqueEmail,
  type ClinicFixture,
  type Session,
} from './helpers.js';

interface RouteInfo {
  method: HTTPMethods;
  url: string;
  roles: readonly string[] | undefined;
}

let database: TestDatabase;
let app: FastifyInstance;
const routes: RouteInfo[] = [];

/** A — чьи данные пытаются достать, B — кто пытается. */
let a: Session;
let aAdmin: Session;
let b: Session;
let aData: ClinicFixture;
let bData: ClinicFixture;
/** Исключение расписания врача A (extra в филиале A). */
let aExceptionId: string;

beforeAll(async () => {
  database = await startTestDatabase();
  app = testApp(database.db);
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD' && route.url.startsWith('/v1/admin')) {
        routes.push({ method, url: route.url, roles: route.config?.roles });
      }
    }
  });
  await app.ready();

  a = await registerClinic(app, { clinicName: 'Clinic A' });
  aAdmin = await addStaff(app, a, 'admin');
  b = await registerClinic(app, { clinicName: 'Clinic B' });
  aData = await createClinicData(app, a, { dentistName: 'Dr. A' });
  bData = await createClinicData(app, b, { dentistName: 'Dr. B' });
  const exception = await call<{ id: string }>(
    app,
    a,
    {
      method: 'POST',
      url: `/v1/admin/dentists/${aData.dentistId}/exceptions`,
      payload: {
        type: 'extra',
        locationId: aData.locationId,
        startAt: '2030-01-05T10:00:00Z',
        endAt: '2030-01-05T14:00:00Z',
      },
    },
    201,
  );
  aExceptionId = exception.id;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await database?.stop();
});

const key = (route: Pick<RouteInfo, 'method' | 'url'>) => `${route.method} ${route.url}`;

/** Роуты без сессии: вход и регистрация. */
const PUBLIC_ROUTES = new Set([
  'POST /v1/admin/auth/register',
  'POST /v1/admin/auth/login',
  'POST /v1/admin/auth/logout',
]);

async function clinicOf(session: Session) {
  const res = await as(app, session, { method: 'GET', url: '/v1/admin/clinic' });
  return res.json<{ id: string; name: string }>();
}

/** Список сущностей глазами сессии: id по порядку. */
async function idsOf(session: Session, url: string) {
  const res = await as(app, session, { method: 'GET', url });
  return res.json<{ id: string }[]>().map((e) => e.id);
}

/** Сущность A глазами самой A: чтобы убедиться, что попытка B её не изменила. */
const asSeenByA = <T>(url: string) => call<T>(app, a, { method: 'GET', url });

/** B создаёт сущность, подсовывая clinicId клиники A: она появляется у B, A не меняется. */
async function createLandsInOwnClinic(url: string, payload: object) {
  const before = await idsOf(a, url);
  const res = await as(app, b, {
    method: 'POST',
    url,
    payload: { ...payload, clinicId: a.clinicId },
  });
  expect(res.statusCode, res.body).toBe(201);
  expect(await idsOf(b, url)).toContain(res.json().id);
  expect(await idsOf(a, url)).toEqual(before);
}

async function expectNotFound(options: InjectOptions) {
  const res = await as(app, b, options);
  expect(res.statusCode, `${options.method} ${options.url}: ${res.body}`).toBe(404);
  expect(res.json().error.code).toBe('not_found');
}

const exceptionsUrl = (dentistId: string) =>
  `/v1/admin/dentists/${dentistId}/exceptions?from=2030-01-01T00:00:00Z&to=2030-02-01T00:00:00Z`;

/** Попытка B дотянуться до данных A через роут. Ключ — «МЕТОД путь» как в Fastify. */
const attacks: Record<string, () => Promise<void>> = {
  'GET /v1/admin/me': async () => {
    const res = await as(app, b, { method: 'GET', url: '/v1/admin/me' });
    expect(res.json().clinic.id).toBe(b.clinicId);
    expect(res.body).not.toContain(a.clinicId);
  },

  // --- клиника и сотрудники ---

  'GET /v1/admin/clinic': async () => {
    expect((await clinicOf(b)).id).toBe(b.clinicId);
  },

  'PATCH /v1/admin/clinic': async () => {
    // Чужой id в теле игнорируется: клиника берётся только из сессии
    const res = await as(app, b, {
      method: 'PATCH',
      url: '/v1/admin/clinic',
      payload: { id: a.clinicId, clinicId: a.clinicId, name: 'Hacked' },
    });
    expect(res.json().id).toBe(b.clinicId);
    expect((await clinicOf(a)).name).toBe('Clinic A');
  },

  'GET /v1/admin/users': async () => {
    const ids = await idsOf(b, '/v1/admin/users');
    expect(ids).toContain(b.userId);
    expect(ids).not.toContain(a.userId);
    expect(ids).not.toContain(aAdmin.userId);
  },

  'POST /v1/admin/users': () =>
    createLandsInOwnClinic('/v1/admin/users', {
      email: uniqueEmail('intruder'),
      fullName: 'Intruder',
      password: PASSWORD,
      role: 'admin',
    }),

  'GET /v1/admin/users/:id': async () => {
    const res = await as(app, b, { method: 'GET', url: `/v1/admin/users/${aAdmin.userId}` });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(aAdmin.email);
  },

  'PATCH /v1/admin/users/:id': async () => {
    await expectNotFound({
      method: 'PATCH',
      url: `/v1/admin/users/${aAdmin.userId}`,
      payload: { isActive: false, fullName: 'Hacked' },
    });
    expect(await asSeenByA(`/v1/admin/users/${aAdmin.userId}`)).toMatchObject({
      isActive: true,
      fullName: 'Sam admin',
    });
  },

  // --- филиалы ---

  'GET /v1/admin/locations': async () => {
    const ids = await idsOf(b, '/v1/admin/locations');
    expect(ids).toContain(bData.locationId);
    expect(ids).not.toContain(aData.locationId);
  },

  'POST /v1/admin/locations': () =>
    createLandsInOwnClinic('/v1/admin/locations', { name: 'Intruder office' }),

  'GET /v1/admin/locations/:id': () =>
    expectNotFound({ method: 'GET', url: `/v1/admin/locations/${aData.locationId}` }),

  'PATCH /v1/admin/locations/:id': async () => {
    await expectNotFound({
      method: 'PATCH',
      url: `/v1/admin/locations/${aData.locationId}`,
      payload: { name: 'Hacked', isActive: false },
    });
    expect(await asSeenByA(`/v1/admin/locations/${aData.locationId}`)).toMatchObject({
      name: 'Main office',
      isActive: true,
    });
  },

  // --- услуги ---

  'GET /v1/admin/services': async () => {
    const ids = await idsOf(b, '/v1/admin/services');
    expect(ids).toContain(bData.serviceId);
    expect(ids).not.toContain(aData.serviceId);
  },

  'POST /v1/admin/services': () =>
    createLandsInOwnClinic('/v1/admin/services', { name: 'Intruder service', durationMin: 15 }),

  'GET /v1/admin/services/:id': () =>
    expectNotFound({ method: 'GET', url: `/v1/admin/services/${aData.serviceId}` }),

  'PATCH /v1/admin/services/:id': async () => {
    await expectNotFound({
      method: 'PATCH',
      url: `/v1/admin/services/${aData.serviceId}`,
      payload: { price: '0.01' },
    });
    expect(await asSeenByA(`/v1/admin/services/${aData.serviceId}`)).toMatchObject({
      price: '80.00',
    });
  },

  // --- врачи ---

  'GET /v1/admin/dentists': async () => {
    const ids = await idsOf(b, '/v1/admin/dentists');
    expect(ids).toContain(bData.dentistId);
    expect(ids).not.toContain(aData.dentistId);
  },

  'POST /v1/admin/dentists': () =>
    createLandsInOwnClinic('/v1/admin/dentists', { fullName: 'Dr. Intruder' }),

  'GET /v1/admin/dentists/:id': () =>
    expectNotFound({ method: 'GET', url: `/v1/admin/dentists/${aData.dentistId}` }),

  'PATCH /v1/admin/dentists/:id': async () => {
    await expectNotFound({
      method: 'PATCH',
      url: `/v1/admin/dentists/${aData.dentistId}`,
      payload: { isActive: false },
    });
    expect(await asSeenByA(`/v1/admin/dentists/${aData.dentistId}`)).toMatchObject({
      isActive: true,
    });
  },

  'PUT /v1/admin/dentists/order': async () => {
    const before = await idsOf(a, '/v1/admin/dentists');
    await expectNotFound({
      method: 'PUT',
      url: '/v1/admin/dentists/order',
      payload: { dentistIds: [aData.dentistId, ...(await idsOf(b, '/v1/admin/dentists'))] },
    });
    expect(await idsOf(a, '/v1/admin/dentists')).toEqual(before);
  },

  'PUT /v1/admin/dentists/:id/services': async () => {
    // Чужой врач — и чужая услуга у своего врача
    await expectNotFound({
      method: 'PUT',
      url: `/v1/admin/dentists/${aData.dentistId}/services`,
      payload: { serviceIds: [] },
    });
    await expectNotFound({
      method: 'PUT',
      url: `/v1/admin/dentists/${bData.dentistId}/services`,
      payload: { serviceIds: [aData.serviceId] },
    });
    expect(await asSeenByA(`/v1/admin/dentists/${aData.dentistId}`)).toMatchObject({
      serviceIds: [aData.serviceId],
    });
  },

  'GET /v1/admin/dentists/:id/working-hours': () =>
    expectNotFound({ method: 'GET', url: `/v1/admin/dentists/${aData.dentistId}/working-hours` }),

  'PUT /v1/admin/dentists/:id/working-hours': async () => {
    const shift = { weekday: 6, startTime: '09:00', endTime: '10:00' };
    await expectNotFound({
      method: 'PUT',
      url: `/v1/admin/dentists/${aData.dentistId}/working-hours`,
      payload: { items: [] },
    });
    await expectNotFound({
      method: 'PUT',
      url: `/v1/admin/dentists/${bData.dentistId}/working-hours`,
      payload: { items: [{ ...shift, locationId: aData.locationId }] },
    });
    const hours = await asSeenByA<unknown[]>(`/v1/admin/dentists/${aData.dentistId}/working-hours`);
    expect(hours).toHaveLength(5);
  },

  'GET /v1/admin/dentists/:id/exceptions': () =>
    expectNotFound({ method: 'GET', url: exceptionsUrl(aData.dentistId) }),

  'POST /v1/admin/dentists/:id/exceptions': async () => {
    const extra = { type: 'extra', startAt: '2030-01-06T10:00:00Z', endAt: '2030-01-06T12:00:00Z' };
    await expectNotFound({
      method: 'POST',
      url: `/v1/admin/dentists/${aData.dentistId}/exceptions`,
      payload: { ...extra, locationId: bData.locationId },
    });
    await expectNotFound({
      method: 'POST',
      url: `/v1/admin/dentists/${bData.dentistId}/exceptions`,
      payload: { ...extra, locationId: aData.locationId },
    });
    expect(await asSeenByA<unknown[]>(exceptionsUrl(aData.dentistId))).toHaveLength(1);
  },

  'DELETE /v1/admin/dentists/:id/exceptions/:exceptionId': async () => {
    for (const dentistId of [aData.dentistId, bData.dentistId]) {
      await expectNotFound({
        method: 'DELETE',
        url: `/v1/admin/dentists/${dentistId}/exceptions/${aExceptionId}`,
      });
    }
    expect(await asSeenByA(exceptionsUrl(aData.dentistId))).toEqual([
      expect.objectContaining({ id: aExceptionId }),
    ]);
  },

  // --- календарь ---

  'GET /v1/admin/availability': async () => {
    const query = (fixture: ClinicFixture, dentistId?: string) =>
      new URLSearchParams({
        serviceId: fixture.serviceId,
        locationId: fixture.locationId,
        from: '2030-01-07',
        to: '2030-01-08',
        ...(dentistId ? { dentistId } : {}),
      });
    await expectNotFound({ method: 'GET', url: `/v1/admin/availability?${query(aData)}` });
    // Свои филиал и услуга, но чужой врач: его время не видно
    const res = await as(app, b, {
      method: 'GET',
      url: `/v1/admin/availability?${query(bData, aData.dentistId)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(aData.dentistId);
  },
};

describe('tenant isolation (CLAUDE.md §2.2)', () => {
  it('collects the admin routes', () => {
    expect(routes.length).toBeGreaterThan(PUBLIC_ROUTES.size);
  });

  it('every admin route has an isolation check', () => {
    const uncovered = routes.map(key).filter((k) => !PUBLIC_ROUTES.has(k) && !(k in attacks));
    expect(uncovered).toEqual([]);
  });

  it('has no checks for routes that no longer exist', () => {
    const existing = new Set(routes.map(key));
    expect(Object.keys(attacks).filter((k) => !existing.has(k))).toEqual([]);
  });

  it.each(Object.keys(attacks))('%s does not reach another clinic', async (route) => {
    await attacks[route]!();
  });

  it('every non-public route requires a session', async () => {
    for (const route of routes.filter((r) => !PUBLIC_ROUTES.has(key(r)))) {
      const url = route.url.replace(/:\w+/g, randomUUID());
      const res = await app.inject({ method: route.method, url });
      expect(res.statusCode, key(route)).toBe(401);
    }
  });

  it('every route closed to registrars answers them 403', async () => {
    const registrar = await addStaff(app, b, 'registrar');
    const closed = routes.filter((r) => r.roles && !r.roles.includes('registrar'));
    expect(closed.length).toBeGreaterThan(0);
    for (const route of closed) {
      const url = route.url.replace(/:\w+/g, bData.dentistId);
      const res = await as(app, registrar, { method: route.method, url, payload: {} });
      expect(res.statusCode, key(route)).toBe(403);
    }
  });
});
