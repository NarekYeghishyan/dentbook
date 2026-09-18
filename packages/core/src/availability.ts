/**
 * Движок доступности (CLAUDE.md §6). Чистые функции: всё нужное передаётся
 * аргументами, время — UTC. Решения по сетке и суткам — ADR-0005.
 */
import { coversSpan, MINUTE_MS, subtractSpans, toSpan, type Span } from './intervals.js';
import { dayBounds, type LocalDate } from './tz.js';
import type { ComputeSlotsInput, ScheduleException } from './types.js';
import { workingIntervalsForDate, type WeeklyHours } from './working-hours.js';

function assertMinutes(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${name} must be an integer >= ${min}, got ${value}`);
  }
}

const spansOfType = (exceptions: readonly ScheduleException[], type: 'block' | 'extra'): Span[] =>
  exceptions.filter((e) => e.type === type).map((e) => toSpan(e.interval));

/**
 * Свободные слоты одного врача, по возрастанию.
 *
 * 1. база — рабочие часы;
 * 2. плюс extra;
 * 3. минус block;
 * 4. минус записи, расширенные на свой буфер;
 * 5. минус всё раньше notBefore;
 * 6. нарезка сеткой stepMin: слот валиден, если в свободное время влезает
 *    durationMin + bufferMin.
 *
 * Узлы сетки отсчитываются от начала каждого интервала рабочих часов и каждого
 * extra: записи, block и notBefore сетку не сдвигают.
 */
export function computeSlots(input: ComputeSlotsInput): Date[] {
  const { durationMin, bufferMin, stepMin } = input;
  assertMinutes('durationMin', durationMin, 1);
  assertMinutes('bufferMin', bufferMin, 0);
  assertMinutes('stepMin', stepMin, 1);

  // 1–2
  const base = [...input.workingHours.map(toSpan), ...spansOfType(input.exceptions, 'extra')];

  // 3–5
  const notBefore = input.notBefore.getTime();
  const busy = input.appointments.map((a) => {
    assertMinutes('appointment bufferMin', a.bufferMin, 0);
    const span = toSpan(a.interval);
    return { start: span.start, end: span.end + a.bufferMin * MINUTE_MS };
  });
  const free = subtractSpans(base, [
    ...spansOfType(input.exceptions, 'block'),
    ...busy,
    { start: -Infinity, end: notBefore },
  ]);

  // 6
  const step = stepMin * MINUTE_MS;
  const need = (durationMin + bufferMin) * MINUTE_MS;
  const starts = new Set<number>();
  for (const source of base) {
    // Первый узел сетки не раньше notBefore
    const skip = Math.max(0, Math.ceil((notBefore - source.start) / step));
    for (let t = source.start + skip * step; t < source.end; t += step) {
      if (coversSpan(free, t, t + need)) starts.add(t);
    }
  }
  return [...starts].sort((a, b) => a - b).map((t) => new Date(t));
}

/** «Любой врач» (§6): объединение слотов нескольких врачей без повторов, по возрастанию. */
export function mergeSlots(slotLists: readonly (readonly Date[])[]): Date[] {
  const unique = new Set<number>();
  for (const list of slotLists) {
    for (const slot of list) unique.add(slot.getTime());
  }
  return [...unique].sort((a, b) => a - b).map((t) => new Date(t));
}

export interface ComputeDaySlotsInput extends Omit<ComputeSlotsInput, 'workingHours'> {
  /** Местная дата в поясе филиала. */
  date: LocalDate;
  /** IANA-пояс филиала, а если не задан — клиники (§2.3). */
  timeZone: string;
  /** Шаблон working_hours врача в этом филиале. */
  weeklyHours: readonly WeeklyHours[];
}

/**
 * Слоты врача, которые начинаются в местную дату date.
 * Слот принадлежит дате своего начала: ночная смена даёт слоты двум датам.
 * exceptions и appointments должны покрывать смены, задевающие дату, —
 * от начала предыдущих местных суток до конца следующих.
 */
export function computeDaySlots(input: ComputeDaySlotsInput): Date[] {
  const day = dayBounds(input.date, input.timeZone);
  const slots = computeSlots({
    workingHours: workingIntervalsForDate(input.weeklyHours, input.date, input.timeZone),
    exceptions: input.exceptions,
    appointments: input.appointments,
    durationMin: input.durationMin,
    bufferMin: input.bufferMin,
    stepMin: input.stepMin,
    notBefore: input.notBefore,
  });
  return slots.filter((s) => s >= day.start && s < day.end);
}
