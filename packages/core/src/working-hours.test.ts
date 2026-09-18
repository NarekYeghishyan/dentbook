import { describe, expect, it } from 'vitest';
import { parseTimeOfDay, workingIntervalsForDate, type WeeklyHours } from './working-hours.js';

const MONDAY = '2026-03-02';
const intervals = (rows: WeeklyHours[], date = MONDAY, zone = 'UTC'): string[][] =>
  workingIntervalsForDate(rows, date, zone).map((i) => [
    i.start.toISOString().slice(0, 16),
    i.end.toISOString().slice(0, 16),
  ]);

describe('parseTimeOfDay', () => {
  it.each([
    ['00:00', 0],
    ['09:00', 540],
    ['09:30:00', 570],
    ['23:59', 1439],
    ['24:00', 1440],
  ])('%s → %s', (value, minutes) => {
    expect(parseTimeOfDay(value)).toBe(minutes);
  });

  it.each(['9:00', '25:00', '24:30', '12:60', '09:00:30', ''])('rejects %j', (value) => {
    expect(() => parseTimeOfDay(value)).toThrow(RangeError);
  });
});

describe('workingIntervalsForDate', () => {
  it("takes only the date's weekday, sorted", () => {
    const rows = [
      { weekday: 1, startTime: '14:00', endTime: '18:00' },
      { weekday: 2, startTime: '09:00', endTime: '18:00' },
      { weekday: 1, startTime: '09:00', endTime: '13:00' },
    ];
    expect(intervals(rows)).toEqual([
      ['2026-03-02T09:00', '2026-03-02T13:00'],
      ['2026-03-02T14:00', '2026-03-02T18:00'],
    ]);
  });

  it('end 00:00 means the shift ends at the next midnight', () => {
    expect(intervals([{ weekday: 1, startTime: '18:00', endTime: '00:00' }])).toEqual([
      ['2026-03-02T18:00', '2026-03-03T00:00'],
    ]);
  });

  it('end 24:00 means the end of the same day', () => {
    expect(intervals([{ weekday: 1, startTime: '18:00', endTime: '24:00' }])).toEqual([
      ['2026-03-02T18:00', '2026-03-03T00:00'],
    ]);
  });

  it("includes the previous day's night shift whole, but not its day shift", () => {
    const rows = [
      { weekday: 7, startTime: '09:00', endTime: '17:00' },
      { weekday: 7, startTime: '22:00', endTime: '04:00' },
    ];
    expect(intervals(rows)).toEqual([['2026-03-01T22:00', '2026-03-02T04:00']]);
  });

  it('converts local time of the location to UTC', () => {
    const rows = [{ weekday: 1, startTime: '09:00', endTime: '18:00' }];
    expect(intervals(rows, MONDAY, 'America/Los_Angeles')).toEqual([
      ['2026-03-02T17:00', '2026-03-03T02:00'],
    ]);
  });

  it.each([
    ['09:00', '09:00'],
    ['24:00', '09:00'],
  ])('rejects an empty shift %s–%s', (startTime, endTime) => {
    expect(() => intervals([{ weekday: 1, startTime, endTime }])).toThrow(RangeError);
  });
});
