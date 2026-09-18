import { describe, expect, it } from 'vitest';
import {
  computeDaySlots,
  computeSlots,
  mergeSlots,
  type ComputeDaySlotsInput,
} from './availability.js';
import type { ComputeSlotsInput, Interval } from './types.js';

const MONDAY = '2026-03-02';
const at = (time: string, date = MONDAY): Date => new Date(`${date}T${time}:00Z`);
const iv = (from: string, to: string, date = MONDAY): Interval => ({
  start: at(from, date),
  end: at(to, date),
});
const hhmm = (slots: Date[]): string[] => slots.map((s) => s.toISOString().slice(11, 16));
const iso = (slots: Date[]): string[] => slots.map((s) => s.toISOString().slice(0, 16));

/** Врач 09:00–12:00 UTC, услуга 30 мин без буфера, шаг 15 мин. */
function slots(overrides: Partial<ComputeSlotsInput> = {}): string[] {
  return hhmm(
    computeSlots({
      workingHours: [iv('09:00', '12:00')],
      exceptions: [],
      appointments: [],
      durationMin: 30,
      bufferMin: 0,
      stepMin: 15,
      notBefore: at('00:00'),
      ...overrides,
    }),
  );
}

describe('computeSlots: working hours', () => {
  it('slices working hours with the grid; the last slot ends exactly at closing', () => {
    expect(slots()).toEqual([
      '09:00',
      '09:15',
      '09:30',
      '09:45',
      '10:00',
      '10:15',
      '10:30',
      '10:45',
      '11:00',
      '11:15',
      '11:30',
    ]);
  });

  it('returns nothing when the service is longer than the working interval', () => {
    expect(slots({ durationMin: 240 })).toEqual([]);
  });

  it('returns nothing without working hours', () => {
    expect(slots({ workingHours: [] })).toEqual([]);
  });

  it('does not let a slot span a gap between working intervals', () => {
    const workingHours = [iv('09:00', '10:00'), iv('11:00', '12:00')];
    expect(slots({ workingHours, durationMin: 60 })).toEqual(['09:00', '11:00']);
  });

  it('anchors the grid at the start of working hours', () => {
    const workingHours = [iv('09:10', '10:10')];
    expect(slots({ workingHours, durationMin: 15 })).toEqual(['09:10', '09:25', '09:40', '09:55']);
  });

  it('accepts unsorted, overlapping working hours without duplicate slots', () => {
    const workingHours = [iv('10:00', '11:00'), iv('09:00', '10:30')];
    expect(slots({ workingHours, stepMin: 30 })).toEqual(['09:00', '09:30', '10:00', '10:30']);
  });
});

describe('computeSlots: buffers', () => {
  it('requires the service buffer to fit before closing', () => {
    const result = slots({ bufferMin: 15 });
    expect(result).toHaveLength(10);
    expect(result.at(-1)).toBe('11:15');
  });

  it('extends an existing appointment by its own buffer', () => {
    const appointments = [{ interval: iv('10:00', '10:30'), bufferMin: 10 }];
    expect(slots({ appointments })).toEqual([
      '09:00',
      '09:15',
      '09:30',
      '10:45',
      '11:00',
      '11:15',
      '11:30',
    ]);
  });

  it("keeps the new slot's buffer clear of the next appointment", () => {
    const appointments = [{ interval: iv('10:00', '10:30'), bufferMin: 0 }];
    expect(slots({ appointments, bufferMin: 15 })).toEqual([
      '09:00',
      '09:15',
      '10:30',
      '10:45',
      '11:00',
      '11:15',
    ]);
  });

  it('allows a slot that only touches an appointment', () => {
    const appointments = [{ interval: iv('09:00', '09:30'), bufferMin: 0 }];
    expect(slots({ appointments })[0]).toBe('09:30');
  });

  it('does not shift the grid after an appointment ending off-grid', () => {
    const appointments = [{ interval: iv('09:00', '09:32'), bufferMin: 0 }];
    expect(slots({ appointments })[0]).toBe('09:45');
  });
});

