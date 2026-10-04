/**
 * Контракт журнала регистратуры, карточки клиента и отчётов (Шаг 9, Q17). Внутренний,
 * как весь админский API, — camelCase.
 */
import { z } from 'zod';
import type { AppointmentActor, AppointmentSource, AppointmentStatus } from './domain.js';
import { instantSchema, localDateSchema } from './catalog.js';
import {
  anyPhoneSchema,
  bookingDurationSchema,
  emailSchema,
  nameSchema,
  uuidSchema,
} from './validators.js';

/** Сколько дней журнала, отчёта или выгрузки можно запросить за раз. */
export const JOURNAL_MAX_DAYS = 31;
export const REPORT_MAX_DAYS = 366;

const dateRange = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ from: localDateSchema, to: localDateSchema, ...shape });

export const journalQuerySchema = dateRange({ locationId: uuidSchema });
export type JournalQuery = z.input<typeof journalQuerySchema>;

/** Статусы записей в журнале и истории клиента: холдов там нет. */
export type BookingStatus = Exclude<AppointmentStatus, 'hold' | 'expired'>;

export interface JournalClient {
  id: string;
  fullName: string;
  /** null — клиента записали без номера (врач в Mini App или регистратура). */
  phone: string | null;
  email: string | null;
}

export interface JournalAppointment {
  id: string;
  status: BookingStatus;
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

const staffClientSchema = z.object({
  fullName: nameSchema,
  /** Необязательный, в любом виде: пусто → клиент без номера. */
  phone: anyPhoneSchema,
  email: emailSchema.optional(),
});

/** Регистратура записывает клиента: врач и время выбраны, запись сразу подтверждена. */
export const staffBookingSchema = z.object({
  locationId: uuidSchema,
  serviceId: uuidSchema,
  dentistId: uuidSchema,
  startAt: instantSchema,
  /** Своя длительность этой записи; без неё — длительность услуги. */
  durationMin: bookingDurationSchema.optional(),
  client: staffClientSchema,
  notes: z.string().trim().max(1000).optional(),
});
export type StaffBookingInput = z.input<typeof staffBookingSchema>;
export type StaffBooking = z.output<typeof staffBookingSchema>;

/**
 * Правка записи регистратурой: перенос мышью (время и в дневном виде врач) или форма
 * «Изменить» — врач, услуга, время, длительность, клиент, заметки. Поля нет — оно не
 * меняется; что изменилось на самом деле, сервер решает сравнением с записью.
 */
export const appointmentUpdateSchema = z
  .object({
    startAt: instantSchema.optional(),
    dentistId: uuidSchema.optional(),
    serviceId: uuidSchema.optional(),
    /** Длительность этой записи; новая услуга без неё — длительность услуги. */
    durationMin: bookingDurationSchema.optional(),
    client: staffClientSchema.optional(),
    /** Пусто или null — убрать заметки. */
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'Nothing to change',
  });
export type AppointmentUpdateInput = z.input<typeof appointmentUpdateSchema>;
export type AppointmentUpdate = z.output<typeof appointmentUpdateSchema>;

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
  /** null — клиента записали без номера (врач в Mini App или регистратура). */
  phone: string | null;
  email: string | null;
  visits: number;
  lastVisitAt: string | null;
  nextVisitAt: string | null;
}

export interface ClientAppointment {
  id: string;
  status: BookingStatus;
  source: AppointmentSource;
  startAt: string;
  timeZone: string;
  service: string;
  dentist: string;
  office: string;
}

/**
 * Заметка о клиенте (Q19): написана в карточке клиента или к записи — регистратурой в
 * журнале, врачом в Mini App, клиентом на сайте. Её видят карточка клиента в панели и
 * врач в Mini App.
 */
export interface ClientNote {
  id: string;
  /** Когда написан нынешний текст. */
  at: string;
  /** Заметку к записи правили: текст не первый, автор — того, кто написал нынешний. */
  edited: boolean;
  text: string;
  author: AppointmentActor;
  /** Имя сотрудника или врача; null — клиент на сайте или сотрудник неизвестен. */
  authorName: string | null;
  /** Заметка к записи — к какому визиту; время показывать в поясе его офиса (§2.3). */
  appointment: { id: string; startAt: string; timeZone: string } | null;
}

export interface ClientCard {
  id: string;
  fullName: string;
  /** null — клиента записали без номера (врач в Mini App или регистратура). */
  phone: string | null;
  email: string | null;
  createdAt: string;
  stats: { completed: number; noShow: number; cancelled: number; upcoming: number };
  appointments: ClientAppointment[];
  /** История заметок, новые сверху. */
  notes: ClientNote[];
}

export const updateClientSchema = z.object({
  fullName: nameSchema.optional(),
  /**
   * Номер в любом виде, как при записи: читается как E.164 — приводится к нему; пусто —
   * клиент без номера. Без поля — номер не меняется. Номер другого клиента клиники — 409.
   */
  phone: anyPhoneSchema.optional(),
  email: emailSchema.nullable().optional(),
});
export type UpdateClientInput = z.input<typeof updateClientSchema>;
export type UpdateClient = z.output<typeof updateClientSchema>;

/** Длина заметки о клиенте; заметка к записи — до 1000 символов, она в эту длину входит. */
export const CLIENT_NOTE_MAX = 2000;

/** Новая заметка в карточке клиента: заметки только добавляются (Q19). */
export const clientNoteSchema = z.object({
  text: z.string().trim().min(1).max(CLIENT_NOTE_MAX),
});
export type ClientNoteInput = z.input<typeof clientNoteSchema>;

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
