/**
 * API Mini App врача /v1/miniapp (§8, Шаг 7). Вход — `Authorization: tma <initData>`:
 * подпись и свежесть проверяет verifyInitData, врач находится по user.id =
 * dentists.telegram_chat_id. Врач видит и меняет только своё: clinicId и dentistId берутся
 * из подписи, не из запроса (§2.2).
 */
import { and, asc, eq, gt, gte, inArray, lt, ne, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { addDays, dayBounds, localDateOf } from '@dentbook/core';
import {
  appointments,
  blockedUntil,
  clinics,
  dentistServices,
  dentists,
  isExclusionViolation,
  locations,
  lockDentist,
  notifications,
  patients,
  scheduleExceptions,
  services,
  type Database,
} from '@dentbook/db';
import {
  AVAILABILITY_MAX_DAYS,
  miniappAppointmentUpdateSchema,
  miniappBlockSchema,
  miniappBookingSchema,
  miniappLocaleSchema,
  miniappMoveSchema,
  miniappSlotsQuerySchema,
  scheduleQuerySchema,
  type AppointmentChanges,
  type AppointmentHistory,
  type MiniappAppointment,
  type MiniappBusyTime,
  type MiniappMe,
  type MiniappSchedule,
  type MiniappSlots,
} from '@dentbook/shared';
import type { Locale } from '@dentbook/shared/domain';
import { translate } from '../../i18n/index.js';
import { ApiError, forbidden, notFound, parse, unauthorized } from '../../lib/errors.js';
import { idOf } from '../../lib/params.js';
import { computeAvailability } from '../../services/availability.js';
import { loadHistory, recordEvent } from '../../services/history.js';
import type { Notifier } from '../../services/notifier.js';
import { slotTaken } from '../../services/holds.js';
import { cancelByClinic, rescheduleAppointment } from '../../services/journal.js';
import {
  findConflictingAppointments,
  takesDentistTime,
  timeHasAppointments,
} from '../../services/schedule.js';
import type { SlotCache } from '../../services/slot-cache.js';
import { InitDataError, verifyInitData } from '../../telegram/verify-init-data.js';

interface DentistContext {
  dentistId: string;
  clinicId: string;
  timeZone: string;
  /** Язык клиники: на нём названа услуга «Другое». */
  clinicLocale: Locale;
  /** Шаг сетки клиники — буфер после «Другого». */
  slotStepMin: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    dentist: DentistContext | null;
  }
}

/** Записи, которые врач видит в расписании и может править. */
const SCHEDULE_STATUSES = ['pending', 'confirmed', 'completed', 'no_show'] as const;
/** С флажком «Показывать отменённые» — ещё и отменённые, только для просмотра. */
const SCHEDULE_WITH_CANCELLED = [...SCHEDULE_STATUSES, 'cancelled'] as const;

const dentistOf = (request: FastifyRequest): DentistContext => {
  if (!request.dentist) throw unauthorized();
  return request.dentist;
};

export interface MiniappRoutesOptions {
  db: Database;
  botToken: string;
  notifier: Notifier;
  cache?: SlotCache;
}

