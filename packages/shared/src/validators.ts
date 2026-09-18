/**
 * Общие zod-валидаторы (CLAUDE.md §9): одни и те же схемы проверяют вход API
 * и формы админки.
 */
import { z } from 'zod';

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** IANA-пояс, известный Intl: CHECK в БД этого проверить не может (schema.sql). */
export const timeZoneSchema = z.string().trim().min(1).refine(isTimeZone, 'Unknown time zone');

export const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code, e.g. USD');

export const emailSchema = z.string().trim().max(254).pipe(z.email());

/** Пароль сотрудника. Верхняя граница — защита от долгого хеширования. */
export const passwordSchema = z.string().min(10).max(200);

export const nameSchema = z.string().trim().min(1).max(200);

export const uuidSchema = z.uuid();

/** Телефон в E.164: '+12025550123'. Приводит к нему форма записи. */
export const phoneSchema = z.string().regex(/^\+[1-9]\d{6,14}$/, 'E.164, e.g. +12025550123');
