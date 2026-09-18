/**
 * Журнал регистратуры (Шаг 9, Q17): записи офиса по датам, запись клиента сотрудником,
 * перенос мышью, подтверждение, отмена клиникой, отметки после визита.
 * Пересечения исключает EXCLUDE (§2.1). Проверка в коде нужна только для понятной ошибки,
 * гонку закрывает БД. Закрытое время (block) проверяется под advisory-lock врача — тем же,
 * что берёт закрытие времени.
 */
import { and, asc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import {
  addDays,
  dayBounds,
  localDateOf,
  workingIntervalsForDate,
  type Interval,
} from '@dentbook/core';
import {
  appointments,
  blockedUntil,
  clinics,
  dentistServices,
  dentists,
  isExclusionViolation,
  locations,
  lockDentist,
  patients,
  scheduleExceptions,
  services,
  type Database,
  type Transaction,
} from '@dentbook/db';
import type {
  JournalAppointment,
  JournalResponse,
  StaffBooking,
  VisitOutcomeInput,
} from '@dentbook/shared';
import { ApiError, notFound } from '../lib/errors.js';
import { computeAvailability, loadSchedules } from './availability.js';
import { slotTaken } from './holds.js';
import type { Notifier } from './notifier.js';
import type { SlotCache } from './slot-cache.js';

const MINUTE_MS = 60_000;
const MAX_ALTERNATIVES = 6;

/** Статусы, которые показывает журнал: всё, кроме холдов. */
const JOURNAL_STATUSES = ['pending', 'confirmed', 'completed', 'no_show', 'cancelled'] as const;

export const outsideWorkingHours = () =>
  new ApiError(400, 'outside_working_hours', 'The dentist does not work at this time');

const notMovable = (message: string) => new ApiError(409, 'validation_failed', message);

/** Запись этой клиники или 404: чужая неотличима от несуществующей (§2.2). */
async function assertExists(db: Database, clinicId: string, id: string) {
  const found = await db.$count(
    appointments,
    and(eq(appointments.id, id), eq(appointments.clinicId, clinicId)),
  );
  if (found === 0) throw notFound();
}

async function officeOf(db: Database, clinicId: string, locationId: string) {
  const [row] = await db
    .select({
      timeZone: sql<string>`coalesce(${locations.timezone}, ${clinics.timezone})`,
      slotStepMin: clinics.slotStepMin,
    })
    .from(locations)
    .innerJoin(clinics, eq(clinics.id, locations.clinicId))
    .where(and(eq(locations.id, locationId), eq(locations.clinicId, clinicId)));
  if (!row) throw notFound();
  return row;
}

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

export async function loadJournal(
  db: Database,
  params: { clinicId: string; locationId: string; from: string; to: string; now: Date },
): Promise<JournalResponse> {
  const { clinicId, locationId, from, to, now } = params;
  const { timeZone, slotStepMin } = await officeOf(db, clinicId, locationId);
  const start = dayBounds(from, timeZone).start;
  const end = dayBounds(to, timeZone).end;

  const [staff, rows, blocks] = await Promise.all([
    db
      .select({ id: dentists.id, fullName: dentists.fullName, isActive: dentists.isActive })
      .from(dentists)
      .where(eq(dentists.clinicId, clinicId))
      .orderBy(asc(dentists.priority), asc(dentists.fullName)),
    db
      .select({
        id: appointments.id,
        status: appointments.status,
        source: appointments.source,
        startAt: appointments.startAt,
        endAt: appointments.endAt,
        dentistId: appointments.dentistId,
        serviceId: appointments.serviceId,
        service: services.name,
        clientId: patients.id,
        clientName: patients.fullName,
        clientPhone: patients.phone,
        notes: appointments.notes,
      })
      .from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .leftJoin(patients, eq(patients.id, appointments.patientId))
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          eq(appointments.locationId, locationId),
          inArray(appointments.status, [...JOURNAL_STATUSES]),
          lt(appointments.startAt, end),
          gt(appointments.endAt, start),
        ),
      )
      .orderBy(asc(appointments.startAt)),
    db
      .select({
        id: scheduleExceptions.id,
        dentistId: scheduleExceptions.dentistId,
        startAt: scheduleExceptions.startAt,
        endAt: scheduleExceptions.endAt,
        reason: scheduleExceptions.reason,
      })
      .from(scheduleExceptions)
      .where(
        and(
          eq(scheduleExceptions.clinicId, clinicId),
          eq(scheduleExceptions.type, 'block'),
          lt(scheduleExceptions.startAt, end),
          gt(scheduleExceptions.endAt, start),
        ),
      ),
  ]);

  // Неактивный врач остаётся в журнале, пока у него есть записи в диапазоне
  const shown = staff.filter((d) => d.isActive || rows.some((r) => r.dentistId === d.id));
  const scheduleOf = await loadSchedules(db, {
    clinicId,
    locationId,
    dentistIds: shown.map((d) => d.id),
    windowStart: dayBounds(addDays(from, -1), timeZone).start,
    windowEnd: dayBounds(addDays(to, 1), timeZone).end,
    now,
    ignoreAppointments: true,
  });

  const dates = datesBetween(from, to);
  return {
    timeZone,
    slotStepMin,
    dentists: shown.map((d) => {
      const schedule = scheduleOf(d.id);
      const extras = schedule.exceptions.filter((e) => e.type === 'extra').map((e) => e.interval);
      const working = dates.flatMap((date) => {
        const day = dayBounds(date, timeZone);
        return [
          ...workingIntervalsForDate(schedule.weeklyHours, date, timeZone),
          ...extras.filter((e) => overlaps(e, day)),
        ].map((w) => ({ date, start: w.start.toISOString(), end: w.end.toISOString() }));
      });
      return { id: d.id, fullName: d.fullName, isActive: d.isActive, working };
    }),
    blocks: blocks
      .filter((b) => shown.some((d) => d.id === b.dentistId))
      .map((b) => ({
        id: b.id,
        dentistId: b.dentistId,
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        reason: b.reason,
      })),
    appointments: rows.map((r): JournalAppointment => ({
      id: r.id,
      status: r.status as JournalAppointment['status'],
      source: r.source,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      dentistId: r.dentistId,
      serviceId: r.serviceId,
      service: r.service,
      client:
        r.clientId && r.clientName && r.clientPhone
          ? { id: r.clientId, fullName: r.clientName, phone: r.clientPhone }
          : null,
      notes: r.notes,
    })),
  };
}

