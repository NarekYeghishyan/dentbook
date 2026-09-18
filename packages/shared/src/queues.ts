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

/**
 * SMS клиентам (Шаг 8): подтверждение записи и напоминания. Задача несёт только id строки
 * notifications, она же — id задачи: по нему напоминание снимается при отмене. Текст
 * worker собирает из БД в момент отправки — в Redis нет ни телефона, ни имени (§2.6).
 */
export const SMS_QUEUE = 'sms';

export interface SmsJob {
  notificationId: string;
}

/** 5 попыток: 30 с, 1 мин, 2 мин, 4 мин — напоминание за 2 ч успевает с запасом. */
export const SMS_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
} as const;

/** За сколько до начала визита напомнить клиенту (§10, Шаг 8). */
export const REMINDER_OFFSETS_MS = {
  reminder_24h: 24 * 60 * 60 * 1000,
  reminder_2h: 2 * 60 * 60 * 1000,
} as const;

export type ReminderKind = keyof typeof REMINDER_OFFSETS_MS;
