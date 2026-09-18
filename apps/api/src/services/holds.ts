/**
 * Холды (§7 POST /holds): слот удерживается строкой appointments со status = 'hold',
 * поэтому двойную бронь исключает то же EXCLUDE-ограничение (§2.1). Врач назначается
 * по правилу §6: приоритет → меньше записей в этот день → случайно.
 */
import { and, count, eq, gt, gte, inArray, lt } from 'drizzle-orm';
import { dayBounds, localDateOf, pickDentist } from '@dentbook/core';
import {
  appointments,
  blockedUntil,
  clinics,
  dentists,
  expireStaleHolds,
  isExclusionViolation,
  locations,
  lockDentist,
  scheduleExceptions,
  services,
  type Database,
} from '@dentbook/db';
import type { HoldResponse } from '@dentbook/shared';
import { ApiError, notFound } from '../lib/errors.js';
import { computeAvailability } from './availability.js';
import { takesDentistTime } from './schedule.js';
import type { SlotCache } from './slot-cache.js';

const MINUTE_MS = 60_000;
const MAX_ALTERNATIVES = 6;

/** 409 slot_taken и ближайшие свободные слоты того же дня (§2.1). */
export const slotTaken = (alternatives: string[]) =>
  new ApiError(409, 'slot_taken', 'The time is no longer available', { alternatives });

function nearest(starts: string[], target: number): string[] {
  return [...starts]
    .sort((a, b) => Math.abs(Date.parse(a) - target) - Math.abs(Date.parse(b) - target))
    .slice(0, MAX_ALTERNATIVES)
    .sort();
}

export interface CreateHoldParams {
  clinicId: string;
  serviceId: string;
  locationId: string;
  startAt: Date;
  now: Date;
  holdTtlSec: number;
  /** Случайность для равных кандидатов (§6); в тестах подменяется. */
  random?: () => number;
}

export async function createHold(
  db: Database,
  cache: SlotCache | undefined,
  params: CreateHoldParams,
): Promise<HoldResponse> {
  const { clinicId, serviceId, locationId, startAt, now } = params;

  // Местная дата слота — по поясу филиала (§2.3)
  const [place] = await db
    .select({ locationZone: locations.timezone, clinicZone: clinics.timezone })
    .from(locations)
    .innerJoin(clinics, eq(clinics.id, locations.clinicId))
    .where(and(eq(locations.id, locationId), eq(locations.clinicId, clinicId)));
  if (!place) throw notFound();
  const timeZone = place.locationZone ?? place.clinicZone;
  const date = localDateOf(startAt, timeZone);

  // Свежий расчёт без кеша: холд ставится только на действительно свободное время
  const availability = await computeAvailability(db, {
    clinicId,
    serviceId,
    locationId,
    from: date,
    to: date,
    now,
    includeHidden: false,
  });
  const target = startAt.getTime();
  const daySlots = availability.days[0]?.slots ?? [];
  const alternatives = () =>
    nearest(
      daySlots.map((s) => s.start).filter((s) => Date.parse(s) !== target),
      target,
    );
  const slot = daySlots.find((s) => Date.parse(s.start) === target);
  if (!slot) throw slotTaken(alternatives());

  const [service] = await db
    .select({ durationMin: services.durationMin, bufferMin: services.bufferMin })
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.clinicId, clinicId)));
  const endAt = new Date(target + service!.durationMin * MINUTE_MS);
  const holdUntil = blockedUntil(endAt, service!.bufferMin);

  // Второй критерий назначения — записи врача в этот местный день
  const day = dayBounds(date, timeZone);
  const load = await db
    .select({ dentistId: appointments.dentistId, n: count() })
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        inArray(appointments.dentistId, slot.dentistIds),
        gte(appointments.startAt, day.start),
        lt(appointments.startAt, day.end),
        takesDentistTime(now),
      ),
    )
    .groupBy(appointments.dentistId);
  const free = await db
    .select({ id: dentists.id, priority: dentists.priority, fullName: dentists.fullName })
    .from(dentists)
    .where(and(eq(dentists.clinicId, clinicId), inArray(dentists.id, slot.dentistIds)));
  let candidates = free.map((d) => ({
    dentistId: d.id,
    fullName: d.fullName,
    priority: d.priority,
    appointmentsThatDay: load.find((l) => l.dentistId === d.id)?.n ?? 0,
  }));

  const holdExpiresAt = new Date(now.getTime() + params.holdTtlSec * 1000);
  // Лучший кандидат по §6; если его время перехватили после расчёта — следующий
  while (candidates.length > 0) {
    const dentist = pickDentist(candidates, params.random)!;
    candidates = candidates.filter((c) => c !== dentist);
    try {
      const holdId = await db.transaction(async (tx) => {
        // Тот же lock берёт закрытие времени (block): блок не проскочит между проверкой и вставкой
        await lockDentist(tx, dentist.dentistId);
        const blocked = await tx.$count(
          scheduleExceptions,
          and(
            eq(scheduleExceptions.clinicId, clinicId),
            eq(scheduleExceptions.dentistId, dentist.dentistId),
            eq(scheduleExceptions.type, 'block'),
            lt(scheduleExceptions.startAt, holdUntil),
            gt(scheduleExceptions.endAt, startAt),
          ),
        );
        if (blocked > 0) return null;
        await expireStaleHolds(tx, now, {
          dentistId: dentist.dentistId,
          start: startAt,
          end: holdUntil,
        });
        const [row] = await tx
          .insert(appointments)
          .values({
            clinicId,
            locationId,
            dentistId: dentist.dentistId,
            serviceId,
            startAt,
            endAt,
            bufferMin: service!.bufferMin,
            blockedUntil: holdUntil,
            status: 'hold',
            holdExpiresAt,
            source: 'widget',
          })
          .returning({ id: appointments.id });
        return row!.id;
      });
      if (holdId === null) continue;
      await cache?.invalidateDentist(clinicId, dentist.dentistId);
      return {
        hold_id: holdId,
        expires_at: holdExpiresAt.toISOString(),
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        dentist: { id: dentist.dentistId, full_name: dentist.fullName },
      };
    } catch (err) {
      // 23P01 — время врача заняли одновременно с нами (§2.1)
      if (!isExclusionViolation(err)) throw err;
    }
  }
  throw slotTaken(alternatives());
}

/** DELETE /holds/:id: клиент передумал — слот свободен сразу, а не через HOLD_TTL. */
export async function releaseHold(
  db: Database,
  cache: SlotCache | undefined,
  params: { clinicId: string; holdId: string },
): Promise<void> {
  const [row] = await db
    .update(appointments)
    .set({ status: 'expired' })
    .where(
      and(
        eq(appointments.id, params.holdId),
        eq(appointments.clinicId, params.clinicId),
        eq(appointments.status, 'hold'),
      ),
    )
    .returning({ dentistId: appointments.dentistId });
  if (!row) throw notFound();
  await cache?.invalidateDentist(params.clinicId, row.dentistId);
}
