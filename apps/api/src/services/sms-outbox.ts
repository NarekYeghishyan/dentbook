/**
 * Уведомления клиентам по SMS — через очередь BullMQ `sms` (Шаг 8): worker отправляет с
 * повторами. id задачи = id строки notifications, по нему отложенное напоминание снимается.
 */
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { SMS_JOB_OPTIONS, SMS_QUEUE, type SmsJob } from '@dentbook/shared/queues';

export interface SmsOutbox {
  enqueue(notificationId: string, options?: { delayMs?: number }): Promise<void>;
  /** Снять задачу, которая ещё не выполнялась. Уже выполненную или отсутствующую — пропустить. */
  remove(notificationId: string): Promise<void>;
}

export class BullSmsOutbox implements SmsOutbox {
  private readonly queue: Queue<SmsJob>;

  constructor(connection: Redis) {
    this.queue = new Queue<SmsJob>(SMS_QUEUE, { connection });
  }

  async enqueue(notificationId: string, options: { delayMs?: number } = {}): Promise<void> {
    await this.queue.add(
      'notification',
      { notificationId },
      {
        ...SMS_JOB_OPTIONS,
        jobId: notificationId,
        ...(options.delayMs ? { delay: options.delayMs } : {}),
      },
    );
  }

  async remove(notificationId: string): Promise<void> {
    // Задачу, которую worker как раз выполняет, BullMQ не удалит — её остановит проверка
    // статуса записи в worker'е
    await this.queue.remove(notificationId).catch(() => 0);
  }

  close(): Promise<void> {
    return this.queue.close();
  }
}
