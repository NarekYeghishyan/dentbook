/**
 * Очереди BullMQ, общие для API (кладёт задачи) и worker'а (выполняет). Без zod —
 * модуль берут и фронтенды нет, и бэкенд без лишнего.
 */

/** Исходящие в Telegram — только через эту очередь (CLAUDE.md §8). */
export const TELEGRAM_QUEUE = 'telegram';

export type TelegramButton =
  | { text: string; callbackData: string }
  /** Кнопка, открывающая Mini App. */
  | { text: string; webAppUrl: string };

export type TelegramJob =
  | {
      type: 'message';
      chatId: number;
      text: string;
      buttons?: TelegramButton[][];
      /** Строка notifications, которую worker отмечает sent/failed. */
      notificationId?: string;
      /** Отправить, только если запись всё ещё ждёт подтверждения (повтор алерта, Q12). */
      onlyIfPending?: string;
    }
  | { type: 'answer'; callbackQueryId: string; text?: string };

/** Повторы с нарастающей паузой: 5 с, 10 с, 20 с… (§8). */
export const TELEGRAM_JOB_OPTIONS = {
  attempts: 6,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
} as const;
