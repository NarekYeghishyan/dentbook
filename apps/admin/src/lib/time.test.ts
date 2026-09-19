import { describe, expect, it } from 'vitest';
import {
  atMinutes,
  dateIn,
  minutesOfDay,
  monthEndOf,
  monthStartOf,
  timeZoneLabel,
  utcOffset,
  wallTimeToIso,
} from './time';

const NY = 'America/New_York';

describe('journal time helpers (§2.3)', () => {
  it('reads the wall clock of the office, not of the browser', () => {
    expect(minutesOfDay('2026-01-15T14:30:00.000Z', NY)).toBe(9 * 60 + 30);
    expect(minutesOfDay('2026-07-15T13:30:00.000Z', NY)).toBe(9 * 60 + 30);
    expect(dateIn('2026-01-16T03:00:00.000Z', NY)).toBe('2026-01-15');
  });

  it('turns wall time back into an instant across daylight saving time', () => {
    // Сутки перевода часов: 10:00 до и после — разные смещения
    expect(atMinutes('2026-03-07', 10 * 60, NY)).toBe('2026-03-07T15:00:00.000Z');
    expect(atMinutes('2026-03-08', 10 * 60, NY)).toBe('2026-03-08T14:00:00.000Z');
    expect(atMinutes('2026-11-01', 10 * 60, NY)).toBe(wallTimeToIso('2026-11-01', '10:00', NY));
  });

  it('keeps midnight at 0 minutes', () => {
    expect(minutesOfDay(atMinutes('2026-05-01', 0, NY), NY)).toBe(0);
  });
});

describe('time zone labels', () => {
  const winter = new Date('2026-01-15T12:00:00Z');
  const summer = new Date('2026-07-15T12:00:00Z');

  it('appends the UTC offset to the zone name', () => {
    expect(timeZoneLabel('Asia/Yerevan', winter)).toBe('Asia/Yerevan (GMT+4)');
    expect(timeZoneLabel('UTC', winter)).toBe('UTC (GMT)');
  });

  it('follows daylight saving time and keeps half-hour offsets', () => {
    expect(utcOffset(NY, winter)).toBe('GMT-5');
    expect(utcOffset(NY, summer)).toBe('GMT-4');
    expect(utcOffset('Asia/Kolkata', winter)).toBe('GMT+5:30');
  });
});

describe('month bounds', () => {
  it('finds the first and last day, including February and December', () => {
    expect(monthStartOf('2026-09-18')).toBe('2026-09-01');
    expect(monthEndOf('2026-09-18')).toBe('2026-09-30');
    expect(monthEndOf('2028-02-10')).toBe('2028-02-29');
    expect(monthEndOf('2026-12-31')).toBe('2026-12-31');
  });
});