/** Врач оказывает услугу и принимает записи — иначе записать к нему нельзя. */
async function assertDentistProvides(
  db: Database,
  clinicId: string,
  dentistId: string,
  serviceId: string,
) {
  const [row] = await db
    .select({ isActive: dentists.isActive })
    .from(dentists)
    .innerJoin(
      dentistServices,
      and(
        eq(dentistServices.dentistId, dentists.id),
        eq(dentistServices.clinicId, clinicId),
        eq(dentistServices.serviceId, serviceId),
      ),
    )
    .where(and(eq(dentists.id, dentistId), eq(dentists.clinicId, clinicId)));
  if (!row?.isActive) {
    throw new ApiError(400, 'validation_failed', 'The dentist does not provide this service');
  }
}

/**
 * Свободно ли время врача для записи сотрудником: без минимального запаса и предела
 * max_advance_days, но в рабочее время и по сетке шага. Занято — 409 с ближайшим
 * свободным временем; вне рабочего времени — 400.
 */
async function assertFree(
  db: Database,
  params: {
    clinicId: string;
    locationId: string;
    serviceId: string;
    dentistId: string;
    startAt: Date;
    timeZone: string;
    now: Date;
    excludeAppointmentId?: string;
  },
) {
  const { startAt, now } = params;
  if (startAt <= now) throw new ApiError(400, 'validation_failed', 'The time has passed');
  const date = localDateOf(startAt, params.timeZone);
  const request = {
    clinicId: params.clinicId,
    serviceId: params.serviceId,
    locationId: params.locationId,
    dentistId: params.dentistId,
    from: date,
    to: date,
    now,
    includeHidden: true,
    ignoreLeadTime: true,
    ignoreMaxAdvance: true,
    ...(params.excludeAppointmentId ? { excludeAppointmentId: params.excludeAppointmentId } : {}),
  };
  const target = startAt.getTime();
  const free = (await computeAvailability(db, request)).days[0]?.slots ?? [];
  if (free.some((s) => Date.parse(s.start) === target)) return;

  const working = (await computeAvailability(db, { ...request, ignoreAppointments: true })).days[0]
    ?.slots;
  if (!working?.some((s) => Date.parse(s.start) === target)) throw outsideWorkingHours();
  throw slotTaken(
    free
      .map((s) => s.start)
      .sort((a, b) => Math.abs(Date.parse(a) - target) - Math.abs(Date.parse(b) - target))
      .slice(0, MAX_ALTERNATIVES)
      .sort(),
  );
}

