/**
 * Описание записи для сообщений врачу — в поясе офиса и на языке врача (§2.3, §9).
 * `locale` — язык врача этой записи: его выбор, иначе язык клиники. Все потребители
 * описания пишут врачу, поэтому язык здесь его, а не клиники. `clinicLocale` нужен
 * там, где сообщение уходит другому врачу (перенос записи): его выбор, иначе клиника.
 */
import { and, eq, sql } from 'drizzle-orm';
import {
  appointments,
  clinics,
  dentists,
  locations,
  patients,
  services,
  type Database,
} from '@dentbook/db';
import type { AppointmentStatus, Locale } from '@dentbook/shared/domain';

export interface AppointmentDetails {
  id: string;
  status: AppointmentStatus;
  /** Язык врача записи: dentists.locale, иначе clinics.locale. */
  locale: Locale;
  /** Язык клиники — запас для сообщений другому врачу. */
  clinicLocale: Locale;
  /** «Mon, Sep 21, 10:30 AM» в поясе офиса. */
  when: string;
  /** Пояс офиса (§2.3). */
  timeZone: string;
  service: string;
  office: string;
  client: string;
  phone: string;
  dentistId: string;
  dentistChatId: number | null;
  dentistBlocked: boolean;
}

export const formatWhen = (at: Date, timeZone: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);

export async function describeAppointment(
  db: Database,
  clinicId: string,
  appointmentId: string,
): Promise<AppointmentDetails | undefined> {
  const [row] = await db
    .select({
      id: appointments.id,
      status: appointments.status,
      startAt: appointments.startAt,
      locale: sql<string>`coalesce(${dentists.locale}, ${clinics.locale})`,
      clinicLocale: clinics.locale,
      zone: sql<string>`coalesce(${locations.timezone}, ${clinics.timezone})`,
      service: services.name,
      office: locations.name,
      client: patients.fullName,
      phone: patients.phone,
      dentistId: dentists.id,
      dentistChatId: dentists.telegramChatId,
      dentistBlocked: dentists.telegramBlocked,
    })
    .from(appointments)
    .innerJoin(clinics, eq(clinics.id, appointments.clinicId))
    .innerJoin(locations, eq(locations.id, appointments.locationId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(dentists, eq(dentists.id, appointments.dentistId))
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .where(and(eq(appointments.id, appointmentId), eq(appointments.clinicId, clinicId)));
  if (!row) return undefined;
  const locale = row.locale as Locale;
  const { startAt, zone, clinicLocale, ...rest } = row;
  return {
    ...rest,
    locale,
    clinicLocale: clinicLocale as Locale,
    timeZone: zone,
    when: formatWhen(startAt, zone, locale),
  };
}
