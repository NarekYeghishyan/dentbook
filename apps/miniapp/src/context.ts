import { createContext, useContext } from 'react';
import type { MiniappMe } from '@dentbook/shared';
import type { Locale } from '@dentbook/shared/domain';
import { ApiError } from './api';
import { translate, type MessageKey } from './i18n';

export interface Session {
  me: MiniappMe;
  locale: Locale;
  t(key: MessageKey, vars?: Record<string, string | number>): string;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession outside SessionContext');
  return session;
}

/** Текст ошибки API на языке врача. */
export function errorText(locale: Locale, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'slot_taken') return translate(locale, 'error.slot_taken');
    if (error.code === 'forbidden') return translate(locale, 'error.forbidden');
    if (error.code === 'unauthorized') return translate(locale, 'error.unauthorized');
  }
  return translate(locale, 'error.generic');
}
