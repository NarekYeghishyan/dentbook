import { describe, expect, it } from 'vitest';
import { isExclusionViolation, pgErrorCode, PG_EXCLUSION_VIOLATION } from './errors.js';

describe('pgErrorCode', () => {
  it('reads SQLSTATE from a driver error', () => {
    expect(pgErrorCode({ code: '23505' })).toBe('23505');
  });

  it('unwraps DrizzleQueryError-style cause chains', () => {
    const driverError = Object.assign(new Error('conflicting key value'), { code: '23P01' });
    const wrapped = new Error('Failed query', {
      cause: new Error('middle', { cause: driverError }),
    });
    expect(pgErrorCode(wrapped)).toBe(PG_EXCLUSION_VIOLATION);
    expect(isExclusionViolation(wrapped)).toBe(true);
  });

  it('ignores non-SQLSTATE codes such as network errors', () => {
    const network = Object.assign(new Error('connect'), { code: 'ECONNREFUSED' });
    expect(pgErrorCode(network)).toBeUndefined();
    expect(isExclusionViolation(network)).toBe(false);
  });

  it('returns undefined for values that are not errors', () => {
    expect(pgErrorCode(undefined)).toBeUndefined();
    expect(pgErrorCode('23P01')).toBeUndefined();
    expect(pgErrorCode(null)).toBeUndefined();
  });

  it('stops on cyclic cause chains', () => {
    const a: { cause?: unknown } = {};
    const b: { cause?: unknown } = { cause: a };
    a.cause = b;
    expect(pgErrorCode(a)).toBeUndefined();
  });
});
