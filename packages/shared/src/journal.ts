/**
 * Контракт журнала регистратуры, карточки клиента и отчётов (Шаг 9, Q17). Внутренний,
 * как весь админский API, — camelCase.
 */
import { z } from 'zod';
import type { AppointmentSource, AppointmentStatus } from './domain.js';
import { instantSchema, localDateSchema } from './catalog.js';
import { emailSchema, nameSchema, phoneSchema, uuidSchema } from './validators.js';

/** Сколько дней журнала, отчёта или выгрузки можно запросить за раз. */
export const JOURNAL_MAX_DAYS = 31;
export const REPORT_MAX_DAYS = 366;

const dateRange = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ from: localDateSchema, to: localDateSchema, ...shape });

export const journalQuerySchema = dateRange({ locationId: uuidSchema });
export type JournalQuery = z.input<typeof journalQuerySchema>;

export interface JournalClient {
  id: string;
  fullName: string;
  phone: string;
}

export interface JournalAppointment {
  id: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  startAt: string;
  endAt: string;
  dentistId: string;
  serviceId: string;
  service: string;
  client: JournalClient | null;
  notes: string | null;
}

export interface JournalDentist {
  id: string;
  fullName: string;
  isActive: boolean;
  /** Рабочее время по датам диапазона (шаблон и extra в этом офисе), UTC. */
  working: { date: string; start: string; end: string }[];
}

export interface JournalBlock {
  id: string;
  dentistId: string;
  startAt: string;
  endAt: string;
  reason: string | null;
}

export interface JournalResponse {
  /** Пояс офиса: в нём рисуется сетка (§2.3). */
  timeZone: string;
  slotStepMin: number;
  dentists: JournalDentist[];
  blocks: JournalBlock[];
  appointments: JournalAppointment[];
}

/** Регистратура записывает клиента: врач и время выбраны, запись сразу подтверждена. */
export const staffBookingSchema = z.object({
  locationId: uuidSchema,
  serviceId: uuidSchema,
  dentistId: uuidSchema,
  startAt: instantSchema,
  client: z.object({
    fullName: nameSchema,
    phone: phoneSchema,
    email: emailSchema.optional(),
  }),
  notes: z.string().trim().max(1000).optional(),
});
export type StaffBookingInput = z.input<typeof staffBookingSchema>;
export type StaffBooking = z.output<typeof staffBookingSchema>;

/** Перенос: новое время и (в дневном виде) другой врач того же офиса. */
export const rescheduleSchema = z.object({
  startAt: instantSchema,
  dentistId: uuidSchema.optional(),
});
export type RescheduleInput = z.input<typeof rescheduleSchema>;

/** Отметка после визита. */
export const VISIT_OUTCOMES = ['completed', 'no_show'] as const;
export const visitOutcomeSchema = z.object({ status: z.enum(VISIT_OUTCOMES) });
export type VisitOutcomeInput = z.input<typeof visitOutcomeSchema>;

// --- клиенты (в БД — patients) ---

export const clientSearchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export interface ClientSummary {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  visits: number;
  lastVisitAt: string | null;
  nextVisitAt: string | null;
}

export interface ClientAppointment {
  id: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  startAt: string;
  timeZone: string;
  service: string;
  dentist: string;
  office: string;
}

export interface ClientCard {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  notes: string | null;
  createdAt: string;
  stats: { completed: number; noShow: number; cancelled: number; upcoming: number };
  appointments: ClientAppointment[];
}

export const updateClientSchema = z.object({
  fullName: nameSchema.optional(),
  email: emailSchema.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateClientInput = z.input<typeof updateClientSchema>;

// --- отчёты ---

export const reportQuerySchema = dateRange({ locationId: uuidSchema.optional() });
export type ReportQuery = z.input<typeof reportQuerySchema>;

export interface DashboardResponse {
  timeZone: string;
  from: string;
  to: string;
  /** Записи с визитом в периоде, кроме холдов. */
  bookings: { total: number; bySource: Record<AppointmentSource, number> };
  cancelled: number;
  noShow: number;
  completed: number;
  /** Загрузка: занятые записями минуты / рабочие минуты врача в периоде. */
  dentists: { id: string; fullName: string; workingMin: number; bookedMin: number }[];
  /** Ближайшие записи, которые ждут подтверждения. */
  pending: { id: string; startAt: string; dentist: string; client: string }[];
}
