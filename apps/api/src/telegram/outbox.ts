/**
 * Исходящие в Telegram — только через очередь BullMQ с повторами (CLAUDE.md §8):
 * API кладёт задачу, worker отправляет, 403 помечает врача telegram_blocked.
 */
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { TELEGRAM_JOB_OPTIONS, TELEGRAM_QUEUE, type TelegramJob } from '@dentbook/shared/queues';

export interface TelegramOutbox {
  enqueue(job: TelegramJob, options?: { delayMs?: number }): Promise<void>;
}

export class BullTelegramOutbox implements TelegramOutbox {
  private readonly queue: Queue<TelegramJob>;

  constructor(connection: Redis) {
    this.queue = new Queue<TelegramJob>(TELEGRAM_QUEUE, { connection });
  }

  async enqueue(job: TelegramJob, options: { delayMs?: number } = {}): Promise<void> {
    await this.queue.add(job.type, job, {
      ...TELEGRAM_JOB_OPTIONS,
      ...(options.delayMs ? { delay: options.delayMs } : {}),
    });
  }

  close(): Promise<void> {
    return this.queue.close();
  }
}

/** Всё, что нужно API для Telegram. Без токена бота — undefined, бот выключен. */
export interface TelegramConfig {
  botToken: string;
  botUsername: string;
  webhookSecret: string;
  /** Адрес Mini App: кнопка «Открыть расписание». */
  miniAppUrl: string;
  outbox: TelegramOutbox;
}

/** Ссылка привязки врача: t.me/<bot>?start=<token> (§8). */
export const linkUrl = (botUsername: string, token: string) =>
  `https://t.me/${botUsername}?start=${token}`;
