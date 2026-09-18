/**
 * Уведомления о записях. Каждое — строка notifications (журнал без ПДн) и задача в очереди;
 * worker отмечает её sent, failed или cancelled.
 * - Врачу в Telegram (Шаг 7, §8): новая запись, отмена клиентом, повтор о неподтверждённой.
 * - Клиенту по SMS (Шаг 8): подтверждение записи (Q12), напоминания за 24 ч и 2 ч;
 *   при отмене напоминания снимаются.
 * Сбой уведомления не отменяет запись: ошибка пишется в лог без данных клиента.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { appointments, notifications, type Database } from '@dentbook/db';
import type { NotificationKind } from '@dentbook/shared/domain';
import type { FastifyBaseLogger } from 'fastify';
import { translate, type MessageKey } from '../i18n/index.js';
import { confirmData } from '../telegram/bot.js';
import type { TelegramConfig } from '../telegram/outbox.js';
import { describeAppointment } from '../telegram/texts.js';
import { planReminders } from './reminders.js';
import type { SmsOutbox } from './sms-outbox.js';

/** Через сколько повторить алерт о неподтверждённой записи (Q12: N не задан — 2 ч). */
export const PENDING_REMINDER_MS = 2 * 60 * 60 * 1000;

export interface Notifier {
  /**
   * Новая запись: алерт врачу и напоминания клиенту. alertDentist: false — запись сделал
   * сам врач в Mini App, сообщать ему не о чем.
   */
  appointmentCreated(
    clinicId: string,
    appointmentId: string,
    options?: { alertDentist?: boolean },
  ): Promise<void>;
  /** Врач или регистратура подтвердили запись: SMS клиенту (Q12). */
  appointmentConfirmed(clinicId: string, appointmentId: string): Promise<void>;
  /** Клиент отменил запись: алерт врачу, напоминания сняты. */
  appointmentCancelled(clinicId: string, appointmentId: string): Promise<void>;
}

export const silentNotifier: Notifier = {
  appointmentCreated: async () => undefined,
  appointmentConfirmed: async () => undefined,
  appointmentCancelled: async () => undefined,
};

export function createNotifier(deps: {
  db: Database;
  telegram: TelegramConfig | undefined;
  sms: SmsOutbox | undefined;
  log: FastifyBaseLogger;
}): Notifier {
  const { db, telegram, sms, log } = deps;
  if (!telegram && !sms) return silentNotifier;

  async function alert(clinicId: string, appointmentId: string, kind: NotificationKind) {
    if (!telegram) return;
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
      [{ text: translate(locale, 'tg.openSchedule'), webAppUrl: telegram.miniAppUrl }],
    ];
    const [row] = await db
      .insert(notifications)
      .values({ clinicId, appointmentId, channel: 'telegram', kind, dentistId: details.dentistId })
      .returning({ id: notifications.id });
    await telegram.outbox.enqueue({
      type: 'message',
      chatId: details.dentistChatId,
      text,
      buttons,
      notificationId: row!.id,
    });
    if (pending && kind === 'appointment_created') {
      // Q12: статус не меняется, через N часов — повтор, если запись всё ещё ждёт
      await telegram.outbox.enqueue(
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

  /** SMS клиенту на время `at`: строка notifications и задача с тем же id. */
  async function queueSms(
    clinicId: string,
    appointmentId: string,
    kind: NotificationKind,
    at: Date,
  ): Promise<void> {
    if (!sms) return;
    const [appointment] = await db
      .select({ patientId: appointments.patientId })
      .from(appointments)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.clinicId, clinicId)));
    if (!appointment?.patientId) return;
    const id = randomUUID();
    await db.insert(notifications).values({
      id,
      clinicId,
      appointmentId,
      channel: 'sms',
      kind,
      patientId: appointment.patientId,
      scheduledFor: at,
      jobId: id,
    });
    await sms.enqueue(id, { delayMs: Math.max(0, at.getTime() - Date.now()) });
  }

  async function scheduleReminders(clinicId: string, appointmentId: string) {
    if (!sms) return;
    const [row] = await db
      .select({ startAt: appointments.startAt })
      .from(appointments)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.clinicId, clinicId)));
    if (!row) return;
    // Напоминания ставятся и для pending: worker отправит их, только если к сроку запись
    // подтверждена
    for (const { kind, at } of planReminders(row.startAt, new Date())) {
      await queueSms(clinicId, appointmentId, kind, at);
    }
  }

  async function cancelSms(clinicId: string, appointmentId: string) {
    if (!sms) return;
    const cancelled = await db
      .update(notifications)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(notifications.clinicId, clinicId),
          eq(notifications.appointmentId, appointmentId),
          eq(notifications.channel, 'sms'),
          eq(notifications.status, 'scheduled'),
        ),
      )
      .returning({ jobId: notifications.jobId });
    for (const { jobId } of cancelled) if (jobId) await sms.remove(jobId);
  }

  /** Каждая часть — отдельно: сбой Telegram не мешает напоминаниям, и наоборот. */
  async function safely(
    what: string,
    appointmentId: string,
    action: () => Promise<void>,
  ): Promise<void> {
    try {
      await action();
    } catch (err) {
      log.error({ err: (err as Error).message, appointmentId, what }, 'notification failed');
    }
  }

  return {
    async appointmentCreated(clinicId, appointmentId, options = {}) {
      if (options.alertDentist !== false) {
        await safely('telegram_created', appointmentId, () =>
          alert(clinicId, appointmentId, 'appointment_created'),
        );
      }
      await safely('sms_reminders', appointmentId, () =>
        scheduleReminders(clinicId, appointmentId),
      );
    },
    async appointmentConfirmed(clinicId, appointmentId) {
      await safely('sms_confirmed', appointmentId, () =>
        queueSms(clinicId, appointmentId, 'appointment_confirmed', new Date()),
      );
    },
    async appointmentCancelled(clinicId, appointmentId) {
      await safely('telegram_cancelled', appointmentId, () =>
        alert(clinicId, appointmentId, 'appointment_cancelled'),
      );
      await safely('sms_cancel', appointmentId, () => cancelSms(clinicId, appointmentId));
    },
  };
}
