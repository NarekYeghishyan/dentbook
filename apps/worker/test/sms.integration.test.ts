/**
 * SMS клиентам из очереди (Шаг 8): текст из БД в момент отправки, пропуск неуместных
 * уведомлений, повторы. Последний тест — настоящий BullMQ на Redis: сбойный провайдер,
 * повторы с паузой, успех на третьей попытке («повторные попытки работают»).
 */
import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents, UnrecoverableError, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appointments, blockedUntil, notifications, patients } from '@dentbook/db';
import { DEMO_IDS, seedDemo } from '@dentbook/db/seed';
import {
  startTestDatabase,
  startTestRedis,
  type TestDatabase,
  type TestRedis,
} from '@dentbook/db/testing';
import type { AppointmentStatus, NotificationKind } from '@dentbook/shared/domain';
import type { SmsJob } from '@dentbook/shared/queues';
import { SmsError, type SmsSender } from '@dentbook/shared/sms';
import { smsProcessor } from '../src/jobs/sms.js';

let database: TestDatabase;
let redisServer: TestRedis;

beforeAll(async () => {
  [database, redisServer] = await Promise.all([startTestDatabase(), startTestRedis()]);
  await seedDemo(database.db);
}, 180_000);

afterAll(async () => {
  await Promise.all([database?.stop(), redisServer?.stop()]);
});

const HOUR = 3_600_000;
let day = 0;

/** Запись клиента в демо-клинике (Берлин) и SMS-уведомление о ней. */
async function booking(
  options: { status?: AppointmentStatus; kind?: NotificationKind } = {},
): Promise<{ notificationId: string; startAt: Date }> {
  const n = ++day;
  // Каждая запись — в свой день: ограничение §2.1 не мешает фикстурам
  const startAt = new Date(Date.UTC(2030, 2, 3 + n, 10));
  const endAt = new Date(startAt.getTime() + 30 * 60_000);
  const status = options.status ?? 'confirmed';
  const [patient] = await database.db
    .insert(patients)
    .values({ clinicId: DEMO_IDS.clinic, fullName: 'Jane Client', phone: `+120255510${10 + n}` })
    .returning({ id: patients.id });
  const [appointment] = await database.db
    .insert(appointments)
    .values({
      clinicId: DEMO_IDS.clinic,
      locationId: DEMO_IDS.location,
      dentistId: DEMO_IDS.dentists.anna,
      serviceId: DEMO_IDS.services.checkup,
      patientId: patient!.id,
      startAt,
      endAt,
      blockedUntil: blockedUntil(endAt, 0),
      status,
      ...(status === 'cancelled'
        ? { cancelledAt: new Date(), cancelledBy: 'client' as const }
        : {}),
      source: 'widget',
    })
    .returning({ id: appointments.id });
  const id = randomUUID();
  await database.db.insert(notifications).values({
    id,
    clinicId: DEMO_IDS.clinic,
    appointmentId: appointment!.id,
    channel: 'sms',
    kind: options.kind ?? 'reminder_24h',
    patientId: patient!.id,
    scheduledFor: new Date(startAt.getTime() - 24 * HOUR),
    jobId: id,
  });
  return { notificationId: id, startAt };
}

const job = (notificationId: string, attemptsMade = 0) =>
  ({ data: { notificationId }, attemptsMade, opts: { attempts: 5 } }) as unknown as Job<SmsJob>;

function fakeSms(failures: SmsError[] = []) {
  const sent: { to: string; text: string }[] = [];
  const sender: SmsSender = {
    async send(message) {
      const failure = failures.shift();
      if (failure) throw failure;
      sent.push(message);
      return { id: `SM${sent.length}` };
    },
  };
  return { sender, sent };
}

const stateOf = async (id: string) =>
  (
    await database.db
      .select({
        status: notifications.status,
        attempts: notifications.attempts,
        lastError: notifications.lastError,
        providerMessageId: notifications.providerMessageId,
        sentAt: notifications.sentAt,
      })
      .from(notifications)
      .where(eq(notifications.id, id))
  )[0]!;

const normalize = (text: string) => text.replace(/\s/g, ' ');

