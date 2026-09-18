import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@dentbook/shared';
import en from './en.json';
import hy from './hy.json';
import ru from './ru.json';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('admin translations (§9, Q6)', () => {
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

  it('translates every API error code', () => {
    for (const code of ERROR_CODES) expect(en).toHaveProperty(`error.${code}`);
  });
});
