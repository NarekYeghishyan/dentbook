/** Строки БД → ответы админского API. Хеш пароля наружу не уходит никогда. */
import { eq } from 'drizzle-orm';
import { clinics, users, type Database } from '@dentbook/db';
import type { ClinicSettings, Locale, StaffUser } from '@dentbook/shared';
import { notFound } from '../../lib/errors.js';

export const staffColumns = {
  id: users.id,
  email: users.email,
  fullName: users.fullName,
  role: users.role,
  isActive: users.isActive,
  lastLoginAt: users.lastLoginAt,
};

type StaffRow = Pick<typeof users.$inferSelect, keyof typeof staffColumns>;

export const toStaffUser = (row: StaffRow): StaffUser => ({
  ...row,
  lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
});

export const clinicColumns = {
  id: clinics.id,
  name: clinics.name,
  timezone: clinics.timezone,
  locale: clinics.locale,
  currency: clinics.currency,
  minLeadMin: clinics.minLeadMin,
  slotStepMin: clinics.slotStepMin,
  maxAdvanceDays: clinics.maxAdvanceDays,
  bookingRequiresConfirmation: clinics.bookingRequiresConfirmation,
};

type ClinicRow = Pick<typeof clinics.$inferSelect, keyof typeof clinicColumns>;

// locale ограничен LOCALES на входе (zod), CHECK в БД — только формат
export const toClinicSettings = (row: ClinicRow): ClinicSettings => ({
  ...row,
  locale: row.locale as Locale,
});

export async function loadClinic(db: Database, clinicId: string): Promise<ClinicSettings> {
  const [row] = await db.select(clinicColumns).from(clinics).where(eq(clinics.id, clinicId));
  if (!row) throw notFound();
  return toClinicSettings(row);
}
