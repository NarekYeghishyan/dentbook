/**
 * Журнал регистратуры (Шаг 9, Q17): записи офиса по датам, запись клиента сотрудником,
 * перенос мышью и правка записи, подтверждение, отмена клиникой, отметки после визита.
 * Перенос и отмену своих записей делает и врач в Mini App — actor.kind = 'dentist'. Каждое
 * изменение пишет событие в историю записи (recordEvent) в той же транзакции.
 * Пересечения исключает EXCLUDE (§2.1). Проверка в коде нужна только для понятной ошибки,
 * гонку закрывает БД. Закрытое время (block) проверяется под advisory-lock врача — тем же,
 * что берёт закрытие времени.
 */
import { and, asc, eq, gt, inArray, lt, sql, type SQL } from 'drizzle-orm';
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
  type Executor,
  type Transaction,
} from '@dentbook/db';
import type {
  AppointmentChanges,
  AppointmentUpdate,
  JournalAppointment,
  JournalResponse,
  StaffBooking,
  VisitOutcomeInput,
} from '@dentbook/shared';
import { ApiError, notFound } from '../lib/errors.js';
import { computeAvailability, loadSchedules } from './availability.js';
import { addClientNote, setBookingClient } from './clients.js';
import { recordEvent, type ClinicActor } from './history.js';
import { slotTaken } from './holds.js';
import type { Notifier } from './notifier.js';
import type { SlotCache } from './slot-cache.js';

const MINUTE_MS = 60_000;
const MAX_ALTERNATIVES = 6;

/** Статусы, которые показывает журнал: всё, кроме холдов. */
const JOURNAL_STATUSES = ['pending', 'confirmed', 'completed', 'no_show', 'cancelled'] as const;
/** Время, врача, услугу и длительность можно менять только у предстоящей записи. */
const UPCOMING_STATUSES = ['pending', 'confirmed'] as const;
/** Клиента и заметки — у любой, кроме отменённой. */
const EDITABLE_STATUSES = ['pending', 'confirmed', 'completed', 'no_show'] as const;

export const outsideWorkingHours = () =>
  new ApiError(400, 'outside_working_hours', 'The dentist does not work at this time');

const notMovable = (message: string) => new ApiError(409, 'validation_failed', message);

/**
 * Запись этой клиники (и этого врача, если задан) или 404: чужая неотличима от
 * несуществующей (§2.2).
 */
async function assertExists(db: Database, clinicId: string, id: string, dentistId?: string) {
  const found = await db.$count(
    appointments,
    and(
      eq(appointments.id, id),
      eq(appointments.clinicId, clinicId),
      dentistId ? eq(appointments.dentistId, dentistId) : undefined,
    ),
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
        clientEmail: patients.email,
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
        r.clientId && r.clientName
          ? { id: r.clientId, fullName: r.clientName, phone: r.clientPhone, email: r.clientEmail }
          : null,
      notes: r.notes,
    })),
  };
}

/**
 * Врач оказывает услугу и принимает записи — иначе записать к нему нельзя. Разовая услуга
 * врача (services.one_time) ни за кем не закреплена: её запись переносится к любому
 * работающему врачу (moving), а новую запись на неё не создать — она одна на свою запись.
 */
