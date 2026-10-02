/** История записи в журнале: что, кем и когда изменено — новые события сверху. */
import type { AppointmentEvent, ClientSnapshot } from '@dentbook/shared';
import { useAppointmentHistory } from '../../api/hooks';
import { useI18n, type MessageKey } from '../../i18n';
import { formatDateTime } from '../../lib/time';

export function AppointmentHistory({ appointmentId }: { appointmentId: string }) {
  const { t, locale } = useI18n();
  const history = useAppointmentHistory(appointmentId);

  if (history.isPending) return <p className="text-slate-500">{t('common.loading')}</p>;
  if (history.isError) {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-700">
        {t('history.failed')}
      </p>
    );
  }
  const { timeZone, events } = history.data;
  if (events.length === 0) return <p className="text-slate-500">{t('history.empty')}</p>;

  const when = (iso: string) => formatDateTime(iso, timeZone, locale);
  const client = (c: ClientSnapshot | null) => (c ? `${c.fullName}, ${c.phone}` : '—');
  const who = (e: AppointmentEvent) => {
    if (e.actor === 'client') return t('history.byClient');
    if (e.actor === 'system') return t('history.bySystem');
    if (e.actor === 'dentist') {
      return e.actorName
        ? t('history.byDentistNamed', { name: e.actorName })
        : t('history.byDentist');
    }
    return e.actorName ? t('history.byStaffNamed', { name: e.actorName }) : t('history.byStaff');
  };
  const lines = ({ changes: c }: AppointmentEvent) => {
    if (!c) return [];
    return [
      c.startAt &&
        (c.startAt.from === null
          ? t('history.for', { when: when(c.startAt.to) })
          : t('history.time', { from: when(c.startAt.from), to: when(c.startAt.to) })),
      c.dentist && t('history.dentist', c.dentist),
      c.client && t('history.client', { from: client(c.client.from), to: client(c.client.to) }),
      c.notes && t('history.notes', { from: c.notes.from ?? '—', to: c.notes.to ?? '—' }),
    ].filter((line): line is string => Boolean(line));
  };

  return (
    <ol className="space-y-2" aria-label={t('appointment.history')}>
      {[...events].reverse().map((event) => (
        <li key={event.id} className="rounded-md border border-slate-200 px-3 py-2">
          <div className="flex flex-wrap justify-between gap-2">
            <span className="font-medium text-slate-900">
              {t(`history.${event.type}` as MessageKey)}
            </span>
            <span className="text-slate-500">{when(event.at)}</span>
          </div>
          <div className="text-slate-500">{who(event)}</div>
          {lines(event).map((line) => (
            <div key={line} className="whitespace-pre-line text-slate-900">
              {line}
            </div>
          ))}
        </li>
      ))}
    </ol>
  );
}
