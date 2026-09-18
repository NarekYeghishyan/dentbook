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

export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
