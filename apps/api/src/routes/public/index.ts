/**
 * Публичный API /v1/public (CLAUDE.md §7) — для формы записи на сайте клиники.
 * Доступ — ключ pk_* и Origin из его списка (§2.5). Клиника берётся только из ключа:
 * id из пути или тела без неё ничего не открывает (§2.2).
 */
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Redis } from 'ioredis';
import { addDays } from '@dentbook/core';
import { clinics, locations, services, type Database } from '@dentbook/db';
import {
  AVAILABILITY_MAX_DAYS,
  appointmentTokenSchema,
  confirmAppointmentSchema,
  createHoldSchema,
  createVerificationSchema,
  publicAvailabilityQuerySchema,
  type PublicAvailability,
  type PublicConfig,
  type PublicService,
} from '@dentbook/shared';
import type { Locale } from '@dentbook/shared/domain';
import { ApiError, notFound, parse } from '../../lib/errors.js';
import { idOf } from '../../lib/params.js';
import { publicOf, registerPublicAuth } from '../../plugins/public-auth.js';
import { computeAvailability } from '../../services/availability.js';
import { cancelAppointment, confirmAppointment, getAppointment } from '../../services/booking.js';
import { createHold, releaseHold } from '../../services/holds.js';
import type { SlotCache } from '../../services/slot-cache.js';
import type { SmsSender } from '../../services/sms.js';
import { createVerification } from '../../services/verification.js';

export interface PublicRoutesOptions {
  db: Database;
  redis: Redis;
  cache?: SlotCache;
  sms?: SmsSender;
  holdTtlSec: number;
  /** Запросов в минуту на ключ (Q4: 60). */
  perKeyPerMin: number;
  /** Холдов и SMS-кодов в минуту с одного IP (Q4: 10). */
  perIpPerMin: number;
  /** Ключ HMAC для SMS-кодов. */
  verificationKey: Buffer;
}

export const publicRoutes: FastifyPluginAsync<PublicRoutesOptions> = async (app, opts) => {
  const { db, cache } = opts;
  registerPublicAuth(app, { db, redis: opts.redis, perKeyPerMin: opts.perKeyPerMin });
  const perIp = { rateLimit: { max: opts.perIpPerMin, timeWindow: 60_000 } };

  app.get('/config', async (request): Promise<PublicConfig> => {
    const { clinicId } = publicOf(request);
    const [clinic] = await db
      .select({
        name: clinics.name,
        locale: clinics.locale,
        currency: clinics.currency,
        timezone: clinics.timezone,
        theme: clinics.widgetTheme,
      })
      .from(clinics)
      .where(eq(clinics.id, clinicId));
    const offices = await db
      .select({
        id: locations.id,
        name: locations.name,
        address: locations.address,
        phone: locations.phone,
        timezone: locations.timezone,
      })
      .from(locations)
      .where(and(eq(locations.clinicId, clinicId), eq(locations.isActive, true)))
      .orderBy(asc(locations.sortOrder), asc(locations.name));
    return {
      clinic: { name: clinic!.name, locale: clinic!.locale as Locale, currency: clinic!.currency },
      theme: clinic!.theme,
      locations: offices.map(({ timezone, ...office }) => ({
        ...office,
        time_zone: timezone ?? clinic!.timezone,
      })),
    };
  });

  app.get('/services', async (request): Promise<PublicService[]> => {
    const { clinicId } = publicOf(request);
    const [clinic] = await db
      .select({ currency: clinics.currency })
      .from(clinics)
      .where(eq(clinics.id, clinicId));
    const rows = await db
      .select({
        id: services.id,
        name: services.name,
        description: services.description,
        duration_min: services.durationMin,
        price: services.price,
      })
      .from(services)
      .where(
        and(
          eq(services.clinicId, clinicId),
          eq(services.isActive, true),
          eq(services.isPublic, true),
        ),
      )
      .orderBy(asc(services.sortOrder), asc(services.name));
    return rows.map((row) => ({ ...row, currency: clinic!.currency }));
  });

  app.get('/availability', async (request): Promise<PublicAvailability> => {
    const query = parse(publicAvailabilityQuerySchema, request.query);
    if (query.to < query.from || addDays(query.from, AVAILABILITY_MAX_DAYS - 1) < query.to) {
      throw new ApiError(
        400,
        'validation_failed',
        `Invalid fields: to (1 to ${AVAILABILITY_MAX_DAYS} days from "from")`,
      );
    }
    const result = await computeAvailability(
      db,
      {
        clinicId: publicOf(request).clinicId,
        serviceId: query.service_id,
        locationId: query.location_id,
        from: query.from,
        to: query.to,
        now: new Date(),
        includeHidden: false,
      },
      cache,
    );
    // Врачи клиенту не показываются: запись — к «любому врачу» (§6)
    return {
      time_zone: result.timeZone,
      duration_min: result.durationMin,
      days: result.days.map((day) => ({ date: day.date, slots: day.slots.map((s) => s.start) })),
    };
  });

  app.post('/holds', { config: perIp }, async (request, reply) => {
    const input = parse(createHoldSchema, request.body);
    const hold = await createHold(db, cache, {
      clinicId: publicOf(request).clinicId,
      serviceId: input.service_id,
      locationId: input.location_id,
      startAt: input.start_at,
      now: new Date(),
      holdTtlSec: opts.holdTtlSec,
    });
    return reply.status(201).send(hold);
  });

  app.delete('/holds/:id', async (request, reply) => {
    await releaseHold(db, cache, { clinicId: publicOf(request).clinicId, holdId: idOf(request) });
    return reply.status(204).send();
  });

  app.post('/verifications', { config: perIp }, async (request, reply) => {
    const input = parse(createVerificationSchema, request.body);
    const verification = await createVerification(db, opts.sms, {
      clinicId: publicOf(request).clinicId,
      phone: input.phone,
      locale: input.locale,
      now: new Date(),
      key: opts.verificationKey,
    });
    return reply.status(201).send(verification);
  });

  app.post('/appointments', async (request, reply) => {
    const input = parse(confirmAppointmentSchema, request.body);
    const appointment = await confirmAppointment(db, input, {
      clinicId: publicOf(request).clinicId,
      now: new Date(),
      key: opts.verificationKey,
    });
    return reply.status(201).send(appointment);
  });

  app.get('/appointments/:id', async (request) => {
    const { token } = parse(appointmentTokenSchema, request.query);
    return getAppointment(db, { clinicId: publicOf(request).clinicId, id: idOf(request), token });
  });

  app.post('/appointments/:id/cancel', async (request) => {
    const result = appointmentTokenSchema.safeParse(request.body);
    if (!result.success) throw notFound();
    return cancelAppointment(db, cache, {
      clinicId: publicOf(request).clinicId,
      id: idOf(request),
      token: result.data.token,
      now: new Date(),
    });
  });
};
