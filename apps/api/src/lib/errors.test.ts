import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError, parse, serializeError } from './errors.js';

describe('serializeError (CLAUDE.md §2.6)', () => {
  it('keeps only the code, table and constraint of a database error', () => {
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      table: 'users',
      constraint: 'users_email_key',
      detail: 'Key (email)=(jane@example.com) already exists.',
    });
    const drizzleError = Object.assign(
      new Error('Failed query: insert into users ... params: jane@example.com'),
      { name: 'DrizzleQueryError', cause: pgError },
    );
    const serialized = serializeError(drizzleError);
    expect(serialized).toEqual({
      type: 'DatabaseError',
      message: 'Database error',
      stack: '',
      code: '23505',
      table: 'users',
      constraint: 'users_email_key',
    });
    expect(JSON.stringify(serialized)).not.toContain('jane@example.com');
  });

  it('keeps message and stack of an ordinary error', () => {
    const serialized = serializeError(new TypeError('boom'));
    expect(serialized).toMatchObject({ type: 'TypeError', message: 'boom' });
    expect(serialized.stack).toContain('boom');
  });

  it('survives a non-error value', () => {
    expect(serializeError('oops')).toEqual({ type: 'string', message: '', stack: '' });
  });
});

describe('parse', () => {
  const schema = z.object({ email: z.email(), age: z.number() });

  it('returns parsed data', () => {
    expect(parse(schema, { email: 'a@b.co', age: 3 })).toEqual({ email: 'a@b.co', age: 3 });
  });

  it('throws validation_failed naming fields but not values', () => {
    try {
      parse(schema, { email: 'jane@', age: 'x' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ statusCode: 400, code: 'validation_failed' });
      expect((err as Error).message).toBe('Invalid fields: email, age');
    }
  });
});
