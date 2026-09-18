import { describe, expect, it } from 'vitest';
import { atMinutes } from '../../lib/time';
import { clickedMinutes, droppedMinutes, gridSpan, PX_PER_MIN, spanOnDate } from './grid';

const NY = 'America/New_York';
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return atMinutes(date, h! * 60 + m!, NY);
};

describe('journal grid (Step 9)', () => {
  it('places an interval on its local day', () => {
    expect(
      spanOnDate(at('2026-09-21', '09:00'), at('2026-09-21', '17:00'), '2026-09-21', NY),
    ).toEqual({ from: 540, to: 1020 });
    expect(
      spanOnDate(at('2026-09-21', '09:00'), at('2026-09-21', '17:00'), '2026-09-22', NY),
    ).toBeNull();
  });

  it('splits a night shift at local midnight', () => {
    const start = at('2026-09-21', '22:00');
    const end = at('2026-09-22', '06:00');
    expect(spanOnDate(start, end, '2026-09-21', NY)).toEqual({ from: 1320, to: 1440 });
    expect(spanOnDate(start, end, '2026-09-22', NY)).toEqual({ from: 0, to: 360 });
    // Кончается ровно в полночь — на следующий день не попадает
    expect(
      spanOnDate(at('2026-09-21', '20:00'), at('2026-09-22', '00:00'), '2026-09-22', NY),
    ).toBeNull();
  });

  it('keeps wall-clock positions on the day clocks go back', () => {
    // 2026-11-01: 10:00 по Нью-Йорку — 10:00 на сетке, хотя с полуночи прошло 11 часов
    expect(
      spanOnDate(at('2026-11-01', '10:00'), at('2026-11-01', '10:30'), '2026-11-01', NY),
    ).toEqual({ from: 600, to: 630 });
  });

  it('fits the grid to whole hours around the shifts', () => {
    expect(
      gridSpan([
        { from: 540, to: 1020 },
        { from: 570, to: 1110 },
      ]),
    ).toEqual({ from: 540, to: 1140 });
    expect(gridSpan([{ from: 1320, to: 1440 }])).toEqual({ from: 1320, to: 1440 });
    expect(gridSpan([])).toEqual({ from: 480, to: 1080 });
  });

  it('snaps a drag and a click to the clinic step', () => {
    const quarter = 15 * PX_PER_MIN;
    expect(droppedMinutes(600, quarter * 2.4, 15)).toBe(630);
    expect(droppedMinutes(600, -quarter * 0.4, 15)).toBe(600);
    expect(droppedMinutes(600, -quarter * 4, 15)).toBe(540);
    expect(clickedMinutes(quarter * 3.9, 480, 15)).toBe(525);
    expect(clickedMinutes(0, 480, 30)).toBe(480);
  });
});
