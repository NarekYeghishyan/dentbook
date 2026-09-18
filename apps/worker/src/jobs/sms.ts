/**
 * SMS клиентам из очереди (Шаг 8): подтверждение записи (Q12), напоминания за 24 ч и
 * 2 ч, перенос и отмена клиникой (Шаг 9). В задаче только id уведомления: телефон и текст берутся из БД в момент отправки
 * (§2.6), так что текст отражает запись на сейчас. Перед отправкой — проверка, что
 * уведомление ещё уместно; неуместное помечается cancelled с причиной.
 * Повторы — у очереди (SMS_JOB_OPTIONS); отказ, который повтор не исправит, — сразу failed.
 */
import { UnrecoverableError, type Job } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
import {
  appointments,
  clinics,
  locations,
  notifications,
  patients,
  type Database,
} from '@dentbook/db';
import type { AppointmentStatus, Locale, NotificationKind } from '@dentbook/shared/domain';
import { REMINDER_OFFSETS_MS, type SmsJob } from '@dentbook/shared/queues';
import { SmsError, type SmsSender } from '@dentbook/shared/sms';
import { translate, type MessageKey } from '../i18n/index.js';

const TEMPLATES: Partial<Record<NotificationKind, MessageKey>> = {
  appointment_confirmed: 'sms.confirmed',
  appointment_rescheduled: 'sms.rescheduled',
  appointment_cancelled: 'sms.cancelled',
  reminder_24h: 'sms.reminder24h',
  reminder_2h: 'sms.reminder2h',
};

/**
 * В каком статусе записи уведомление ещё уместно. Напоминания и подтверждение — только о
 * подтверждённой записи; о переносе — и ожидающей; об отмене — об отменённой.
 */
const RELEVANT_STATUSES: Partial<Record<NotificationKind, readonly AppointmentStatus[]>> = {
  appointment_confirmed: ['confirmed'],
  appointment_rescheduled: ['pending', 'confirmed'],
  appointment_cancelled: ['cancelled'],
  reminder_24h: ['confirmed'],
  reminder_2h: ['confirmed'],
};

/** Тихие часы по времени офиса (Q16): с 21:00 до 8:00 напоминания не шлём. */
export const QUIET_FROM_HOUR = 21;
export const QUIET_UNTIL_HOUR = 8;

/** Час (0–23) по местному времени пояса. */
export function localHour(at: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(at);
  return Number(hour);
}

/**
 * Почему уведомление уже не нужно, или null: запись в неподходящем статусе
 * (RELEVANT_STATUSES) или визит уже начался. Напоминание за сутки, опоздавшее к сроку
 * напоминания за 2 ч, не шлём — его заменит второе. Напоминание в тихие часы пропускаем
 * (Q16): у раннего визита остаётся напоминание за сутки.
 */
export function skipReason(
  kind: NotificationKind,
  status: AppointmentStatus,
  startAt: Date,
  now: Date,
  timeZone: string,
): string | null {
  if (!RELEVANT_STATUSES[kind]?.includes(status)) return `appointment_${status}`;
  if (now >= startAt) return 'visit_started';
  if (
    kind === 'reminder_24h' &&
    now.getTime() >= startAt.getTime() - REMINDER_OFFSETS_MS.reminder_2h
  ) {
    return 'superseded';
  }
  if (kind === 'reminder_24h' || kind === 'reminder_2h') {
    const hour = localHour(now, timeZone);
    if (hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR) return 'quiet_hours';
  }
  return null;
}

/** «Mon, Sep 21, 10:30 AM» в поясе офиса и на языке клиники (§2.3). */
export const formatWhen = (at: Date, timeZone: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);

export function smsProcessor(deps: { db: Database; sms: SmsSender; now?: () => Date }) {
  const { db, sms } = deps;

  const mark = (id: string, patch: Partial<typeof notifications.$inferInsert>) =>
    db.update(notifications).set(patch).where(eq(notifications.id, id));

  return async function process(job: Job<SmsJob>): Promise<string> {
    const now = deps.now?.() ?? new Date();
    const id = job.data.notificationId;
    const [row] = await db
      .select({
        kind: notifications.kind,
        status: notifications.status,
        appointmentStatus: appointments.status,
        startAt: appointments.startAt,
        phone: patients.phone,
        clinic: clinics.name,
        locale: clinics.locale,
        office: locations.name,
        zone: sql<string>`coalesce(${locations.timezone}, ${clinics.timezone})`,
      })
      .from(notifications)
      .innerJoin(clinics, eq(clinics.id, notifications.clinicId))
      .innerJoin(
        appointments,
        and(
          eq(appointments.id, notifications.appointmentId),
          eq(appointments.clinicId, notifications.clinicId),
        ),
      )
      .innerJoin(
        patients,
        and(
          eq(patients.id, notifications.patientId),
          eq(patients.clinicId, notifications.clinicId),
        ),
      )
      .innerJoin(locations, eq(locations.id, appointments.locationId))
      .where(and(eq(notifications.id, id), eq(notifications.channel, 'sms')));
    // Снято при отмене записи или уже отправлено прошлой попыткой
    if (!row || row.status !== 'scheduled') return 'skipped';

    const reason = skipReason(row.kind, row.appointmentStatus, row.startAt, now, row.zone);
    if (reason) {
      await mark(id, { status: 'cancelled', lastError: reason });
      return 'skipped';
    }
    const template = TEMPLATES[row.kind];
    if (!template) {
      await mark(id, { status: 'failed', lastError: 'unsupported_kind' });
      throw new UnrecoverableError(`no SMS template for ${row.kind}`);
    }
    const locale = row.locale as Locale;
    // Текст об отписке — в каждом уведомлении (Q16); STOP обрабатывает сам провайдер
    const text = `${translate(locale, template, {
      clinic: row.clinic,
      when: formatWhen(row.startAt, row.zone, locale),
      office: row.office,
    })} ${translate(locale, 'sms.optOut')}`;

    const attempt = job.attemptsMade + 1;
    try {
      const sent = await sms.send({ to: row.phone, text });
      await mark(id, {
        status: 'sent',
        sentAt: now,
        attempts: attempt,
        lastError: null,
        providerMessageId: sent.id || null,
      });
      return 'sent';
    } catch (err) {
      const permanent = err instanceof SmsError && err.permanent;
      const lastAttempt = permanent || attempt >= (job.opts.attempts ?? 1);
      await mark(id, {
        attempts: attempt,
        // Только код провайдера: в его описании бывает номер получателя (§2.6)
        lastError: err instanceof SmsError ? err.label : 'unknown',
        ...(lastAttempt ? { status: 'failed' as const } : {}),
      });
      if (permanent) throw new UnrecoverableError((err as SmsError).label);
      throw err;
    }
  };
}
