/**
 * API Mini App врача /v1/miniapp (§8, Шаг 7). Вход — `Authorization: tma <initData>`:
 * подпись и свежесть проверяет verifyInitData, врач находится по user.id =
 * dentists.telegram_chat_id. Врач видит и меняет только своё: clinicId и dentistId берутся
 * из подписи, не из запроса (§2.2).
 */
import { and, asc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
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
  patients,
  scheduleExceptions,
  services,
  type Database,
} from '@dentbook/db';
import {
  AVAILABILITY_MAX_DAYS,
  miniappBlockSchema,
  miniappBookingSchema,
  miniappSlotsQuerySchema,
  scheduleQuerySchema,
  type MiniappMe,
  type MiniappSchedule,
  type MiniappSlots,
} from '@dentbook/shared';
import type { Locale } from '@dentbook/shared/domain';
import { ApiError, forbidden, notFound, parse, unauthorized } from '../../lib/errors.js';
import { idOf } from '../../lib/params.js';
import { computeAvailability } from '../../services/availability.js';
import type { Notifier } from '../../services/notifier.js';
import { slotTaken } from '../../services/holds.js';
import { findConflictingAppointments, timeHasAppointments } from '../../services/schedule.js';
import type { SlotCache } from '../../services/slot-cache.js';
import { InitDataError, verifyInitData } from '../../telegram/verify-init-data.js';

interface DentistContext {
  dentistId: string;
  clinicId: string;
  timeZone: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    dentist: DentistContext | null;
  }
}

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
      })
      .from(dentists)
      .innerJoin(clinics, eq(clinics.id, dentists.clinicId))
      .where(eq(dentists.telegramChatId, userId));
    if (!row || !row.isActive || row.clinicStatus !== 'active') {
      throw forbidden('This Telegram account is not connected to an active dentist');
    }
    request.dentist = { dentistId: row.dentistId, clinicId: row.clinicId, timeZone: row.timeZone };
  });

  const zone = sql<string>`coalesce(${locations.timezone}, ${clinics.timezone})`;

  app.get('/me', async (request): Promise<MiniappMe> => {
    const { dentistId, clinicId } = dentistOf(request);
    const [me] = await db
      .select({
        id: dentists.id,
        fullName: dentists.fullName,
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
      dentist: { id: me!.id, fullName: me!.fullName },
      clinic: { name: me!.clinicName, locale: me!.locale as Locale, timezone: me!.timezone },
      locations: offices,
      services: own,
    };
  });

  app.get('/schedule', async (request): Promise<MiniappSchedule> => {
    const { dentistId, clinicId, timeZone } = dentistOf(request);
    const { from, to } = parse(scheduleQuerySchema, request.query);
    if (to < from || addDays(from, AVAILABILITY_MAX_DAYS - 1) < to) {
      throw new ApiError(400, 'validation_failed', 'Invalid fields: to');
    }
    const start = dayBounds(from, timeZone).start;
    const end = dayBounds(to, timeZone).end;
    const rows = await db
      .select({
        id: appointments.id,
        status: appointments.status,
        startAt: appointments.startAt,
        endAt: appointments.endAt,
        timeZone: zone,
        service: services.name,
        office: locations.name,
        clientName: patients.fullName,
        clientPhone: patients.phone,
        notes: appointments.notes,
        source: appointments.source,
      })
      .from(appointments)
      .innerJoin(clinics, eq(clinics.id, appointments.clinicId))
      .innerJoin(locations, eq(locations.id, appointments.locationId))
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .leftJoin(patients, eq(patients.id, appointments.patientId))
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          eq(appointments.dentistId, dentistId),
          inArray(appointments.status, ['pending', 'confirmed', 'completed', 'no_show']),
          lt(appointments.startAt, end),
          gt(appointments.endAt, start),
        ),
      )
      .orderBy(asc(appointments.startAt));
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
      appointments: rows.map(({ clientName, clientPhone, ...row }) => ({
        ...row,
        startAt: row.startAt.toISOString(),
        endAt: row.endAt.toISOString(),
        client: clientName && clientPhone ? { fullName: clientName, phone: clientPhone } : null,
      })),
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

  /** Свободное время врача на дату — для записи своего клиента, без минимального запаса. */
  async function freeSlots(
    ctx: DentistContext,
    serviceId: string,
    locationId: string,
    date: string,
  ) {
    const result = await computeAvailability(db, {
      clinicId: ctx.clinicId,
      serviceId,
      locationId,
      dentistId: ctx.dentistId,
      from: date,
      to: date,
      now: new Date(),
      includeHidden: true,
      ignoreLeadTime: true,
    });
    return { timeZone: result.timeZone, slots: result.days[0]?.slots.map((s) => s.start) ?? [] };
  }

  app.get('/slots', async (request): Promise<MiniappSlots> => {
    const query = parse(miniappSlotsQuerySchema, request.query);
    return freeSlots(dentistOf(request), query.serviceId, query.locationId, query.date);
  });

  /** Врач записывает своего клиента: без SMS-кода, запись сразу подтверждена. */
  app.post('/appointments', async (request, reply) => {
    const ctx = dentistOf(request);
    const input = parse(miniappBookingSchema, request.body);
    const [service] = await db
      .select({ durationMin: services.durationMin, bufferMin: services.bufferMin })
      .from(services)
      .innerJoin(
        dentistServices,
        and(
          eq(dentistServices.serviceId, services.id),
          eq(dentistServices.dentistId, ctx.dentistId),
        ),
      )
      .where(and(eq(services.id, input.serviceId), eq(services.clinicId, ctx.clinicId)));
    if (!service) throw notFound();

    const { timeZone, slots } = await freeSlots(
      ctx,
      input.serviceId,
      input.locationId,
      localDateOf(input.startAt, (await officeZone(ctx, input.locationId)) ?? ctx.timeZone),
    );
    const startIso = input.startAt.toISOString();
    if (!slots.includes(startIso)) throw slotTaken(slots.slice(0, 6));

    const endAt = new Date(input.startAt.getTime() + service.durationMin * 60_000);
    try {
      const id = await db.transaction(async (tx) => {
        await lockDentist(tx, ctx.dentistId);
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
            serviceId: input.serviceId,
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

  app.post('/appointments/:id/confirm', async (request) => {
    const { dentistId, clinicId } = dentistOf(request);
    const [row] = await db
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
    if (!row) throw notFound();
    await notifier.appointmentConfirmed(clinicId, row.id);
    return row;
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
