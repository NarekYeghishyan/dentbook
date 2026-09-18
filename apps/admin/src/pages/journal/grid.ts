/**
 * Геометрия сетки журнала: минуты местных суток офиса ↔ пиксели (§2.3). Сетка — по
 * настенным часам: запись в 10:00 стоит на 10:00 и в день перевода часов.
 */
import { dateIn, minutesOfDay } from '../../lib/time';

/** Пикселей на минуту: час — 72 px, 15 минут — 18 px. */
export const PX_PER_MIN = 1.2;
export const DAY_MIN = 24 * 60;

/** Отрезок местных суток в минутах от полуночи, [from, to). */
export interface DaySpan {
  from: number;
  to: number;
}

/**
 * Часть интервала UTC, попадающая в местную дату date: то, что до полуночи, начинается
 * с 0, что после — кончается в 1440. Не задевает дату — null.
 */
export function spanOnDate(
  startIso: string,
  endIso: string,
  date: string,
  timeZone: string,
): DaySpan | null {
  const startDate = dateIn(startIso, timeZone);
  const endDate = dateIn(endIso, timeZone);
  if (startDate > date || endDate < date) return null;
  const from = startDate < date ? 0 : minutesOfDay(startIso, timeZone);
  const to = endDate > date ? DAY_MIN : minutesOfDay(endIso, timeZone);
  return to > from ? { from, to } : null;
}

/** Высота сетки: от самой ранней смены или записи до самой поздней, по целым часам. */
export function gridSpan(spans: DaySpan[], fallback: DaySpan = { from: 8 * 60, to: 18 * 60 }) {
  if (spans.length === 0) return fallback;
  const from = Math.min(...spans.map((s) => s.from));
  const to = Math.max(...spans.map((s) => s.to));
  return { from: Math.floor(from / 60) * 60, to: Math.min(DAY_MIN, Math.ceil(to / 60) * 60) };
}

/** Перетаскивание на deltaPx по вертикали → новое время, кратно шагу клиники. */
export function droppedMinutes(oldMinutes: number, deltaPx: number, stepMin: number): number {
  return oldMinutes + Math.round(deltaPx / PX_PER_MIN / stepMin) * stepMin;
}

/** Клик на offsetPx от верха сетки → время начала по сетке шага. */
export function clickedMinutes(offsetPx: number, gridFrom: number, stepMin: number): number {
  return gridFrom + Math.floor(offsetPx / PX_PER_MIN / stepMin) * stepMin;
}
