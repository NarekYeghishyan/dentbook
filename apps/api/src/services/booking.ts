/**
 * Подтверждение записи по холду и SMS-коду, статус и отмена клиентом (§7).
 * Холд переходит в pending или confirmed — по настройке клиники (Q9, Q12).
 */
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  appointments,
  clinics,
  dentists,
  locations,
  patients,
  services,
  type Database,
} from '@dentbook/db';
import type {
  ConfirmAppointmentInput,
  ConfirmedAppointment,
  PublicAppointment,
} from '@dentbook/shared';
import { ApiError, notFound } from '../lib/errors.js';
import type { Notifier } from './notifier.js';
import type { SlotCache } from './slot-cache.js';
import { checkCode, consumeVerification } from './verification.js';

export const holdExpired = () =>
  new ApiError(410, 'hold_expired', 'The reserved time has expired; choose a time again');

async function loadAppointment(
  db: Database,
  clinicId: string,
  id: string,
  token?: string,
): Promise<{ appointment: PublicAppointment; token: string }> {
  const [row] = await db
    .select({
      id: appointments.id,
      status: appointments.status,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      token: appointments.publicToken,
      serviceId: services.id,
      serviceName: services.name,
      dentistId: dentists.id,
      dentistName: dentists.fullName,
      locationId: locations.id,
      locationName: locations.name,
      address: locations.address,
      zone: sql<string>`coalesce(${locations.timezone}, ${clinics.timezone})`,
    })
    .from(appointments)
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(dentists, eq(dentists.id, appointments.dentistId))
    .innerJoin(locations, eq(locations.id, appointments.locationId))
    .innerJoin(clinics, eq(clinics.id, appointments.clinicId))
    .where(
      and(
        eq(appointments.id, id),
        eq(appointments.clinicId, clinicId),
        token === undefined ? undefined : eq(appointments.publicToken, token),
        // Холд — ещё не запись: по публичному адресу его не видно
        inArray(appointments.status, ['pending', 'confirmed', 'cancelled', 'completed', 'no_show']),
      ),
    );
  if (!row) throw notFound();
  return {
    appointment: {
      id: row.id,
      status: row.status,
      start_at: row.startAt.toISOString(),
      end_at: row.endAt.toISOString(),
      time_zone: row.zone,
      service: { id: row.serviceId, name: row.serviceName },
      dentist: { id: row.dentistId, full_name: row.dentistName },
      location: { id: row.locationId, name: row.locationName, address: row.address },
    },
    token: row.token,
  };
}

export async function confirmAppointment(
  db: Database,
  input: ConfirmAppointmentInput,
  params: { clinicId: string; now: Date; key: Buffer; notifier: Notifier },
): Promise<ConfirmedAppointment> {
  const { clinicId, now } = params;
  await checkCode(db, {
    clinicId,
    verificationId: input.verification_id,
    phone: input.client.phone,
    code: input.code,
    now,
    key: params.key,
  });

  const id = await db.transaction(async (tx) => {
    await consumeVerification(tx, { clinicId, verificationId: input.verification_id, now });
    const [clinic] = await tx
      .select({ requiresConfirmation: clinics.bookingRequiresConfirmation })
      .from(clinics)
      .where(eq(clinics.id, clinicId));
    // Клиент в клинике определяется телефоном (Q9): повторная запись — та же карточка
    const [patient] = await tx
      .insert(patients)
      .values({
        clinicId,
        fullName: input.client.full_name,
        phone: input.client.phone,
        email: input.client.email ?? null,
        phoneVerifiedAt: now,
      })
      .onConflictDoUpdate({
        target: [patients.clinicId, patients.phone],
        set: {
          fullName: sql`excluded.full_name`,
          email: sql`coalesce(excluded.email, ${patients.email})`,
          phoneVerifiedAt: now,
        },
      })
      .returning({ id: patients.id });
    const [appointment] = await tx
      .update(appointments)
      .set({
        status: clinic!.requiresConfirmation ? 'pending' : 'confirmed',
        patientId: patient!.id,
        holdExpiresAt: null,
        notes: input.notes ?? null,
      })
      .where(
        and(
          eq(appointments.id, input.hold_id),
          eq(appointments.clinicId, clinicId),
          eq(appointments.status, 'hold'),
          gt(appointments.holdExpiresAt, now),
        ),
      )
      .returning({ id: appointments.id });
    // Холд истёк или его уже подтвердили: откат, код не расходуется
    if (!appointment) throw holdExpired();
    return appointment.id;
  });
  await params.notifier.appointmentCreated(clinicId, id);
  const { appointment, token } = await loadAppointment(db, clinicId, id);
  return { ...appointment, token };
}

export async function getAppointment(
  db: Database,
  params: { clinicId: string; id: string; token: string },
): Promise<PublicAppointment> {
  const { appointment } = await loadAppointment(db, params.clinicId, params.id, params.token);
  return appointment;
}

/** Отмена клиентом по токену: только будущая pending/confirmed запись. Повтор — без ошибки. */
export async function cancelAppointment(
  db: Database,
  cache: SlotCache | undefined,
  params: { clinicId: string; id: string; token: string; now: Date; notifier: Notifier },
): Promise<PublicAppointment> {
  const { clinicId, id, token, now } = params;
  const [row] = await db
    .update(appointments)
    .set({ status: 'cancelled', cancelledAt: now, cancelledBy: 'client' })
    .where(
      and(
        eq(appointments.id, id),
        eq(appointments.clinicId, clinicId),
        eq(appointments.publicToken, token),
        inArray(appointments.status, ['pending', 'confirmed']),
        gt(appointments.startAt, now),
      ),
    )
    .returning({ dentistId: appointments.dentistId });
  if (row) {
    await cache?.invalidateDentist(clinicId, row.dentistId);
    await params.notifier.appointmentCancelled(clinicId, id);
  }
  const appointment = await getAppointment(db, { clinicId, id, token });
  if (!row && appointment.status !== 'cancelled') {
    throw new ApiError(409, 'validation_failed', 'Only an upcoming appointment can be cancelled');
  }
  return appointment;
}
