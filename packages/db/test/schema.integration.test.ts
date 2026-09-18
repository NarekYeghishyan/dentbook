import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { and, eq, inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BLOCKING_APPOINTMENT_STATUSES } from '@dentbook/shared';
import {
  PG_CHECK_VIOLATION,
  PG_EXCLUSION_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  appointments,
  blockedUntil,
  clinics,
  createDatabase,
  isExclusionViolation,
  locations,
  pgErrorCode,
  workingHours,
  type Database,
} from '../src/index.js';
import { DEMO_IDS, seedDemo } from '../src/seed/demo.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../src/migrations', import.meta.url));
const SCHEMA_SQL = fileURLToPath(new URL('../../../schema.sql', import.meta.url));

// Версия как в CLAUDE.md §3 и docker-compose.yml
const POSTGRES_IMAGE = 'postgres:16-alpine';
const CONCURRENT_BOOKINGS = 50;

let container: StartedPostgreSqlContainer;
let db: Database;
let pool: pg.Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  // Пул больше числа конкурентных попыток — все вставки идут в разных соединениях
  ({ db, pool } = createDatabase(container.getConnectionUri(), { max: CONCURRENT_BOOKINGS + 5 }));
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  await seedDemo(db);
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

const { clinic: clinicId, location: locationId } = DEMO_IDS;
const { anna, boris } = DEMO_IDS.dentists;
const { checkup } = DEMO_IDS.services;

/** Холд с буфером 10 мин: держит время до end + 10 мин (Q11). */
function hold(dentistId: string, startAt: string, endAt: string) {
  return {
    clinicId,
    locationId,
    dentistId,
    serviceId: checkup,
    startAt: new Date(startAt),
    endAt: new Date(endAt),
    bufferMin: 10,
    blockedUntil: blockedUntil(new Date(endAt), 10),
    status: 'hold' as const,
    holdExpiresAt: new Date('2030-01-01T00:00:00Z'),
    source: 'widget' as const,
  };
}

async function blockingCount(dentistId: string, startAt: string): Promise<number> {
  return db.$count(
    appointments,
    and(
      eq(appointments.clinicId, clinicId),
      eq(appointments.dentistId, dentistId),
      eq(appointments.startAt, new Date(startAt)),
      inArray(appointments.status, [...BLOCKING_APPOINTMENT_STATUSES]),
    ),
  );
}

describe('appointments_no_dentist_overlap (CLAUDE.md §2.1)', () => {
  const start = '2030-03-04T10:00:00Z';
  const end = '2030-03-04T10:30:00Z';

  it(`accepts exactly one of ${CONCURRENT_BOOKINGS} concurrent bookings of one slot`, async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: CONCURRENT_BOOKINGS }, () =>
        db.transaction((tx) =>
          tx
            .insert(appointments)
            .values(hold(anna, start, end))
            .returning({ id: appointments.id }),
        ),
      ),
    );

    const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
    const rejected = attempts.filter((a): a is PromiseRejectedResult => a.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(CONCURRENT_BOOKINGS - 1);
    expect(rejected.map((r) => pgErrorCode(r.reason))).toEqual(
      Array(CONCURRENT_BOOKINGS - 1).fill(PG_EXCLUSION_VIOLATION),
    );
    expect(await blockingCount(anna, start)).toBe(1);
  });

  it('rejects a partial overlap and accepts a slot that only touches the boundary', async () => {
    const overlap = db
      .insert(appointments)
      .values(hold(anna, '2030-03-04T10:15:00Z', '2030-03-04T10:45:00Z'));
    await expect(overlap).rejects.toSatisfy(isExclusionViolation);

    // Первая запись держит время до 10:40 — конец плюс буфер 10 мин
    await expect(
      db.insert(appointments).values(hold(anna, '2030-03-04T10:40:00Z', '2030-03-04T11:00:00Z')),
    ).resolves.toBeDefined();
  });

  it('protects the buffer after a visit, even in a race (Q11)', async () => {
    // Встык к концу приёма 10:30, но внутри буфера до 10:40
    const intoBuffer = db.insert(appointments).values(hold(boris, end, '2030-03-04T11:00:00Z'));
    await db.insert(appointments).values(hold(boris, start, end));
    await expect(intoBuffer).rejects.toSatisfy(isExclusionViolation);
  });

  it('rejects blocked_until that does not match end_at + buffer_min', async () => {
    const wrong = db.insert(appointments).values({
      ...hold(boris, '2030-03-06T10:00:00Z', '2030-03-06T10:30:00Z'),
      blockedUntil: new Date('2030-03-06T10:30:00Z'),
    });
    await expect(wrong).rejects.toSatisfy(
      (err: unknown) => pgErrorCode(err) === PG_CHECK_VIOLATION,
    );
  });

  it('lets another dentist take the same time', async () => {
    // Boris уже записан на это время в тесте про буфер
    expect(await blockingCount(boris, start)).toBe(1);
    expect(await blockingCount(anna, start)).toBe(1);
  });

  it('frees the slot once the hold expires', async () => {
    await db
      .update(appointments)
      .set({ status: 'expired' })
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          eq(appointments.dentistId, anna),
          eq(appointments.startAt, new Date(start)),
        ),
      );

    await expect(db.insert(appointments).values(hold(anna, start, end))).resolves.toBeDefined();
    expect(await blockingCount(anna, start)).toBe(1);
  });
});

