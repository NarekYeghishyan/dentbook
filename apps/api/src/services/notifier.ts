/**
 * Уведомления о записях. Каждое — строка notifications (журнал без ПДн) и задача в очереди;
 * worker отмечает её sent, failed или cancelled.
 * - Врачу в Telegram (Шаг 7, §8): новая запись, отмена, перенос, повтор о неподтверждённой.
 * - Клиенту по SMS (Шаг 8): подтверждение записи (Q12), напоминания за 24 ч и 2 ч, перенос
 *   и отмена клиникой (Шаг 9); при отмене и переносе старые напоминания снимаются.
 * Сбой уведомления не отменяет запись: ошибка пишется в лог без данных клиента.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { appointments, dentists, notifications, type Database } from '@dentbook/db';
import type { NotificationKind } from '@dentbook/shared/domain';
import type { TelegramButton } from '@dentbook/shared/queues';
import type { FastifyBaseLogger } from 'fastify';
import { translate, type MessageKey } from '../i18n/index.js';
import { confirmData } from '../telegram/bot.js';
import type { TelegramConfig } from '../telegram/outbox.js';
import { describeAppointment, formatWhen, type AppointmentDetails } from '../telegram/texts.js';
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
  /**
   * Запись отменена: алерт врачу, напоминания сняты. Отменила клиника — клиенту SMS;
   * отменил клиент — он и так знает.
   */
  appointmentCancelled(
    clinicId: string,
    appointmentId: string,
    by?: 'client' | 'clinic',
  ): Promise<void>;
  /**
   * Регистратура перенесла запись (Шаг 9): алерт врачу (и прежнему, если врач сменился);
   * если сменилось время — клиенту SMS и напоминания на новое время.
   */
  appointmentRescheduled(
    clinicId: string,
    appointmentId: string,
    previous: { dentistId: string; startAt: Date },
  ): Promise<void>;
}

export const silentNotifier: Notifier = {
  appointmentCreated: async () => undefined,
  appointmentConfirmed: async () => undefined,
  appointmentCancelled: async () => undefined,
  appointmentRescheduled: async () => undefined,
};

