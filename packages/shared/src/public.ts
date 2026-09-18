/**
 * Контракт публичного API /v1/public (CLAUDE.md §7). Имена полей — snake_case, как в §7
 * (hold_id, expires_at, service_id). Виджет берёт отсюда только типы: zod в его бандл
 * не попадает (бюджет 50 КБ gzip, Шаг 6).
 */
import { z } from 'zod';
import { LOCALES, type AppointmentStatus, type Locale } from './domain.js';
import { instantSchema, localDateSchema } from './catalog.js';
import { emailSchema, nameSchema, phoneSchema, uuidSchema } from './validators.js';

export const publicAvailabilityQuerySchema = z.object({
  service_id: uuidSchema,
  location_id: uuidSchema,
  from: localDateSchema,
  to: localDateSchema,
});
export type PublicAvailabilityQuery = z.input<typeof publicAvailabilityQuerySchema>;

export const createHoldSchema = z.object({
  service_id: uuidSchema,
  location_id: uuidSchema,
  /** Начало слота из GET /availability. */
  start_at: instantSchema,
});
export type CreateHoldInput = z.input<typeof createHoldSchema>;

export const createVerificationSchema = z.object({
  phone: phoneSchema,
  /** Язык SMS; по умолчанию — язык формы записи клиники. */
  locale: z.enum(LOCALES).optional(),
});
export type CreateVerificationInput = z.input<typeof createVerificationSchema>;

/** Код из SMS: 6 цифр. */
export const VERIFICATION_CODE_LENGTH = 6;

export const confirmAppointmentSchema = z.object({
  hold_id: uuidSchema,
  verification_id: uuidSchema,
  code: z.string().regex(/^\d{6}$/),
  client: z.object({
    full_name: nameSchema,
    phone: phoneSchema,
    email: emailSchema.optional(),
  }),
  notes: z.string().trim().max(1000).optional(),
});
export type ConfirmAppointmentInput = z.input<typeof confirmAppointmentSchema>;

/** Публичный токен записи: из ответа на подтверждение и из ссылок в SMS. */
export const appointmentTokenSchema = z.object({ token: z.string().min(16).max(128) });

// --- ответы ---

export interface PublicLocation {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  time_zone: string;
}

export interface PublicConfig {
  clinic: { name: string; locale: Locale; currency: string };
  /** Цвета и оформление формы (clinics.widget_theme). */
  theme: Record<string, unknown>;
  locations: PublicLocation[];
}

export interface PublicService {
  id: string;
  name: string;
  description: string | null;
  duration_min: number;
  /** Строка numeric или null — цену не показывать. */
  price: string | null;
  currency: string;
}

export interface PublicAvailability {
  time_zone: string;
  duration_min: number;
  /** Начала свободных слотов, ISO UTC, «любой врач» (§6). */
  days: { date: string; slots: string[] }[];
}

export interface HoldResponse {
  hold_id: string;
  expires_at: string;
  start_at: string;
  end_at: string;
  dentist: { id: string; full_name: string };
}

export interface VerificationResponse {
  verification_id: string;
  expires_at: string;
}

export interface PublicAppointment {
  id: string;
  status: AppointmentStatus;
  start_at: string;
  end_at: string;
  time_zone: string;
  service: { id: string; name: string };
  dentist: { id: string; full_name: string };
  location: { id: string; name: string; address: string | null };
}

/** Ответ на подтверждение: плюс токен для статуса и отмены. */
export interface ConfirmedAppointment extends PublicAppointment {
  token: string;
}

/** Тело 409 slot_taken: рядом с error — ближайшие свободные слоты того же дня (§2.1). */
export interface SlotTakenBody {
  error: { code: 'slot_taken'; message: string };
  alternatives: string[];
}
