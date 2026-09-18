/**
 * Доступность на даты (CLAUDE.md §6): данные из БД → чистый движок @dentbook/core.
 * Одна функция для календаря админки и публичного API (Шаг 5).
 * Свободные слоты не хранятся (§2.4) — считаются на каждый запрос.
 */
import { and, asc, eq, gt, inArray, lt, or } from 'drizzle-orm';
import {
  addDays,
  computeDaySlots,
  dayBounds,
  localDateOf,
  type BusyAppointment,
  type ScheduleException,
  type WeeklyHours,
} from '@dentbook/core';
import {
  appointments,
  clinics,
  dentistServices,
  dentists,
  locations,
  scheduleExceptions,
  services,
  workingHours,
  type Database,
} from '@dentbook/db';
import type { AvailabilityDay, AvailabilityResponse } from '@dentbook/shared';
import { notFound } from '../lib/errors.js';
import { takesDentistTime } from './schedule.js';

export interface AvailabilityRequest {
  clinicId: string;
  serviceId: string;
  locationId: string;
  /** Без врача — все врачи, оказывающие услугу. */
  dentistId?: string | undefined;
  /** Местные даты филиала, включительно. */
  from: string;
  to: string;
  now: Date;
  /** Показывать ли услуги и филиалы, скрытые от виджета (админке — да). */
  includeHidden: boolean;
}

const MINUTE_MS = 60_000;

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

