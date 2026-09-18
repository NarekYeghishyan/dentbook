import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appointments, blockedUntil, isExclusionViolation } from '@dentbook/db';
import { DEMO_IDS, seedDemo } from '@dentbook/db/seed';
import {
  startTestDatabase,
  startTestRedis,
  type TestDatabase,
  type TestRedis,
} from '@dentbook/db/testing';
import { expireHolds } from '../src/jobs/expire-holds.js';

let database: TestDatabase;
let redisServer: TestRedis;
let redis: Redis;

beforeAll(async () => {
  [database, redisServer] = await Promise.all([startTestDatabase(), startTestRedis()]);
  redis = new Redis(redisServer.url);
  await seedDemo(database.db);
}, 180_000);

afterAll(async () => {
  redis?.disconnect();
  await Promise.all([database?.stop(), redisServer?.stop()]);
});

const NOW = new Date('2030-03-04T09:00:00Z');

function hold(startAt: string, endAt: string, holdExpiresAt: Date) {
  return {
    clinicId: DEMO_IDS.clinic,
    locationId: DEMO_IDS.location,
    dentistId: DEMO_IDS.dentists.anna,
    serviceId: DEMO_IDS.services.checkup,
    startAt: new Date(startAt),
    endAt: new Date(endAt),
    blockedUntil: blockedUntil(new Date(endAt), 0),
    status: 'hold' as const,
    holdExpiresAt,
    source: 'widget' as const,
  };
}

describe('expire holds job (Step 5)', () => {
  it('expires only stale holds, and the slot can be held again', async () => {
    const [stale] = await database.db
      .insert(appointments)
      .values(hold('2030-03-04T10:00:00Z', '2030-03-04T10:30:00Z', new Date(NOW.getTime() - 1000)))
      .returning({ id: appointments.id });
    const [live] = await database.db
      .insert(appointments)
      .values(
        hold('2030-03-04T11:00:00Z', '2030-03-04T11:30:00Z', new Date(NOW.getTime() + 60_000)),
      )
      .returning({ id: appointments.id });

    // Пока статус hold, EXCLUDE держит время даже за истёкшим холдом
    await expect(
      database.db
        .insert(appointments)
        .values(hold('2030-03-04T10:00:00Z', '2030-03-04T10:30:00Z', NOW)),
    ).rejects.toSatisfy(isExclusionViolation);

    // Кеш слотов врача и чужого врача: сбрасывается только первый
    const annaKey = `avail:${DEMO_IDS.clinic}:${DEMO_IDS.dentists.anna}:2030-03-04:s:l`;
    const borisKey = `avail:${DEMO_IDS.clinic}:${DEMO_IDS.dentists.boris}:2030-03-04:s:l`;
    await redis.set(annaKey, '[]');
    await redis.set(borisKey, '[]');

    expect(await expireHolds(database.db, redis, NOW)).toBe(1);
    expect(await redis.exists(annaKey)).toBe(0);
    expect(await redis.exists(borisKey)).toBe(1);
    const status = async (id: string) =>
      (
        await database.db
          .select({ s: appointments.status })
          .from(appointments)
          .where(eq(appointments.id, id))
      )[0]!.s;
    expect(await status(stale!.id)).toBe('expired');
    expect(await status(live!.id)).toBe('hold');

    await expect(
      database.db
        .insert(appointments)
        .values(
          hold('2030-03-04T10:00:00Z', '2030-03-04T10:30:00Z', new Date(NOW.getTime() + 60_000)),
        ),
    ).resolves.toBeDefined();
    expect(await expireHolds(database.db, redis, NOW)).toBe(0);
  });
});
