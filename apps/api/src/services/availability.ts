/**
 * Доступность на даты (CLAUDE.md §6): данные из БД → чистый движок @dentbook/core.
 * Одна функция для календаря админки, публичного API и проверки холда.
 * Свободные слоты не хранятся в БД (§2.4) — считаются на запрос; кеш в Redis живёт 60 с.
 */
import { and, asc, eq, gt, inArray, lt, ne, or } from 'drizzle-orm';
import {
  addDays,
  computeDaySlots,
  dayBounds,
  localDateOf,
  type BusyAppointment,
  type ScheduleException,
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
  type Executor,
} from '@dentbook/db';
import type { AvailabilityDay, AvailabilityResponse } from '@dentbook/shared';
import { notFound } from '../lib/errors.js';
import { takesDentistTime } from './schedule.js';
import type { SlotCache, SlotKey } from './slot-cache.js';

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
  /** Показывать ли услуги, скрытые от виджета, и неактивные филиалы (админке — да). */
  includeHidden: boolean;
  /** Без минимального запаса min_lead_min: врач записывает своего клиента (Mini App). */
  ignoreLeadTime?: boolean;
  /** Без предела max_advance_days: записывает сотрудник (журнал, Шаг 9). */
  ignoreMaxAdvance?: boolean;
  /** Не считать эту запись занятостью: её переносят (Шаг 9). */
  excludeAppointmentId?: string;
  /** Не считать записи вовсе: отличить «занято» от «вне рабочего времени». */
  ignoreAppointments?: boolean;
}

const MINUTE_MS = 60_000;

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/** Расписание врачей за окно дат из БД: шаблон в филиале, исключения, записи. */
export async function loadSchedules(
  db: Executor,
  params: {
    clinicId: string;
    locationId: string;
    dentistIds: string[];
    windowStart: Date;
    windowEnd: Date;
    now: Date;
    excludeAppointmentId?: string | undefined;
    ignoreAppointments?: boolean | undefined;
  },
) {
  const { clinicId, locationId, dentistIds, windowStart, windowEnd, now } = params;
  const [hours, exceptions, busy] = await Promise.all([
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
          eq(workingHours.locationId, locationId),
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
          or(eq(scheduleExceptions.type, 'block'), eq(scheduleExceptions.locationId, locationId)),
        ),
      ),
    // Записи врача во всех филиалах: в двух местах сразу он не бывает
    params.ignoreAppointments
      ? Promise.resolve([])
      : db
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
              gt(appointments.blockedUntil, windowStart),
              takesDentistTime(now),
              params.excludeAppointmentId
                ? ne(appointments.id, params.excludeAppointmentId)
                : undefined,
            ),
          ),
  ]);

  return (dentistId: string) => ({
    weeklyHours: hours.filter((h) => h.dentistId === dentistId),
    exceptions: exceptions
      .filter((e) => e.dentistId === dentistId)
      .map((e): ScheduleException => ({
        type: e.type,
        interval: { start: e.startAt, end: e.endAt },
      })),
    appointments: busy
      .filter((a) => a.dentistId === dentistId)
      .map((a): BusyAppointment => ({
        interval: { start: a.startAt, end: a.endAt },
        bufferMin: a.bufferMin,
      })),
  });
}

export async function computeAvailability(
  db: Database,
  request: AvailabilityRequest,
  cache?: SlotCache,
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

  const hidden = !location?.isActive || !service?.isActive || !service.isPublic;
  if (!clinic || !location || !service || (hidden && !request.includeHidden)) throw notFound();

  const timeZone = location.timezone ?? clinic.timezone;
  const { durationMin, bufferMin } = service;
  const response: AvailabilityResponse = { timeZone, durationMin, days: [] };
  const allDates = datesBetween(request.from, request.to);

  // Не раньше сегодняшней даты и не дальше max_advance_days
  const today = localDateOf(now, timeZone);
  const lastDate = request.ignoreMaxAdvance ? request.to : addDays(today, clinic.maxAdvanceDays);
  // Кеш хранит слоты «как есть»; расчёт без части записей в него не пишется и не читается
  if (request.excludeAppointmentId || request.ignoreAppointments) cache = undefined;
  const from = request.from < today ? today : request.from;
  const to = request.to > lastDate ? lastDate : request.to;
  if (from > to || !location.isActive || !service.isActive) {
    response.days = allDates.map((date) => ({ date, slots: [] }));
    return response;
  }

  const candidates = await db
    .select({ id: dentists.id })
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
  const dates = datesBetween(from, to);

  // Слоты по парам «врач × дата»: сначала кеш, недостающее — из БД одним заходом
  const keyOf = (dentistId: string, date: string): SlotKey => ({
    clinicId,
    dentistId,
    date,
    serviceId: request.serviceId,
    locationId: request.locationId,
  });
  const pairs = dates.flatMap((date) => dentistIds.map((dentistId) => ({ date, dentistId })));
  const cached = cache
    ? await cache.get(pairs.map((p) => keyOf(p.dentistId, p.date)))
    : pairs.map(() => null);
  const startsOf = new Map<string, number[]>();
  const pairKey = (dentistId: string, date: string) => `${dentistId}|${date}`;
  const missing = pairs.filter((pair, i) => {
    const hit = cached[i];
    if (hit) startsOf.set(pairKey(pair.dentistId, pair.date), hit);
    return !hit;
  });

  if (missing.length > 0) {
    // Окно данных: смены, задевающие даты, — от суток до первой даты до суток после последней
    const scheduleOf = await loadSchedules(db, {
      clinicId,
      locationId: request.locationId,
      dentistIds: [...new Set(missing.map((p) => p.dentistId))],
      windowStart: dayBounds(addDays(from, -1), timeZone).start,
      windowEnd: dayBounds(addDays(to, 1), timeZone).end,
      now,
      excludeAppointmentId: request.excludeAppointmentId,
      ignoreAppointments: request.ignoreAppointments,
    });
    const leadMin = request.ignoreLeadTime ? 0 : clinic.minLeadMin;
    const notBefore = new Date(now.getTime() + leadMin * MINUTE_MS);
    const computed = missing.map(({ dentistId, date }) => {
      const starts = computeDaySlots({
        date,
        timeZone,
        ...scheduleOf(dentistId),
        durationMin,
        bufferMin,
        stepMin: clinic.slotStepMin,
        notBefore,
      }).map((s) => s.getTime());
      startsOf.set(pairKey(dentistId, date), starts);
      return { key: keyOf(dentistId, date), starts };
    });
    await cache?.set(computed);
  }

  response.days = allDates.map((date): AvailabilityDay => {
    if (date < from || date > to) return { date, slots: [] };
    // Время начала → свободные врачи; dentistIds уже по приоритету
    const slots = new Map<number, string[]>();
    for (const dentistId of dentistIds) {
      for (const start of startsOf.get(pairKey(dentistId, date)) ?? []) {
        slots.set(start, [...(slots.get(start) ?? []), dentistId]);
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