export const miniappRoutes: FastifyPluginAsync<MiniappRoutesOptions> = async (
  app,
  { db, botToken, notifier, cache },
) => {
  app.decorateRequest('dentist', null);

  app.addHook('onRequest', async (request) => {
    const header = request.headers.authorization ?? '';
    if (!header.startsWith('tma ')) throw unauthorized('Open the schedule from Telegram');
    let userId: number;
    try {
      userId = verifyInitData(header.slice(4), botToken).user.id;
    } catch (err) {
      if (err instanceof InitDataError) throw unauthorized('Open the schedule from Telegram');
      throw err;
    }
    const [row] = await db
      .select({
        dentistId: dentists.id,
        clinicId: dentists.clinicId,
        isActive: dentists.isActive,
        clinicStatus: clinics.status,
        timeZone: clinics.timezone,
        clinicLocale: clinics.locale,
        slotStepMin: clinics.slotStepMin,
      })
      .from(dentists)
      .innerJoin(clinics, eq(clinics.id, dentists.clinicId))
      .where(eq(dentists.telegramChatId, userId));
    if (!row || !row.isActive || row.clinicStatus !== 'active') {
      throw forbidden('This Telegram account is not connected to an active dentist');
    }
    request.dentist = {
      dentistId: row.dentistId,
      clinicId: row.clinicId,
      timeZone: row.timeZone,
      clinicLocale: row.clinicLocale as Locale,
      slotStepMin: row.slotStepMin,
    };
  });

  const zone = sql<string>`coalesce(${locations.timezone}, ${clinics.timezone})`;

  app.get('/me', async (request): Promise<MiniappMe> => {
    const { dentistId, clinicId } = dentistOf(request);
    const [me] = await db
      .select({
        id: dentists.id,
        fullName: dentists.fullName,
        dentistLocale: dentists.locale,
        clinicName: clinics.name,
        locale: clinics.locale,
        timezone: clinics.timezone,
      })
      .from(dentists)
      .innerJoin(clinics, eq(clinics.id, dentists.clinicId))
      .where(and(eq(dentists.id, dentistId), eq(dentists.clinicId, clinicId)));
    const offices = await db
      .select({ id: locations.id, name: locations.name, timeZone: zone })
      .from(locations)
      .innerJoin(clinics, eq(clinics.id, locations.clinicId))
      .where(and(eq(locations.clinicId, clinicId), eq(locations.isActive, true)))
      .orderBy(asc(locations.sortOrder), asc(locations.name));
    const own = await db
      .select({ id: services.id, name: services.name, durationMin: services.durationMin })
      .from(services)
      .innerJoin(
        dentistServices,
        and(eq(dentistServices.serviceId, services.id), eq(dentistServices.dentistId, dentistId)),
      )
      .where(and(eq(services.clinicId, clinicId), eq(services.isActive, true)))
      .orderBy(asc(services.sortOrder), asc(services.name));
    return {
      dentist: { id: me!.id, fullName: me!.fullName, locale: me!.dentistLocale ?? null },
      clinic: { name: me!.clinicName, locale: me!.locale as Locale, timezone: me!.timezone },
      locations: offices,
      services: own,
    };
  });

  /**
   * Язык врача (§9): тот же выбор, что и у команды /language в боте. Врач меняет только
   * свой — dentistId берётся из подписи initData, не из запроса (§2.2).
   */
  app.patch('/me', async (request) => {
    const { dentistId, clinicId } = dentistOf(request);
    const { locale } = parse(miniappLocaleSchema, request.body);
    await db
      .update(dentists)
      .set({ locale })
      .where(and(eq(dentists.id, dentistId), eq(dentists.clinicId, clinicId)));
    return { locale };
  });

  /** Записи врача, как их показывает Mini App: для расписания и для одной записи. */
  async function ownAppointments(
    ctx: DentistContext,
    where: SQL | undefined,
  ): Promise<MiniappAppointment[]> {
    const rows = await db
      .select({
        id: appointments.id,
        status: appointments.status,
        startAt: appointments.startAt,
        endAt: appointments.endAt,
        timeZone: zone,
        serviceId: appointments.serviceId,
        service: services.name,
        locationId: appointments.locationId,
        office: locations.name,
        clientName: patients.fullName,
        clientPhone: patients.phone,
        notes: appointments.notes,
        source: appointments.source,
        cancelledBy: appointments.cancelledBy,
      })
      .from(appointments)
      .innerJoin(clinics, eq(clinics.id, appointments.clinicId))
      .innerJoin(locations, eq(locations.id, appointments.locationId))
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .leftJoin(patients, eq(patients.id, appointments.patientId))
      .where(
        and(
          eq(appointments.clinicId, ctx.clinicId),
          eq(appointments.dentistId, ctx.dentistId),
          where,
        ),
      )
      .orderBy(asc(appointments.startAt));
    return rows.map(({ clientName, clientPhone, ...row }) => ({
      ...row,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      // Клиента нет только у холда; телефона может не быть — врач записал без номера
      client: clientName ? { fullName: clientName, phone: clientPhone } : null,
    }));
  }

  app.get('/schedule', async (request): Promise<MiniappSchedule> => {
    const ctx = dentistOf(request);
    const { dentistId, clinicId, timeZone } = ctx;
    const { from, to, cancelled } = parse(scheduleQuerySchema, request.query);
    if (to < from || addDays(from, AVAILABILITY_MAX_DAYS - 1) < to) {
      throw new ApiError(400, 'validation_failed', 'Invalid fields: to');
    }
    const start = dayBounds(from, timeZone).start;
    const end = dayBounds(to, timeZone).end;
    const rows = await ownAppointments(
      ctx,
      and(
        inArray(appointments.status, cancelled ? SCHEDULE_WITH_CANCELLED : SCHEDULE_STATUSES),
        lt(appointments.startAt, end),
        gt(appointments.endAt, start),
      ),
    );
    const blocks = await db
      .select({
        id: scheduleExceptions.id,
        startAt: scheduleExceptions.startAt,
        endAt: scheduleExceptions.endAt,
        reason: scheduleExceptions.reason,
      })
      .from(scheduleExceptions)
      .where(
        and(
          eq(scheduleExceptions.clinicId, clinicId),
          eq(scheduleExceptions.dentistId, dentistId),
          eq(scheduleExceptions.type, 'block'),
          lt(scheduleExceptions.startAt, end),
          gt(scheduleExceptions.endAt, start),
        ),
      )
      .orderBy(asc(scheduleExceptions.startAt));
    return {
      timeZone,
      appointments: rows,
      blocks: blocks.map((b) => ({
        ...b,
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
      })),
    };
  });

  /** Закрыть время. На нём записи — отказ со списком, переносит регистратура (§8). */
  app.post('/blocks', async (request, reply) => {
    const { dentistId, clinicId } = dentistOf(request);
    const input = parse(miniappBlockSchema, request.body);
    const block = await db.transaction(async (tx) => {
      await lockDentist(tx, dentistId);
      const conflicts = await findConflictingAppointments(tx, {
        clinicId,
        dentistId,
        start: input.startAt,
        end: input.endAt,
        now: new Date(),
      });
      if (conflicts.length > 0) throw timeHasAppointments(conflicts);
      const [row] = await tx
        .insert(scheduleExceptions)
        .values({
          clinicId,
          dentistId,
          type: 'block',
          startAt: input.startAt,
          endAt: input.endAt,
          reason: input.reason ?? null,
          createdBy: null,
        })
        .returning({ id: scheduleExceptions.id });
      return row!;
    });
    await cache?.invalidateDentist(clinicId, dentistId);
    return reply.status(201).send(block);
  });

  app.delete('/blocks/:id', async (request, reply) => {
    const { dentistId, clinicId } = dentistOf(request);
    const rows = await db
      .delete(scheduleExceptions)
      .where(
        and(
          eq(scheduleExceptions.id, idOf(request)),
          eq(scheduleExceptions.clinicId, clinicId),
          eq(scheduleExceptions.dentistId, dentistId),
          eq(scheduleExceptions.type, 'block'),
        ),
      )
      .returning({ id: scheduleExceptions.id });
    if (rows.length === 0) throw notFound();
    await cache?.invalidateDentist(clinicId, dentistId);
    return reply.status(204).send();
  });

  /**
   * Свободное время врача на дату — для записи своего клиента, без минимального запаса.
   * Услуга — из каталога (id) или разовая (id = null, только длительность).
   * excludeAppointmentId — для переноса: время самой записи не считается занятым. Записи
   * другого врача в расчёт и так не попадают, поэтому чужой id ничего не открывает.
   */
  async function freeSlots(
    ctx: DentistContext,
    service: { id: string | null; durationMin?: number | undefined },
    locationId: string,
    date: string,
    excludeAppointmentId?: string,
  ) {
    const result = await computeAvailability(db, {
      clinicId: ctx.clinicId,
      serviceId: service.id,
      durationMin: service.durationMin,
      locationId,
      dentistId: ctx.dentistId,
      from: date,
      to: date,
      now: new Date(),
      includeHidden: true,
      ignoreLeadTime: true,
      ...(excludeAppointmentId ? { excludeAppointmentId } : {}),
    });
    return { timeZone: result.timeZone, slots: result.days[0]?.slots.map((s) => s.start) ?? [] };
  }

  /**
   * Занятое время врача на дату — чтобы сетка показала его рядом со свободным: запись —
   * одной клеткой на время начала, закрытое время — тоже (с начала дня, если началось
   * раньше). Прошедшее не показывается; запись, которую переносят, — тоже.
   */
  async function busyTimes(
    ctx: DentistContext,
    date: string,
    timeZone: string,
    excludeAppointmentId?: string,
  ): Promise<MiniappBusyTime[]> {
    const { start, end } = dayBounds(date, timeZone);
    const now = new Date();
    const [booked, closed] = await Promise.all([
      db
        .select({ id: appointments.id, status: appointments.status, startAt: appointments.startAt })
        .from(appointments)
        .where(
          and(
            eq(appointments.clinicId, ctx.clinicId),
            eq(appointments.dentistId, ctx.dentistId),
            takesDentistTime(now),
            gte(appointments.startAt, start),
            lt(appointments.startAt, end),
            gt(appointments.blockedUntil, now),
            excludeAppointmentId ? ne(appointments.id, excludeAppointmentId) : undefined,
          ),
        ),
      db
        .select({ startAt: scheduleExceptions.startAt })
        .from(scheduleExceptions)
        .where(
          and(
            eq(scheduleExceptions.clinicId, ctx.clinicId),
            eq(scheduleExceptions.dentistId, ctx.dentistId),
            eq(scheduleExceptions.type, 'block'),
            lt(scheduleExceptions.startAt, end),
            gt(scheduleExceptions.endAt, start > now ? start : now),
          ),
        ),
    ]);
    return [
      ...booked.map((b) => ({
        startAt: b.startAt,
        kind: 'booked' as const,
        // У холда записи ещё нет — открывать нечего
        ...(b.status === 'hold' ? {} : { appointmentId: b.id }),
      })),
      ...closed.map((c) => ({
        startAt: c.startAt < start ? start : c.startAt,
        kind: 'closed' as const,
      })),
    ]
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
      .map((b) => ({ ...b, startAt: b.startAt.toISOString() }));
  }

  /** Длительность своей записи в минутах — её могли изменить при записи. */
  async function ownDuration(ctx: DentistContext, appointmentId: string) {
    const [row] = await db
      .select({ startAt: appointments.startAt, endAt: appointments.endAt })
      .from(appointments)
      .where(
        and(
          eq(appointments.id, appointmentId),
          eq(appointments.clinicId, ctx.clinicId),
          eq(appointments.dentistId, ctx.dentistId),
        ),
      );
    return row ? (row.endAt.getTime() - row.startAt.getTime()) / 60_000 : undefined;
  }

  app.get('/slots', async (request): Promise<MiniappSlots> => {
    const ctx = dentistOf(request);
    const query = parse(miniappSlotsQuerySchema, request.query);
    // Перенос — по длительности самой записи, а не услуги
    const durationMin =
      (query.appointmentId && (await ownDuration(ctx, query.appointmentId))) || query.durationMin;
    const free = await freeSlots(
      ctx,
      { id: query.serviceId ?? null, durationMin },
      query.locationId,
      query.date,
      query.appointmentId,
    );
    const busy = await busyTimes(ctx, query.date, free.timeZone, query.appointmentId);
    return { ...free, busy };
  });

  /** Услуга из каталога, которую врач оказывает, — иначе 404. */
  async function providedService(ctx: DentistContext, serviceId: string | undefined) {
    if (!serviceId) throw notFound();
    const [service] = await db
      .select({
        id: services.id,
        durationMin: services.durationMin,
        bufferMin: services.bufferMin,
      })
      .from(services)
      .innerJoin(
        dentistServices,
        and(
          eq(dentistServices.serviceId, services.id),
          eq(dentistServices.dentistId, ctx.dentistId),
        ),
      )
      .where(and(eq(services.id, serviceId), eq(services.clinicId, ctx.clinicId)));
    if (!service) throw notFound();
    return service;
  }

  /**
   * Врач записывает своего клиента: без SMS-кода, запись сразу подтверждена. Услуга — из
   * каталога (с её длительностью или своей для этой записи, буфер — от услуги) или
   * «Другое»: длительность врач задаёт сам, название — «Другое» на языке
   * клиники, буфер после визита — шаг сетки клиники. Такая услуга сохраняется только для
   * этой записи (services.one_time).
   */
  app.post('/appointments', async (request, reply) => {
    const ctx = dentistOf(request);
    const input = parse(miniappBookingSchema, request.body);
    const { customService } = input;
    const service = customService
      ? {
          id: null,
          name: translate(ctx.clinicLocale, 'service.other'),
          durationMin: customService.durationMin,
          bufferMin: ctx.slotStepMin,
        }
      : {
          ...(await providedService(ctx, input.serviceId)),
          // Своя длительность этой записи; буфер — от услуги
          ...(input.durationMin ? { durationMin: input.durationMin } : {}),
        };

    const { timeZone, slots } = await freeSlots(
      ctx,
      service,
      input.locationId,
      localDateOf(input.startAt, (await officeZone(ctx, input.locationId)) ?? ctx.timeZone),
    );
    const startIso = input.startAt.toISOString();
    if (!slots.includes(startIso)) throw slotTaken(slots.slice(0, 6));

    const endAt = new Date(input.startAt.getTime() + service.durationMin * 60_000);
    try {
      const id = await db.transaction(async (tx) => {
        await lockDentist(tx, ctx.dentistId);
        const [booked] =
          service.id === null
            ? await tx
                .insert(services)
                .values({
                  clinicId: ctx.clinicId,
                  name: service.name,
                  durationMin: service.durationMin,
                  bufferMin: service.bufferMin,
                  isPublic: false,
                  oneTime: true,
                })
                .returning({ id: services.id })
            : [service];
        // Клиент с номером ищется по нему (Q9). Без номера совпасть не с чем: NULL в
        // уникальном ключе не равен NULL, и у такой записи свой клиент
        const [patient] = await tx
          .insert(patients)
          .values({
            clinicId: ctx.clinicId,
            fullName: input.client.fullName,
            phone: input.client.phone,
          })
          .onConflictDoUpdate({
            target: [patients.clinicId, patients.phone],
            set: { fullName: sql`excluded.full_name` },
          })
          .returning({ id: patients.id });
        const [row] = await tx
          .insert(appointments)
          .values({
            clinicId: ctx.clinicId,
            locationId: input.locationId,
            dentistId: ctx.dentistId,
            serviceId: booked!.id,
            patientId: patient!.id,
            startAt: input.startAt,
            endAt,
            bufferMin: service.bufferMin,
            blockedUntil: blockedUntil(endAt, service.bufferMin),
            status: 'confirmed',
            source: 'telegram',
            notes: input.notes ?? null,
          })
          .returning({ id: appointments.id });
        await recordEvent(tx, {
          clinicId: ctx.clinicId,
          appointmentId: row!.id,
          type: 'created',
          actor: { kind: 'dentist', dentistId: ctx.dentistId },
          changes: { startAt: { from: null, to: startIso } },
        });
        return row!.id;
      });
      await cache?.invalidateDentist(ctx.clinicId, ctx.dentistId);
      await notifier.appointmentCreated(ctx.clinicId, id, { alertDentist: false });
      return reply
        .status(201)
        .send({ id, startAt: startIso, endAt: endAt.toISOString(), timeZone });
    } catch (err) {
      if (isExclusionViolation(err))
        throw slotTaken(slots.filter((s) => s !== startIso).slice(0, 6));
      throw err;
    }
  });

  /**
   * Врач правит свою запись: клиента и комментарий. Клиент в клинике определяется
   * телефоном (Q9): новое имя меняет карточку клиента, новый телефон переводит запись на
   * клиента с этим номером. Клиент без номера есть только у своей записи: его имя правится
   * на месте, а убранный номер даёт записи нового клиента без номера — карточка клиента с
   * этим номером не трогается. В историю пишется только то, что действительно изменилось.
   */
  app.patch('/appointments/:id', async (request, reply) => {
    const { dentistId, clinicId } = dentistOf(request);
    const input = parse(miniappAppointmentUpdateSchema, request.body);
    const id = idOf(request);
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          patientId: appointments.patientId,
          notes: appointments.notes,
          fullName: patients.fullName,
          phone: patients.phone,
        })
        .from(appointments)
        .leftJoin(patients, eq(patients.id, appointments.patientId))
        .where(
          and(
            eq(appointments.id, id),
            eq(appointments.clinicId, clinicId),
            eq(appointments.dentistId, dentistId),
            inArray(appointments.status, SCHEDULE_STATUSES),
          ),
        )
        .for('update', { of: appointments });
      if (!current) throw notFound();

      const before =
        current.fullName !== null ? { fullName: current.fullName, phone: current.phone } : null;
      const notes = input.notes === undefined ? current.notes : input.notes || null;
      const changes: AppointmentChanges = {};
      if (
        input.client &&
        (input.client.fullName !== before?.fullName || input.client.phone !== before?.phone)
      ) {
        changes.client = { from: before, to: input.client };
      }
      if (notes !== current.notes) changes.notes = { from: current.notes, to: notes };

      let patientId = current.patientId;
      const client = changes.client?.to;
      if (client && client.phone === null && before?.phone === null && patientId) {
        await tx
          .update(patients)
          .set({ fullName: client.fullName })
          .where(and(eq(patients.id, patientId), eq(patients.clinicId, clinicId)));
      } else if (client) {
        const [patient] = await tx
          .insert(patients)
          .values({ clinicId, ...client })
          .onConflictDoUpdate({
            target: [patients.clinicId, patients.phone],
            set: { fullName: sql`excluded.full_name` },
          })
          .returning({ id: patients.id });
        patientId = patient!.id;
      }
      await tx
        .update(appointments)
        .set({ patientId, notes })
        .where(and(eq(appointments.id, id), eq(appointments.clinicId, clinicId)));
      if (patientId !== current.patientId) {
        // Напоминание уходит на телефон клиента из notifications.patient_id — на новый номер
        await tx
          .update(notifications)
          .set({ patientId })
          .where(
            and(
              eq(notifications.clinicId, clinicId),
              eq(notifications.appointmentId, id),
              eq(notifications.channel, 'sms'),
              eq(notifications.status, 'scheduled'),
            ),
          );
      }
      if (changes.client || changes.notes) {
        await recordEvent(tx, {
          clinicId,
          appointmentId: id,
          type: 'updated',
          actor: { kind: 'dentist', dentistId },
          changes,
        });
      }
    });
    return reply.status(204).send();
  });

  /** Перенос своей записи на другое свободное время: проверки и SMS клиенту — как в журнале. */
  app.post('/appointments/:id/move', async (request, reply) => {
    const { dentistId, clinicId } = dentistOf(request);
    const { startAt } = parse(miniappMoveSchema, request.body);
    await rescheduleAppointment(
      db,
      { cache, notifier },
      {
        clinicId,
        id: idOf(request),
        startAt,
        actor: { kind: 'dentist', dentistId },
        now: new Date(),
      },
    );
    return reply.status(204).send();
  });

  /** Отмена своей записи: время освобождается, клиенту SMS, напоминания снимаются. */
  app.post('/appointments/:id/cancel', async (request, reply) => {
    const { dentistId, clinicId } = dentistOf(request);
    await cancelByClinic(
      db,
      { cache, notifier },
      { clinicId, id: idOf(request), actor: { kind: 'dentist', dentistId }, now: new Date() },
    );
    return reply.status(204).send();
  });

  app.post('/appointments/:id/confirm', async (request) => {
    const { dentistId, clinicId } = dentistOf(request);
    const row = await db.transaction(async (tx) => {
      const [confirmed] = await tx
        .update(appointments)
        .set({ status: 'confirmed' })
        .where(
          and(
            eq(appointments.id, idOf(request)),
            eq(appointments.clinicId, clinicId),
            eq(appointments.dentistId, dentistId),
            eq(appointments.status, 'pending'),
          ),
        )
        .returning({ id: appointments.id, status: appointments.status });
      if (!confirmed) throw notFound();
      await recordEvent(tx, {
        clinicId,
        appointmentId: confirmed.id,
        type: 'confirmed',
        actor: { kind: 'dentist', dentistId },
      });
      return confirmed;
    });
    await notifier.appointmentConfirmed(clinicId, row.id);
    return row;
  });

  /** Одна своя запись — её открывает красная клетка в сетке времени. Чужая — 404 (§2.2). */
  app.get('/appointments/:id', async (request): Promise<MiniappAppointment> => {
    const [found] = await ownAppointments(
      dentistOf(request),
      and(
        eq(appointments.id, idOf(request)),
        inArray(appointments.status, SCHEDULE_WITH_CANCELLED),
      ),
    );
    if (!found) throw notFound();
    return found;
  });

  /** История своей записи: что, кем и когда изменено. Чужая запись — 404 (§2.2). */
  app.get('/appointments/:id/history', async (request): Promise<AppointmentHistory> => {
    const { dentistId, clinicId } = dentistOf(request);
    return loadHistory(db, { clinicId, appointmentId: idOf(request), dentistId });
  });

  async function officeZone(ctx: DentistContext, locationId: string) {
    const [office] = await db
      .select({ timeZone: zone })
      .from(locations)
      .innerJoin(clinics, eq(clinics.id, locations.clinicId))
      .where(and(eq(locations.id, locationId), eq(locations.clinicId, ctx.clinicId)));
    if (!office) throw notFound();
    return office.timeZone;
  }
};
