/**
 * Обработка обновлений бота (§8): привязка врача по /start <токен>, повторный /start,
 * подтверждение записи кнопкой. Ответы — задачами в очередь, не напрямую.
 * Только личные чаты: в группах бот молчит.
 */
import { createHash } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Update } from 'grammy/types';
import {
  appointments,
  clinics,
  dentists,
  pgErrorCode,
  PG_UNIQUE_VIOLATION,
  telegramLinkTokens,
  type Database,
} from '@dentbook/db';
import type { Locale } from '@dentbook/shared/domain';
import { translate } from '../i18n/index.js';
import type { TelegramConfig } from './outbox.js';
import { describeAppointment } from './texts.js';

export const hashLinkToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Данные кнопки подтверждения: confirm:<appointment id>. */
export const confirmData = (appointmentId: string) => `confirm:${appointmentId}`;

export function createUpdateHandler(deps: { db: Database; telegram: TelegramConfig }) {
  const { db, telegram } = deps;
  const scheduleButton = (locale: Locale) => [
    [{ text: translate(locale, 'tg.openSchedule'), webAppUrl: telegram.miniAppUrl }],
  ];
  const send = (chatId: number, text: string, locale?: Locale) =>
    telegram.outbox.enqueue({
      type: 'message',
      chatId,
      text,
      ...(locale ? { buttons: scheduleButton(locale) } : {}),
    });

  async function dentistByChat(chatId: number) {
    const [row] = await db
      .select({
        id: dentists.id,
        clinicId: dentists.clinicId,
        clinicName: clinics.name,
        locale: clinics.locale,
      })
      .from(dentists)
      .innerJoin(clinics, eq(clinics.id, dentists.clinicId))
      .where(eq(dentists.telegramChatId, chatId));
    return row ? { ...row, locale: row.locale as Locale } : undefined;
  }

  async function link(chatId: number, token: string, now: Date) {
    const [invite] = await db
      .select({
        dentistId: telegramLinkTokens.dentistId,
        clinicId: telegramLinkTokens.clinicId,
        name: dentists.fullName,
        clinicName: clinics.name,
        locale: clinics.locale,
      })
      .from(telegramLinkTokens)
      .innerJoin(dentists, eq(dentists.id, telegramLinkTokens.dentistId))
      .innerJoin(clinics, eq(clinics.id, telegramLinkTokens.clinicId))
      .where(
        and(
          eq(telegramLinkTokens.tokenHash, hashLinkToken(token)),
          isNull(telegramLinkTokens.usedAt),
          gt(telegramLinkTokens.expiresAt, now),
        ),
      );
    if (!invite) return send(chatId, translate('en', 'tg.linkInvalid'));
    const locale = invite.locale as Locale;
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(dentists)
          .set({ telegramChatId: chatId, telegramLinkedAt: now, telegramBlocked: false })
          .where(and(eq(dentists.id, invite.dentistId), eq(dentists.clinicId, invite.clinicId)));
        await tx
          .update(telegramLinkTokens)
          .set({ usedAt: now })
          .where(eq(telegramLinkTokens.tokenHash, hashLinkToken(token)));
      });
    } catch (err) {
      // Один Telegram — один врач на платформе (Q9)
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION)
        return send(chatId, translate(locale, 'tg.linkTaken'));
      throw err;
    }
    return send(
      chatId,
      translate(locale, 'tg.linked', { name: invite.name, clinic: invite.clinicName }),
      locale,
    );
  }

  async function greet(chatId: number) {
    const dentist = await dentistByChat(chatId);
    if (!dentist) return send(chatId, translate('en', 'tg.notLinked'));
    // Написал боту — значит, снова не заблокировал его
    await db.update(dentists).set({ telegramBlocked: false }).where(eq(dentists.id, dentist.id));
    return send(
      chatId,
      translate(dentist.locale, 'tg.welcomeBack', { clinic: dentist.clinicName }),
      dentist.locale,
    );
  }

  async function confirm(
    chatId: number,
    callbackQueryId: string,
    appointmentId: string,
    now: Date,
  ) {
    const answer = (text: string) =>
      telegram.outbox.enqueue({ type: 'answer', callbackQueryId, text });
    const dentist = await dentistByChat(chatId);
    if (!dentist) return answer(translate('en', 'tg.notLinked'));

    const [confirmed] = await db
      .update(appointments)
      .set({ status: 'confirmed' })
      .where(
        and(
          eq(appointments.id, appointmentId),
          eq(appointments.clinicId, dentist.clinicId),
          eq(appointments.dentistId, dentist.id),
          eq(appointments.status, 'pending'),
          gt(appointments.startAt, now),
        ),
      )
      .returning({ id: appointments.id });
    if (!confirmed) return answer(translate(dentist.locale, 'tg.alreadyHandled'));

    // TODO(Шаг 8): SMS клиенту о подтверждении (Q12)
    const details = await describeAppointment(db, dentist.clinicId, appointmentId);
    const text = translate(dentist.locale, 'tg.confirmed', {
      when: details?.when ?? '',
      client: details?.client ?? '',
    });
    await answer(text);
    return send(chatId, text, dentist.locale);
  }

  return async function handleUpdate(update: Update, now = new Date()): Promise<void> {
    const message = update.message;
    if (message?.chat.type === 'private' && typeof message.text === 'string') {
      const [command, payload] = message.text.trim().split(/\s+/, 2);
      if (command === '/start' && payload && /^[\w-]{20,64}$/.test(payload)) {
        return link(message.chat.id, payload, now);
      }
      return greet(message.chat.id);
    }
    const query = update.callback_query;
    const data = query?.data?.match(/^confirm:([0-9a-f-]{36})$/);
    if (query && data && query.message?.chat.type === 'private') {
      return confirm(query.message.chat.id, query.id, data[1]!, now);
    }
  };
}
