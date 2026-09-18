/**
 * Перевод настенного времени филиала в UTC и обратно (CLAUDE.md §2.3).
 * Только Intl — без библиотек и без пояса сервера. Решения — ADR-0005.
 */
import { MINUTE_MS } from './intervals.js';
import type { Interval } from './types.js';

/** Календарная дата 'YYYY-MM-DD' без привязки к поясу. */
export type LocalDate = string;

const DAY_MS = 86_400_000;
const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    // Неизвестный пояс — RangeError от самого Intl
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Настенное время момента в поясе, записанное как «UTC-миллисекунды». */
function wallClockMs(instantMs: number, timeZone: string): number {
  const p: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of formatter(timeZone).formatToParts(instantMs)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
}

/** Смещение пояса от UTC в момент instant, мс (местное минус UTC). */
function offsetMs(instantMs: number, timeZone: string): number {
  const seconds = Math.floor(instantMs / 1000) * 1000;
  return wallClockMs(seconds, timeZone) - seconds;
}

/** 'YYYY-MM-DD' → полночь этой даты как UTC-миллисекунды. */
function parseLocalDate(date: LocalDate): number {
  const m = LOCAL_DATE_RE.exec(date);
  const ms = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new RangeError(`Invalid local date: ${date}`);
  }
  return ms;
}

const formatLocalDate = (ms: number): LocalDate => new Date(ms).toISOString().slice(0, 10);

export function addDays(date: LocalDate, days: number): LocalDate {
  return formatLocalDate(parseLocalDate(date) + days * DAY_MS);
}

/** ISO 8601: 1 — понедельник … 7 — воскресенье (как working_hours.weekday). */
export function isoWeekday(date: LocalDate): number {
  const day = new Date(parseLocalDate(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Местная дата момента в поясе. */
export function localDateOf(instant: Date, timeZone: string): LocalDate {
  return formatLocalDate(wallClockMs(Math.floor(instant.getTime() / 1000) * 1000, timeZone));
}

/**
 * Настенное время (дата + минуты от полуночи) в поясе → момент UTC.
 * minuteOfDay может выходить за сутки: 1440 — полночь следующей даты.
 *
 * Переход на летнее время:
 * - несуществующее время (весной 02:30 при переводе 02:00 → 03:00) сдвигается вперёд
 *   на величину перевода — 03:30;
 * - неоднозначное (осенью 01:30 бывает дважды) — первое из двух.
 * Так же поступает Temporal с disambiguation: 'compatible'.
 */
export function zonedTimeToUtc(date: LocalDate, minuteOfDay: number, timeZone: string): Date {
  const wall = parseLocalDate(date) + minuteOfDay * MINUTE_MS;
  // Смещения до и после возможного перевода: переводы в одном поясе
  // не бывают чаще раза в двое суток.
  const offsetBefore = offsetMs(wall - DAY_MS, timeZone);
  const offsetAfter = offsetMs(wall + DAY_MS, timeZone);
  const withBefore = wall - offsetBefore;
  const withAfter = wall - offsetAfter;
  const beforeValid = offsetMs(withBefore, timeZone) === offsetBefore;
  const afterValid = offsetMs(withAfter, timeZone) === offsetAfter;

  if (beforeValid && afterValid) return new Date(Math.min(withBefore, withAfter));
  if (afterValid) return new Date(withAfter);
  // Либо время до перевода, либо «дыра» — смещение до перевода сдвигает вперёд
  return new Date(withBefore);
}

/** Местные сутки даты в UTC: [полночь date, полночь следующей даты). 23 или 25 ч в дни перевода. */
export function dayBounds(date: LocalDate, timeZone: string): Interval {
  return {
    start: zonedTimeToUtc(date, 0, timeZone),
    end: zonedTimeToUtc(addDays(date, 1), 0, timeZone),
  };
}
