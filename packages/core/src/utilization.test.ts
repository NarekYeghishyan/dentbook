import { describe, expect, it } from 'vitest';
import { zonedTimeToUtc } from './tz.js';
import { workingMinutes } from './utilization.js';

const NY = 'America/New_York';
const at = (date: string, time: string) => {
  const [h, m] = time.split(':').map(Number);
  return zonedTimeToUtc(date, h! * 60 + m!, NY);
};
const weekdays = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startTime: '09:00',
  endTime: '17:00',
}));

describe('workingMinutes (Step 9)', () => {
  it('sums the weekly template over the range', () => {
    // 2026-09-21 — понедельник: пять дней по 8 часов, выходные пустые
    expect(
      workingMinutes({
        weeklyHours: weekdays,
        exceptions: [],
        from: '2026-09-21',
        to: '2026-09-27',
        timeZone: NY,
      }),
    ).toBe(5 * 8 * 60);
  });

  it('adds extra time and takes closed time away', () => {
    expect(
      workingMinutes({
        weeklyHours: weekdays,
        exceptions: [
          // суббота 10–14 — дополнительно; во вторник 12–13 и 16:30–18 закрыто
          {
            type: 'extra',
            interval: { start: at('2026-09-26', '10:00'), end: at('2026-09-26', '14:00') },
          },
          {
            type: 'block',
            interval: { start: at('2026-09-22', '12:00'), end: at('2026-09-22', '13:00') },
          },
          {
            type: 'block',
            interval: { start: at('2026-09-22', '16:30'), end: at('2026-09-22', '18:00') },
          },
        ],
        from: '2026-09-21',
        to: '2026-09-27',
        timeZone: NY,
      }),
    ).toBe(5 * 8 * 60 + 4 * 60 - 60 - 30);
  });

  it('counts a night shift once and cuts it at the edges of the range', () => {
    const night = [{ weekday: 1, startTime: '22:00', endTime: '06:00' }];
    // Смена понедельник 22:00 → вторник 06:00
    expect(
      workingMinutes({
        weeklyHours: night,
        exceptions: [],
        from: '2026-09-21',
        to: '2026-09-22',
        timeZone: NY,
      }),
    ).toBe(8 * 60);
    expect(
      workingMinutes({
        weeklyHours: night,
        exceptions: [],
        from: '2026-09-21',
        to: '2026-09-21',
        timeZone: NY,
      }),
    ).toBe(2 * 60);
    expect(
      workingMinutes({
        weeklyHours: night,
        exceptions: [],
        from: '2026-09-22',
        to: '2026-09-22',
        timeZone: NY,
      }),
    ).toBe(6 * 60);
  });

  it('measures real minutes when clocks go back', () => {
    // 2026-11-01 02:00 → 01:00: ночь с субботы на воскресенье длится на час больше
    const night = [{ weekday: 6, startTime: '22:00', endTime: '06:00' }];
    expect(
      workingMinutes({
        weeklyHours: night,
        exceptions: [],
        from: '2026-10-31',
        to: '2026-11-01',
        timeZone: NY,
      }),
    ).toBe(9 * 60);
  });
});
