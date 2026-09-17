import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { APPOINTMENT_SOURCES, APPOINTMENT_STATUSES, CANCELLED_BY } from '@dentbook/shared';
import { dentists, services } from './catalog.js';
import { clinics, locations, users } from './clinics.js';
import { citext, createdAt, e164, oneOf, timestamptz, updatedAt } from './columns.js';

/** Клиенты клиники; в интерфейсе — «client». ПДн: не логировать (§2.6). */
export const patients = pgTable(
  'patients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    fullName: text('full_name').notNull(),
    /** E.164 */
    phone: text('phone').notNull(),
    email: citext('email'),
    phoneVerifiedAt: timestamptz('phone_verified_at'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'patients_clinic_id_fkey',
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    unique('patients_clinic_id_id_key').on(t.clinicId, t.id),
    unique('patients_clinic_phone_key').on(t.clinicId, t.phone),
    check('patients_phone_e164', e164('phone')),
  ],
);

/**
 * Записи, включая холды (status = 'hold'). Ограничение
 * appointments_no_dentist_overlap (EXCLUDE USING gist, §2.1) Drizzle описать
 * не умеет — оно создаётся кастомной миграцией. Нарушение → SQLSTATE 23P01,
 * см. isExclusionViolation().
 */
export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    locationId: uuid('location_id').notNull(),
    dentistId: uuid('dentist_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    /** NULL, пока запись — холд. */
    patientId: uuid('patient_id'),
    startAt: timestamptz('start_at').notNull(),
    endAt: timestamptz('end_at').notNull(),
    /** Снимок services.buffer_min на момент записи. */
    bufferMin: integer('buffer_min').notNull().default(0),
    status: text('status', { enum: APPOINTMENT_STATUSES }).notNull(),
    holdExpiresAt: timestamptz('hold_expires_at'),
    source: text('source', { enum: APPOINTMENT_SOURCES }).notNull(),
    publicToken: text('public_token')
      .notNull()
      .default(sql`encode(gen_random_bytes(24), 'hex')`),
    notes: text('notes'),
    cancelledAt: timestamptz('cancelled_at'),
    cancelledBy: text('cancelled_by', { enum: CANCELLED_BY }),
    cancelReason: text('cancel_reason'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'appointments_clinic_id_fkey',
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: 'appointments_created_by_fkey',
      columns: [t.createdBy],
      foreignColumns: [users.id],
    }),
    unique('appointments_clinic_id_id_key').on(t.clinicId, t.id),
    unique('appointments_public_token_key').on(t.publicToken),
    check('appointments_range', sql`end_at > start_at`),
    check('appointments_buffer_min', sql`buffer_min >= 0`),
    check('appointments_status', oneOf('status', APPOINTMENT_STATUSES)),
    check('appointments_source', oneOf('source', APPOINTMENT_SOURCES)),
    check(
      'appointments_cancelled_by',
      sql`cancelled_by IS NULL OR ${oneOf('cancelled_by', CANCELLED_BY)}`,
    ),
    check('appointments_hold_has_expiry', sql`status <> 'hold' OR hold_expires_at IS NOT NULL`),
    check(
      'appointments_patient_required',
      sql`status IN ('hold', 'expired') OR patient_id IS NOT NULL`,
    ),
    check(
      'appointments_cancel_consistent',
      sql`(status = 'cancelled') = (cancelled_at IS NOT NULL)`,
    ),
    foreignKey({
      name: 'appointments_location_fk',
      columns: [t.clinicId, t.locationId],
      foreignColumns: [locations.clinicId, locations.id],
    }),
    foreignKey({
      name: 'appointments_dentist_fk',
      columns: [t.clinicId, t.dentistId],
      foreignColumns: [dentists.clinicId, dentists.id],
    }),
    foreignKey({
      name: 'appointments_service_fk',
      columns: [t.clinicId, t.serviceId],
      foreignColumns: [services.clinicId, services.id],
    }),
    foreignKey({
      name: 'appointments_patient_fk',
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }),
    index('appointments_clinic_start_idx').on(t.clinicId, t.startAt),
    index('appointments_dentist_start_idx').on(t.dentistId, t.startAt),
    index('appointments_patient_idx')
      .on(t.patientId)
      .where(sql`patient_id IS NOT NULL`),
    index('appointments_hold_expiry_idx')
      .on(t.holdExpiresAt)
      .where(sql`status = 'hold'`),
  ],
);

/** SMS-коды подтверждения телефона. code_hash — HMAC-SHA256 с серверным секретом. */
export const phoneVerifications = pgTable(
  'phone_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    phone: text('phone').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamptz('expires_at').notNull(),
    verifiedAt: timestamptz('verified_at'),
    consumedAt: timestamptz('consumed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'phone_verifications_clinic_id_fkey',
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    check('phone_verifications_phone_e164', e164('phone')),
    check('phone_verifications_attempts', sql`attempts >= 0`),
    check(
      'phone_verifications_consumed_verified',
      sql`consumed_at IS NULL OR verified_at IS NOT NULL`,
    ),
    index('phone_verifications_lookup_idx').on(
      t.clinicId,
      t.phone,
      t.createdAt.desc().nullsFirst(),
    ),
  ],
);
