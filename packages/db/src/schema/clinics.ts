import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { CLINIC_STATUSES, USER_ROLES } from '@dentbook/shared';
import { citext, createdAt, oneOf, timestamptz, updatedAt } from './columns.js';

// Имена таблиц, колонок и ограничений совпадают со schema.sql (CLAUDE.md §5).
// Паритет проверяет packages/db/test/schema.integration.test.ts.

export const clinics = pgTable(
  'clinics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull(),
    locale: text('locale').notNull().default('en'),
    currency: char('currency', { length: 3 }).notNull(),
    minLeadMin: integer('min_lead_min').notNull().default(120),
    slotStepMin: integer('slot_step_min').notNull().default(15),
    maxAdvanceDays: integer('max_advance_days').notNull().default(60),
    bookingRequiresConfirmation: boolean('booking_requires_confirmation').notNull().default(false),
    widgetTheme: jsonb('widget_theme')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text('status', { enum: CLINIC_STATUSES }).notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check('clinics_locale_format', sql`locale ~ '^[a-z]{2}(-[A-Z]{2})?$'`),
    check('clinics_currency_format', sql`currency ~ '^[A-Z]{3}$'`),
    check('clinics_min_lead_min', sql`min_lead_min >= 0`),
    check('clinics_slot_step_min', sql`slot_step_min > 0`),
    check('clinics_max_advance_days', sql`max_advance_days > 0`),
    check('clinics_status', oneOf('status', CLINIC_STATUSES)),
  ],
);

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    phone: text('phone'),
    /** NULL — пояс клиники (§2.3). */
    timezone: text('timezone'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'locations_clinic_id_fkey',
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    unique('locations_clinic_id_id_key').on(t.clinicId, t.id),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** NULL только у оператора платформы. */
    clinicId: uuid('clinic_id'),
    email: citext('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    role: text('role', { enum: USER_ROLES }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamptz('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'users_clinic_id_fkey',
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    unique('users_email_key').on(t.email),
    check('users_role', oneOf('role', USER_ROLES)),
    check('users_operator_has_no_clinic', sql`(role = 'operator') = (clinic_id IS NULL)`),
    index('users_clinic_idx').on(t.clinicId),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    name: text('name').notNull(),
    /** Публикуемый ключ pk_* (§2.5). */
    token: text('token').notNull(),
    /** Пустой массив — запрещены все Origin. */
    allowedOrigins: text('allowed_origins')
      .array()
      .notNull()
      .default(sql`'{}'`),
    lastUsedAt: timestamptz('last_used_at'),
    revokedAt: timestamptz('revoked_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'api_keys_clinic_id_fkey',
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: 'api_keys_created_by_fkey',
      columns: [t.createdBy],
      foreignColumns: [users.id],
    }),
    unique('api_keys_token_key').on(t.token),
    check('api_keys_token_prefix', sql`token LIKE 'pk\\_%'`),
    index('api_keys_clinic_idx').on(t.clinicId),
  ],
);
