/**
 * Тексты SMS клиентам (§9): шаблоны в файлах переводов, базовый язык — английский.
 * Недостающий ключ берётся из en.json.
 */
import type { Locale } from '@dentbook/shared/domain';
import en from './en.json' with { type: 'json' };
import hy from './hy.json' with { type: 'json' };
import ru from './ru.json' with { type: 'json' };

export type MessageKey = keyof typeof en;

const DICTIONARIES: Record<Locale, Partial<Record<MessageKey, string>>> = { en, ru, hy };

export function translate(
  locale: Locale,
  key: MessageKey,
  vars: Record<string, string | number> = {},
): string {
  const template = DICTIONARIES[locale][key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match));
}
