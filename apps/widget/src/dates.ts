/** Даты и время в поясе филиала (§2.3) — только Intl, без библиотек: бюджет 50 КБ. */

const DAY_MS = 86_400_000;

/** Сегодняшняя дата 'YYYY-MM-DD' в поясе (en-CA форматирует дату как ISO). */
export const todayIn = (timeZone: string, now = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!) + days * DAY_MS).toISOString().slice(0, 10);
}

export const formatTime = (iso: string, timeZone: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );

/** Календарная дата без пояса: как UTC, чтобы не съехать на сутки. */
export const formatDay = (date: string, locale: string, long = false): string =>
  new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: long ? 'long' : 'short',
    day: 'numeric',
    month: long ? 'long' : 'short',
  }).format(new Date(`${date}T00:00:00Z`));

/** День момента времени в поясе: «Monday, September 21». */
export const formatDateOf = (iso: string, timeZone: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(iso));
