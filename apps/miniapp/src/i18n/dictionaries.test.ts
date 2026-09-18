import { describe, expect, it } from 'vitest';
import en from './en.json';
import hy from './hy.json';
import ru from './ru.json';
import { pickLocale, translate } from './index';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('mini app translations (§9, Q6)', () => {
  it.each([
    ['ru', ru],
    ['hy', hy],
  ])('%s has exactly the English keys', (_locale, dictionary) => {
    expect(Object.keys(dictionary).sort()).toEqual(Object.keys(en).sort());
  });

  it.each([
    ['ru', ru as Record<string, string>],
    ['hy', hy as Record<string, string>],
  ])('%s keeps the placeholders of every message', (_locale, dictionary) => {
    for (const [key, text] of Object.entries(en)) {
      expect(placeholders(dictionary[key] ?? ''), key).toEqual(placeholders(text));
    }
  });

  it('takes the language from Telegram, then the clinic, then English', () => {
    expect(pickLocale('ru', 'hy')).toBe('ru');
    expect(pickLocale('hy-AM', 'en')).toBe('hy');
    expect(pickLocale('de', 'hy')).toBe('hy');
    expect(pickLocale(undefined)).toBe('en');
  });

  it('fills placeholders', () => {
    expect(translate('en', 'book.done', { when: 'Mon 9:00' })).toBe('Booked: Mon 9:00.');
  });
});
