/**
 * Контракт API Mini App врача /v1/miniapp (§8, Шаг 7): расписание, закрытие времени,
 * запись своих клиентов и правка своих записей. Внутренний, как админский, — camelCase.
 */
import { z } from 'zod';
import { LOCALES, type AppointmentStatus, type Locale } from './domain.js';
import { instantSchema, localDateSchema } from './catalog.js';
import { nameSchema, phoneSchema, uuidSchema } from './validators.js';

export const scheduleQuerySchema = z.object({ from: localDateSchema, to: localDateSchema });

export const miniappBlockSchema = z
  .object({
    startAt: instantSchema,
    endAt: instantSchema,
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.endAt > v.startAt, { message: 'End before start', path: ['endAt'] });
export type MiniappBlockInput = z.input<typeof miniappBlockSchema>;

export const miniappSlotsQuerySchema = z.object({
  serviceId: uuidSchema,
  locationId: uuidSchema,
  date: localDateSchema,
  /** Время для переноса этой записи: её собственное время свободным не мешает. */
  appointmentId: uuidSchema.optional(),
});

export const miniappBookingSchema = z.object({
  serviceId: uuidSchema,
  locationId: uuidSchema,
  startAt: instantSchema,
  client: z.object({ fullName: nameSchema, phone: phoneSchema }),
  notes: z.string().trim().max(1000).optional(),
});
export type MiniappBookingInput = z.input<typeof miniappBookingSchema>;

/** Врач правит свою запись: клиента и комментарий. notes: null или '' — убрать. */
export const miniappAppointmentUpdateSchema = z
  .object({
    client: z.object({ fullName: nameSchema, phone: phoneSchema }).optional(),
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
  client: { fullName: string; phone: string } | null;
  notes: string | null;
  source: string;
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
}

export interface MiniappSlots {
  timeZone: string;
  /** Свободное время — его можно выбрать. */
  slots: string[];
  busy: MiniappBusyTime[];
}
