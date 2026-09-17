/**
 * Допустимые значения перечислений предметной области.
 * В БД это text + CHECK (schema.sql, ADR-0003); здесь — единый источник для
 * Drizzle-схемы, zod-валидаторов, API и интерфейсов. Порядок и состав должны
 * совпадать с CHECK-ограничениями в schema.sql.
 */

export const CLINIC_STATUSES = ['active', 'suspended'] as const;
export type ClinicStatus = (typeof CLINIC_STATUSES)[number];

export const USER_ROLES = ['owner', 'admin', 'registrar', 'operator'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const RESOURCE_KINDS = ['room', 'chair', 'equipment'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const SCHEDULE_EXCEPTION_TYPES = ['block', 'extra'] as const;
export type ScheduleExceptionType = (typeof SCHEDULE_EXCEPTION_TYPES)[number];

export const APPOINTMENT_STATUSES = [
  'hold',
  'pending',
  'confirmed',
  'cancelled',
  'completed',
  'no_show',
  'expired',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Статусы, которые занимают время врача (§2.1). */
export const BLOCKING_APPOINTMENT_STATUSES = [
  'hold',
  'pending',
  'confirmed',
] as const satisfies readonly AppointmentStatus[];

export const APPOINTMENT_SOURCES = ['widget', 'admin', 'telegram'] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

export const CANCELLED_BY = ['client', 'clinic', 'dentist', 'system'] as const;
export type CancelledBy = (typeof CANCELLED_BY)[number];

export const NOTIFICATION_CHANNELS = ['sms', 'telegram'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_KINDS = [
  'appointment_created',
  'appointment_confirmed',
  'appointment_cancelled',
  'appointment_rescheduled',
  'reminder_24h',
  'reminder_2h',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_STATUSES = ['scheduled', 'sent', 'failed', 'cancelled'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
