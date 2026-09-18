import { UnrecoverableError, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { GrammyError } from 'grammy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appointments, blockedUntil, dentists, notifications } from '@dentbook/db';
import { DEMO_IDS, seedDemo } from '@dentbook/db/seed';
import { startTestDatabase, type TestDatabase } from '@dentbook/db/testing';
import type { TelegramJob } from '@dentbook/shared/queues';
import { telegramProcessor, type TelegramApi } from '../src/jobs/telegram.js';

const CHAT = 7001;
let database: TestDatabase;

beforeAll(async () => {
  database = await startTestDatabase();
  await seedDemo(database.db);
  await database.db
    .update(dentists)
    .set({ telegramChatId: CHAT })
    .where(eq(dentists.id, DEMO_IDS.dentists.anna));
}, 180_000);

afterAll(async () => {
  await database?.stop();
});

const job = (data: TelegramJob, attemptsMade = 0) =>
  ({ data, attemptsMade, opts: { attempts: 6 } }) as unknown as Job<TelegramJob>;

function fakeApi(fail?: { code: number }) {
  const sent: { chatId: number; text: string; other: unknown }[] = [];
  const answered: { id: string; text?: string }[] = [];
  const api: TelegramApi = {
    async sendMessage(chatId, text, other) {
      if (fail) {
        throw new GrammyError(
          'Call to sendMessage failed!',
          {
            ok: false,
            error_code: fail.code,
            description: 'Forbidden: bot was blocked by the user',
          },
          'sendMessage',
          {},
        );
      }
      sent.push({ chatId, text, other });
      return { message_id: 42 };
    },
    async answerCallbackQuery(id, other) {
      answered.push({ id, ...other });
      return true;
    },
  };
  return { api, sent, answered };
}

async function notification() {
  const [row] = await database.db
    .insert(notifications)
    .values({
      clinicId: DEMO_IDS.clinic,
      channel: 'telegram',
      kind: 'appointment_created',
      dentistId: DEMO_IDS.dentists.anna,
    })
    .returning({ id: notifications.id });
  return row!.id;
}

const statusOf = async (id: string) =>
  (
    await database.db
      .select({
        status: notifications.status,
        attempts: notifications.attempts,
        lastError: notifications.lastError,
        providerMessageId: notifications.providerMessageId,
      })
      .from(notifications)
      .where(eq(notifications.id, id))
  )[0]!;

describe('telegram queue (§8)', () => {
  it('sends a message with buttons and marks the notification sent', async () => {
    const { api, sent } = fakeApi();
    const id = await notification();
    const result = await telegramProcessor({ api, db: database.db })(
      job({
        type: 'message',
        chatId: CHAT,
        text: 'New booking',
        notificationId: id,
        buttons: [
          [{ text: 'Confirm', callbackData: 'confirm:x' }],
          [{ text: 'Open', webAppUrl: 'https://example.com/miniapp/' }],
        ],
      }),
    );
    expect(result).toBe('sent');
    expect(sent[0]!.other).toEqual({
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Confirm', callback_data: 'confirm:x' }],
          [{ text: 'Open', web_app: { url: 'https://example.com/miniapp/' } }],
        ],
      },
    });
    expect(await statusOf(id)).toMatchObject({
      status: 'sent',
      attempts: 1,
      providerMessageId: '42',
    });
  });

  it('on 403 marks the dentist as having blocked the bot and stops retrying', async () => {
    const { api } = fakeApi({ code: 403 });
    const id = await notification();
    const run = telegramProcessor({ api, db: database.db })(
      job({ type: 'message', chatId: CHAT, text: 'Hi', notificationId: id }),
    );
    await expect(run).rejects.toBeInstanceOf(UnrecoverableError);
    expect(await statusOf(id)).toMatchObject({
      status: 'failed',
      lastError: 'telegram_403_blocked',
    });
    const [dentist] = await database.db
      .select({ blocked: dentists.telegramBlocked })
      .from(dentists)
      .where(eq(dentists.id, DEMO_IDS.dentists.anna));
    expect(dentist!.blocked).toBe(true);
    await database.db
      .update(dentists)
      .set({ telegramBlocked: false })
      .where(eq(dentists.id, DEMO_IDS.dentists.anna));
  });

  it('on other errors rethrows for a retry and fails only on the last attempt', async () => {
    const { api } = fakeApi({ code: 429 });
    const id = await notification();
    const process = telegramProcessor({ api, db: database.db });
    const data: TelegramJob = { type: 'message', chatId: CHAT, text: 'Hi', notificationId: id };
    await expect(process(job(data, 0))).rejects.toBeInstanceOf(GrammyError);
    expect(await statusOf(id)).toMatchObject({
      status: 'scheduled',
      attempts: 1,
      lastError: 'telegram_429',
    });
    await expect(process(job(data, 5))).rejects.toBeInstanceOf(GrammyError);
    expect(await statusOf(id)).toMatchObject({ status: 'failed', attempts: 6 });
  });

  it('skips the pending reminder when the booking is no longer pending (Q12)', async () => {
    const endAt = new Date('2030-03-04T10:30:00Z');
    const [row] = await database.db
      .insert(appointments)
      .values({
        clinicId: DEMO_IDS.clinic,
        locationId: DEMO_IDS.location,
        dentistId: DEMO_IDS.dentists.anna,
        serviceId: DEMO_IDS.services.checkup,
        startAt: new Date('2030-03-04T10:00:00Z'),
        endAt,
        blockedUntil: blockedUntil(endAt, 0),
        status: 'hold',
        holdExpiresAt: new Date('2099-01-01T00:00:00Z'),
        source: 'widget',
      })
      .returning({ id: appointments.id });
    const { api, sent } = fakeApi();
    const result = await telegramProcessor({ api, db: database.db })(
      job({ type: 'message', chatId: CHAT, text: 'Reminder', onlyIfPending: row!.id }),
    );
    expect(result).toBe('skipped');
    expect(sent).toHaveLength(0);
  });

  it('answers a button press', async () => {
    const { api, answered } = fakeApi();
    await telegramProcessor({ api, db: database.db })(
      job({ type: 'answer', callbackQueryId: 'cb-1', text: 'Confirmed' }),
    );
    expect(answered).toEqual([{ id: 'cb-1', text: 'Confirmed' }]);
  });
});
