import { describe, expect, it } from 'vitest';
import { formatWhen, skipReason } from './sms.js';

const start = new Date('2026-10-01T14:00:00Z');
const hoursBefore = (h: number) => new Date(start.getTime() - h * 3_600_000);

describe('skipReason (Step 8)', () => {
  it('sends to a confirmed upcoming visit', () => {
    expect(skipReason('reminder_24h', 'confirmed', start, hoursBefore(24))).toBeNull();
    expect(skipReason('reminder_2h', 'confirmed', start, hoursBefore(2))).toBeNull();
    expect(skipReason('appointment_confirmed', 'confirmed', start, hoursBefore(0.5))).toBeNull();
  });

  it('writes to the client only about a confirmed booking', () => {
    expect(skipReason('reminder_2h', 'pending', start, hoursBefore(2))).toBe('appointment_pending');
    expect(skipReason('reminder_2h', 'cancelled', start, hoursBefore(2))).toBe(
      'appointment_cancelled',
    );
  });

  it('does not remind after the visit started', () => {
    expect(skipReason('reminder_2h', 'confirmed', start, start)).toBe('visit_started');
    expect(skipReason('appointment_confirmed', 'confirmed', start, hoursBefore(-1))).toBe(
      'visit_started',
    );
  });

  it('drops a late day-before reminder once the 2-hour one is due', () => {
    expect(skipReason('reminder_24h', 'confirmed', start, hoursBefore(2.01))).toBeNull();
    expect(skipReason('reminder_24h', 'confirmed', start, hoursBefore(2))).toBe('superseded');
  });
});

describe('formatWhen', () => {
  it('shows the visit in the office time zone, across daylight saving time', () => {
    const normalize = (s: string) => s.replace(/\s/g, ' ');
    expect(normalize(formatWhen(start, 'America/New_York', 'en'))).toBe('Thu, Oct 1, 10:00 AM');
    expect(normalize(formatWhen(new Date('2026-12-01T15:00:00Z'), 'America/New_York', 'en'))).toBe(
      'Tue, Dec 1, 10:00 AM',
    );
  });
});
