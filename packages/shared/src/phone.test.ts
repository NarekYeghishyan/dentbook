import { describe, expect, it } from 'vitest';
import { toE164 } from './phone.js';

describe('toE164', () => {
  it.each([
    ['(202) 555-0123', '+12025550123'],
    ['202.555.0123', '+12025550123'],
    ['1 202 555 0123', '+12025550123'],
    ['+1 (202) 555-0123', '+12025550123'],
    ['+374 91 234567', '+37491234567'],
  ])('%s → %s', (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });

  it.each(['', '555-0123', '(102) 555-0123', '+0 123', 'phone'])('rejects %j', (input) => {
    expect(toE164(input)).toBeNull();
  });
});
