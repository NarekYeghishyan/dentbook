/**
 * Рабочее время врача за диапазон дат — знаменатель загрузки на дашборде (Шаг 9).
 * Те же правила, что у слотов (§6): шаблон плюс extra минус block, всё в UTC.
 */
import { MINUTE_MS, normalizeSpans, subtractSpans, toSpan, type Span } from './intervals.js';
import { addDays, dayBounds, type LocalDate } from './tz.js';
import type { Interval, ScheduleException } from './types.js';
import { workingIntervalsForDate, type WeeklyHours } from './working-hours.js';

export interface WorkingMinutesInput {
  /** Шаблон врача в одном филиале. */
  weeklyHours: readonly WeeklyHours[];
  /** Исключения, задевающие диапазон: block — все, extra — этого филиала. */
  exceptions: readonly ScheduleException[];
  /** Местные даты филиала, включительно. */
  from: LocalDate;
  to: LocalDate;
  timeZone: string;
}

/**
 * Минуты рабочего времени в [начало from, конец to) по поясу филиала. Ночная смена
 * последнего дня обрезается концом диапазона, смена накануне from — его началом.
 */
export function workingMinutes(input: WorkingMinutesInput): number {
  const window: Span = {
    start: dayBounds(input.from, input.timeZone).start.getTime(),
    end: dayBounds(input.to, input.timeZone).end.getTime(),
  };
  const shifts: Interval[] = [];
  for (let date = input.from; date <= input.to; date = addDays(date, 1)) {
    shifts.push(...workingIntervalsForDate(input.weeklyHours, date, input.timeZone));
  }
  const spans = (type: 'block' | 'extra') =>
    input.exceptions.filter((e) => e.type === type).map((e) => toSpan(e.interval));
  const working = subtractSpans(
    [...shifts.map(toSpan), ...spans('extra')],
    [
      ...spans('block'),
      { start: -Infinity, end: window.start },
      { start: window.end, end: Infinity },
    ],
  );
  return normalizeSpans(working).reduce((sum, s) => sum + (s.end - s.start) / MINUTE_MS, 0);
}
