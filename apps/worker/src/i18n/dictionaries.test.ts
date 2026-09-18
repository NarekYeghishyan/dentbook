import { describe, expect, it } from 'vitest';
import en from './en.json' with { type: 'json' };
import hy from './hy.json' with { type: 'json' };
import ru from './ru.json' with { type: 'json' };
import { translate } from './index.js';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('client SMS templates (§9)', () => {
  it.each([
    ['ru', ru as Record<string, string>],
    ['hy', hy as Record<string, string>],
  ])('%s has the English keys and placeholders', (_locale, dictionary) => {
    expect(Object.keys(dictionary).sort()).toEqual(Object.keys(en).sort());
    for (const [key, text] of Object.entries(en)) {
      expect(placeholders(dictionary[key]!), key).toEqual(placeholders(text));
    }
  });

  it('fits an English reminder with the opt-out line into one SMS segment', () => {
    const text = `${translate('en', 'sms.reminder2h', {
      clinic: 'Brooklyn Family Dental Care',
      when: 'Wed, Sep 30, 10:30 AM',
      office: 'Downtown Brooklyn office',
    })} ${translate('en', 'sms.optOut')}`;
    expect(text.length).toBeLessThanOrEqual(160);
  });
});
