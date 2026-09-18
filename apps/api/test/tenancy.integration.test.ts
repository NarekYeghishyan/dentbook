/**
 * Изоляция тенантов (CLAUDE.md §2.2, критерий «Готово» Шага 3): на каждый роут /v1/admin —
 * попытка сотрудника клиники B добраться до данных клиники A. Роуты берутся из самого
 * приложения, поэтому новый роут без проверки здесь роняет тест покрытия.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '@dentbook/db/testing';
import {
  PASSWORD,
  addStaff,
  as,
  registerClinic,
  testApp,
  uniqueEmail,
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

async function userIdsOf(session: Session) {
  const res = await as(app, session, { method: 'GET', url: '/v1/admin/users' });
  return res.json<{ id: string }[]>().map((u) => u.id);
}

/** Попытка B дотянуться до данных A через роут. Ключ — «МЕТОД путь» как в Fastify. */
const attacks: Record<string, () => Promise<void>> = {
  'GET /v1/admin/me': async () => {
    const res = await as(app, b, { method: 'GET', url: '/v1/admin/me' });
    expect(res.json().clinic.id).toBe(b.clinicId);
    expect(res.body).not.toContain(a.clinicId);
  },

  'GET /v1/admin/clinic': async () => {
    const clinic = await clinicOf(b);
    expect(clinic.id).toBe(b.clinicId);
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
    const ids = await userIdsOf(b);
    expect(ids).toContain(b.userId);
    expect(ids).not.toContain(a.userId);
    expect(ids).not.toContain(aAdmin.userId);
  },

  'POST /v1/admin/users': async () => {
    const before = await userIdsOf(a);
    const res = await as(app, b, {
      method: 'POST',
      url: '/v1/admin/users',
      payload: {
        clinicId: a.clinicId,
        email: uniqueEmail('intruder'),
        fullName: 'Intruder',
        password: PASSWORD,
        role: 'admin',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(await userIdsOf(b)).toContain(res.json().id);
    expect(await userIdsOf(a)).toEqual(before);
  },

  'GET /v1/admin/users/:id': async () => {
    const res = await as(app, b, { method: 'GET', url: `/v1/admin/users/${aAdmin.userId}` });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(aAdmin.email);
  },

  'PATCH /v1/admin/users/:id': async () => {
    const res = await as(app, b, {
      method: 'PATCH',
      url: `/v1/admin/users/${aAdmin.userId}`,
      payload: { isActive: false, fullName: 'Hacked' },
    });
    expect(res.statusCode).toBe(404);
    const victim = await as(app, a, { method: 'GET', url: `/v1/admin/users/${aAdmin.userId}` });
    expect(victim.json()).toMatchObject({ isActive: true, fullName: 'Sam admin' });
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
      const url = route.url.replace(':id', randomUUID());
      const res = await app.inject({ method: route.method, url });
      expect(res.statusCode, key(route)).toBe(401);
    }
  });

  it('every route closed to registrars answers them 403', async () => {
    const registrar = await addStaff(app, b, 'registrar');
    const closed = routes.filter((r) => r.roles && !r.roles.includes('registrar'));
    expect(closed.length).toBeGreaterThan(0);
    for (const route of closed) {
      const url = route.url.replace(':id', b.userId);
      const res = await as(app, registrar, { method: route.method, url, payload: {} });
      expect(res.statusCode, key(route)).toBe(403);
    }
  });
});
