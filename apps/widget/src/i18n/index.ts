/** Тексты формы (§9, Q6): JSON-словари и t(); недостающий ключ — по-английски. */
import type { Locale } from '@dentbook/shared/domain';
import en from './en.json';
import hy from './hy.json';
import ru from './ru.json';

export type MessageKey = keyof typeof en;
export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const DICTIONARIES: Record<Locale, Partial<Record<MessageKey, string>>> = { en, ru, hy };

export const isLocale = (value: unknown): value is Locale =>
  value === 'en' || value === 'ru' || value === 'hy';

export function translator(locale: Locale): Translate {
  return (key, vars = {}) =>
    (DICTIONARIES[locale][key] ?? en[key]).replace(/\{(\w+)\}/g, (match, name: string) =>
      String(vars[name] ?? match),
    );
}
