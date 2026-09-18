/**
 * Врачи, их услуги, недельный шаблон и исключения расписания.
 * Приоритет (§6) задаётся порядком: PUT /dentists/order с полным списком врачей.
 * Удаления врача нет: на него ссылаются записи, он отключается.
 */
import { and, asc, eq, gt, inArray, lt, max } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { findWeeklyOverlap } from '@dentbook/core';
import {
  dentistServices,
  dentists,
  lockDentist,
  locations,
  scheduleExceptions,
  services,
  workingHours,
  type Database,
} from '@dentbook/db';
import {
  createDentistSchema,
  createExceptionSchema,
  dentistServicesSchema,
  exceptionRangeSchema,
  reorderDentistsSchema,
  updateDentistSchema,
  uuidSchema,
  workingHoursSchema,
  type Dentist,
  type ScheduleExceptionItem,
  type WorkingHoursItem,
} from '@dentbook/shared';
import { ApiError, notFound, parse } from '../../lib/errors.js';
import { idOf } from '../../lib/params.js';
import { authOf, MANAGERS } from '../../plugins/session.js';
import { findConflictingAppointments, timeHasAppointments } from '../../services/schedule.js';
import type { SlotCache } from '../../services/slot-cache.js';

/** Шаг приоритета: между соседями остаётся место. */
const PRIORITY_STEP = 10;

const dentistColumns = {
  id: dentists.id,
  fullName: dentists.fullName,
  priority: dentists.priority,
  isActive: dentists.isActive,
  telegramChatId: dentists.telegramChatId,
};

const exceptionColumns = {
  id: scheduleExceptions.id,
  type: scheduleExceptions.type,
  startAt: scheduleExceptions.startAt,
  endAt: scheduleExceptions.endAt,
  locationId: scheduleExceptions.locationId,
  reason: scheduleExceptions.reason,
};

const exceptionParams = z.object({ id: uuidSchema, exceptionId: uuidSchema });

/** 'HH:MM:SS' из Postgres → 'HH:MM' для API. */
const hhmm = (time: string) => time.slice(0, 5);

const toException = (row: {
  id: string;
  type: 'block' | 'extra';
  startAt: Date;
  endAt: Date;
  locationId: string | null;
  reason: string | null;
}): ScheduleExceptionItem => ({
  ...row,
  startAt: row.startAt.toISOString(),
  endAt: row.endAt.toISOString(),
});

