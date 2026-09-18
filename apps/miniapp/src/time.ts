/**
 * Время в Mini App показывается и вводится в поясе офиса (или клиники), а не телефона
 * врача (CLAUDE.md §2.3). Перевод — тем же @dentbook/core, что считает слоты на сервере.
 */
import { localDateOf, zonedTimeToUtc } from '@dentbook/core';

export { addDays } from '@dentbook/core';

/** Настенные дата и время 'HH:MM' в поясе → ISO UTC для API. */
export function wallTimeToIso(date: string, time: string, timeZone: string): string {
  const [h, m] = time.split(':').map(Number);
  return zonedTimeToUtc(date, h! * 60 + m!, timeZone).toISOString();
}

export const todayIn = (timeZone: string) => localDateOf(new Date(), timeZone);

export const dateIn = (iso: string, timeZone: string) => localDateOf(new Date(iso), timeZone);

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
export function formatDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}
