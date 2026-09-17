import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, smallint, text, time, uuid } from 'drizzle-orm/pg-core';
import { SCHEDULE_EXCEPTION_TYPES } from '@dentbook/shared';
import { dentists } from './catalog.js';
import { clinics, locations, users } from './clinics.js';
import { createdAt, oneOf, timestamptz, updatedAt } from './columns.js';

/**
 * Недельный шаблон рабочего времени. Время настенное, в поясе филиала
 * (или клиники): перевод в UTC на конкретную дату — в коде, до computeSlots.
 * end_time <= start_time — смена через полночь.
 */
export const workingHours = pgTable(
  'working_hours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    dentistId: uuid('dentist_id').notNull(),
    locationId: uuid('location_id').notNull(),
    /** ISO 8601: 1 — понедельник, 7 — воскресенье. День начала смены. */
    weekday: smallint('weekday').notNull(),
    /** 'HH:MM:SS' */
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'working_hours_clinic_id_fkey',
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    check('working_hours_weekday', sql`weekday BETWEEN 1 AND 7`),
    check('working_hours_not_empty', sql`start_time <> end_time`),
    foreignKey({
      name: 'working_hours_dentist_fk',
      columns: [t.clinicId, t.dentistId],
      foreignColumns: [dentists.clinicId, dentists.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'working_hours_location_fk',
      columns: [t.clinicId, t.locationId],
      foreignColumns: [locations.clinicId, locations.id],
    }),
    index('working_hours_dentist_idx').on(t.dentistId, t.weekday),
  ],
);

/**
 * Разовые изменения расписания: block — закрыть время, extra — добавить.
 * gist-индекс по (dentist_id, tstzrange) создаётся кастомной миграцией.
 */
export const scheduleExceptions = pgTable(
  'schedule_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    dentistId: uuid('dentist_id').notNull(),
    /** Обязателен для extra. */
    locationId: uuid('location_id'),
    type: text('type', { enum: SCHEDULE_EXCEPTION_TYPES }).notNull(),
    startAt: timestamptz('start_at').notNull(),
    endAt: timestamptz('end_at').notNull(),
    reason: text('reason'),
    /** NULL — создано врачом через Telegram. */
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'schedule_exceptions_clinic_id_fkey',
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: 'schedule_exceptions_created_by_fkey',
      columns: [t.createdBy],
      foreignColumns: [users.id],
    }),
    check('schedule_exceptions_type', oneOf('type', SCHEDULE_EXCEPTION_TYPES)),
    check('schedule_exceptions_range', sql`end_at > start_at`),
    check('schedule_exceptions_extra_location', sql`type = 'block' OR location_id IS NOT NULL`),
    foreignKey({
      name: 'schedule_exceptions_dentist_fk',
      columns: [t.clinicId, t.dentistId],
      foreignColumns: [dentists.clinicId, dentists.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'schedule_exceptions_location_fk',
      columns: [t.clinicId, t.locationId],
      foreignColumns: [locations.clinicId, locations.id],
    }),
  ],
);
