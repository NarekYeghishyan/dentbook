/**
 * Контракт админского API /v1/admin: схемы входа и формы ответов.
 */
import { z } from 'zod';
import { LOCALES, STAFF_ROLES, type Locale, type UserRole } from './domain.js';
import {
  currencySchema,
  emailSchema,
  nameSchema,
  passwordSchema,
  timeZoneSchema,
} from './validators.js';

// --- auth ---

export const registerClinicSchema = z.object({
  clinicName: nameSchema,
  timezone: timeZoneSchema,
  currency: currencySchema,
  locale: z.enum(LOCALES).default('en'),
  fullName: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterClinicInput = z.input<typeof registerClinicSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  // Длину нового пароля не проверяем: вход должен работать и со старыми
  password: z.string().min(1).max(200),
});
export type LoginInput = z.input<typeof loginSchema>;

// --- клиника ---

export const updateClinicSchema = z
  .object({
    name: nameSchema,
    timezone: timeZoneSchema,
    locale: z.enum(LOCALES),
    currency: currencySchema,
    minLeadMin: z
      .number()
      .int()
      .min(0)
      .max(7 * 24 * 60),
    slotStepMin: z.number().int().min(5).max(240),
    maxAdvanceDays: z.number().int().min(1).max(365),
    bookingRequiresConfirmation: z.boolean(),
  })
  .partial();
export type UpdateClinicInput = z.input<typeof updateClinicSchema>;

// --- сотрудники ---

export const createUserSchema = z.object({
  fullName: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(STAFF_ROLES),
});
export type CreateUserInput = z.input<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    fullName: nameSchema,
    password: passwordSchema,
    role: z.enum(STAFF_ROLES),
    isActive: z.boolean(),
  })
  .partial();
export type UpdateUserInput = z.input<typeof updateUserSchema>;

// --- ответы ---

export interface ClinicSettings {
  id: string;
  name: string;
  timezone: string;
  locale: Locale;
  currency: string;
  minLeadMin: number;
  slotStepMin: number;
  maxAdvanceDays: number;
  bookingRequiresConfirmation: boolean;
}

export interface StaffUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  /** ISO 8601, UTC. */
  lastLoginAt: string | null;
}

export interface MeResponse {
  user: StaffUser;
  clinic: ClinicSettings;
}
