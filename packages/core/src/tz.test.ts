import { describe, expect, it } from 'vitest';
import { addDays, dayBounds, isoWeekday, localDateOf, zonedTimeToUtc } from './tz.js';

const NEW_YORK = 'America/New_York';
const utc = (date: string, minuteOfDay: number, timeZone: string): string =>
  zonedTimeToUtc(date, minuteOfDay, timeZone).toISOString();

describe('zonedTimeToUtc', () => {
  it.each([
    ['2026-01-15', 9 * 60, NEW_YORK, '2026-01-15T14:00:00.000Z'],
    ['2026-07-15', 9 * 60, NEW_YORK, '2026-07-15T13:00:00.000Z'],
    ['2026-01-15', 9 * 60, 'America/Los_Angeles', '2026-01-15T17:00:00.000Z'],
    ['2026-01-15', 9 * 60, 'Asia/Yerevan', '2026-01-15T05:00:00.000Z'],
    ['2026-01-15', 9 * 60, 'Asia/Kolkata', '2026-01-15T03:30:00.000Z'],
    ['2026-01-15', 9 * 60, 'UTC', '2026-01-15T09:00:00.000Z'],
  ])('%s %s min in %s → %s', (date, minute, zone, expected) => {
    expect(utc(date, minute, zone)).toBe(expected);
  });

  it('treats minute 1440 as midnight of the next date', () => {
    expect(utc('2026-03-02', 1440, 'UTC')).toBe('2026-03-03T00:00:00.000Z');
  });

  describe('spring forward (New York, 2026-03-08, 02:00 → 03:00)', () => {
    it.each([
      [60, '2026-03-08T06:00:00.000Z'], // 01:00 EST — до перевода
      [120, '2026-03-08T07:00:00.000Z'], // 02:00 не существует → 03:00 EDT
      [150, '2026-03-08T07:30:00.000Z'], // 02:30 не существует → 03:30 EDT
      [180, '2026-03-08T07:00:00.000Z'], // 03:00 EDT
      [240, '2026-03-08T08:00:00.000Z'], // 04:00 EDT — после перевода
    ])('%s min → %s', (minute, expected) => {
      expect(utc('2026-03-08', minute, NEW_YORK)).toBe(expected);
    });

    it('works the same in Europe (Berlin, 2026-03-29)', () => {
      expect(utc('2026-03-29', 150, 'Europe/Berlin')).toBe('2026-03-29T01:30:00.000Z');
    });
  });

  describe('fall back (New York, 2026-11-01, 02:00 → 01:00)', () => {
    it.each([
      [30, '2026-11-01T04:30:00.000Z'], // 00:30 EDT
      [90, '2026-11-01T05:30:00.000Z'], // 01:30 дважды → первое, EDT
      [180, '2026-11-01T08:00:00.000Z'], // 03:00 EST
    ])('%s min → %s', (minute, expected) => {
      expect(utc('2026-11-01', minute, NEW_YORK)).toBe(expected);
    });
  });

  it('rejects an unknown time zone', () => {
    expect(() => zonedTimeToUtc('2026-03-02', 0, 'Mars/Olympus')).toThrow(RangeError);
  });

  it.each(['2026-02-30', '2026-3-2', '02.03.2026', ''])('rejects local date %j', (date) => {
    expect(() => zonedTimeToUtc(date, 0, 'UTC')).toThrow(RangeError);
  });
});

describe('dayBounds', () => {
  const hours = (date: string, zone: string): number => {
    const { start, end } = dayBounds(date, zone);
    return (end.getTime() - start.getTime()) / 3_600_000;
  };

  it('is 24 h on a regular day', () => {
    expect(dayBounds('2026-03-02', NEW_YORK)).toEqual({
      start: new Date('2026-03-02T05:00:00Z'),
      end: new Date('2026-03-03T05:00:00Z'),
    });
  });

  it('is 23 h on the spring-forward day and 25 h on the fall-back day', () => {
    expect(hours('2026-03-08', NEW_YORK)).toBe(23);
    expect(hours('2026-11-01', NEW_YORK)).toBe(25);
    expect(hours('2026-03-29', 'Europe/Berlin')).toBe(23);
  });
});

describe('localDateOf', () => {
  it.each([
    ['2026-03-02T03:00:00Z', NEW_YORK, '2026-03-01'],
    ['2026-03-02T03:00:00Z', 'UTC', '2026-03-02'],
    ['2026-03-01T21:00:00Z', 'Asia/Yerevan', '2026-03-02'],
  ])('%s in %s → %s', (instant, zone, expected) => {
    expect(localDateOf(new Date(instant), zone)).toBe(expected);
  });
});

describe('calendar helpers', () => {
  it.each([
    ['2026-03-02', 1],
    ['2026-03-07', 6],
    ['2026-03-08', 7],
  ])('isoWeekday(%s) = %s', (date, weekday) => {
    expect(isoWeekday(date)).toBe(weekday);
  });

  it.each([
    ['2026-02-28', 1, '2026-03-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2026-03-08', 1, '2026-03-09'],
  ])('addDays(%s, %s) = %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });
});
