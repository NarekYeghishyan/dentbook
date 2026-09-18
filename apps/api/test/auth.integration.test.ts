import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { clinics, users } from '@dentbook/db';
import { startTestDatabase, type TestDatabase } from '@dentbook/db/testing';
import { hashPassword } from '../src/lib/password.js';
import { SESSION_COOKIE } from '../src/plugins/session.js';
import {
  PASSWORD,
  addStaff,
  as,
  registerClinic,
  sessionCookie,
  testApp,
  uniqueEmail,
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

const validRegistration = () => ({
  clinicName: 'Bright Smile',
  timezone: 'America/Los_Angeles',
  currency: 'USD',
  fullName: 'Olivia Owner',
  email: uniqueEmail('owner'),
  password: PASSWORD,
});

const login = (email: string, password = PASSWORD) =>
  app.inject({ method: 'POST', url: '/v1/admin/auth/login', payload: { email, password } });

describe('POST /v1/admin/auth/register', () => {
  it('creates the clinic with its owner and starts a session', async () => {
    const session = await registerClinic(app, {
      clinicName: 'Bright Smile',
      timezone: 'America/Los_Angeles',
    });
    const me = await as(app, session, { method: 'GET', url: '/v1/admin/me' });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({
      user: {
        id: session.userId,
        email: session.email,
        fullName: 'Olivia Owner',
        role: 'owner',
        isActive: true,
        lastLoginAt: null,
      },
      clinic: {
        id: session.clinicId,
        name: 'Bright Smile',
        timezone: 'America/Los_Angeles',
        locale: 'en',
        currency: 'USD',
        minLeadMin: 120,
        slotStepMin: 15,
        maxAdvanceDays: 60,
        bookingRequiresConfirmation: false,
      },
    });
  });

  it('sets an httpOnly, SameSite=Strict cookie scoped to the admin API', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/register',
      payload: validRegistration(),
    });
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toMatchObject({
      httpOnly: true,
      sameSite: 'Strict',
      path: '/v1/admin',
      maxAge: 3600,
    });
  });

  it('stores a scrypt hash instead of the password', async () => {
    const session = await registerClinic(app);
    const [row] = await database.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, session.userId));
    expect(row!.passwordHash).toMatch(/^scrypt\$/);
    expect(row!.passwordHash).not.toContain(PASSWORD);
  });

  it('rejects a taken email, case-insensitively, without leaving a clinic behind', async () => {
    const first = await registerClinic(app);
    const clinicName = `Duplicate ${first.userId}`;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/register',
      payload: { ...validRegistration(), clinicName, email: first.email.toUpperCase() },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: { code: 'validation_failed', message: 'Email is already registered' },
    });
    expect(await database.db.$count(clinics, eq(clinics.name, clinicName))).toBe(0);
  });

  it.each([
    ['unknown time zone', { timezone: 'Mars/Olympus' }],
    ['lowercase currency', { currency: 'usd' }],
    ['unsupported locale', { locale: 'fr' }],
    ['short password', { password: 'short' }],
    ['bad email', { email: 'not-an-email' }],
    ['empty clinic name', { clinicName: '  ' }],
  ])('rejects %s with validation_failed', async (_case, override) => {
    const payload = { ...validRegistration(), ...override };
    const res = await app.inject({ method: 'POST', url: '/v1/admin/auth/register', payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
    // В сообщении только имена полей, без значений (§2.6)
    expect(res.json().error.message).not.toContain(payload.email);
    expect(res.json().error.message).not.toContain(payload.password);
  });

  it('rejects a form-encoded body (CSRF via HTML form)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/register',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'clinicName=x',
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('validation_failed');
  });
});