describe('sms queue (Step 8)', () => {
  it('sends a reminder with the visit time in the office zone and marks it sent', async () => {
    const { notificationId, startAt } = await booking();
    const { sender, sent } = fakeSms();
    const now = new Date(startAt.getTime() - 24 * HOUR);
    const result = await smsProcessor({ db: database.db, sms: sender, now: () => now })(
      job(notificationId),
    );
    expect(result).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toMatch(/^\+120255510\d\d$/);
    // 10:00 UTC = 11:00 в Берлине (зимнее время)
    expect(normalize(sent[0]!.text)).toMatch(
      /^Demo Dental: a reminder of your visit on \w{3}, Mar \d{1,2}, 11:00 AM at Main office\.$/,
    );
    expect(await stateOf(notificationId)).toMatchObject({
      status: 'sent',
      attempts: 1,
      providerMessageId: 'SM1',
      sentAt: now,
    });
  });

  it('sends the confirmation text', async () => {
    const { notificationId, startAt } = await booking({ kind: 'appointment_confirmed' });
    const { sender, sent } = fakeSms();
    await smsProcessor({
      db: database.db,
      sms: sender,
      now: () => new Date(startAt.getTime() - 48 * HOUR),
    })(job(notificationId));
    expect(sent[0]!.text).toMatch(/^Demo Dental: your visit on .+ at Main office is confirmed\.$/);
  });

  it.each([
    ['pending', 'appointment_pending'],
    ['cancelled', 'appointment_cancelled'],
  ] as const)('skips a reminder for a %s booking', async (status, reason) => {
    const { notificationId, startAt } = await booking({ status });
    const { sender, sent } = fakeSms();
    const result = await smsProcessor({
      db: database.db,
      sms: sender,
      now: () => new Date(startAt.getTime() - 2 * HOUR),
    })(job(notificationId));
    expect(result).toBe('skipped');
    expect(sent).toHaveLength(0);
    expect(await stateOf(notificationId)).toMatchObject({ status: 'cancelled', lastError: reason });
  });

  it('does nothing for a notification cancelled with its booking', async () => {
    const { notificationId } = await booking();
    await database.db
      .update(notifications)
      .set({ status: 'cancelled' })
      .where(eq(notifications.id, notificationId));
    const { sender, sent } = fakeSms();
    expect(await smsProcessor({ db: database.db, sms: sender })(job(notificationId))).toBe(
      'skipped',
    );
    expect(sent).toHaveLength(0);
  });

  it('fails at once when the provider rejects the number', async () => {
    const { notificationId, startAt } = await booking();
    const { sender } = fakeSms([new SmsError(400, 21211, true)]);
    const run = smsProcessor({
      db: database.db,
      sms: sender,
      now: () => new Date(startAt.getTime() - 24 * HOUR),
    })(job(notificationId));
    await expect(run).rejects.toBeInstanceOf(UnrecoverableError);
    expect(await stateOf(notificationId)).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'sms_400_21211',
    });
  });

  it('keeps a transient failure scheduled for a retry and fails on the last attempt', async () => {
    const { notificationId, startAt } = await booking();
    const now = () => new Date(startAt.getTime() - 24 * HOUR);
    const { sender } = fakeSms([new SmsError(503, null, false), new SmsError(null, null, false)]);
    const processor = smsProcessor({ db: database.db, sms: sender, now });

    await expect(processor(job(notificationId, 0))).rejects.toBeInstanceOf(SmsError);
    expect(await stateOf(notificationId)).toMatchObject({
      status: 'scheduled',
      attempts: 1,
      lastError: 'sms_503_unknown',
    });
    await expect(processor(job(notificationId, 4))).rejects.toBeInstanceOf(SmsError);
    expect(await stateOf(notificationId)).toMatchObject({
      status: 'failed',
      attempts: 5,
      lastError: 'network',
    });
  });

  it('retries through BullMQ until the provider accepts the message', async () => {
    const { notificationId, startAt } = await booking();
    const { sender, sent } = fakeSms([
      new SmsError(503, null, false),
      new SmsError(429, 20429, false),
    ]);
    // Своё соединение каждому: BullMQ не закрывает переданные ему соединения
    const connections = [1, 2, 3].map(
      () => new Redis(redisServer.url, { maxRetriesPerRequest: null }),
    );
    const name = `sms-test-${randomUUID()}`;
    const queue = new Queue<SmsJob>(name, { connection: connections[0]! });
    const events = new QueueEvents(name, { connection: connections[1]! });
    const worker = new Worker<SmsJob>(
      name,
      smsProcessor({
        db: database.db,
        sms: sender,
        now: () => new Date(startAt.getTime() - 24 * HOUR),
      }),
      { connection: connections[2]! },
    );
    try {
      await events.waitUntilReady();
      const added = await queue.add(
        'notification',
        { notificationId },
        // Как SMS_JOB_OPTIONS, но с короткой паузой — тест не ждёт минутами
        { jobId: notificationId, attempts: 5, backoff: { type: 'exponential', delay: 50 } },
      );
      expect(await added.waitUntilFinished(events, 15_000)).toBe('sent');
      expect(sent).toHaveLength(1);
      expect(await stateOf(notificationId)).toMatchObject({
        status: 'sent',
        attempts: 3,
        lastError: null,
      });
    } finally {
      await worker.close();
      await events.close();
      await queue.close();
      for (const connection of connections) connection.disconnect();
    }
  });
});
