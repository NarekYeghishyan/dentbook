import { describe, expect, it } from 'vitest';
import { isE164, maskNational, maskPhone, toE164, toE164In } from './phone.js';
import { anyPhoneSchema } from './validators.js';

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

describe('toE164In', () => {
  it.each([
    // код страны из списка + национальная часть
    ['1', '(202) 555-0199', '+12025550199'],
    ['374', '91 234567', '+37491234567'],
    ['39', '333 1234567', '+393331234567'],
    // ведущий ноль национального набора в E.164 не входит
    ['44', '07911 123456', '+447911123456'],
    // NANP: единицу перед кодом зоны считаем кодом страны
    ['1', '1 202 555 0199', '+12025550199'],
    // международный ввод сильнее выбранной страны
    ['374', '+1 202 555 0199', '+12025550199'],
    ['374', '001 202 555 0199', '+12025550199'],
  ])('+%s and %j → %s', (dial, input, expected) => {
    expect(toE164In(dial, input)).toBe(expected);
  });

  it.each([
    ['1', ''],
    ['1', 'phone'],
    ['44', '0'],
    ['1', '+0 123'],
  ])('+%s rejects %j', (dial, input) => {
    expect(toE164In(dial, input)).toBeNull();
  });
});

describe('isE164', () => {
  it('accepts only a number ready for the SMS provider', () => {
    expect(isE164('+12025550123')).toBe(true);
    expect(isE164('+37491234567')).toBe(true);
    expect(isE164('(202) 555-0123')).toBe(false);
    expect(isE164('077 12-34-56')).toBe(false);
  });
});

describe('anyPhoneSchema (dentist in the Mini App, front desk in the journal)', () => {
  it.each(['', '   ', null, undefined])('takes %j as a client without a number', (input) => {
    expect(anyPhoneSchema.parse(input)).toBeNull();
  });

  it.each([
    // читается как номер — приводится к E.164
    ['(202) 555-0123', '+12025550123'],
    ['+374 91 234567', '+37491234567'],
    // иначе — как ввёл врач, без пробелов по краям
    [' 077 12-34-56 ', '077 12-34-56'],
    ['555-0123 ext. 4', '555-0123 ext. 4'],
  ])('%j → %j', (input, expected) => {
    expect(anyPhoneSchema.parse(input)).toBe(expected);
  });

  it('rejects a number longer than 50 characters', () => {
    expect(anyPhoneSchema.safeParse('x'.repeat(51)).success).toBe(false);
  });
});

describe('maskNational', () => {
  it.each([
    // набирают по одной цифре: разделитель появляется только перед следующей цифрой
    ['1', '2', '(2'],
    ['1', '202', '(202'],
    ['1', '2025', '(202) 5'],
    ['1', '2025550123', '(202) 555-0123'],
    // уже отформатированный номер не разъезжается
    ['1', '(202) 555-0123', '(202) 555-0123'],
    // ведущая единица NANP и ведущий ноль национального набора — перед номером
    ['1', '12025550123', '1 (202) 555-0123'],
    ['44', '07911123456', '07911 123456'],
    ['44', '7911123456', '7911 123456'],
    ['374', '91234567', '91 234567'],
    ['7', '9161234567', '916 123-45-67'],
    ['33', '612345678', '6 12 34 56 78'],
    // цифр больше, чем в шаблоне — лишние остаются в конце
    ['374', '9123456789', '91 23456789'],
    ['1', '', ''],
  ])('+%s and %j → %j', (dial, input, expected) => {
    expect(maskNational(dial, input)).toBe(expected);
  });

  it('leaves the number as typed where there is no pattern', () => {
    expect(maskNational('672', '3 123 456')).toBeNull();
  });

  it('keeps every digit, so the number still converts to E.164', () => {
    const masked = maskNational('374', '91234567')!;
    expect(toE164In('374', masked)).toBe('+37491234567');
  });
});

describe('maskPhone', () => {
  it.each([
    ['', ''],
    ['202', '(202'],
    ['2025550123', '(202) 555-0123'],
    ['(202) 555-0123', '(202) 555-0123'],
    ['+', '+'],
    ['+1', '+1'],
    ['+12025550123', '+1 (202) 555-0123'],
    ['+37491123456', '+374 91 123456'],
    ['+79161234567', '+7 916 123-45-67'],
    ['call 555', 'call 555'],
  ])('%s → %s', (input, expected) => {
    expect(maskPhone(input)).toBe(expected);
  });

  it('keeps what toE164 reads', () => {
    for (const input of ['2025550123', '+12025550123', '+79161234567', '+37491123456']) {
      expect(toE164(maskPhone(input))).toBe(toE164(input));
    }
  });
});
