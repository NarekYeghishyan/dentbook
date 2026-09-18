import { describe, expect, it } from 'vitest';
import { formatWhen, localHour, skipReason } from './sms.js';

const start = new Date('2026-10-01T14:00:00Z');
const hoursBefore = (h: number, from = start) => new Date(from.getTime() - h * 3_600_000);
const NY = 'America/New_York';

describe('skipReason (Step 8)', () => {
  it('sends to a confirmed upcoming visit', () => {
    expect(skipReason('reminder_24h', 'confirmed', start, hoursBefore(24), 'UTC')).toBeNull();
    expect(skipReason('reminder_2h', 'confirmed', start, hoursBefore(2), 'UTC')).toBeNull();
    expect(
      skipReason('appointment_confirmed', 'confirmed', start, hoursBefore(0.5), 'UTC'),
    ).toBeNull();
  });

  it('writes to the client only about a confirmed booking', () => {
    expect(skipReason('reminder_2h', 'pending', start, hoursBefore(2), 'UTC')).toBe(
      'appointment_pending',
    );
    expect(skipReason('reminder_2h', 'cancelled', start, hoursBefore(2), 'UTC')).toBe(
      'appointment_cancelled',
    );
  });

  it('does not remind after the visit started', () => {
    expect(skipReason('reminder_2h', 'confirmed', start, start, 'UTC')).toBe('visit_started');
    expect(skipReason('appointment_confirmed', 'confirmed', start, hoursBefore(-1), 'UTC')).toBe(
      'visit_started',
    );
  });

  it('drops a late day-before reminder once the 2-hour one is due', () => {
    expect(skipReason('reminder_24h', 'confirmed', start, hoursBefore(2.01), 'UTC')).toBeNull();
    expect(skipReason('reminder_24h', 'confirmed', start, hoursBefore(2), 'UTC')).toBe(
      'superseded',
    );
  });
});

describe('quiet hours (Q16)', () => {
  it('skips a reminder that falls at night in the office time zone', () => {
    // Визит в 8:30 по Нью-Йорку (EDT, UTC−4): за 2 ч — 6:30, ночь; за сутки — 8:30 накануне
    const early = new Date('2026-10-01T12:30:00Z');
    expect(skipReason('reminder_2h', 'confirmed', early, hoursBefore(2, early), NY)).toBe(
      'quiet_hours',
    );
    expect(skipReason('reminder_24h', 'confirmed', early, hoursBefore(24, early), NY)).toBeNull();
  });

  it('allows 8:00 to 20:59 and blocks 21:00 to 7:59', () => {
    // 2026-10-01 по Нью-Йорку, EDT (UTC−4); визит — назавтра в полдень
    const visit = new Date('2026-10-02T16:00:00Z');
    const reason = (iso: string) =>
      skipReason('reminder_24h', 'confirmed', visit, new Date(iso), NY);
    expect(reason('2026-10-01T12:00:00Z')).toBeNull(); // 8:00
    expect(reason('2026-10-02T00:59:00Z')).toBeNull(); // 20:59
    expect(reason('2026-10-02T01:00:00Z')).toBe('quiet_hours'); // 21:00
    expect(reason('2026-10-01T11:59:00Z')).toBe('quiet_hours'); // 7:59
  });

  it('does not hold back the confirmation', () => {
    const night = new Date('2026-10-01T03:00:00Z'); // 23:00 накануне по Нью-Йорку
    expect(skipReason('appointment_confirmed', 'confirmed', start, night, NY)).toBeNull();
  });

  it('reads the local hour across the switch to winter time', () => {
    expect(localHour(new Date('2026-10-30T13:00:00Z'), NY)).toBe(9);
    expect(localHour(new Date('2026-11-02T13:00:00Z'), NY)).toBe(8);
    expect(localHour(new Date('2026-11-02T04:30:00Z'), NY)).toBe(23);
  });
});

describe('formatWhen', () => {
  it('shows the visit in the office time zone, across daylight saving time', () => {
    const normalize = (s: string) => s.replace(/\s/g, ' ');
    expect(normalize(formatWhen(start, NY, 'en'))).toBe('Thu, Oct 1, 10:00 AM');
    expect(normalize(formatWhen(new Date('2026-12-01T15:00:00Z'), NY, 'en'))).toBe(
      'Tue, Dec 1, 10:00 AM',
    );
  });
});
