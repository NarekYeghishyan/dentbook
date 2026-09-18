import { describe, expect, it } from 'vitest';
import en from './en.json';
import hy from './hy.json';
import ru from './ru.json';
import { translator } from './index';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('widget translations (§9)', () => {
  it.each([
    ['ru', ru as Record<string, string>],
    ['hy', hy as Record<string, string>],
  ])('%s has the English keys and placeholders', (_locale, dictionary) => {
    expect(Object.keys(dictionary).sort()).toEqual(Object.keys(en).sort());
    for (const [key, text] of Object.entries(en)) {
      expect(placeholders(dictionary[key]!), key).toEqual(placeholders(text));
    }
  });

  it('fills placeholders', () => {
    expect(translator('ru')('service.minutes', { min: 30 })).toBe('30 мин');
  });
});
