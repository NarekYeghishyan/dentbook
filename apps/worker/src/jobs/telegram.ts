/**
 * Отправка в Telegram из очереди (§8): только отсюда, с повторами и нарастающей паузой.
 * 403 — врач заблокировал бота: ставим telegram_blocked и больше не пытаемся; врач снова
 * получит сообщения, когда напишет боту (API снимет флаг).
 */
import { UnrecoverableError, type Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { GrammyError } from 'grammy';
import type { InlineKeyboardButton } from 'grammy/types';
import { appointments, dentists, notifications, type Database } from '@dentbook/db';
import type { TelegramButton, TelegramJob } from '@dentbook/shared/queues';

/** То, что нужно от Bot API: grammY Api или подделка в тестах. */
export interface TelegramApi {
  sendMessage(
    chatId: number,
    text: string,
    other?: { reply_markup?: { inline_keyboard: InlineKeyboardButton[][] } },
  ): Promise<{ message_id: number }>;
  answerCallbackQuery(id: string, other?: { text?: string }): Promise<unknown>;
}

const toKeyboard = (rows: TelegramButton[][]): InlineKeyboardButton[][] =>
  rows.map((row) =>
    row.map((button) =>
      'webAppUrl' in button
        ? { text: button.text, web_app: { url: button.webAppUrl } }
        : { text: button.text, callback_data: button.callbackData },
    ),
  );

export function telegramProcessor(deps: { api: TelegramApi; db: Database }) {
  const { api, db } = deps;

  async function markNotification(id: string | undefined, patch: Record<string, unknown>) {
    if (!id) return;
    await db.update(notifications).set(patch).where(eq(notifications.id, id));
  }

  return async function process(job: Job<TelegramJob>): Promise<string> {
    const data = job.data;
    if (data.type === 'answer') {
      await api.answerCallbackQuery(data.callbackQueryId, data.text ? { text: data.text } : {});
      return 'answered';
    }

    if (data.onlyIfPending) {
      const [row] = await db
        .select({ status: appointments.status })
        .from(appointments)
        .where(eq(appointments.id, data.onlyIfPending));
      if (row?.status !== 'pending') return 'skipped';
    }

    const attempt = job.attemptsMade + 1;
    try {
      const sent = await api.sendMessage(
        data.chatId,
        data.text,
        data.buttons ? { reply_markup: { inline_keyboard: toKeyboard(data.buttons) } } : {},
      );
      await markNotification(data.notificationId, {
        status: 'sent',
        sentAt: new Date(),
        attempts: attempt,
        providerMessageId: String(sent.message_id),
      });
      return 'sent';
    } catch (err) {
      const code = err instanceof GrammyError ? err.error_code : undefined;
      if (code === 403) {
        await db
          .update(dentists)
          .set({ telegramBlocked: true })
          .where(
            and(eq(dentists.telegramChatId, data.chatId), eq(dentists.telegramBlocked, false)),
          );
        await markNotification(data.notificationId, {
          status: 'failed',
          attempts: attempt,
          lastError: 'telegram_403_blocked',
        });
        throw new UnrecoverableError('bot is blocked by the user');
      }
      const lastAttempt = attempt >= (job.opts.attempts ?? 1);
      await markNotification(data.notificationId, {
        attempts: attempt,
        // Только код ошибки: в описании Telegram бывает текст сообщения (§2.6)
        lastError: code ? `telegram_${code}` : 'network',
        ...(lastAttempt ? { status: 'failed' } : {}),
      });
      throw err;
    }
  };
}
