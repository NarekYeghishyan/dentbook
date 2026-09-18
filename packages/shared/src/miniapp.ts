/**
 * Контракт API Mini App врача /v1/miniapp (§8, Шаг 7): расписание, закрытие времени,
 * запись своих клиентов. Внутренний, как админский, — camelCase.
 */
import { z } from 'zod';
import type { AppointmentStatus, Locale } from './domain.js';
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
});

export const miniappBookingSchema = z.object({
  serviceId: uuidSchema,
  locationId: uuidSchema,
  startAt: instantSchema,
  client: z.object({ fullName: nameSchema, phone: phoneSchema }),
  notes: z.string().trim().max(1000).optional(),
});
export type MiniappBookingInput = z.input<typeof miniappBookingSchema>;

export interface MiniappMe {
  dentist: { id: string; fullName: string };
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
  service: string;
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

export interface MiniappSlots {
  timeZone: string;
  slots: string[];
}
