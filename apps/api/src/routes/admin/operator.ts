/**
 * Панель оператора платформы (Шаг 10, Q18): клиники со сводкой и их блокировка, состояние
 * платформы. Роуты под /v1/admin/operator — там живёт cookie сессии. Оператор видит только
 * сводные числа: ни клиентов клиник, ни их телефонов (§2.6).
 */
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { appointments, clinics, dentists, notifications, users, type Database } from '@dentbook/db';
import {
  clinicStatusSchema,
  type OperatorClinic,
  type OperatorMe,
  type PlatformHealth,
} from '@dentbook/shared';
import { SMS_QUEUE, TELEGRAM_QUEUE } from '@dentbook/shared/queues';
import { notFound, parse, unauthorized } from '../../lib/errors.js';
import { idOf } from '../../lib/params.js';
import type { QueueInspector } from '../../services/queues.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface OperatorRoutesOptions {
  db: Database;
  queues?: QueueInspector;
  providers: PlatformHealth['providers'];
}

export const operatorRoutes: FastifyPluginAsync<OperatorRoutesOptions> = async (
  app,
  { db, queues, providers },
) => {
  app.addHook('onRequest', app.authenticateOperator);

  app.get('/me', async (request): Promise<OperatorMe> => {
    const [me] = await db
      .select({ id: users.id, fullName: users.fullName, email: users.email })
      .from(users)
      .where(eq(users.id, request.operator!.userId));
    if (!me) throw unauthorized();
    return me;
  });

  app.get('/clinics', async (): Promise<OperatorClinic[]> => {
    const now = new Date();
    const since = new Date(now.getTime() - 30 * DAY_MS);
    const [rows, owners, staff, bookings] = await Promise.all([
      db
        .select({
          id: clinics.id,
          name: clinics.name,
          status: clinics.status,
          timezone: clinics.timezone,
          createdAt: clinics.createdAt,
        })
        .from(clinics)
        .orderBy(asc(clinics.createdAt)),
      db
        .select({ clinicId: users.clinicId, fullName: users.fullName, email: users.email })
        .from(users)
        .where(eq(users.role, 'owner')),
      db
        .select({
          clinicId: dentists.clinicId,
          total: sql<number>`count(*)`.mapWith(Number),
          telegram: sql<number>`count(${dentists.telegramChatId})`.mapWith(Number),
        })
        .from(dentists)
        .where(eq(dentists.isActive, true))
        .groupBy(dentists.clinicId),
      db
        .select({
          clinicId: appointments.clinicId,
          recent:
            sql<number>`count(*) filter (where ${appointments.startAt} >= ${since} and ${appointments.startAt} < ${now})`.mapWith(
              Number,
            ),
          last: sql<string | null>`max(${appointments.createdAt})`,
        })
        .from(appointments)
        .where(inArray(appointments.status, ['pending', 'confirmed', 'completed', 'no_show']))
        .groupBy(appointments.clinicId),
    ]);
    return rows.map((c) => {
      const owner = owners.find((o) => o.clinicId === c.id);
      const team = staff.find((s) => s.clinicId === c.id);
      const booked = bookings.find((b) => b.clinicId === c.id);
      return {
        ...c,
        createdAt: c.createdAt.toISOString(),
        owner: owner ? { fullName: owner.fullName, email: owner.email } : null,
        dentists: team?.total ?? 0,
        telegramDentists: team?.telegram ?? 0,
        bookings30d: booked?.recent ?? 0,
        lastBookingAt: booked?.last ? new Date(booked.last).toISOString() : null,
      };
    });
  });

  /**
   * Приостановить или возобновить клинику. У приостановленной не работают форма записи
   * (invalid_key), панель (403) и Mini App; уже назначенным визитам клиенты получают
   * напоминания — визиты от блокировки не отменяются.
   */
  app.patch('/clinics/:id', async (request) => {
    const { status } = parse(clinicStatusSchema, request.body);
    const [row] = await db
      .update(clinics)
      .set({ status })
      .where(eq(clinics.id, idOf(request)))
      .returning({ id: clinics.id, status: clinics.status });
    if (!row) throw notFound();
    request.log.info({ clinicId: row.id, status }, 'clinic status changed by operator');
    return row;
  });

  app.get('/health', async (): Promise<PlatformHealth> => {
    const now = new Date();
    const counts = queues ? await queues.counts() : [];
    const failures = await db
      .select({
        channel: notifications.channel,
        lastError: notifications.lastError,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.status, 'failed'),
          gte(notifications.updatedAt, new Date(now.getTime() - DAY_MS)),
        ),
      )
      .groupBy(notifications.channel, notifications.lastError)
      .orderBy(asc(notifications.channel));
    const enabled: Record<string, boolean> = {
      [SMS_QUEUE]: providers.sms,
      [TELEGRAM_QUEUE]: providers.telegram,
    };
    return {
      checkedAt: now.toISOString(),
      providers,
      queues: counts.map((q) => ({ ...q, enabled: enabled[q.name] ?? true })),
      failures24h: failures,
    };
  });
};