describe('computeSlots: exceptions', () => {
  it('block removes time', () => {
    const exceptions = [{ type: 'block' as const, interval: iv('10:00', '11:00') }];
    expect(slots({ exceptions })).toEqual(['09:00', '09:15', '09:30', '11:00', '11:15', '11:30']);
  });

  it('block at opening does not shift the grid', () => {
    const exceptions = [{ type: 'block' as const, interval: iv('09:00', '09:20') }];
    expect(slots({ exceptions })[0]).toBe('09:30');
  });

  it('extra adds time outside working hours', () => {
    const exceptions = [{ type: 'extra' as const, interval: iv('18:00', '19:00') }];
    expect(slots({ exceptions, durationMin: 60, stepMin: 60 })).toEqual([
      '09:00',
      '10:00',
      '11:00',
      '18:00',
    ]);
  });

  it('extra adjacent to working hours lets a slot span the boundary', () => {
    const exceptions = [{ type: 'extra' as const, interval: iv('12:00', '13:00') }];
    expect(slots({ exceptions, durationMin: 60, stepMin: 30 })).toEqual([
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '11:30',
      '12:00',
    ]);
  });

  it('extra works on a day off', () => {
    const exceptions = [{ type: 'extra' as const, interval: iv('10:00', '11:00') }];
    expect(slots({ workingHours: [], exceptions })).toEqual(['10:00', '10:15', '10:30']);
  });

  it('block wins over extra on the same time', () => {
    const exceptions = [
      { type: 'extra' as const, interval: iv('18:00', '19:00') },
      { type: 'block' as const, interval: iv('18:00', '19:00') },
    ];
    expect(slots({ exceptions, durationMin: 60, stepMin: 60 })).toEqual([
      '09:00',
      '10:00',
      '11:00',
    ]);
  });
});

describe('computeSlots: notBefore', () => {
  it('drops slots before notBefore and keeps the grid', () => {
    expect(slots({ notBefore: at('10:07') })[0]).toBe('10:15');
  });

  it('keeps a slot that starts exactly at notBefore', () => {
    expect(slots({ notBefore: at('10:00') })[0]).toBe('10:00');
  });

  it('returns nothing when notBefore is after closing', () => {
    expect(slots({ notBefore: at('12:00') })).toEqual([]);
  });
});

describe('computeSlots: input validation', () => {
  it.each([
    ['durationMin', 0],
    ['durationMin', 1.5],
    ['bufferMin', -1],
    ['stepMin', 0],
  ] as const)('rejects %s = %s', (field, value) => {
    expect(() => slots({ [field]: value } as Partial<ComputeSlotsInput>)).toThrow(RangeError);
  });

  it('rejects a negative appointment buffer', () => {
    const appointments = [{ interval: iv('10:00', '10:30'), bufferMin: -5 }];
    expect(() => slots({ appointments })).toThrow(RangeError);
  });
});

describe('mergeSlots', () => {
  it('unions slots of several dentists without duplicates, sorted', () => {
    const merged = mergeSlots([[at('10:00'), at('09:00')], [at('09:00'), at('11:00')], []]);
    expect(hhmm(merged)).toEqual(['09:00', '10:00', '11:00']);
  });

  it('returns nothing for no dentists', () => {
    expect(mergeSlots([])).toEqual([]);
  });
});

describe('computeDaySlots: midnight', () => {
  /** Ночная смена в понедельник 20:00–02:00 UTC, услуга 60 мин, шаг 60. */
  function night(date: string, overrides: Partial<ComputeDaySlotsInput> = {}): string[] {
    return iso(
      computeDaySlots({
        date,
        timeZone: 'UTC',
        weeklyHours: [{ weekday: 1, startTime: '20:00', endTime: '02:00' }],
        exceptions: [],
        appointments: [],
        durationMin: 60,
        bufferMin: 0,
        stepMin: 60,
        notBefore: at('00:00', '2026-01-01'),
        ...overrides,
      }),
    );
  }

  it('a night shift gives slots to the date each slot starts on', () => {
    expect(night('2026-03-01')).toEqual([]);
    expect(night('2026-03-02')).toEqual([
      '2026-03-02T20:00',
      '2026-03-02T21:00',
      '2026-03-02T22:00',
      '2026-03-02T23:00',
    ]);
    expect(night('2026-03-03')).toEqual(['2026-03-03T00:00', '2026-03-03T01:00']);
  });

  it('a slot starting before midnight may end after it', () => {
    const options = { durationMin: 90, stepMin: 30 };
    expect(night('2026-03-02', options).at(-1)).toBe('2026-03-02T23:30');
    expect(night('2026-03-03', options)).toEqual(['2026-03-03T00:00', '2026-03-03T00:30']);
  });

  it('an appointment after midnight blocks the tail of the shift', () => {
    const appointments = [{ interval: iv('00:00', '01:00', '2026-03-03'), bufferMin: 0 }];
    expect(night('2026-03-02', { appointments }).at(-1)).toBe('2026-03-02T23:00');
    expect(night('2026-03-03', { appointments })).toEqual(['2026-03-03T01:00']);
  });

  it('a block across midnight closes time on both dates', () => {
    const exceptions = [
      { type: 'block' as const, interval: { start: at('23:00'), end: at('01:00', '2026-03-03') } },
    ];
    expect(night('2026-03-02', { exceptions }).at(-1)).toBe('2026-03-02T22:00');
    expect(night('2026-03-03', { exceptions })).toEqual(['2026-03-03T01:00']);
  });
});

