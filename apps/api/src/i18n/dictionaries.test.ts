import { describe, expect, it } from 'vitest';
import en from './en.json' with { type: 'json' };
import hy from './hy.json' with { type: 'json' };
import ru from './ru.json' with { type: 'json' };
import { translate } from './index.js';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('API messages (§9)', () => {
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
    expect(translate('en', 'sms.verificationCode', { code: '123456', clinic: 'Smile' })).toBe(
      '123456 is your Smile booking code. It expires in 5 minutes.',
    );
  });
});
