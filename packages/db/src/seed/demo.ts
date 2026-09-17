import { eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import {
  clinics,
  dentistServices,
  dentists,
  locations,
  services,
  workingHours,
} from '../schema/index.js';

/**
 * Демо-клиника для локальной разработки.
 * Фиксированные id — сид можно запускать повторно: существующие строки пропускаются.
 * Пояс Europe/Berlin выбран намеренно: в нём есть переход на летнее время.
 *
 * Пользователи админки и API-ключи сюда не входят — они появятся вместе с
 * хешированием паролей (Шаг 3) и выдачей ключей (Шаг 5).
 */
export const DEMO_IDS = {
  clinic: '00000000-0000-4000-8000-000000000001',
  location: '00000000-0000-4000-8000-000000000101',
  dentists: {
    anna: '00000000-0000-4000-8000-000000000201',
    boris: '00000000-0000-4000-8000-000000000202',
    clara: '00000000-0000-4000-8000-000000000203',
  },
  services: {
    checkup: '00000000-0000-4000-8000-000000000301',
    cleaning: '00000000-0000-4000-8000-000000000302',
    consultation: '00000000-0000-4000-8000-000000000303',
  },
} as const;

const WEEKDAYS = [1, 2, 3, 4, 5] as const;

export async function seedDemo(db: Database): Promise<void> {
  const clinicId = DEMO_IDS.clinic;
  const locationId = DEMO_IDS.location;
  const { anna, boris, clara } = DEMO_IDS.dentists;
  const { checkup, cleaning, consultation } = DEMO_IDS.services;

  await db.transaction(async (tx) => {
    await tx
      .insert(clinics)
      .values({
        id: clinicId,
        name: 'Demo Dental',
        timezone: 'Europe/Berlin',
        locale: 'en',
        currency: 'EUR',
      })
      .onConflictDoNothing();

    await tx
      .insert(locations)
      .values({ id: locationId, clinicId, name: 'Main office', address: 'Demo street 1' })
      .onConflictDoNothing();

    await tx
      .insert(dentists)
      .values([
        { id: anna, clinicId, fullName: 'Anna Demo', priority: 10 },
        { id: boris, clinicId, fullName: 'Boris Demo', priority: 20 },
        { id: clara, clinicId, fullName: 'Clara Demo', priority: 30 },
      ])
      .onConflictDoNothing();

    await tx
      .insert(services)
      .values([
        {
          id: checkup,
          clinicId,
          name: 'Checkup',
          durationMin: 30,
          bufferMin: 10,
          price: '50.00',
          sortOrder: 1,
        },
        {
          id: cleaning,
          clinicId,
          name: 'Professional cleaning',
          durationMin: 60,
          bufferMin: 15,
          price: '90.00',
          sortOrder: 2,
        },
        {
          id: consultation,
          clinicId,
          name: 'Consultation',
          durationMin: 20,
          bufferMin: 0,
          price: null,
          sortOrder: 3,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(dentistServices)
      .values([
        { clinicId, dentistId: anna, serviceId: checkup },
        { clinicId, dentistId: anna, serviceId: consultation },
        { clinicId, dentistId: boris, serviceId: checkup },
        { clinicId, dentistId: boris, serviceId: cleaning },
        { clinicId, dentistId: clara, serviceId: cleaning },
        { clinicId, dentistId: clara, serviceId: consultation },
      ])
      .onConflictDoNothing();

    // У working_hours нет естественного ключа — вставляем, только если у врачей
    // демо-клиники ещё нет расписания.
    const existing = await tx.$count(workingHours, eq(workingHours.clinicId, clinicId));
    if (existing === 0) {
      await tx.insert(workingHours).values([
        // Анна и Борис: пн–пт 09:00–18:00
        ...[anna, boris].flatMap((dentistId) =>
          WEEKDAYS.map((weekday) => ({
            clinicId,
            dentistId,
            locationId,
            weekday,
            startTime: '09:00',
            endTime: '18:00',
          })),
        ),
        // Клара: вт и чт 12:00–20:00, пт — смена через полночь 20:00–02:00
        {
          clinicId,
          dentistId: clara,
          locationId,
          weekday: 2,
          startTime: '12:00',
          endTime: '20:00',
        },
        {
          clinicId,
          dentistId: clara,
          locationId,
          weekday: 4,
          startTime: '12:00',
          endTime: '20:00',
        },
        {
          clinicId,
          dentistId: clara,
          locationId,
          weekday: 5,
          startTime: '20:00',
          endTime: '02:00',
        },
      ]);
    }
  });
}
