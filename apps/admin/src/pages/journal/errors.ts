import { ApiError } from '../../api/client';
import { useErrorText } from '../../components/ui';
import { useI18n } from '../../i18n';

/** Ошибка действия с записью — словами регистратуры, а не кодом API. */
export function useJournalError() {
  const { t } = useI18n();
  const text = useErrorText();
  return (error: unknown): string => {
    if (error instanceof ApiError) {
      if (error.code === 'slot_taken') return t('journal.slotTaken');
      if (error.code === 'outside_working_hours') return t('journal.outsideHours');
      if (error.status === 409) return t('journal.notMovable');
    }
    return text(error);
  };
}

/** Свободное время рядом из ответа 409 slot_taken. */
export const alternativesOf = (error: unknown): string[] => {
  const list = error instanceof ApiError ? (error.body as { alternatives?: unknown }) : null;
  return Array.isArray(list?.alternatives) ? (list.alternatives as string[]) : [];
};
