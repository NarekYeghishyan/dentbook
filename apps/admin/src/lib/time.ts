/**
 * Время в админке показывается и вводится в поясе филиала (или клиники), а не браузера
 * (CLAUDE.md §2.3). Перевод — тем же @dentbook/core, что считает слоты на сервере.
 */
import { addDays, isoWeekday, localDateOf, zonedTimeToUtc } from '@dentbook/core';

export { addDays };

/** 'HH:MM' → минуты от полуночи. */
const minutesOf = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h! * 60 + m!;
};

/** Настенные дата и время в поясе → ISO UTC для API. */
export const wallTimeToIso = (date: string, time: string, timeZone: string) =>
  zonedTimeToUtc(date, minutesOf(time), timeZone).toISOString();

/** Сегодняшняя дата в поясе. */
export const todayIn = (timeZone: string) => localDateOf(new Date(), timeZone);

/** Местная дата момента в поясе. */
export const dateIn = (iso: string, timeZone: string) => localDateOf(new Date(iso), timeZone);

/** Минуты от местной полуночи — по настенным часам пояса (для сетки журнала). */
export function minutesOfDay(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return value('hour') * 60 + value('minute');
}

/** Настенные дата и минуты от полуночи в поясе → ISO UTC. */
export const atMinutes = (date: string, minutes: number, timeZone: string) =>
  zonedTimeToUtc(date, minutes, timeZone).toISOString();

/** Первое и последнее число месяца даты. */
export const monthStartOf = (date: string) => `${date.slice(0, 8)}01`;
export function monthEndOf(date: string): string {
  const [year, month] = date.split('-').map(Number);
  const next =
    month === 12 ? `${year! + 1}-01-01` : `${year}-${String(month! + 1).padStart(2, '0')}-01`;
  return addDays(next, -1);
}

/** Понедельник недели, в которую входит дата. */
export const mondayOf = (date: string) => addDays(date, 1 - isoWeekday(date));

export function formatTime(iso: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
}

export function formatDateTime(iso: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** Календарная дата без пояса: форматируется как UTC, чтобы не съехать на сутки. */
export function formatDate(
  date: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' },
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** Название дня недели ISO (1 — понедельник). 2024-01-01 — понедельник. */
export const weekdayName = (weekday: number, locale: string) =>
  formatDate(`2024-01-0${weekday}`, locale, { weekday: 'long' });

export const timeZones = (): string[] => Intl.supportedValuesOf('timeZone');

/** Смещение пояса от UTC в момент `at`: 'GMT+4', 'GMT-5', 'GMT+5:30', 'GMT' — сам UTC. */
export function utcOffset(timeZone: string, at: Date = new Date()): string {
  return (
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  );
}

/** Подпись пояса в списках: 'Asia/Yerevan (GMT+4)'. Смещение — текущее, с учётом летнего времени. */
export const timeZoneLabel = (timeZone: string, at?: Date) =>
  `${timeZone} (${utcOffset(timeZone, at)})`;

export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