async function assertDentistProvides(
  db: Database,
  clinicId: string,
  dentistId: string,
  serviceId: string,
  moving = false,
) {
  const [row] = await db
    .select({
      isActive: dentists.isActive,
      oneTime: services.oneTime,
      provided: dentistServices.serviceId,
    })
    .from(dentists)
    .innerJoin(services, and(eq(services.id, serviceId), eq(services.clinicId, clinicId)))
    .leftJoin(
      dentistServices,
      and(
        eq(dentistServices.dentistId, dentists.id),
        eq(dentistServices.clinicId, clinicId),
        eq(dentistServices.serviceId, serviceId),
      ),
    )
    .where(and(eq(dentists.id, dentistId), eq(dentists.clinicId, clinicId)));
  const provides = row?.oneTime ? moving : Boolean(row?.provided);
  if (!row?.isActive || !provides) {
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
    /** Своя длительность записи вместо длительности услуги. */
    durationMin?: number | undefined;
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
    durationMin: params.durationMin,
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
  params: { clinicId: string; input: StaffBooking; userId: string; now: Date },
): Promise<{ id: string }> {
  const { clinicId, input, now } = params;
  const { timeZone } = await officeOf(db, clinicId, input.locationId);
  await assertDentistProvides(db, clinicId, input.dentistId, input.serviceId);
  await assertFree(db, { clinicId, ...input, timeZone, now });

  const [service] = await db
    .select({ durationMin: services.durationMin, bufferMin: services.bufferMin })
    .from(services)
    .where(and(eq(services.id, input.serviceId), eq(services.clinicId, clinicId)));
  // Своя длительность этой записи или длительность услуги; буфер — всегда от услуги
  const durationMin = input.durationMin ?? service!.durationMin;
  const endAt = new Date(input.startAt.getTime() + durationMin * MINUTE_MS);
  const until = blockedUntil(endAt, service!.bufferMin);

  let id: string;
  try {
    id = await db.transaction(async (tx) => {
      await lockDentist(tx, input.dentistId);
      await assertNotBlocked(tx, clinicId, input.dentistId, { start: input.startAt, end: until });
      // Клиент с номером ищется по нему (Q9). Без номера совпасть не с чем: NULL в
      // уникальном ключе не равен NULL, и у такой записи свой клиент
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
      await recordEvent(tx, {
        clinicId,
        appointmentId: row!.id,
        type: 'created',
        actor: { kind: 'staff', userId: params.userId },
        changes: { startAt: { from: null, to: input.startAt.toISOString() } },
      });
      // Заметка к записи — и в историю заметок клиента (Q19)
      await addClientNote(tx, {
        clinicId,
        patientId: patient!.id,
        appointmentId: row!.id,
        author: { kind: 'staff', userId: params.userId },
        text: input.notes,
      });
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

/** Запись с услугой и клиентом — то, что меняет правка. */
const bookingOf = (db: Executor, where: SQL | undefined) =>
  db
    .select({
      status: appointments.status,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      bufferMin: appointments.bufferMin,
      dentistId: appointments.dentistId,
      serviceId: appointments.serviceId,
      service: services.name,
      locationId: appointments.locationId,
      patientId: appointments.patientId,
      notes: appointments.notes,
      fullName: patients.fullName,
      phone: patients.phone,
      email: patients.email,
    })
    .from(appointments)
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .leftJoin(patients, eq(patients.id, appointments.patientId))
    .where(where);

const minutesOf = (b: { startAt: Date; endAt: Date }) =>
  (b.endAt.getTime() - b.startAt.getTime()) / MINUTE_MS;

/**
 * Правка записи: перенос мышью и форма «Изменить» в журнале, перенос врачом в Mini App
 * (actor.kind = 'dentist' — только своя запись, алерта ему нет).
 *
 * Время, врач, услуга и длительность меняются только у предстоящей записи. Новое время
 * проверяется как при записи сотрудником; пересечение с другой записью отклоняет EXCLUDE
 * (23P01 → 409): «перенос не создаёт пересечений» (Шаг 9) держит БД, а не этот код. Новая
 * услуга приносит свой буфер, а без своей длительности — и свою длительность. Клиента и
 * заметки можно поправить и после визита; отменённую запись — нельзя ничего.
 * В историю — одно событие с тем, что действительно изменилось: только время и врач — moved,
 * иначе updated.
 */
export async function updateAppointment(
  db: Database,
  deps: { cache: SlotCache | undefined; notifier: Notifier },
  params: {
    clinicId: string;
    id: string;
    update: AppointmentUpdate;
    actor: ClinicActor;
    now: Date;
  },
): Promise<void> {
  const { clinicId, id, update, now, actor } = params;
  const own = actor.kind === 'dentist' ? eq(appointments.dentistId, actor.dentistId) : undefined;
  const where = and(eq(appointments.id, id), eq(appointments.clinicId, clinicId), own);
  const [current] = await bookingOf(db, where);
  if (!current) throw notFound();

  const startAt = update.startAt ?? current.startAt;
  const dentistId = update.dentistId ?? current.dentistId;
  const serviceId = update.serviceId ?? current.serviceId;
  const serviceChanged = serviceId !== current.serviceId;
  const scheduleChanged =
    serviceChanged ||
    dentistId !== current.dentistId ||
    startAt.getTime() !== current.startAt.getTime() ||
    (update.durationMin !== undefined && update.durationMin !== minutesOf(current));
  const statuses = scheduleChanged ? UPCOMING_STATUSES : EDITABLE_STATUSES;
  const refused = scheduleChanged
    ? 'Only an upcoming booking can be moved'
    : 'A cancelled booking cannot be changed';
  if (!(statuses as readonly string[]).includes(current.status)) throw notMovable(refused);

  // Без новой услуги длительность и буфер — записи: их могли изменить при записи
  let service = {
    name: current.service,
    durationMin: minutesOf(current),
    bufferMin: current.bufferMin,
  };
  if (scheduleChanged) {
    if (current.startAt <= now) throw notMovable('The visit has already started');
    if (serviceChanged || dentistId !== current.dentistId) {
      await assertDentistProvides(db, clinicId, dentistId, serviceId, !serviceChanged);
    }
    if (serviceChanged) {
      const [row] = await db
        .select({
          name: services.name,
          durationMin: services.durationMin,
          bufferMin: services.bufferMin,
        })
        .from(services)
        .where(and(eq(services.id, serviceId), eq(services.clinicId, clinicId)));
      // Услуга этой клиники есть — это проверил assertDentistProvides
      service = row!;
    }
  }
  const durationMin = update.durationMin ?? service.durationMin;
  const endAt = new Date(startAt.getTime() + durationMin * MINUTE_MS);
  const until = blockedUntil(endAt, service.bufferMin);
  if (scheduleChanged) {
    const { timeZone } = await officeOf(db, clinicId, current.locationId);
    await assertFree(db, {
      clinicId,
      locationId: current.locationId,
      serviceId,
      dentistId,
      startAt,
      durationMin,
      timeZone,
      now,
      excludeAppointmentId: id,
    });
  }

  try {
    await db.transaction(async (tx) => {
      if (scheduleChanged) {
        await lockDentist(tx, dentistId);
        await assertNotBlocked(tx, clinicId, dentistId, { start: startAt, end: until });
      }
      // Под блокировкой строки: что было до правки — для истории и клиента
      const [before] = await bookingOf(
        tx,
        and(where, inArray(appointments.status, [...statuses])),
      ).for('update', { of: appointments });
      if (!before) throw notMovable(refused);

      const changes: AppointmentChanges = {};
      if (scheduleChanged) {
        if (startAt.getTime() !== before.startAt.getTime()) {
          changes.startAt = { from: before.startAt.toISOString(), to: startAt.toISOString() };
        }
        if (dentistId !== before.dentistId) {
          changes.dentist = { from: before.dentistId, to: dentistId };
        }
        if (serviceId !== before.serviceId) {
          changes.service = { from: before.service, to: service.name };
        }
        if (durationMin !== minutesOf(before)) {
          changes.durationMin = { from: minutesOf(before), to: durationMin };
        }
      }

      const client = update.client;
      const clientBefore =
        before.fullName !== null ? { fullName: before.fullName, phone: before.phone } : null;
      if (
        client &&
        (client.fullName !== clientBefore?.fullName || client.phone !== clientBefore?.phone)
      ) {
        changes.client = {
          from: clientBefore,
          to: { fullName: client.fullName, phone: client.phone },
        };
      }
      // Email — в карточке клиента, не в записи: меняет клиента, в историю записи не попадает
      const emailChanged = client?.email !== undefined && client.email !== before.email;
      const patientId =
        client && (changes.client || emailChanged)
          ? await setBookingClient(tx, {
              clinicId,
              appointmentId: id,
              patientId: before.patientId,
              before: clientBefore,
              client,
            })
          : before.patientId;
      const notes = update.notes === undefined ? before.notes : update.notes || null;
      if (notes !== before.notes) changes.notes = { from: before.notes, to: notes };

      await tx
        .update(appointments)
        .set({
          ...(scheduleChanged
            ? {
                startAt,
                endAt,
                blockedUntil: until,
                dentistId,
                serviceId,
                bufferMin: service.bufferMin,
              }
            : {}),
          patientId,
          notes,
        })
        .where(and(eq(appointments.id, id), eq(appointments.clinicId, clinicId)));
      // Новая заметка к записи — и в историю заметок клиента (Q19)
      if (changes.notes && patientId) {
        await addClientNote(tx, {
          clinicId,
          patientId,
          appointmentId: id,
          author: actor,
          text: notes,
        });
      }
      const changed = Object.keys(changes);
      if (changed.length === 0) return;
      await recordEvent(tx, {
        clinicId,
        appointmentId: id,
        type: changed.every((key) => key === 'startAt' || key === 'dentist') ? 'moved' : 'updated',
        actor,
        changes,
      });
    });
  } catch (err) {
    if (isExclusionViolation(err)) throw slotTaken([]);
    throw err;
  }
  if (!scheduleChanged) return;
  await deps.cache?.invalidateDentist(clinicId, current.dentistId);
  if (dentistId !== current.dentistId) await deps.cache?.invalidateDentist(clinicId, dentistId);
  await deps.notifier.appointmentRescheduled(
    clinicId,
    id,
    { dentistId: current.dentistId, startAt: current.startAt },
    { alertDentist: actor.kind !== 'dentist' },
  );
}

/** Регистратура подтверждает ожидающую запись: клиенту SMS (Q12). */
export async function confirmByStaff(
  db: Database,
  deps: { notifier: Notifier },
  params: { clinicId: string; id: string; userId: string; now: Date },
): Promise<void> {
  await assertExists(db, params.clinicId, params.id);
  await db.transaction(async (tx) => {
    const [row] = await tx
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
    if (!row) {
      throw notMovable('Only an upcoming booking that awaits confirmation can be confirmed');
    }
    await recordEvent(tx, {
      clinicId: params.clinicId,
      appointmentId: params.id,
      type: 'confirmed',
      actor: { kind: 'staff', userId: params.userId },
    });
  });
  await deps.notifier.appointmentConfirmed(params.clinicId, params.id);
}

/**
 * Отмена от имени клиники: время освобождается, клиенту SMS, напоминания снимаются.
 * Отменяет сам врач в Mini App (actor.kind = 'dentist') — только свою запись,
 * cancelled_by = 'dentist', алерта ему нет.
 */
export async function cancelByClinic(
  db: Database,
  deps: { cache: SlotCache | undefined; notifier: Notifier },
  params: { clinicId: string; id: string; actor: ClinicActor; now: Date },
): Promise<void> {
  const { actor } = params;
  const byDentistId = actor.kind === 'dentist' ? actor.dentistId : undefined;
  await assertExists(db, params.clinicId, params.id, byDentistId);
  const row = await db.transaction(async (tx) => {
    const [cancelled] = await tx
      .update(appointments)
      .set({
        status: 'cancelled',
        cancelledAt: params.now,
        cancelledBy: byDentistId ? 'dentist' : 'clinic',
      })
      .where(
        and(
          eq(appointments.id, params.id),
          eq(appointments.clinicId, params.clinicId),
          byDentistId ? eq(appointments.dentistId, byDentistId) : undefined,
          inArray(appointments.status, ['pending', 'confirmed']),
          gt(appointments.startAt, params.now),
        ),
      )
      .returning({ dentistId: appointments.dentistId });
    if (!cancelled) throw notMovable('Only an upcoming booking can be cancelled');
    await recordEvent(tx, {
      clinicId: params.clinicId,
      appointmentId: params.id,
      type: 'cancelled',
      actor,
    });
    return cancelled;
  });
  await deps.cache?.invalidateDentist(params.clinicId, row.dentistId);
  await deps.notifier.appointmentCancelled(
    params.clinicId,
    params.id,
    byDentistId ? 'dentist' : 'clinic',
  );
}

/**
 * «Пришёл» / «не пришёл» — после начала визита; отметку можно поменять. В историю
 * пишется только смена отметки, повторное нажатие — нет.
 */
export async function setVisitOutcome(
  db: Database,
  params: {
    clinicId: string;
    id: string;
    outcome: VisitOutcomeInput['status'];
    userId: string;
    now: Date;
  },
): Promise<void> {
  await assertExists(db, params.clinicId, params.id);
  const where = and(eq(appointments.id, params.id), eq(appointments.clinicId, params.clinicId));
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: appointments.status })
      .from(appointments)
      .where(where)
      .for('update');
    const [row] = await tx
      .update(appointments)
      .set({ status: params.outcome })
      .where(
        and(
          where,
          inArray(appointments.status, ['pending', 'confirmed', 'completed', 'no_show']),
          lt(appointments.startAt, params.now),
        ),
      )
      .returning({ id: appointments.id });
    if (!row) throw notMovable('The visit has not started yet');
    if (current?.status === params.outcome) return;
    await recordEvent(tx, {
      clinicId: params.clinicId,
      appointmentId: params.id,
      type: params.outcome,
      actor: { kind: 'staff', userId: params.userId },
    });
  });
}
