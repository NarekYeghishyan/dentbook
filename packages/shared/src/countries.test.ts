import { describe, expect, it } from 'vitest';
import { DEFAULT_COUNTRY, DIAL_CODES, NUMBER_FORMATS, isCountryCode } from './countries.js';

describe('countries', () => {
  it('holds ISO alpha-2 codes and plain dial codes', () => {
    for (const [code, dial] of Object.entries(DIAL_CODES)) {
      expect(code, code).toMatch(/^[A-Z]{2}$/);
      expect(dial, code).toMatch(/^[1-9]\d{0,3}$/);
    }
  });

  // Названия стран виджет берёт у Intl: коды должны быть настоящими регионами,
  // иначе в списке окажется «AQ» вместо имени
  it('uses codes Intl knows', () => {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    for (const code of Object.keys(DIAL_CODES)) expect(names.of(code), code).not.toBe(code);
  });

  it('defaults to a country from the list for every locale', () => {
    for (const country of Object.values(DEFAULT_COUNTRY)) {
      expect(isCountryCode(country), country).toBe(true);
    }
  });
});

describe('number formats', () => {
  const dials = new Set<string>(Object.values(DIAL_CODES));

  it('are keyed by a dial code from the list', () => {
    for (const dial of Object.keys(NUMBER_FORMATS)) expect(dials.has(dial), dial).toBe(true);
  });

  it('hold digit places and separators only', () => {
    for (const [dial, pattern] of Object.entries(NUMBER_FORMATS)) {
      expect(pattern, dial).toMatch(/^[#()\-., ]*#$/);
      expect((pattern.match(/#/g) ?? []).length, dial).toBeGreaterThanOrEqual(6);
    }
  });
});
