import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { services } from '../src/index.js';
import { startTestDatabase, type TestDatabase } from '../src/testing.js';
import { DEMO_IDS, seedDemo } from '../src/seed/demo.js';
import { FEE_SCHEDULE } from '../src/seed/fee-schedule.js';
import { importFeeSchedule } from '../src/seed/import-fee-schedule.js';

const TOTAL = FEE_SCHEDULE.reduce((n, c) => n + c.services.length, 0);

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestDatabase();
  await seedDemo(testDb.db);
}, 180_000);

afterAll(async () => {
  await testDb?.stop();
});

describe('fee schedule data', () => {
  it('has unique names and valid prices', () => {
    const names = FEE_SCHEDULE.flatMap((c) => c.services.map(([name]) => name.toLowerCase()));
    expect(new Set(names).size).toBe(names.length);
    for (const { services: rows } of FEE_SCHEDULE) {
      for (const [, price] of rows) expect(price).toBeGreaterThan(0);
    }
  });
});

describe('importFeeSchedule', () => {
  const clinicId = DEMO_IDS.clinic;

  it('creates hidden categorised services after the existing ones, in schedule order', async () => {
    const result = await importFeeSchedule(testDb.db, clinicId);
    expect(result).toEqual({ created: TOTAL, existing: 0 });

    const rows = await testDb.db
      .select()
      .from(services)
      .where(and(eq(services.clinicId, clinicId), eq(services.name, 'Crown – zirconia')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      category: 'Restorative',
      price: '950.00',
      insurancePrice: '1500.00',
      durationMin: 30,
      isPublic: false,
      oneTime: false,
    });
    // демо-услуги (sort_order 1–3) остались первыми и без категории
    const demo = await testDb.db
      .select()
      .from(services)
      .where(eq(services.id, DEMO_IDS.services.checkup));
    expect(demo[0]!.category).toBeNull();
    const all = await testDb.db.select().from(services).where(eq(services.clinicId, clinicId));
    const imported = all
      .filter((s) => s.category !== null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    expect(imported[0]!.name).toBe(FEE_SCHEDULE[0]!.services[0]![0]);
    expect(Math.min(...imported.map((s) => s.sortOrder))).toBeGreaterThan(3);
  });

  it('is re-runnable: nothing is duplicated and edits survive', async () => {
    await testDb.db
      .update(services)
      .set({ durationMin: 75, isPublic: true })
      .where(and(eq(services.clinicId, clinicId), eq(services.name, 'Core buildup')));
    await testDb.db
      .update(services)
      .set({ price: '999.00', insurancePrice: '1.00' })
      .where(and(eq(services.clinicId, clinicId), eq(services.name, 'Periodic exam')));
    const result = await importFeeSchedule(testDb.db, clinicId);
    expect(result).toEqual({ created: 0, existing: TOTAL });
    const [exam] = await testDb.db
      .select()
      .from(services)
      .where(and(eq(services.clinicId, clinicId), eq(services.name, 'Periodic exam')));
    expect(exam).toMatchObject({ price: '999.00', insurancePrice: '1.00' });
    const [row] = await testDb.db
      .select()
      .from(services)
      .where(and(eq(services.clinicId, clinicId), eq(services.name, 'Core buildup')));
    expect(row).toMatchObject({ durationMin: 75, isPublic: true });
  });

  it('fills an empty category and Insurance Fee of a same-named service', async () => {
    await testDb.db
      .update(services)
      .set({ category: null, insurancePrice: null })
      .where(and(eq(services.clinicId, clinicId), eq(services.name, 'Pulpotomy')));
    await importFeeSchedule(testDb.db, clinicId);
    const [row] = await testDb.db
      .select()
      .from(services)
      .where(and(eq(services.clinicId, clinicId), eq(services.name, 'Pulpotomy')));
    expect(row).toMatchObject({ category: 'Endodontics (Root Canals)', insurancePrice: '200.00' });
  });
});
