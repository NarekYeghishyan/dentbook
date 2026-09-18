import { describe, expect, it } from 'vitest';
import { pickDentist } from './assign.js';

const dentist = (dentistId: string, priority: number, appointmentsThatDay: number) => ({
  dentistId,
  priority,
  appointmentsThatDay,
});

describe('pickDentist', () => {
  it('picks the lowest priority value regardless of load', () => {
    const picked = pickDentist([dentist('a', 2, 0), dentist('b', 1, 5), dentist('c', 3, 0)]);
    expect(picked?.dentistId).toBe('b');
  });

  it('on equal priority picks the dentist with fewer appointments that day', () => {
    const picked = pickDentist([dentist('a', 1, 4), dentist('b', 1, 2), dentist('c', 2, 0)]);
    expect(picked?.dentistId).toBe('b');
  });

  it('on a full tie picks randomly among the tied dentists only', () => {
    const candidates = [dentist('a', 1, 2), dentist('x', 1, 3), dentist('b', 1, 2)];
    expect(pickDentist(candidates, () => 0)?.dentistId).toBe('a');
    expect(pickDentist(candidates, () => 0.99)?.dentistId).toBe('b');
  });

  it('clamps an out-of-range random value', () => {
    const candidates = [dentist('a', 1, 0), dentist('b', 1, 0)];
    expect(pickDentist(candidates, () => 1)?.dentistId).toBe('b');
    expect(pickDentist(candidates, () => -0.5)?.dentistId).toBe('a');
  });

  it('uses Math.random by default', () => {
    const candidates = [dentist('a', 1, 0), dentist('b', 1, 0)];
    expect(['a', 'b']).toContain(pickDentist(candidates)?.dentistId);
  });

  it('returns the candidate object itself, with extra fields', () => {
    const candidate = { ...dentist('a', 1, 0), name: 'Dr. A' };
    expect(pickDentist([candidate])).toBe(candidate);
  });

  it('returns undefined when nobody is free', () => {
    expect(pickDentist([])).toBeUndefined();
  });
});
