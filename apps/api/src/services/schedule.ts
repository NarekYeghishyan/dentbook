/** Проверки расписания, общие для админки и Telegram (Шаг 7). */
import { and, asc, eq, gt, inArray, lt, or } from 'drizzle-orm';
import { appointments, type Database } from '@dentbook/db';
import type { ConflictingAppointment } from '@dentbook/shared';
import { ApiError } from '../lib/errors.js';

/**
 * Условие «запись занимает время врача»: pending, confirmed и холд, который ещё не истёк.
 * Просроченный холд, который worker не успел снять, время не держит.
 */
export const takesDentistTime = (now: Date) =>
  or(
    inArray(appointments.status, ['pending', 'confirmed']),
    and(eq(appointments.status, 'hold'), gt(appointments.holdExpiresAt, now)),
  );

/**
 * Записи врача, занимающие время в [start, end): pending, confirmed и живые холды.
 * Такое время закрыть нельзя (§8) — записи сначала переносит регистратура.
 */
export async function findConflictingAppointments(
  db: Database,
  params: { clinicId: string; dentistId: string; start: Date; end: Date; now: Date },
): Promise<ConflictingAppointment[]> {
  const rows = await db
    .select({
      id: appointments.id,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      status: appointments.status,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicId, params.clinicId),
        eq(appointments.dentistId, params.dentistId),
        lt(appointments.startAt, params.end),
        gt(appointments.endAt, params.start),
        takesDentistTime(params.now),
      ),
    )
    .orderBy(asc(appointments.startAt));
  return rows.map((r) => ({
    id: r.id,
    startAt: r.startAt.toISOString(),
    endAt: r.endAt.toISOString(),
    status: r.status,
  }));
}

/**
 * Время занято записями — 409 со списком (§8). Код slot_taken: время занято, и это
 * ответ того же рода, что при попытке записи на занятый слот.
 */
export const timeHasAppointments = (conflicts: ConflictingAppointment[]) =>
  new ApiError(409, 'slot_taken', 'The time has appointments; reschedule them first', {
    conflicts,
  });