describe('tenant isolation in the schema (CLAUDE.md §2.2)', () => {
  it('rejects an appointment that links a clinic to another clinic’s dentist', async () => {
    const [other] = await db
      .insert(clinics)
      .values({ name: 'Other clinic', timezone: 'UTC', currency: 'USD' })
      .returning({ id: clinics.id });
    const [otherLocation] = await db
      .insert(locations)
      .values({ clinicId: other!.id, name: 'Other office' })
      .returning({ id: locations.id });

    const crossTenant = db.insert(appointments).values({
      ...hold(anna, '2030-03-05T10:00:00Z', '2030-03-05T10:30:00Z'),
      clinicId: other!.id,
      locationId: otherLocation!.id,
    });

    await expect(crossTenant).rejects.toSatisfy(
      (err: unknown) => pgErrorCode(err) === PG_FOREIGN_KEY_VIOLATION,
    );
  });
});

describe('seed', () => {
  it('is idempotent', async () => {
    const countHours = () => db.$count(workingHours, eq(workingHours.clinicId, clinicId));
    const before = await countHours();

    await seedDemo(db);

    expect(before).toBe(13);
    expect(await countHours()).toBe(before);
  });
});

describe('migrations', () => {
  // Паритет с schema.sql (CLAUDE.md §5): те же таблицы, колонки, типы,
  // значения по умолчанию, ограничения, индексы и расширения.
  const SNAPSHOT_SQL = `
    select json_build_object(
      'extensions', (
        select json_agg(extname order by extname) from pg_extension where extname <> 'plpgsql'
      ),
      'columns', (
        select json_agg(row_to_json(c) order by c.table_name, c.column_name) from (
          select table_name, column_name, data_type, udt_name, is_nullable, column_default,
                 character_maximum_length, numeric_precision, numeric_scale
          from information_schema.columns
          where table_schema = 'public'
        ) c
      ),
      'constraints', (
        select json_agg(row_to_json(k) order by k.table_name, k.name) from (
          select conrelid::regclass::text as table_name, conname as name, contype as type,
                 pg_get_constraintdef(oid) as definition
          from pg_constraint
          where connamespace = 'public'::regnamespace
        ) k
      ),
      'indexes', (
        select json_agg(row_to_json(i) order by i.name) from (
          select indexname as name, indexdef as definition
          from pg_indexes
          where schemaname = 'public'
        ) i
      )
    ) as snapshot`;

  async function snapshot(client: pg.Pool | pg.Client): Promise<unknown> {
    const { rows } = await client.query<{ snapshot: unknown }>(SNAPSHOT_SQL);
    return rows[0]!.snapshot;
  }

  it('produce exactly the schema described in schema.sql', async () => {
    // Эталон — отдельная БД в том же контейнере, в которую применён schema.sql.
    // Это тестовая БД, а не рабочая: правило §9 о ручном SQL здесь не нарушается.
    await pool.query('create database reference');
    const referenceUrl = new URL(container.getConnectionUri());
    referenceUrl.pathname = '/reference';
    const reference = new pg.Client({ connectionString: referenceUrl.toString() });
    await reference.connect();
    try {
      await reference.query(readFileSync(SCHEMA_SQL, 'utf8'));
      expect(await snapshot(pool)).toEqual(await snapshot(reference));
    } finally {
      await reference.end();
    }
  });
});