/** Под lock врача: время не закрыто блоком (закрытие берёт тот же lock). */
async function assertNotBlocked(tx: Transaction, clinicId: string, dentistId: string, i: Interval) {
  const blocked = await tx.$count(
    scheduleExceptions,
    and(
      eq(scheduleExceptions.clinicId, clinicId),
      eq(scheduleExceptions.dentistId, dentistId),
      eq(scheduleExceptions.type, 'block'),
      lt(scheduleExceptions.startAt, i.end),
      gt(scheduleExceptions.endAt, i.start),
    ),
  );
  if (blocked > 0) throw outsideWorkingHours();
}

export async function createStaffBooking(
  db: Database,
  deps: { cache: SlotCache | undefined; notifier: Notifier },
  params: { clinicId: string; input: StaffBooking; now: Date },
): Promise<{ id: string }> {
  const { clinicId, input, now } = params;
  const { timeZone } = await officeOf(db, clinicId, input.locationId);
  await assertDentistProvides(db, clinicId, input.dentistId, input.serviceId);
  await assertFree(db, { clinicId, ...input, timeZone, now });

  const [service] = await db
    .select({ durationMin: services.durationMin, bufferMin: services.bufferMin })
    .from(services)
    .where(and(eq(services.id, input.serviceId), eq(services.clinicId, clinicId)));
  const endAt = new Date(input.startAt.getTime() + service!.durationMin * MINUTE_MS);
  const until = blockedUntil(endAt, service!.bufferMin);

  let id: string;
  try {
    id = await db.transaction(async (tx) => {
      await lockDentist(tx, input.dentistId);
      await assertNotBlocked(tx, clinicId, input.dentistId, { start: input.startAt, end: until });
      // Клиент в клинике определяется телефоном (Q9)
      const [patient] = await tx
        .insert(patients)
        .values({
          clinicId,
          fullName: input.client.fullName,
          phone: input.client.phone,
          email: input.client.email ?? null,
        })
        .onConflictDoUpdate({
          target: [patients.clinicId, patients.phone],
          set: {
            fullName: sql`excluded.full_name`,
            email: sql`coalesce(excluded.email, ${patients.email})`,
          },
        })
        .returning({ id: patients.id });
      const [row] = await tx
        .insert(appointments)
        .values({
          clinicId,
          locationId: input.locationId,
          dentistId: input.dentistId,
          serviceId: input.serviceId,
          patientId: patient!.id,
          startAt: input.startAt,
          endAt,
          bufferMin: service!.bufferMin,
          blockedUntil: until,
          status: 'confirmed',
          source: 'admin',
          notes: input.notes ?? null,
        })
        .returning({ id: appointments.id });
      return row!.id;
    });
  } catch (err) {
    if (isExclusionViolation(err)) throw slotTaken([]);
    throw err;
  }
  await deps.cache?.invalidateDentist(clinicId, input.dentistId);
  await deps.notifier.appointmentCreated(clinicId, id);
  return { id };
}

/**
 * Перенос мышью: новое время и, возможно, другой врач того же офиса. Длительность и буфер —
 * записи. Пересечение с другой записью отклоняет EXCLUDE (23P01 → 409): «перенос не
 * создаёт пересечений» (Шаг 9) держит БД, а не этот код.
 */
