import { describe, expect, it } from 'vitest';
import { dateIn, formatDate, wallTimeToIso } from './time';

describe('mini app time (§2.3)', () => {
  it('reads wall time in the office zone, not the phone zone', () => {
    expect(wallTimeToIso('2026-01-15', '09:30', 'America/New_York')).toBe(
      '2026-01-15T14:30:00.000Z',
    );
  });

  it('follows daylight saving time', () => {
    expect(wallTimeToIso('2026-07-15', '09:30', 'America/New_York')).toBe(
      '2026-07-15T13:30:00.000Z',
    );
    // 2026-03-08 02:30 не существует в Нью-Йорке — сдвиг вперёд, как в Temporal "compatible"
    expect(wallTimeToIso('2026-03-08', '02:30', 'America/New_York')).toBe(
      '2026-03-08T07:30:00.000Z',
    );
  });

  it('takes the local date of an instant after midnight UTC', () => {
    expect(dateIn('2026-01-16T03:00:00.000Z', 'America/Los_Angeles')).toBe('2026-01-15');
  });

  it('formats a calendar date without shifting the day', () => {
    expect(formatDate('2026-01-15', 'en')).toBe('Thursday, January 15');
  });
});
