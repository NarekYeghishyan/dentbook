/** Счётчики очередей BullMQ для панели оператора (Шаг 10, Q18). */
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { SMS_QUEUE, TELEGRAM_QUEUE } from '@dentbook/shared/queues';

export interface QueueCounts {
  name: string;
  waiting: number;
  delayed: number;
  active: number;
  failed: number;
}

export interface QueueInspector {
  counts(): Promise<QueueCounts[]>;
}

export const NOTIFICATION_QUEUES = [SMS_QUEUE, TELEGRAM_QUEUE] as const;

export class BullQueueInspector implements QueueInspector {
  private readonly queues: Queue[];

  constructor(connection: Redis) {
    this.queues = NOTIFICATION_QUEUES.map((name) => new Queue(name, { connection }));
  }

  async counts(): Promise<QueueCounts[]> {
    return Promise.all(
      this.queues.map(async (queue) => {
        const c = await queue.getJobCounts('waiting', 'delayed', 'active', 'failed');
        return {
          name: queue.name,
          waiting: c.waiting ?? 0,
          delayed: c.delayed ?? 0,
          active: c.active ?? 0,
          failed: c.failed ?? 0,
        };
      }),
    );
  }

  async close(): Promise<void> {
    await Promise.all(this.queues.map((queue) => queue.close()));
  }
}
