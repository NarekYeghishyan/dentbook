/** Общие операции над записями для api и worker. */
import { and, eq, gt, lte, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { appointments } from './schema/index.js';

/** Транзакция Drizzle — те же запросы, что у Database. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;

/**
 * Конец времени, которое держит запись: end_at + buffer_min (Q11). Колонку заполняет код,
 * CHECK appointments_blocked_until сверяет.
 */
export const blockedUntil = (endAt: Date, bufferMin: number): Date =>
  new Date(endAt.getTime() + bufferMin * 60_000);

/**
 * Advisory-lock на врача до конца транзакции. Его берут создание холда и закрытие
 * времени (block): проверка «на это время нет записей» и вставка идут без гонки.
 * Двойную бронь по-прежнему исключает только EXCLUDE (§2.1) — блокировка её не заменяет.
 */
export async function lockDentist(tx: Transaction, dentistId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${dentistId}, 0))`);
}

/**
 * Холды с истёкшим сроком → expired, слот освобождается. С фильтром — только холды врача,
 * пересекающие интервал: так новый холд не упирается в EXCLUDE из-за холда, который
 * worker ещё не успел снять. Возвращает врачей снятых холдов — их слоты в кеше устарели.
 */
export async function expireStaleHolds(
  db: Executor,
  now: Date,
  filter?: { dentistId: string; start: Date; end: Date },
): Promise<{ clinicId: string; dentistId: string }[]> {
  const rows = await db
    .update(appointments)
    .set({ status: 'expired' })
    .where(
      and(
        eq(appointments.status, 'hold'),
        lte(appointments.holdExpiresAt, now),
        filter ? eq(appointments.dentistId, filter.dentistId) : undefined,
        filter ? sql`${appointments.startAt} < ${filter.end}` : undefined,
        filter ? gt(appointments.blockedUntil, filter.start) : undefined,
      ),
    )
    .returning({ clinicId: appointments.clinicId, dentistId: appointments.dentistId });
  return rows;
}