export const dentistRoutes: FastifyPluginAsync<{ db: Database; cache?: SlotCache }> = async (
  app,
  { db, cache },
) => {
  /** Расписание или записи врача изменились — его слоты в кеше больше не верны (§6). */
  const onScheduleChange = async (clinicId: string, dentistId: string) => {
    await cache?.invalidateDentist(clinicId, dentistId);
  };

  async function loadDentists(clinicId: string, id?: string): Promise<Dentist[]> {
    const rows = await db
      .select(dentistColumns)
      .from(dentists)
      .where(and(eq(dentists.clinicId, clinicId), id ? eq(dentists.id, id) : undefined))
      .orderBy(asc(dentists.priority), asc(dentists.fullName));
    const links = await db
      .select({ dentistId: dentistServices.dentistId, serviceId: dentistServices.serviceId })
      .from(dentistServices)
      .where(
        and(
          eq(dentistServices.clinicId, clinicId),
          id ? eq(dentistServices.dentistId, id) : undefined,
        ),
      );
    return rows.map(({ telegramChatId, ...row }) => ({
      ...row,
      serviceIds: links.filter((l) => l.dentistId === row.id).map((l) => l.serviceId),
      telegramLinked: telegramChatId !== null,
    }));
  }

  async function loadDentist(clinicId: string, id: string): Promise<Dentist> {
    const [dentist] = await loadDentists(clinicId, id);
    if (!dentist) throw notFound();
    return dentist;
  }

  /** Врач из пути, принадлежащий клинике сессии. */
  async function dentistOf(request: FastifyRequest) {
    const { clinicId } = authOf(request);
    const id = idOf(request);
    const [row] = await db
      .select({ id: dentists.id })
      .from(dentists)
      .where(and(eq(dentists.id, id), eq(dentists.clinicId, clinicId)));
    if (!row) throw notFound();
    return { clinicId, dentistId: id };
  }

  /** Все id принадлежат клинике — иначе 404, как для чужой сущности. */
  async function assertOwned(
    table: typeof locations | typeof services,
    clinicId: string,
    ids: string[],
  ) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const count = await db.$count(
      table,
      and(eq(table.clinicId, clinicId), inArray(table.id, unique)),
    );
    if (count !== unique.length) throw notFound('Referenced entity not found');
  }

  // --- врачи ---

  app.get('', async (request) => loadDentists(authOf(request).clinicId));

  app.get('/:id', async (request) => loadDentist(authOf(request).clinicId, idOf(request)));

  app.post('', { config: MANAGERS }, async (request, reply) => {
    const { clinicId } = authOf(request);
    const input = parse(createDentistSchema, request.body);
    // Новый врач — в конец списка приоритетов
    const [last] = await db
      .select({ priority: max(dentists.priority) })
      .from(dentists)
      .where(eq(dentists.clinicId, clinicId));
    const [row] = await db
      .insert(dentists)
      .values({ ...input, clinicId, priority: (last?.priority ?? 0) + PRIORITY_STEP })
      .returning({ id: dentists.id });
    return reply.status(201).send(await loadDentist(clinicId, row!.id));
  });

  app.patch('/:id', { config: MANAGERS }, async (request) => {
    const { clinicId } = authOf(request);
    const id = idOf(request);
    const input = parse(updateDentistSchema, request.body);
    if (Object.keys(input).length > 0) {
      await db
        .update(dentists)
        .set(input)
        .where(and(eq(dentists.id, id), eq(dentists.clinicId, clinicId)));
      await onScheduleChange(clinicId, id);
    }
    return loadDentist(clinicId, id);
  });

  app.put('/order', { config: MANAGERS }, async (request) => {
    const { clinicId } = authOf(request);
    const { dentistIds } = parse(reorderDentistsSchema, request.body);
    const existing = await db
      .select({ id: dentists.id })
      .from(dentists)
      .where(eq(dentists.clinicId, clinicId));
    const known = new Set(existing.map((d) => d.id));
    if (new Set(dentistIds).size !== dentistIds.length || dentistIds.some((id) => !known.has(id))) {
      throw notFound('Unknown or repeated dentist');
    }
    if (dentistIds.length !== known.size) {
      throw new ApiError(400, 'validation_failed', 'The order must list every dentist');
    }
    await db.transaction(async (tx) => {
      for (const [index, id] of dentistIds.entries()) {
        await tx
          .update(dentists)
          .set({ priority: (index + 1) * PRIORITY_STEP })
          .where(and(eq(dentists.id, id), eq(dentists.clinicId, clinicId)));
      }
    });
    return loadDentists(clinicId);
  });

  app.put('/:id/services', { config: MANAGERS }, async (request) => {
    const { clinicId, dentistId } = await dentistOf(request);
    const { serviceIds } = parse(dentistServicesSchema, request.body);
    await assertOwned(services, clinicId, serviceIds);
    await db.transaction(async (tx) => {
      await tx
        .delete(dentistServices)
        .where(
          and(eq(dentistServices.clinicId, clinicId), eq(dentistServices.dentistId, dentistId)),
        );
      const unique = [...new Set(serviceIds)];
      if (unique.length > 0) {
        await tx
          .insert(dentistServices)
          .values(unique.map((serviceId) => ({ clinicId, dentistId, serviceId })));
      }
    });
    await onScheduleChange(clinicId, dentistId);
    return loadDentist(clinicId, dentistId);
  });

  // --- недельный шаблон ---

  async function loadHours(clinicId: string, dentistId: string): Promise<WorkingHoursItem[]> {
    const rows = await db
      .select({
        id: workingHours.id,
        locationId: workingHours.locationId,
        weekday: workingHours.weekday,
        startTime: workingHours.startTime,
        endTime: workingHours.endTime,
      })
      .from(workingHours)
      .where(and(eq(workingHours.clinicId, clinicId), eq(workingHours.dentistId, dentistId)))
      .orderBy(asc(workingHours.weekday), asc(workingHours.startTime));
    return rows.map((r) => ({ ...r, startTime: hhmm(r.startTime), endTime: hhmm(r.endTime) }));
  }

  app.get('/:id/working-hours', async (request) => {
    const { clinicId, dentistId } = await dentistOf(request);
    return loadHours(clinicId, dentistId);
  });

  /**
   * Шаблон заменяется целиком. Уже созданные записи не проверяются и не отменяются
   * (автоотмена запрещена, §8): записи вне нового шаблона видны в журнале.
   */
  app.put('/:id/working-hours', { config: MANAGERS }, async (request) => {
    const { clinicId, dentistId } = await dentistOf(request);
    const { items } = parse(workingHoursSchema, request.body);
    await assertOwned(
      locations,
      clinicId,
      items.map((i) => i.locationId),
    );
    const overlap = findWeeklyOverlap(items);
    if (overlap) {
      throw new ApiError(
        400,
        'validation_failed',
        `Shifts ${overlap[0]} and ${overlap[1]} overlap`,
        {
          overlap,
        },
      );
    }
    await db.transaction(async (tx) => {
      await tx
        .delete(workingHours)
        .where(and(eq(workingHours.clinicId, clinicId), eq(workingHours.dentistId, dentistId)));
      if (items.length > 0) {
        await tx.insert(workingHours).values(items.map((i) => ({ ...i, clinicId, dentistId })));
      }
    });
    await onScheduleChange(clinicId, dentistId);
    return loadHours(clinicId, dentistId);
  });

  // --- исключения ---

  app.get('/:id/exceptions', async (request): Promise<ScheduleExceptionItem[]> => {
    const { clinicId, dentistId } = await dentistOf(request);
    const { from, to } = parse(exceptionRangeSchema, request.query);
    const rows = await db
      .select(exceptionColumns)
      .from(scheduleExceptions)
      .where(
        and(
          eq(scheduleExceptions.clinicId, clinicId),
          eq(scheduleExceptions.dentistId, dentistId),
          lt(scheduleExceptions.startAt, to),
          gt(scheduleExceptions.endAt, from),
        ),
      )
      .orderBy(asc(scheduleExceptions.startAt));
    return rows.map(toException);
  });

  // Проверка записей и вставка block — под advisory-lock на врача, тем же, что берёт
  // создание холда: иначе запись могла бы проскочить между проверкой и вставкой.
  app.post('/:id/exceptions', { config: MANAGERS }, async (request, reply) => {
    const { clinicId, dentistId } = await dentistOf(request);
    const input = parse(createExceptionSchema, request.body);
    if (input.locationId) await assertOwned(locations, clinicId, [input.locationId]);
    const row = await db.transaction(async (tx) => {
      await lockDentist(tx, dentistId);
      if (input.type === 'block') {
        const conflicts = await findConflictingAppointments(tx, {
          clinicId,
          dentistId,
          start: input.startAt,
          end: input.endAt,
          now: new Date(),
        });
        if (conflicts.length > 0) throw timeHasAppointments(conflicts);
      }
      const [inserted] = await tx
        .insert(scheduleExceptions)
        .values({
          clinicId,
          dentistId,
          type: input.type,
          startAt: input.startAt,
          endAt: input.endAt,
          locationId: input.locationId ?? null,
          reason: input.reason ?? null,
          createdBy: authOf(request).userId,
        })
        .returning(exceptionColumns);
      return inserted!;
    });
    await onScheduleChange(clinicId, dentistId);
    return reply.status(201).send(toException(row));
  });

  /**
   * Удаление extra закрывает время — с записями внутри нельзя (§8). Проверка
   * консервативная: считается любая запись в интервале extra.
   */
  app.delete('/:id/exceptions/:exceptionId', { config: MANAGERS }, async (request, reply) => {
    const { clinicId } = authOf(request);
    const params = exceptionParams.safeParse(request.params);
    if (!params.success) throw notFound();
    const { id: dentistId, exceptionId } = params.data;
    const where = and(
      eq(scheduleExceptions.id, exceptionId),
      eq(scheduleExceptions.dentistId, dentistId),
      eq(scheduleExceptions.clinicId, clinicId),
    );
    await db.transaction(async (tx) => {
      await lockDentist(tx, dentistId);
      const [row] = await tx.select(exceptionColumns).from(scheduleExceptions).where(where);
      if (!row) throw notFound();
      if (row.type === 'extra') {
        const conflicts = await findConflictingAppointments(tx, {
          clinicId,
          dentistId,
          start: row.startAt,
          end: row.endAt,
          now: new Date(),
        });
        if (conflicts.length > 0) throw timeHasAppointments(conflicts);
      }
      await tx.delete(scheduleExceptions).where(where);
    });
    await onScheduleChange(clinicId, dentistId);
    return reply.status(204).send();
  });
};
