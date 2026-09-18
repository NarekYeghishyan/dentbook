/**
 * Тексты, которые API отправляет людям (SMS; позже — Telegram и напоминания), — в файлах
 * переводов (§9). Базовый язык — английский: недостающий ключ берётся из en.json.
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