export function createNotifier(deps: {
  db: Database;
  telegram: TelegramConfig | undefined;
  sms: SmsOutbox | undefined;
  log: FastifyBaseLogger;
}): Notifier {
  const { db, telegram, sms, log } = deps;
  if (!telegram && !sms) return silentNotifier;

  const varsOf = (details: AppointmentDetails, when = details.when) => ({
    when,
    service: details.service,
    office: details.office,
    client: details.client,
    phone: details.phone,
  });

  /** Сообщение врачу в Telegram: строка notifications и задача очереди. */
  async function toDentist(
    clinicId: string,
    appointmentId: string,
    dentistId: string,
    kind: NotificationKind,
    message: { chatId: number; text: string; buttons: TelegramButton[][] },
  ) {
    const [row] = await db
      .insert(notifications)
      .values({ clinicId, appointmentId, channel: 'telegram', kind, dentistId })
      .returning({ id: notifications.id });
    await telegram!.outbox.enqueue({ type: 'message', ...message, notificationId: row!.id });
  }

  async function alert(
    clinicId: string,
    appointmentId: string,
    kind: NotificationKind,
    key: MessageKey,
  ) {
    if (!telegram) return;
    const details = await describeAppointment(db, clinicId, appointmentId);
    if (!details || details.dentistChatId === null || details.dentistBlocked) return;
    const { locale } = details;
    const awaitsConfirmation = details.status === 'pending' && kind !== 'appointment_cancelled';
    const buttons = [
      ...(awaitsConfirmation
        ? [[{ text: translate(locale, 'tg.confirm'), callbackData: confirmData(appointmentId) }]]
        : []),
      [{ text: translate(locale, 'tg.openSchedule'), webAppUrl: telegram.miniAppUrl }],
    ];
    const text = translate(locale, key, varsOf(details));
    await toDentist(clinicId, appointmentId, details.dentistId, kind, {
      chatId: details.dentistChatId,
      text,
      buttons,
    });
    if (awaitsConfirmation && kind === 'appointment_created') {
      // Q12: статус не меняется, через N часов — повтор, если запись всё ещё ждёт
      await telegram.outbox.enqueue(
        {
          type: 'message',
          chatId: details.dentistChatId,
          text: translate(locale, 'tg.pendingReminder', varsOf(details)),
          buttons,
          onlyIfPending: appointmentId,
        },
        { delayMs: PENDING_REMINDER_MS },
      );
    }
  }

  /** Прежнему врачу: запись ушла к другому, время — прежнее. */
  async function alertPreviousDentist(
    clinicId: string,
    appointmentId: string,
    previous: { dentistId: string; startAt: Date },
  ) {
    if (!telegram) return;
    const details = await describeAppointment(db, clinicId, appointmentId);
    const [dentist] = await db
      .select({ chatId: dentists.telegramChatId, blocked: dentists.telegramBlocked })
      .from(dentists)
      .where(and(eq(dentists.id, previous.dentistId), eq(dentists.clinicId, clinicId)));
    if (!details || !dentist || dentist.chatId === null || dentist.blocked) return;
    const when = formatWhen(previous.startAt, details.timeZone, details.locale);
    await toDentist(clinicId, appointmentId, previous.dentistId, 'appointment_rescheduled', {
      chatId: dentist.chatId,
      text: translate(details.locale, 'tg.movedAway', varsOf(details, when)),
      buttons: [
        [
          {
            text: translate(details.locale, 'tg.openSchedule'),
            webAppUrl: telegram.miniAppUrl,
          },
        ],
      ],
    });
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

  /** Каждая часть — отдельно: сбой Telegram не мешает SMS, и наоборот. */
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
        await safely('telegram_created', appointmentId, async () => {
          const details = await describeAppointment(db, clinicId, appointmentId);
          const key = details?.status === 'pending' ? 'tg.newBookingPending' : 'tg.newBooking';
          await alert(clinicId, appointmentId, 'appointment_created', key);
        });
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
    async appointmentCancelled(clinicId, appointmentId, by = 'client') {
      await safely('telegram_cancelled', appointmentId, () =>
        alert(
          clinicId,
          appointmentId,
          'appointment_cancelled',
          by === 'clinic' ? 'tg.cancelledByClinic' : 'tg.cancelled',
        ),
      );
      await safely('sms_cancel', appointmentId, async () => {
        await cancelSms(clinicId, appointmentId);
        if (by === 'clinic') {
          await queueSms(clinicId, appointmentId, 'appointment_cancelled', new Date());
        }
      });
    },
    async appointmentRescheduled(clinicId, appointmentId, previous) {
      await safely('telegram_rescheduled', appointmentId, async () => {
        await alert(clinicId, appointmentId, 'appointment_rescheduled', 'tg.rescheduled');
        const [row] = await db
          .select({ dentistId: appointments.dentistId })
          .from(appointments)
          .where(and(eq(appointments.id, appointmentId), eq(appointments.clinicId, clinicId)));
        if (row && row.dentistId !== previous.dentistId) {
          await alertPreviousDentist(clinicId, appointmentId, previous);
        }
      });
      await safely('sms_rescheduled', appointmentId, async () => {
        const [row] = await db
          .select({ startAt: appointments.startAt })
          .from(appointments)
          .where(and(eq(appointments.id, appointmentId), eq(appointments.clinicId, clinicId)));
        // Сменился только врач — время у клиента прежнее, напоминания верны
        if (!row || row.startAt.getTime() === previous.startAt.getTime()) return;
        await cancelSms(clinicId, appointmentId);
        await queueSms(clinicId, appointmentId, 'appointment_rescheduled', new Date());
        await scheduleReminders(clinicId, appointmentId);
      });
    },
  };
}