export async function computeAvailability(
  db: Database,
  request: AvailabilityRequest,
): Promise<AvailabilityResponse> {
  const { clinicId, now } = request;

  const [clinic] = await db
    .select({
      timezone: clinics.timezone,
      minLeadMin: clinics.minLeadMin,
      slotStepMin: clinics.slotStepMin,
      maxAdvanceDays: clinics.maxAdvanceDays,
    })
    .from(clinics)
    .where(eq(clinics.id, clinicId));
  const [location] = await db
    .select({ timezone: locations.timezone, isActive: locations.isActive })
    .from(locations)
    .where(and(eq(locations.id, request.locationId), eq(locations.clinicId, clinicId)));
  const [service] = await db
    .select({
      durationMin: services.durationMin,
      bufferMin: services.bufferMin,
      isActive: services.isActive,
      isPublic: services.isPublic,
    })
    .from(services)
    .where(and(eq(services.id, request.serviceId), eq(services.clinicId, clinicId)));

  const visible = (entity: { isActive: boolean; isPublic?: boolean } | undefined) =>
    entity !== undefined &&
    (request.includeHidden || (entity.isActive && entity.isPublic !== false));
  if (!clinic || !visible(location) || !visible(service)) throw notFound();

  const timeZone = location!.timezone ?? clinic.timezone;
  const { durationMin, bufferMin } = service!;
  const response: AvailabilityResponse = { timeZone, durationMin, days: [] };

  // Не раньше сегодняшней даты и не дальше max_advance_days
  const today = localDateOf(now, timeZone);
  const lastDate = addDays(today, clinic.maxAdvanceDays);
  const from = request.from < today ? today : request.from;
  const to = request.to > lastDate ? lastDate : request.to;
  if (from > to || !location!.isActive || !service!.isActive) {
    response.days = datesBetween(request.from, request.to).map((date) => ({ date, slots: [] }));
    return response;
  }

  const candidates = await db
    .select({ id: dentists.id, priority: dentists.priority })
    .from(dentists)
    .innerJoin(
      dentistServices,
      and(
        eq(dentistServices.dentistId, dentists.id),
        eq(dentistServices.clinicId, clinicId),
        eq(dentistServices.serviceId, request.serviceId),
      ),
    )
    .where(
      and(
        eq(dentists.clinicId, clinicId),
        eq(dentists.isActive, true),
        request.dentistId ? eq(dentists.id, request.dentistId) : undefined,
      ),
    )
    .orderBy(asc(dentists.priority), asc(dentists.id));
  const dentistIds = candidates.map((d) => d.id);

  // Окно данных: смены, задевающие даты, — от суток до первой даты до суток после последней
  const windowStart = dayBounds(addDays(from, -1), timeZone).start;
  const windowEnd = dayBounds(addDays(to, 1), timeZone).end;

  const [hours, exceptions, busy] =
    dentistIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          db
            .select({
              dentistId: workingHours.dentistId,
              weekday: workingHours.weekday,
              startTime: workingHours.startTime,
              endTime: workingHours.endTime,
            })
            .from(workingHours)
            .where(
              and(
                eq(workingHours.clinicId, clinicId),
                eq(workingHours.locationId, request.locationId),
                inArray(workingHours.dentistId, dentistIds),
              ),
            ),
          db
            .select({
              dentistId: scheduleExceptions.dentistId,
              type: scheduleExceptions.type,
              startAt: scheduleExceptions.startAt,
              endAt: scheduleExceptions.endAt,
            })
            .from(scheduleExceptions)
            .where(
              and(
                eq(scheduleExceptions.clinicId, clinicId),
                inArray(scheduleExceptions.dentistId, dentistIds),
                lt(scheduleExceptions.startAt, windowEnd),
                gt(scheduleExceptions.endAt, windowStart),
                // block закрывает время врача везде; extra — время в своём филиале
                or(
                  eq(scheduleExceptions.type, 'block'),
                  eq(scheduleExceptions.locationId, request.locationId),
                ),
              ),
            ),
          // Записи врача во всех филиалах: в двух местах сразу он не бывает
          db
            .select({
              dentistId: appointments.dentistId,
              startAt: appointments.startAt,
              endAt: appointments.endAt,
              bufferMin: appointments.bufferMin,
            })
            .from(appointments)
            .where(
              and(
                eq(appointments.clinicId, clinicId),
                inArray(appointments.dentistId, dentistIds),
                lt(appointments.startAt, windowEnd),
                gt(appointments.endAt, windowStart),
                takesDentistTime(now),
              ),
            ),
        ]);

  const notBefore = new Date(now.getTime() + clinic.minLeadMin * MINUTE_MS);
  const byDentist = <T extends { dentistId: string }>(rows: T[], id: string) =>
    rows.filter((r) => r.dentistId === id);

  const perDentist = candidates.map((dentist) => ({
    id: dentist.id,
    weeklyHours: byDentist(hours, dentist.id) satisfies WeeklyHours[],
    exceptions: byDentist(exceptions, dentist.id).map((e): ScheduleException => ({
      type: e.type,
      interval: { start: e.startAt, end: e.endAt },
    })),
    appointments: byDentist(busy, dentist.id).map((a): BusyAppointment => ({
      interval: { start: a.startAt, end: a.endAt },
      bufferMin: a.bufferMin,
    })),
  }));

  response.days = datesBetween(request.from, request.to).map((date): AvailabilityDay => {
    if (date < from || date > to) return { date, slots: [] };
    // Время начала → свободные врачи; candidates уже по приоритету
    const slots = new Map<number, string[]>();
    for (const dentist of perDentist) {
      const starts = computeDaySlots({
        date,
        timeZone,
        weeklyHours: dentist.weeklyHours,
        exceptions: dentist.exceptions,
        appointments: dentist.appointments,
        durationMin,
        bufferMin,
        stepMin: clinic.slotStepMin,
        notBefore,
      });
      for (const start of starts) {
        const free = slots.get(start.getTime()) ?? [];
        free.push(dentist.id);
        slots.set(start.getTime(), free);
      }
    }
    return {
      date,
      slots: [...slots.entries()]
        .sort(([a], [b]) => a - b)
        .map(([start, ids]) => ({ start: new Date(start).toISOString(), dentistIds: ids })),
    };
  });
  return response;
}
