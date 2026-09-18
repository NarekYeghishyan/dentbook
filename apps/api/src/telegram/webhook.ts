/**
 * Вебхук Telegram (§8: webhook, не polling). Запрос подписан секретом из setWebhook
 * (заголовок X-Telegram-Bot-Api-Secret-Token). Telegram повторяет доставку — дубли
 * отсекаются по update_id через telegram_updates.
 */
import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Update } from 'grammy/types';
import { telegramUpdates, type Database } from '@dentbook/db';
import { ApiError } from '../lib/errors.js';
import type { Notifier } from '../services/notifier.js';
import { createUpdateHandler } from './bot.js';
import type { TelegramConfig } from './outbox.js';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

function sameSecret(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const telegramWebhook: FastifyPluginAsync<{
  db: Database;
  telegram: TelegramConfig;
  notifier: Notifier;
}> = async (app, { db, telegram, notifier }) => {
  const handleUpdate = createUpdateHandler({ db, telegram, notifier });

  app.post('/webhook', async (request, reply) => {
    if (!sameSecret(request.headers[SECRET_HEADER], telegram.webhookSecret)) {
      throw new ApiError(401, 'unauthorized', 'Bad webhook secret');
    }
    const update = request.body as Update | undefined;
    if (!update || !Number.isSafeInteger(update.update_id)) {
      throw new ApiError(400, 'validation_failed', 'Invalid fields: update_id');
    }

    const fresh = await db
      .insert(telegramUpdates)
      .values({ updateId: update.update_id })
      .onConflictDoNothing()
      .returning({ updateId: telegramUpdates.updateId });
    // Повторная доставка уже обработанного обновления
    if (fresh.length === 0) return reply.status(200).send({ ok: true });

    try {
      await handleUpdate(update);
    } catch (err) {
      // Не обработали — забываем update_id, чтобы повтор Telegram дошёл до обработчика
      await db.delete(telegramUpdates).where(eq(telegramUpdates.updateId, update.update_id));
      throw err;
    }
    return reply.status(200).send({ ok: true });
  });
};
