/**
 * Недельный шаблон working_hours → UTC-интервалы на конкретную дату (schema.sql).
 * Время в шаблоне настенное, в поясе филиала; end <= start — смена через полночь,
 * weekday — день начала смены.
 */
import { addDays, isoWeekday, zonedTimeToUtc, type LocalDate } from './tz.js';
import type { Interval } from './types.js';

export interface WeeklyHours {
  /** ISO 8601: 1 — понедельник … 7 — воскресенье; день начала смены. */
  weekday: number;
  /** 'HH:MM' или 'HH:MM:SS' — так Postgres отдаёт time. */
  startTime: string;
  endTime: string;
}

const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** 'HH:MM[:SS]' → минуты от полуночи. '24:00' — конец суток (Postgres допускает). */
export function parseTimeOfDay(value: string): number {
  const m = TIME_RE.exec(value);
  const hours = Number(m?.[1]);
  const minutes = Number(m?.[2]);
  const seconds = Number(m?.[3] ?? '0');
  const valid =
    m !== null && minutes <= 59 && seconds === 0 && (hours < 24 || (hours === 24 && minutes === 0));
  if (!valid) throw new RangeError(`Invalid time of day: ${value}`);
  return hours * 60 + minutes;
}

function shiftInterval(row: WeeklyHours, shiftDate: LocalDate, timeZone: string): Interval {
  const start = parseTimeOfDay(row.startTime);
  const end = parseTimeOfDay(row.endTime);
  if (start === end || start === 24 * 60) {
    throw new RangeError(`Empty working hours: ${row.startTime}–${row.endTime}`);
  }
  const overnight = end < start;
  return {
    start: zonedTimeToUtc(shiftDate, start, timeZone),
    end: zonedTimeToUtc(overnight ? addDays(shiftDate, 1) : shiftDate, end, timeZone),
  };
}

const isOvernight = (row: WeeklyHours): boolean =>
  parseTimeOfDay(row.endTime) < parseTimeOfDay(row.startTime);

/**
 * Смены, которые задевают местную дату date: начатые в эту дату и ночные смены
 * предыдущего дня. Интервалы целые, без обрезки по границе суток: слот, начатый
 * в 23:30, может закончиться после полуночи.
 */
export function workingIntervalsForDate(
  rows: readonly WeeklyHours[],
  date: LocalDate,
  timeZone: string,
): Interval[] {
  const previous = addDays(date, -1);
  const previousWeekday = isoWeekday(previous);
  const weekday = isoWeekday(date);
  const intervals: Interval[] = [];
  for (const row of rows) {
    if (row.weekday === previousWeekday && isOvernight(row)) {
      intervals.push(shiftInterval(row, previous, timeZone));
    }
    if (row.weekday === weekday) {
      intervals.push(shiftInterval(row, date, timeZone));
    }
  }
  return intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
}
