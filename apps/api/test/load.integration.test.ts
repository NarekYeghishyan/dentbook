/**
 * Критерий «Готово» Шага 10: 50 одновременных попыток записи на один слот дают ровно одну
 * запись. Настоящий HTTP-сервер (не inject), Postgres и Redis в Testcontainers, один врач.
 * Гонка идёт в два этапа, как у живых клиентов: 50 одновременных холдов одного времени,
 * затем 50 одновременных подтверждений выигравшего холда с кодом из SMS.
 */
import type { AddressInfo } from 'node:net';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, isoWeekday, localDateOf, zonedTimeToUtc } from '@dentbook/core';
import { appointments } from '@dentbook/db';
import {
  startTestDatabase,
  startTestRedis,
  type TestDatabase,
  type TestRedis,
} from '@dentbook/db/testing';
import { raceHolds, summarize } from '../src/load-test.js';
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
const ORIGIN = 'https://clinic.example';
const ATTEMPTS = 50;

let database: TestDatabase;
let redisServer: TestRedis;
let redis: Redis;
let app: FastifyInstance;
let apiUrl: string;
const sms = new TestSms();
let owner: Session;
let data: ClinicFixture;
let key: string;

function upcoming(weekday: number): string {
  let date = addDays(localDateOf(new Date(), ZONE), 3);
  while (isoWeekday(date) !== weekday) date = addDays(date, 1);
  return date;
}

beforeAll(async () => {
  [database, redisServer] = await Promise.all([
    startTestDatabase({ poolSize: 20 }),
    startTestRedis(),
  ]);
  redis = new Redis(redisServer.url);
  app = testApp(database.db, {}, { redis, sms });
  await app.listen({ host: '127.0.0.1', port: 0 });
  apiUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

  owner = await registerClinic(app, { clinicName: 'Load Test Dental', timezone: ZONE });
  data = await createClinicData(app, owner, { dentistName: 'Dr. Only' });
  key = (
    await call<{ token: string }>(
      app,
      owner,
      {
        method: 'POST',
        url: '/v1/admin/api-keys',
        payload: { name: 'Site', allowedOrigins: [ORIGIN] },
      },
      201,
    )
  ).token;
}, 180_000);

afterAll(async () => {
  await app?.close();
  redis?.disconnect();
  await Promise.all([database?.stop(), redisServer?.stop()]);
});

const post = (path: string, body: object) =>
  fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      origin: ORIGIN,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

describe('load: one slot, 50 clients (Step 10)', () => {
  it('50 concurrent attempts give exactly one booking', async () => {
    const startAt = zonedTimeToUtc(upcoming(3), 10 * 60, ZONE).toISOString();

    const race = await raceHolds({
      api: apiUrl,
      key,
      origin: ORIGIN,
      serviceId: data.serviceId,
      locationId: data.locationId,
      startAt,
      n: ATTEMPTS,
    });
    console.log(`holds race — ${summarize(race)}`);
    expect(race.holds).toHaveLength(1);
    expect(race.statuses).toEqual({ 201: 1, 409: ATTEMPTS - 1 });

    // Победитель получает код; 50 одновременных подтверждений одного холда
    const phone = '+12025550150';
    const verification = await post('/v1/public/verifications', { phone });
    expect(verification.status).toBe(201);
    const { verification_id } = (await verification.json()) as { verification_id: string };
    const confirm = {
      hold_id: race.holds[0]!.hold_id,
      verification_id,
      code: sms.lastCode(phone),
      client: { full_name: 'Winner Client', phone },
    };
    const confirmations = await Promise.all(
      Array.from({ length: ATTEMPTS }, () => post('/v1/public/appointments', confirm)),
    );
    const statuses = confirmations.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 201 || s >= 500)).toHaveLength(1);

    const booked = await database.db
      .select({ id: appointments.id, status: appointments.status })
      .from(appointments)
      .where(
        and(
          eq(appointments.dentistId, data.dentistId),
          eq(appointments.startAt, new Date(startAt)),
          inArray(appointments.status, ['hold', 'pending', 'confirmed']),
        ),
      );
    expect(booked).toEqual([{ id: race.holds[0]!.hold_id, status: 'confirmed' }]);
  });
});
