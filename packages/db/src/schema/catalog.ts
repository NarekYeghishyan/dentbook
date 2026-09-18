import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { RESOURCE_KINDS } from '@dentbook/shared';
import { clinics, locations } from './clinics.js';
import { createdAt, oneOf, timestamptz, updatedAt } from './columns.js';

export const dentists = pgTable(
  'dentists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    fullName: text('full_name').notNull(),
    /** Меньше — выше приоритет при автоназначении (§6). */
    priority: integer('priority').notNull().default(100),
    isActive: boolean('is_active').notNull().default(true),
    /** В личном чате chat_id = user.id Telegram (§8). До 52 бит — безопасно для number. */
    telegramChatId: bigint('telegram_chat_id', { mode: 'number' }),
    telegramBlocked: boolean('telegram_blocked').notNull().default(false),
    telegramLinkedAt: timestamptz('telegram_linked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'dentists_clinic_id_fkey',
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    unique('dentists_clinic_id_id_key').on(t.clinicId, t.id),
    unique('dentists_telegram_chat_id_key').on(t.telegramChatId),
    index('dentists_clinic_priority_idx').on(t.clinicId, t.priority),
  ],
);

export const services = pgTable(
  'services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    durationMin: integer('duration_min').notNull(),
    bufferMin: integer('buffer_min').notNull().default(0),
    /** numeric → string: деньги без float (§9). NULL — цена не показывается. */
    price: numeric('price', { precision: 12, scale: 2 }),
    isPublic: boolean('is_public').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'services_clinic_id_fkey',
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    unique('services_clinic_id_id_key').on(t.clinicId, t.id),
    check('services_duration_min', sql`duration_min > 0`),
    check('services_buffer_min', sql`buffer_min >= 0`),
    check('services_price', sql`price IS NULL OR price >= 0`),
  ],
);

export const dentistServices = pgTable(
  'dentist_services',
  {
    clinicId: uuid('clinic_id').notNull(),
    dentistId: uuid('dentist_id').notNull(),
    serviceId: uuid('service_id').notNull(),
  },
  (t) => [
    primaryKey({ name: 'dentist_services_pkey', columns: [t.dentistId, t.serviceId] }),
    foreignKey({
      name: 'dentist_services_clinic_id_fkey',
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: 'dentist_services_dentist_fk',
      columns: [t.clinicId, t.dentistId],
      foreignColumns: [dentists.clinicId, dentists.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'dentist_services_service_fk',
      columns: [t.clinicId, t.serviceId],
      foreignColumns: [services.clinicId, services.id],
    }).onDelete('cascade'),
    index('dentist_services_service_idx').on(t.clinicId, t.serviceId),
  ],
);

/** Справочник ресурсов филиала, в записи не участвует (Q10: A). */
export const resources = pgTable(
  'resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    locationId: uuid('location_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: RESOURCE_KINDS }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'resources_clinic_id_fkey',
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    unique('resources_clinic_id_id_key').on(t.clinicId, t.id),
    check('resources_kind', oneOf('kind', RESOURCE_KINDS)),
    foreignKey({
      name: 'resources_location_fk',
      columns: [t.clinicId, t.locationId],
      foreignColumns: [locations.clinicId, locations.id],
    }),
  ],
);
