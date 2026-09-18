/**
 * Переводы Mini App (§9, Q6): JSON-словари и t(), без библиотеки. Язык — из профиля
 * Telegram врача, иначе язык клиники, иначе английский.
 */
import { LOCALES, type Locale } from '@dentbook/shared/domain';
import en from './en.json';
import hy from './hy.json';
import ru from './ru.json';

export type MessageKey = keyof typeof en;
type Vars = Record<string, string | number>;

const DICTIONARIES: Record<Locale, Partial<Record<MessageKey, string>>> = { en, ru, hy };

export const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);

export function pickLocale(telegramLanguage: string | undefined, clinicLocale?: Locale): Locale {
  const fromTelegram = telegramLanguage?.slice(0, 2);
  if (isLocale(fromTelegram)) return fromTelegram;
  return clinicLocale ?? 'en';
}

export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const template = DICTIONARIES[locale][key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match));
}
