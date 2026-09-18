/**
 * Переводы интерфейса (§9, Q6): JSON-словари и t(), без библиотеки. Базовый язык —
 * английский; ключ, которого нет в словаре языка, показывается по-английски.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { LOCALES, type Locale } from '@dentbook/shared/domain';
import en from './en.json';
import hy from './hy.json';
import ru from './ru.json';

export type MessageKey = keyof typeof en;
type Vars = Record<string, string | number>;

const DICTIONARIES: Record<Locale, Partial<Record<MessageKey, string>>> = { en, ru, hy };
const STORAGE_KEY = 'dentbook.locale';

export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', ru: 'Русский', hy: 'Հայերեն' };

export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const template = DICTIONARIES[locale][key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match));
}

const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // Хранилище недоступно (приватный режим) — берём язык браузера
  }
  const browser = navigator.language.slice(0, 2);
  return isLocale(browser) ? browser : 'en';
}

interface I18n {
  locale: Locale;
  setLocale(locale: Locale): void;
  t(key: MessageKey, vars?: Vars): string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale(next) {
        setLocaleState(next);
        document.documentElement.lang = next;
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // Не запомнится между визитами — не страшно
        }
      },
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n outside I18nProvider');
  return context;
}
