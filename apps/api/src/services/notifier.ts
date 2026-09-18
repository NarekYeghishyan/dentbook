/**
 * Уведомления врачу в Telegram о новых и отменённых записях (Шаг 7, §8). Каждое — строка
 * notifications (журнал без ПДн) и задача в очереди; worker отмечает её sent или failed.
 * Сбой уведомления не отменяет запись: ошибка пишется в лог без данных клиента.
 */
import { notifications, type Database } from '@dentbook/db';
import type { NotificationKind } from '@dentbook/shared/domain';
import type { FastifyBaseLogger } from 'fastify';
import { translate, type MessageKey } from '../i18n/index.js';
import { confirmData } from '../telegram/bot.js';
import type { TelegramConfig } from '../telegram/outbox.js';
import { describeAppointment } from '../telegram/texts.js';

/** Через сколько повторить алерт о неподтверждённой записи (Q12: N не задан — 2 ч). */
export const PENDING_REMINDER_MS = 2 * 60 * 60 * 1000;

export interface Notifier {
  appointmentCreated(clinicId: string, appointmentId: string): Promise<void>;
  appointmentCancelled(clinicId: string, appointmentId: string): Promise<void>;
}

export const silentNotifier: Notifier = {
  appointmentCreated: async () => undefined,
  appointmentCancelled: async () => undefined,
};

export function createNotifier(deps: {
  db: Database;
  telegram: TelegramConfig | undefined;
  log: FastifyBaseLogger;
}): Notifier {
  const { db, telegram, log } = deps;
  if (!telegram) return silentNotifier;

  async function alert(clinicId: string, appointmentId: string, kind: NotificationKind) {
    const details = await describeAppointment(db, clinicId, appointmentId);
    if (!details || details.dentistChatId === null || details.dentistBlocked) return;
    const { locale } = details;
    const pending = details.status === 'pending';
    const key: MessageKey =
      kind === 'appointment_cancelled'
        ? 'tg.cancelled'
        : pending
          ? 'tg.newBookingPending'
          : 'tg.newBooking';
    const vars = {
      when: details.when,
      service: details.service,
      office: details.office,
      client: details.client,
      phone: details.phone,
    };
    const text = translate(locale, key, vars);
    const buttons = [
      ...(pending && kind === 'appointment_created'
        ? [[{ text: translate(locale, 'tg.confirm'), callbackData: confirmData(appointmentId) }]]
        : []),
      [{ text: translate(locale, 'tg.openSchedule'), webAppUrl: telegram!.miniAppUrl }],
    ];
    const [row] = await db
      .insert(notifications)
      .values({ clinicId, appointmentId, channel: 'telegram', kind, dentistId: details.dentistId })
      .returning({ id: notifications.id });
    await telegram!.outbox.enqueue({
      type: 'message',
      chatId: details.dentistChatId,
      text,
      buttons,
      notificationId: row!.id,
    });
    if (pending && kind === 'appointment_created') {
      // Q12: статус не меняется, через N часов — повтор, если запись всё ещё ждёт
      await telegram!.outbox.enqueue(
        {
          type: 'message',
          chatId: details.dentistChatId,
          text: translate(locale, 'tg.pendingReminder', vars),
          buttons,
          onlyIfPending: appointmentId,
        },
        { delayMs: PENDING_REMINDER_MS },
      );
    }
  }

  const safely =
    (kind: NotificationKind) =>
    async (clinicId: string, appointmentId: string): Promise<void> => {
      try {
        await alert(clinicId, appointmentId, kind);
      } catch (err) {
        log.error({ err: (err as Error).message, appointmentId, kind }, 'telegram alert failed');
      }
    };

  return {
    appointmentCreated: safely('appointment_created'),
    appointmentCancelled: safely('appointment_cancelled'),
  };
}