export async function rescheduleAppointment(
  db: Database,
  deps: { cache: SlotCache | undefined; notifier: Notifier },
  params: { clinicId: string; id: string; startAt: Date; dentistId?: string; now: Date },
): Promise<void> {
  const { clinicId, id, startAt, now } = params;
  const [current] = await db
    .select({
      status: appointments.status,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      bufferMin: appointments.bufferMin,
      dentistId: appointments.dentistId,
      serviceId: appointments.serviceId,
      locationId: appointments.locationId,
    })
    .from(appointments)
    .where(and(eq(appointments.id, id), eq(appointments.clinicId, clinicId)));
  if (!current) throw notFound();
  if (current.status !== 'pending' && current.status !== 'confirmed') {
    throw notMovable('Only an upcoming booking can be moved');
  }
  if (current.startAt <= now) throw notMovable('The visit has already started');

  const dentistId = params.dentistId ?? current.dentistId;
  const { timeZone } = await officeOf(db, clinicId, current.locationId);
  if (dentistId !== current.dentistId) {
    await assertDentistProvides(db, clinicId, dentistId, current.serviceId);
  }
  await assertFree(db, {
    clinicId,
    locationId: current.locationId,
    serviceId: current.serviceId,
    dentistId,
    startAt,
    timeZone,
    now,
    excludeAppointmentId: id,
  });

  const endAt = new Date(startAt.getTime() + (current.endAt.getTime() - current.startAt.getTime()));
  const until = blockedUntil(endAt, current.bufferMin);
  try {
    const moved = await db.transaction(async (tx) => {
      await lockDentist(tx, dentistId);
      await assertNotBlocked(tx, clinicId, dentistId, { start: startAt, end: until });
      return tx
        .update(appointments)
        .set({ startAt, endAt, blockedUntil: until, dentistId })
        .where(
          and(
            eq(appointments.id, id),
            eq(appointments.clinicId, clinicId),
            inArray(appointments.status, ['pending', 'confirmed']),
          ),
        )
        .returning({ id: appointments.id });
    });
    if (moved.length === 0) throw notMovable('Only an upcoming booking can be moved');
  } catch (err) {
    if (isExclusionViolation(err)) throw slotTaken([]);
    throw err;
  }
  await deps.cache?.invalidateDentist(clinicId, current.dentistId);
  if (dentistId !== current.dentistId) await deps.cache?.invalidateDentist(clinicId, dentistId);
  await deps.notifier.appointmentRescheduled(clinicId, id, {
    dentistId: current.dentistId,
    startAt: current.startAt,
  });
}

/** Регистратура подтверждает ожидающую запись: клиенту SMS (Q12). */
export async function confirmByStaff(
  db: Database,
  deps: { notifier: Notifier },
  params: { clinicId: string; id: string; now: Date },
): Promise<void> {
  await assertExists(db, params.clinicId, params.id);
  const [row] = await db
    .update(appointments)
    .set({ status: 'confirmed' })
    .where(
      and(
        eq(appointments.id, params.id),
        eq(appointments.clinicId, params.clinicId),
        eq(appointments.status, 'pending'),
        gt(appointments.startAt, params.now),
      ),
    )
    .returning({ id: appointments.id });
  if (!row) throw notMovable('Only an upcoming booking that awaits confirmation can be confirmed');
  await deps.notifier.appointmentConfirmed(params.clinicId, params.id);
}

/** Отмена от имени клиники: время освобождается, клиенту SMS, напоминания снимаются. */
export async function cancelByClinic(
  db: Database,
  deps: { cache: SlotCache | undefined; notifier: Notifier },
  params: { clinicId: string; id: string; now: Date },
): Promise<void> {
  await assertExists(db, params.clinicId, params.id);
  const [row] = await db
    .update(appointments)
    .set({ status: 'cancelled', cancelledAt: params.now, cancelledBy: 'clinic' })
    .where(
      and(
        eq(appointments.id, params.id),
        eq(appointments.clinicId, params.clinicId),
        inArray(appointments.status, ['pending', 'confirmed']),
        gt(appointments.startAt, params.now),
      ),
    )
    .returning({ dentistId: appointments.dentistId });
  if (!row) throw notMovable('Only an upcoming booking can be cancelled');
  await deps.cache?.invalidateDentist(params.clinicId, row.dentistId);
  await deps.notifier.appointmentCancelled(params.clinicId, params.id, 'clinic');
}

/** «Пришёл» / «не пришёл» — после начала визита; отметку можно поменять. */
export async function setVisitOutcome(
  db: Database,
  params: { clinicId: string; id: string; outcome: VisitOutcomeInput['status']; now: Date },
): Promise<void> {
  await assertExists(db, params.clinicId, params.id);
  const [row] = await db
    .update(appointments)
    .set({ status: params.outcome })
    .where(
      and(
        eq(appointments.id, params.id),
        eq(appointments.clinicId, params.clinicId),
        inArray(appointments.status, ['pending', 'confirmed', 'completed', 'no_show']),
        lt(appointments.startAt, params.now),
      ),
    )
    .returning({ id: appointments.id });
  if (!row) throw notMovable('The visit has not started yet');
}
