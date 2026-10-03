/**
 * Контракт API Mini App врача /v1/miniapp (§8, Шаг 7): расписание, закрытие времени,
 * запись своих клиентов и правка своих записей. Внутренний, как админский, — camelCase.
 */
import { z } from 'zod';
import {
  CUSTOM_DURATION_MAX,
  CUSTOM_DURATION_MIN,
  LOCALES,
  type AppointmentStatus,
  type CancelledBy,
  type Locale,
} from './domain.js';
import { instantSchema, localDateSchema } from './catalog.js';
import { anyPhoneSchema, nameSchema, uuidSchema } from './validators.js';

export const scheduleQuerySchema = z.object({
  from: localDateSchema,
  to: localDateSchema,
  /** true — и отменённые записи: флажок «Показывать отменённые» в Mini App. */
  cancelled: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const miniappBlockSchema = z
  .object({
    startAt: instantSchema,
    endAt: instantSchema,
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.endAt > v.startAt, { message: 'End before start', path: ['endAt'] });
export type MiniappBlockInput = z.input<typeof miniappBlockSchema>;

const customDurationSchema = z.number().int().min(CUSTOM_DURATION_MIN).max(CUSTOM_DURATION_MAX);

/** Ровно одно из двух: услуга из каталога или разовая. */
const oneServiceOf = (v: { serviceId?: unknown }, custom: unknown) =>
  (v.serviceId === undefined) !== (custom === undefined);

export const miniappSlotsQuerySchema = z
  .object({
    serviceId: uuidSchema.optional(),
    /** Разовая услуга этой длительности — вместо serviceId. */
    durationMin: z.coerce.number().pipe(customDurationSchema).optional(),
    locationId: uuidSchema,
    date: localDateSchema,
    /** Время для переноса этой записи: её собственное время свободным не мешает. */
    appointmentId: uuidSchema.optional(),
  })
  .refine((v) => oneServiceOf(v, v.durationMin), {
    message: 'Pass serviceId or durationMin',
    path: ['serviceId'],
  });

/**
 * Врач записывает своего клиента: на услугу из каталога (serviceId) или на «Другое»
 * (customService) — длительность врач задаёт сам, только для этой записи.
 */
export const miniappBookingSchema = z
  .object({
    serviceId: uuidSchema.optional(),
    customService: z.object({ durationMin: customDurationSchema }).optional(),
    locationId: uuidSchema,
    startAt: instantSchema,
    client: z.object({ fullName: nameSchema, phone: anyPhoneSchema }),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((v) => oneServiceOf(v, v.customService), {
    message: 'Pass serviceId or customService',
    path: ['serviceId'],
  });
export type MiniappBookingInput = z.input<typeof miniappBookingSchema>;

/** Врач правит свою запись: клиента и комментарий. notes: null или '' — убрать. */
export const miniappAppointmentUpdateSchema = z
  .object({
    client: z.object({ fullName: nameSchema, phone: anyPhoneSchema }).optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => v.client !== undefined || v.notes !== undefined, {
    message: 'Nothing to change',
  });
export type MiniappAppointmentUpdateInput = z.input<typeof miniappAppointmentUpdateSchema>;

/** Перенос своей записи на другое свободное время — врач тот же. */
export const miniappMoveSchema = z.object({ startAt: instantSchema });
export type MiniappMoveInput = z.input<typeof miniappMoveSchema>;

/** Врач сам выбирает язык бота и Mini App (§8, §9): PATCH /v1/miniapp/me. */
export const miniappLocaleSchema = z.object({ locale: z.enum(LOCALES) });
export type MiniappLocaleInput = z.input<typeof miniappLocaleSchema>;

export interface MiniappMe {
  /** locale — выбранный врачом язык; null — не выбирал, язык берётся из Telegram или клиники. */
  dentist: { id: string; fullName: string; locale: Locale | null };
  clinic: { name: string; locale: Locale; timezone: string };
  locations: { id: string; name: string; timeZone: string }[];
  services: { id: string; name: string; durationMin: number }[];
}

export interface MiniappAppointment {
  id: string;
  status: AppointmentStatus;
  startAt: string;
  endAt: string;
  /** Пояс офиса — в нём показывать время (§2.3). */
  timeZone: string;
  serviceId: string;
  service: string;
  locationId: string;
  office: string;
  /** phone: null — клиент записан без номера. */
  client: { fullName: string; phone: string | null } | null;
  notes: string | null;
  source: string;
  /** Кто отменил — только у отменённой записи. */
  cancelledBy: CancelledBy | null;
}

export interface MiniappBlock {
  id: string;
  startAt: string;
  endAt: string;
  reason: string | null;
}

export interface MiniappSchedule {
  timeZone: string;
  appointments: MiniappAppointment[];
  blocks: MiniappBlock[];
}

/**
 * Занятое время в сетке: запись — одной клеткой на время начала (booked), закрытое
 * врачом время — тоже одной (closed).
 */
export interface MiniappBusyTime {
  startAt: string;
  kind: 'booked' | 'closed';
  /**
   * Запись на этой клетке — нажатие открывает её. Только у записи: у закрытого времени и
   * у холда (клиент как раз записывается на сайте) открывать нечего.
   */
  appointmentId?: string;
}

export interface MiniappSlots {
  timeZone: string;
  /** Свободное время — его можно выбрать. */
  slots: string[];
  busy: MiniappBusyTime[];
}