describe('computeDaySlots: daylight saving time', () => {
  const NEW_YORK = 'America/New_York';

  function day(
    date: string,
    weeklyHours: ComputeDaySlotsInput['weeklyHours'],
    timeZone = NEW_YORK,
    overrides: Partial<ComputeDaySlotsInput> = {},
  ): string[] {
    return iso(
      computeDaySlots({
        date,
        timeZone,
        weeklyHours,
        exceptions: [],
        appointments: [],
        durationMin: 60,
        bufferMin: 0,
        stepMin: 60,
        notBefore: at('00:00', '2026-01-01'),
        ...overrides,
      }),
    );
  }

  const sunday9to11 = [{ weekday: 7, startTime: '09:00', endTime: '11:00' }];
  const saturdayNight = [{ weekday: 6, startTime: '22:00', endTime: '06:00' }];

  it('09:00 stays 09:00 local when the offset changes in spring', () => {
    expect(day('2026-03-01', sunday9to11)).toEqual(['2026-03-01T14:00', '2026-03-01T15:00']);
    expect(day('2026-03-08', sunday9to11)).toEqual(['2026-03-08T13:00', '2026-03-08T14:00']);
  });

  it('09:00 stays 09:00 local when the offset changes in autumn', () => {
    expect(day('2026-10-25', sunday9to11)).toEqual(['2026-10-25T13:00', '2026-10-25T14:00']);
    expect(day('2026-11-01', sunday9to11)).toEqual(['2026-11-01T14:00', '2026-11-01T15:00']);
  });

  it('a night shift over the spring gap is one hour shorter', () => {
    // 22:00 EST → 06:00 EDT = 7 часов
    expect(day('2026-03-07', saturdayNight)).toEqual(['2026-03-08T03:00', '2026-03-08T04:00']);
    expect(day('2026-03-08', saturdayNight)).toEqual([
      '2026-03-08T05:00', // 00:00 EST
      '2026-03-08T06:00', // 01:00 EST
      '2026-03-08T07:00', // 03:00 EDT
      '2026-03-08T08:00',
      '2026-03-08T09:00', // 05:00 EDT, конец в 06:00 EDT
    ]);
  });

  it('a night shift over the autumn overlap is one hour longer', () => {
    // 22:00 EDT → 06:00 EST = 9 часов
    const saturday = day('2026-10-31', saturdayNight);
    const sunday = day('2026-11-01', saturdayNight);
    expect(saturday).toEqual(['2026-11-01T02:00', '2026-11-01T03:00']);
    expect(sunday).toHaveLength(7);
    expect(sunday[0]).toBe('2026-11-01T04:00'); // 00:00 EDT
    expect(sunday.at(-1)).toBe('2026-11-01T10:00'); // 05:00 EST, конец в 06:00 EST
  });

  it('a zone without DST keeps a fixed offset on the European transition day', () => {
    expect(day('2026-03-29', sunday9to11, 'Asia/Yerevan')).toEqual([
      '2026-03-29T05:00',
      '2026-03-29T06:00',
    ]);
  });

  it('applies notBefore inside the day', () => {
    const notBefore = new Date('2026-03-08T13:30:00Z');
    expect(day('2026-03-08', sunday9to11, NEW_YORK, { notBefore })).toEqual(['2026-03-08T14:00']);
  });
});
