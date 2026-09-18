/**
 * Контракт админского API для данных клиники: филиалы, врачи, услуги, расписание,
 * календарь доступности (Шаг 4).
 */
import { z } from 'zod';
import { SCHEDULE_EXCEPTION_TYPES, type ScheduleExceptionType } from './domain.js';
import { nameSchema, timeZoneSchema, uuidSchema } from './validators.js';

/** Необязательный текст: пустая строка из формы — это «нет значения». */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === '' ? null : v));

/** Календарная дата 'YYYY-MM-DD'. */
export const localDateSchema = z.iso.date();

/** Время 'HH:MM' (24 ч); '24:00' не принимается — конец суток пишется как '00:00'. */
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

/** Момент времени с явным смещением: '2026-03-02T09:00:00Z' или '...+04:00'. */
export const instantSchema = z.iso.datetime({ offset: true }).transform((v) => new Date(v));

/** Деньги — строкой, без float (§9): '120', '120.5', '120.50'. */
export const priceSchema = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'Decimal, e.g. 120.00');

// --- филиалы (в интерфейсе — «office») ---

export const createLocationSchema = z.object({
  name: nameSchema,
  address: optionalText(500).optional(),
  phone: optionalText(50).optional(),
  /** null — пояс клиники (§2.3). */
  timezone: timeZoneSchema.nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type CreateLocationInput = z.input<typeof createLocationSchema>;

export const updateLocationSchema = createLocationSchema.partial();
export type UpdateLocationInput = z.input<typeof updateLocationSchema>;

export interface Location {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  timezone: string | null;
  isActive: boolean;
  sortOrder: number;
}

// --- услуги ---

export const createServiceSchema = z.object({
  name: nameSchema,
  description: optionalText(2000).optional(),
  durationMin: z
    .number()
    .int()
    .min(5)
    .max(8 * 60),
  bufferMin: z
    .number()
    .int()
    .min(0)
    .max(4 * 60)
    .optional(),
  price: priceSchema.nullable().optional(),
  isPublic: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type CreateServiceInput = z.input<typeof createServiceSchema>;

export const updateServiceSchema = createServiceSchema.partial();
export type UpdateServiceInput = z.input<typeof updateServiceSchema>;

export interface Service {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  bufferMin: number;
  /** Строка numeric(12,2) или null — цена не показывается. */
  price: string | null;
  isPublic: boolean;
  isActive: boolean;
  sortOrder: number;
}

// --- врачи ---

export const createDentistSchema = z.object({
  fullName: nameSchema,
  isActive: z.boolean().optional(),
});
export type CreateDentistInput = z.input<typeof createDentistSchema>;

export const updateDentistSchema = createDentistSchema.partial();
export type UpdateDentistInput = z.input<typeof updateDentistSchema>;

/** Новый порядок врачей: первый — наивысший приоритет (§6). Нужны все врачи клиники. */
export const reorderDentistsSchema = z.object({
  dentistIds: z.array(uuidSchema).min(1).max(500),
});
export type ReorderDentistsInput = z.input<typeof reorderDentistsSchema>;

export const dentistServicesSchema = z.object({
  serviceIds: z.array(uuidSchema).max(500),
});
export type DentistServicesInput = z.input<typeof dentistServicesSchema>;

export interface Dentist {
  id: string;
  fullName: string;
  /** Меньше — выше приоритет. */
  priority: number;
  isActive: boolean;
  serviceIds: string[];
  telegramLinked: boolean;
}

// --- рабочие часы ---

export const workingHoursItemSchema = z
  .object({
    locationId: uuidSchema,
    /** ISO 8601: 1 — понедельник … 7 — воскресенье; день начала смены. */
    weekday: z.number().int().min(1).max(7),
    startTime: timeOfDaySchema,
    /** Меньше startTime — смена через полночь. */
    endTime: timeOfDaySchema,
  })
  .refine((v) => v.startTime !== v.endTime, {
    message: 'Empty shift',
    path: ['endTime'],
  });

/** Недельный шаблон врача целиком: PUT заменяет все строки. */
export const workingHoursSchema = z.object({
  items: z.array(workingHoursItemSchema).max(100),
});
export type WorkingHoursInput = z.input<typeof workingHoursSchema>;

export interface WorkingHoursItem {
  id: string;
  locationId: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

// --- исключения расписания ---

export const createExceptionSchema = z
  .object({
    type: z.enum(SCHEDULE_EXCEPTION_TYPES),
    startAt: instantSchema,
    endAt: instantSchema,
    /** Обязателен для extra: дополнительное время проходит в конкретном филиале. */
    locationId: uuidSchema.nullable().optional(),
    reason: optionalText(500).optional(),
  })
  .refine((v) => v.endAt > v.startAt, { message: 'End before start', path: ['endAt'] })
  .refine((v) => v.type === 'block' || v.locationId, {
    message: 'Required for extra',
    path: ['locationId'],
  });
export type CreateExceptionInput = z.input<typeof createExceptionSchema>;

export const exceptionRangeSchema = z
  .object({ from: instantSchema, to: instantSchema })
  .refine((v) => v.to > v.from, { message: 'Empty range', path: ['to'] });

export interface ScheduleExceptionItem {
  id: string;
  type: ScheduleExceptionType;
  startAt: string;
  endAt: string;
  locationId: string | null;
  reason: string | null;
}

/** Запись, из-за которой нельзя закрыть время (§8): её сначала переносят. */
export interface ConflictingAppointment {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
}

// --- календарь доступности ---

/** Сколько дней можно запросить за раз. */
export const AVAILABILITY_MAX_DAYS = 31;

export const availabilityQuerySchema = z.object({
  serviceId: uuidSchema,
  locationId: uuidSchema,
  /** Без врача — «любой врач» (§6). */
  dentistId: uuidSchema.optional(),
  from: localDateSchema,
  to: localDateSchema,
});
export type AvailabilityQuery = z.input<typeof availabilityQuerySchema>;

export interface AvailabilitySlot {
  /** ISO 8601, UTC. */
  start: string;
  /** Свободные в это время врачи, по приоритету. */
  dentistIds: string[];
}

export interface AvailabilityDay {
  /** Местная дата филиала. */
  date: string;
  slots: AvailabilitySlot[];
}

export interface AvailabilityResponse {
  /** Пояс, в котором показывать время (§2.3). */
  timeZone: string;
  durationMin: number;
  days: AvailabilityDay[];
}
