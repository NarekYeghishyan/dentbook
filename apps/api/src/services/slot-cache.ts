/**
 * Кеш слотов в Redis (CLAUDE.md §6): TTL 60 с, сброс при изменении записей или расписания
 * врача. Ключ — формат §6 плюс филиал в конце: у врача, работающего в двух филиалах,
 * слоты в них разные (ADR-0008). Префикс avail:{clinic}:{dentist}: остаётся как в §6.
 *
 * Кеш — ускорение, а не источник правды: сбой Redis не ломает ответ, а холд всегда
 * проверяет время по свежим данным.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { clinicSlotsPattern, dentistSlotsPattern, slotCacheKey } from '@dentbook/shared/cache-keys';

export interface SlotKey {
  clinicId: string;
  dentistId: string;
  /** Местная дата филиала. */
  date: string;
  serviceId: string;
  locationId: string;
}

export interface SlotCache {
  get(keys: SlotKey[]): Promise<(number[] | null)[]>;
  set(entries: { key: SlotKey; starts: number[] }[]): Promise<void>;
  /** Записи, исключения, шаблон, услуги или активность врача изменились. */
  invalidateDentist(clinicId: string, dentistId: string): Promise<void>;
  /** Настройки клиники, филиала или услуги изменились — все слоты клиники. */
  invalidateClinic(clinicId: string): Promise<void>;
}

export const SLOT_CACHE_TTL_SEC = 60;

export class RedisSlotCache implements SlotCache {
  constructor(
    private readonly redis: Redis,
    private readonly log: FastifyBaseLogger,
  ) {}

  async get(keys: SlotKey[]): Promise<(number[] | null)[]> {
    if (keys.length === 0) return [];
    try {
      const values = await this.redis.mget(keys.map(slotCacheKey));
      return values.map((v) => (v === null ? null : (JSON.parse(v) as number[])));
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'slot cache read failed');
      return keys.map(() => null);
    }
  }

  async set(entries: { key: SlotKey; starts: number[] }[]): Promise<void> {
    if (entries.length === 0) return;
    try {
      const pipeline = this.redis.pipeline();
      for (const { key, starts } of entries) {
        pipeline.set(slotCacheKey(key), JSON.stringify(starts), 'EX', SLOT_CACHE_TTL_SEC);
      }
      await pipeline.exec();
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'slot cache write failed');
    }
  }

  invalidateDentist(clinicId: string, dentistId: string): Promise<void> {
    return this.unlink(dentistSlotsPattern(clinicId, dentistId));
  }

  invalidateClinic(clinicId: string): Promise<void> {
    return this.unlink(clinicSlotsPattern(clinicId));
  }

  private async unlink(pattern: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
        if (keys.length > 0) await this.redis.unlink(...keys);
        cursor = next;
      } while (cursor !== '0');
    } catch (err) {
      // Не сбросили — устаревшие слоты проживут не дольше TTL
      this.log.warn({ err: (err as Error).message }, 'slot cache invalidation failed');
    }
  }
}
