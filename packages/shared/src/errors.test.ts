import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from './errors.js';

/**
 * Коды ошибок — часть публичного контракта (CLAUDE.md §7).
 * Тест ловит случайное переименование или удаление кода.
 */
describe('ERROR_CODES', () => {
  it('совпадает со списком из CLAUDE.md §7', () => {
    expect([...ERROR_CODES]).toEqual([
      'invalid_key',
      'origin_not_allowed',
      'rate_limited',
      'slot_taken',
      'hold_expired',
      'verification_required',
      'verification_failed',
      'outside_working_hours',
      'validation_failed',
      'unauthorized',
      'forbidden',
      'not_found',
      'internal_error',
    ]);
  });

  it('не содержит дублей', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});
