/** Общее для интеграционных тестов API: приложение на тестовой БД и регистрация клиник. */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { expect } from 'vitest';
import type { Database } from '@dentbook/db';
import type { RegisterClinicInput } from '@dentbook/shared';
import { buildApp } from '../src/app.js';
import type { Env } from '../src/env.js';
import { SESSION_COOKIE } from '../src/plugins/session.js';

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    API_HOST: '127.0.0.1',
    API_PORT: 3000,
    DATABASE_URL: 'postgres://unused',
    REDIS_URL: 'redis://unused',
    JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    JWT_ACCESS_TTL: 3600,
    // Тесты регистрируют много клиник с одного адреса
    AUTH_RATE_LIMIT: 10_000,
    ...overrides,
  };
}

export function testApp(db: Database, overrides: Partial<Env> = {}): FastifyInstance {
  return buildApp({ env: testEnv(overrides), db, logger: false });
}

export const PASSWORD = 'correct-horse-battery';

export interface Session {
  clinicId: string;
  userId: string;
  email: string;
  /** Заголовок Cookie с сессией. */
  cookie: string;
}

export const uniqueEmail = (label: string) => `${label}-${randomUUID()}@example.com`;

export function sessionCookie(setCookie: { name: string; value: string }[]): string {
  const cookie = setCookie.find((c) => c.name === SESSION_COOKIE);
  expect(cookie, 'session cookie is set').toBeDefined();
  return `${SESSION_COOKIE}=${cookie!.value}`;
}

export async function registerClinic(
  app: FastifyInstance,
  overrides: Partial<RegisterClinicInput> = {},
): Promise<Session> {
  const email = overrides.email ?? uniqueEmail('owner');
  const res = await app.inject({
    method: 'POST',
    url: '/v1/admin/auth/register',
    payload: {
      clinicName: 'Smile Dental',
      timezone: 'America/New_York',
      currency: 'USD',
      fullName: 'Olivia Owner',
      password: PASSWORD,
      ...overrides,
      email,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const { clinicId, userId } = res.json<{ clinicId: string; userId: string }>();
  return { clinicId, userId, email, cookie: sessionCookie(res.cookies) };
}

/** Сотрудник клиники с заданной ролью, созданный владельцем, и его сессия. */
export async function addStaff(
  app: FastifyInstance,
  owner: Session,
  role: 'admin' | 'registrar',
): Promise<Session> {
  const email = uniqueEmail(role);
  const created = await app.inject({
    method: 'POST',
    url: '/v1/admin/users',
    headers: { cookie: owner.cookie },
    payload: { email, fullName: `Sam ${role}`, password: PASSWORD, role },
  });
  expect(created.statusCode, created.body).toBe(201);
  const login = await app.inject({
    method: 'POST',
    url: '/v1/admin/auth/login',
    payload: { email, password: PASSWORD },
  });
  expect(login.statusCode, login.body).toBe(204);
  return {
    clinicId: owner.clinicId,
    userId: created.json<{ id: string }>().id,
    email,
    cookie: sessionCookie(login.cookies),
  };
}

/** Запрос от имени сессии. */
export function as(app: FastifyInstance, session: Session | null, options: InjectOptions) {
  return app.inject({
    ...options,
    headers: { ...options.headers, ...(session ? { cookie: session.cookie } : {}) },
  });
}
