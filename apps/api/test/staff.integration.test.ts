import type { FastifyInstance } from 'fastify';
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

const patchUser = (session: Session, id: string, payload: object) =>
  as(app, session, { method: 'PATCH', url: `/v1/admin/users/${id}`, payload });

describe('staff management', () => {
  it('owner adds staff; the list shows them without password hashes', async () => {
    const owner = await registerClinic(app);
    const admin = await addStaff(app, owner, 'admin');
    const registrar = await addStaff(app, owner, 'registrar');

    const res = await as(app, owner, { method: 'GET', url: '/v1/admin/users' });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((u: { id: string; role: string }) => [u.id, u.role])).toEqual([
      [owner.userId, 'owner'],
      [admin.userId, 'admin'],
      [registrar.userId, 'registrar'],
    ]);
    expect(res.body).not.toContain('scrypt');
  });

  it('admin can add staff; registrar cannot see or add staff', async () => {
    const owner = await registerClinic(app);
    const admin = await addStaff(app, owner, 'admin');
    const registrar = await addStaff(app, admin, 'registrar');

    const payload = {
      email: uniqueEmail('x'),
      fullName: 'X',
      password: PASSWORD,
      role: 'registrar',
    };
    for (const options of [
      { method: 'GET' as const, url: '/v1/admin/users' },
      { method: 'GET' as const, url: `/v1/admin/users/${owner.userId}` },
      { method: 'POST' as const, url: '/v1/admin/users', payload },
    ]) {
      expect((await as(app, registrar, options)).statusCode).toBe(403);
    }
  });

  it.each(['owner', 'operator'])('does not hand out the %s role', async (role) => {
    const owner = await registerClinic(app);
    const res = await as(app, owner, {
      method: 'POST',
      url: '/v1/admin/users',
      payload: { email: uniqueEmail('x'), fullName: 'X', password: PASSWORD, role },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a taken email with 409', async () => {
    const owner = await registerClinic(app);
    const res = await as(app, owner, {
      method: 'POST',
      url: '/v1/admin/users',
      payload: { email: owner.email, fullName: 'X', password: PASSWORD, role: 'admin' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('renames staff and changes the password', async () => {
    const owner = await registerClinic(app);
    const staff = await addStaff(app, owner, 'admin');
    const res = await patchUser(owner, staff.userId, {
      fullName: 'Renamed',
      password: 'a-new-password-42',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ fullName: 'Renamed', role: 'admin', isActive: true });

    const login = (password: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/admin/auth/login',
        payload: { email: staff.email, password },
      });
    expect((await login(PASSWORD)).statusCode).toBe(401);
    expect((await login('a-new-password-42')).statusCode).toBe(204);
  });

  it('nobody changes their own role or status', async () => {
    const owner = await registerClinic(app);
    const admin = await addStaff(app, owner, 'admin');
    expect((await patchUser(admin, admin.userId, { role: 'registrar' })).statusCode).toBe(403);
    expect((await patchUser(admin, admin.userId, { isActive: false })).statusCode).toBe(403);
    expect((await patchUser(admin, admin.userId, { fullName: 'Me' })).statusCode).toBe(200);
  });

  it('the owner is edited only by themselves, and never loses the role', async () => {
    const owner = await registerClinic(app);
    const admin = await addStaff(app, owner, 'admin');
    expect((await patchUser(admin, owner.userId, { fullName: 'Hijack' })).statusCode).toBe(403);
    expect((await patchUser(admin, owner.userId, { isActive: false })).statusCode).toBe(403);
    expect((await patchUser(owner, owner.userId, { isActive: false })).statusCode).toBe(403);
    expect((await patchUser(owner, owner.userId, { fullName: 'Olivia' })).statusCode).toBe(200);
  });

  it('an empty patch changes nothing', async () => {
    const owner = await registerClinic(app);
    const staff = await addStaff(app, owner, 'registrar');
    const res = await patchUser(owner, staff.userId, {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: staff.userId, role: 'registrar' });
  });

  it('answers 404 for a malformed id', async () => {
    const owner = await registerClinic(app);
    const res = await as(app, owner, { method: 'GET', url: '/v1/admin/users/not-a-uuid' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
});

describe('clinic settings', () => {
  it('every role reads the settings; owner and admin change them', async () => {
    const owner = await registerClinic(app);
    const admin = await addStaff(app, owner, 'admin');
    const registrar = await addStaff(app, owner, 'registrar');

    expect((await as(app, registrar, { method: 'GET', url: '/v1/admin/clinic' })).statusCode).toBe(
      200,
    );
    const patch = (session: Session, payload: object) =>
      as(app, session, { method: 'PATCH', url: '/v1/admin/clinic', payload });

    expect((await patch(registrar, { name: 'X' })).statusCode).toBe(403);
    const res = await patch(admin, {
      name: 'Renamed Dental',
      timezone: 'America/Chicago',
      locale: 'hy',
      slotStepMin: 30,
      bookingRequiresConfirmation: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: owner.clinicId,
      name: 'Renamed Dental',
      timezone: 'America/Chicago',
      locale: 'hy',
      slotStepMin: 30,
      bookingRequiresConfirmation: true,
    });
  });

  it('validates the settings; an empty patch changes nothing', async () => {
    const owner = await registerClinic(app);
    const patch = (payload: object) =>
      as(app, owner, { method: 'PATCH', url: '/v1/admin/clinic', payload });
    expect((await patch({ timezone: 'Nowhere/City' })).statusCode).toBe(400);
    expect((await patch({ slotStepMin: 0 })).statusCode).toBe(400);
    const res = await patch({});
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Smile Dental');
  });
});
