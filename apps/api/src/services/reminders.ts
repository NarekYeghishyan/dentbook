/**
 * Напоминания клиенту за 24 ч и за 2 ч до визита (§10, Шаг 8). Время — абсолютное
 * смещение от начала в UTC, поэтому переход на летнее время его не сдвигает: «за 24 часа»
 * — ровно 24 часа, даже если в эти сутки часы переводили.
 */
import { REMINDER_OFFSETS_MS, type ReminderKind } from '@dentbook/shared/queues';

export interface PlannedReminder {
  kind: ReminderKind;
  at: Date;
}

/** Напоминания, время которых ещё не наступило. Запись за 3 часа — только за 2 ч. */
export function planReminders(startAt: Date, now: Date): PlannedReminder[] {
  return (Object.entries(REMINDER_OFFSETS_MS) as [ReminderKind, number][])
    .map(([kind, offset]) => ({ kind, at: new Date(startAt.getTime() - offset) }))
    .filter(({ at }) => at > now);
}
