import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { NOTIFICATION_CHANNELS, NOTIFICATION_KINDS, NOTIFICATION_STATUSES } from '@dentbook/shared';
import { appointments, patients } from './booking.js';
import { dentists } from './catalog.js';
import { clinics, users } from './clinics.js';
import { createdAt, oneOf, timestamptz, updatedAt } from './columns.js';

/** Журнал исходящих уведомлений. Текст не хранится — в нём ПДн. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    appointmentId: uuid('appointment_id'),
    channel: text('channel', { enum: NOTIFICATION_CHANNELS }).notNull(),
    kind: text('kind', { enum: NOTIFICATION_KINDS }).notNull(),
    /** Получатель — ровно один из patientId / dentistId. */
    patientId: uuid('patient_id'),
    dentistId: uuid('dentist_id'),
    status: text('status', { enum: NOTIFICATION_STATUSES }).notNull().default('scheduled'),
    scheduledFor: timestamptz('scheduled_for').notNull().defaultNow(),
    /** id задачи BullMQ — для снятия напоминания при отмене записи. */
    jobId: text('job_id'),
    attempts: integer('attempts').notNull().default(0),
    /** Только код/класс ошибки провайдера, без ПДн. */
    lastError: text('last_error'),
    providerMessageId: text('provider_message_id'),
    sentAt: timestamptz('sent_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'notifications_clinic_id_fkey',
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    check('notifications_channel', oneOf('channel', NOTIFICATION_CHANNELS)),
    check('notifications_kind', oneOf('kind', NOTIFICATION_KINDS)),
    check('notifications_status', oneOf('status', NOTIFICATION_STATUSES)),
    check('notifications_one_recipient', sql`num_nonnulls(patient_id, dentist_id) = 1`),
    check('notifications_attempts', sql`attempts >= 0`),
    foreignKey({
      name: 'notifications_appointment_fk',
      columns: [t.clinicId, t.appointmentId],
      foreignColumns: [appointments.clinicId, appointments.id],
    }),
    foreignKey({
      name: 'notifications_patient_fk',
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }),
    foreignKey({
      name: 'notifications_dentist_fk',
      columns: [t.clinicId, t.dentistId],
      foreignColumns: [dentists.clinicId, dentists.id],
    }),
    index('notifications_due_idx')
      .on(t.scheduledFor)
      .where(sql`status = 'scheduled'`),
    index('notifications_appointment_idx')
      .on(t.appointmentId)
      .where(sql`appointment_id IS NOT NULL`),
    uniqueIndex('notifications_reminder_once_idx')
      .on(t.appointmentId, t.kind, t.channel, sql`coalesce(patient_id, dentist_id)`)
      .where(sql`kind IN ('reminder_24h', 'reminder_2h') AND status <> 'cancelled'`),
  ],
);

/** Одноразовые токены привязки врача к Telegram. Хранится только SHA-256 (hex). */
export const telegramLinkTokens = pgTable(
  'telegram_link_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    clinicId: uuid('clinic_id').notNull(),
    dentistId: uuid('dentist_id').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'telegram_link_tokens_clinic_id_fkey',
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: 'telegram_link_tokens_created_by_fkey',
      columns: [t.createdBy],
      foreignColumns: [users.id],
    }),
    check('telegram_link_tokens_hash_format', sql`token_hash ~ '^[0-9a-f]{64}$'`),
    check('telegram_link_tokens_expiry', sql`expires_at > created_at`),
    foreignKey({
      name: 'telegram_link_tokens_dentist_fk',
      columns: [t.clinicId, t.dentistId],
      foreignColumns: [dentists.clinicId, dentists.id],
    }).onDelete('cascade'),
    index('telegram_link_tokens_dentist_idx').on(t.dentistId),
  ],
);

/** Дедупликация вебхука. Бот один на платформу — clinic_id нет (ADR-0003). */
export const telegramUpdates = pgTable('telegram_updates', {
  updateId: bigint('update_id', { mode: 'number' }).primaryKey(),
  receivedAt: timestamptz('received_at').notNull().defaultNow(),
});
