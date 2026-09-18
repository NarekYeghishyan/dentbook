import { describe, expect, it } from 'vitest';
import { addDays, formatDateOf, formatDay, formatTime, todayIn } from './dates';

describe('widget dates', () => {
  it('knows today in the office time zone, not the browser one', () => {
    const lateEvening = new Date('2026-03-02T03:30:00Z'); // 22:30 в Нью-Йорке 1 марта
    expect(todayIn('America/New_York', lateEvening)).toBe('2026-03-01');
    expect(todayIn('Asia/Yerevan', lateEvening)).toBe('2026-03-02');
  });

  it('adds days across months and years', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-15', -14)).toBe('2026-03-01');
  });

  it('formats a slot in the office time zone', () => {
    expect(formatTime('2026-03-09T13:00:00Z', 'America/New_York', 'en')).toBe('9:00 AM');
    expect(formatDateOf('2026-03-09T13:00:00Z', 'America/New_York', 'en')).toBe('Monday, March 9');
    expect(formatDay('2026-03-09', 'en')).toBe('Mon, Mar 9');
  });
});