describe('POST /v1/admin/auth/login and /logout', () => {
  it('logs in with any email case and records the login time', async () => {
    const owner = await registerClinic(app);
    const res = await login(owner.email.toUpperCase());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ role: 'owner' });
    const me = await app.inject({
      method: 'GET',
      url: '/v1/admin/me',
      headers: { cookie: sessionCookie(res.cookies) },
    });
    expect(me.json().user.lastLoginAt).not.toBeNull();
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const owner = await registerClinic(app);
    const wrongPassword = await login(owner.email, 'wrong-password-123');
    const unknownEmail = await login(uniqueEmail('nobody'));
    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        error: { code: 'unauthorized', message: 'Invalid email or password' },
      });
    }
  });

  it('logout clears the cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/admin/auth/logout' });
    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)?.value).toBe('');
  });

  it('limits attempts per IP', async () => {
    const limited = testApp(database.db, { AUTH_RATE_LIMIT: 2 });
    try {
      const attempt = () =>
        limited.inject({
          method: 'POST',
          url: '/v1/admin/auth/login',
          payload: { email: uniqueEmail('x'), password: 'whatever-123' },
        });
      expect((await attempt()).statusCode).toBe(401);
      expect((await attempt()).statusCode).toBe(401);
      const blocked = await attempt();
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error.code).toBe('rate_limited');
    } finally {
      await limited.close();
    }
  });
});

describe('sessions', () => {
  it('rejects requests without a session in the common error format', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/admin/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: 'unauthorized', message: 'Authentication required' },
    });
  });

  it('rejects a garbage token and a token signed with another secret', async () => {
    const other = testApp(database.db, { JWT_SECRET: 'another-secret-that-is-at-least-32-chars' });
    try {
      const foreign = await registerClinic(other);
      for (const cookie of [`${SESSION_COOKIE}=garbage`, foreign.cookie]) {
        const res = await app.inject({ method: 'GET', url: '/v1/admin/me', headers: { cookie } });
        expect(res.statusCode).toBe(401);
      }
    } finally {
      await other.close();
    }
  });

  it('rejects an expired session', async () => {
    const owner = await registerClinic(app);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 3601 * 1000);
    try {
      const res = await as(app, owner, { method: 'GET', url: '/v1/admin/me' });
      expect(res.statusCode).toBe(401);
    } finally {
      clock.mockRestore();
    }
  });

  it('applies a role change to an existing session immediately', async () => {
    const owner = await registerClinic(app);
    const staff = await addStaff(app, owner, 'registrar');
    const listUsers = () => as(app, staff, { method: 'GET', url: '/v1/admin/users' });

    expect((await listUsers()).statusCode).toBe(403);
    await as(app, owner, {
      method: 'PATCH',
      url: `/v1/admin/users/${staff.userId}`,
      payload: { role: 'admin' },
    });
    expect((await listUsers()).statusCode).toBe(200);
  });

  it('ends the sessions of a deactivated user', async () => {
    const owner = await registerClinic(app);
    const staff = await addStaff(app, owner, 'admin');
    await as(app, owner, {
      method: 'PATCH',
      url: `/v1/admin/users/${staff.userId}`,
      payload: { isActive: false },
    });
    expect((await as(app, staff, { method: 'GET', url: '/v1/admin/me' })).statusCode).toBe(401);
    expect((await login(staff.email)).statusCode).toBe(401);
  });

  it('forbids a suspended clinic', async () => {
    const owner = await registerClinic(app);
    await database.db
      .update(clinics)
      .set({ status: 'suspended' })
      .where(eq(clinics.id, owner.clinicId));
    const res = await as(app, owner, { method: 'GET', url: '/v1/admin/me' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden');
  });

  it('gives a platform operator no access to clinic data', async () => {
    const email = uniqueEmail('operator');
    await database.db.insert(users).values({
      clinicId: null,
      email,
      passwordHash: await hashPassword(PASSWORD),
      fullName: 'Pat Operator',
      role: 'operator',
    });
    const res = await login(email);
    const me = await app.inject({
      method: 'GET',
      url: '/v1/admin/me',
      headers: { cookie: sessionCookie(res.cookies) },
    });
    expect(me.statusCode).toBe(403);
  });
});
