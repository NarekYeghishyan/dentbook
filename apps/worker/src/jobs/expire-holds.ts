/**
 * Очистка истёкших холдов (§4, Шаг 5): hold с прошедшим hold_expires_at → expired, и сброс
 * кеша слотов этих врачей (§6) — слот возвращается в форму записи, не дожидаясь TTL кеша.
 * Новый холд на это время ставится и до очистки: API снимает мешающий истёкший холд сам.
 */
import type { Redis } from 'ioredis';
import { expireStaleHolds, type Database } from '@dentbook/db';
import { dentistSlotsPattern } from '@dentbook/shared/cache-keys';

export const EXPIRE_HOLDS_QUEUE = 'expire-holds';
export const EXPIRE_HOLDS_EVERY_MS = 60_000;

async function unlinkMatching(redis: Redis, pattern: string): Promise<void> {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    if (keys.length > 0) await redis.unlink(...keys);
    cursor = next;
  } while (cursor !== '0');
}

/** Возвращает число снятых холдов. */
export async function expireHolds(
  db: Database,
  redis: Redis,
  now: Date = new Date(),
): Promise<number> {
  const expired = await expireStaleHolds(db, now);
  const dentists = new Map(expired.map((e) => [`${e.clinicId}:${e.dentistId}`, e]));
  for (const { clinicId, dentistId } of dentists.values()) {
    await unlinkMatching(redis, dentistSlotsPattern(clinicId, dentistId));
  }
  return expired.length;
}
