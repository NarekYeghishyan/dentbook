/**
 * История записи (appointment_events): каждое изменение записи пишет событие в той же
 * транзакции, что и само изменение. Читают врач в Mini App и регистратура в журнале.
 * Холды в историю не попадают — она начинается с подтверждения записи клиентом.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  appointmentEvents,
  appointments,
  clinics,
  dentists,
  locations,
  users,
  type Database,
  type Executor,
} from '@dentbook/db';
import type {
  AppointmentChanges,
  AppointmentEventType,
  AppointmentHistory,
} from '@dentbook/shared';
import { notFound } from '../lib/errors.js';

/** Кто меняет запись: клиент на сайте, врач в Telegram, сотрудник в панели. */
export type Actor =
  { kind: 'client' } | { kind: 'dentist'; dentistId: string } | { kind: 'staff'; userId: string };

/** Действия клиники: регистратура в журнале или врач в Mini App. */
export type ClinicActor = Exclude<Actor, { kind: 'client' }>;

export async function recordEvent(
  db: Executor,
  event: {
    clinicId: string;
    appointmentId: string;
    type: AppointmentEventType;
    actor: Actor;
    changes?: AppointmentChanges;
  },
): Promise<void> {
  const { actor } = event;
  await db.insert(appointmentEvents).values({
    clinicId: event.clinicId,
    appointmentId: event.appointmentId,
    type: event.type,
    actor: actor.kind,
    userId: actor.kind === 'staff' ? actor.userId : null,
    dentistId: actor.kind === 'dentist' ? actor.dentistId : null,
    changes: event.changes ?? null,
  });
}

/**
 * История записи клиники, от старых событий к новым. dentistId — только запись этого
 * врача (Mini App): чужая неотличима от несуществующей (§2.2).
 */
export async function loadHistory(
  db: Database,
  params: { clinicId: string; appointmentId: string; dentistId?: string },
): Promise<AppointmentHistory> {
  const { clinicId, appointmentId } = params;
  const [appointment] = await db
    .select({ timeZone: sql<string>`coalesce(${locations.timezone}, ${clinics.timezone})` })
    .from(appointments)
    .innerJoin(locations, eq(locations.id, appointments.locationId))
    .innerJoin(clinics, eq(clinics.id, appointments.clinicId))
    .where(
      and(
        eq(appointments.id, appointmentId),
        eq(appointments.clinicId, clinicId),
        params.dentistId ? eq(appointments.dentistId, params.dentistId) : undefined,
      ),
    );
  if (!appointment) throw notFound();

  const rows = await db
    .select({
      id: appointmentEvents.id,
      at: appointmentEvents.createdAt,
      type: appointmentEvents.type,
      actor: appointmentEvents.actor,
      userName: users.fullName,
      dentistName: dentists.fullName,
      changes: appointmentEvents.changes,
    })
    .from(appointmentEvents)
    .leftJoin(users, eq(users.id, appointmentEvents.userId))
    .leftJoin(dentists, eq(dentists.id, appointmentEvents.dentistId))
    .where(
      and(
        eq(appointmentEvents.clinicId, clinicId),
        eq(appointmentEvents.appointmentId, appointmentId),
      ),
    )
    .orderBy(asc(appointmentEvents.createdAt), asc(appointmentEvents.id));

  // Врач в changes хранится как id, в ответе — имя
  const ids = [
    ...new Set(
      rows.flatMap((r) =>
        r.changes?.dentist ? [r.changes.dentist.from, r.changes.dentist.to] : [],
      ),
    ),
  ];
  const names = new Map(
    ids.length === 0
      ? []
      : (
          await db
            .select({ id: dentists.id, fullName: dentists.fullName })
            .from(dentists)
            .where(and(eq(dentists.clinicId, clinicId), inArray(dentists.id, ids)))
        ).map((d) => [d.id, d.fullName]),
  );
  const nameOf = (id: string) => names.get(id) ?? '—';

  return {
    timeZone: appointment.timeZone,
    events: rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      type: r.type,
      actor: r.actor,
      actorName: r.userName ?? r.dentistName ?? null,
      changes: r.changes?.dentist
        ? {
            ...r.changes,
            dentist: { from: nameOf(r.changes.dentist.from), to: nameOf(r.changes.dentist.to) },
          }
        : r.changes,
    })),
  };
}
