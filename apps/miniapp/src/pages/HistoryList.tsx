/** История записи: что, кем и когда изменено — новые события сверху. */
import { useQuery } from '@tanstack/react-query';
import type { AppointmentEvent, AppointmentHistory, ClientSnapshot } from '@dentbook/shared';
import type { AppointmentActor } from '@dentbook/shared/domain';
import { api } from '../api';
import { errorText, useSession, type Session } from '../context';
import type { MessageKey } from '../i18n';
import { formatDateTime } from '../time';
import { Notice } from '../ui';

/** Кто это сделал или написал: клиент на сайте, врач, регистратура, система. */
export function actorLabel(t: Session['t'], actor: AppointmentActor, name: string | null) {
  if (actor === 'client') return t('history.byClient');
  if (actor === 'system') return t('history.bySystem');
  if (actor === 'dentist') {
    return name ? t('history.byDentistNamed', { name }) : t('history.byDentist');
  }
  return name ? t('history.byStaffNamed', { name }) : t('history.byStaff');
}

export function HistoryList({ appointmentId }: { appointmentId: string }) {
  const { locale, t } = useSession();
  const history = useQuery({
    queryKey: ['history', appointmentId],
    queryFn: () => api<AppointmentHistory>('GET', `/appointments/${appointmentId}/history`),
    staleTime: 0,
  });

  if (history.isPending) return <p className="text-hint">{t('loading')}</p>;
  if (history.isError) return <Notice tone="error">{errorText(locale, history.error)}</Notice>;
  const { timeZone, events } = history.data;
  if (events.length === 0) return <p className="text-sm text-hint">{t('history.empty')}</p>;

  const when = (iso: string) => formatDateTime(iso, timeZone, locale);
  const client = (c: ClientSnapshot | null) =>
    c ? [c.fullName, c.phone].filter(Boolean).join(', ') : '—';
  const who = (e: AppointmentEvent) => actorLabel(t, e.actor, e.actorName);
  const lines = ({ changes: c }: AppointmentEvent) => {
    if (!c) return [];
    return [
      c.startAt &&
        (c.startAt.from === null
          ? t('history.for', { when: when(c.startAt.to) })
          : t('history.time', { from: when(c.startAt.from), to: when(c.startAt.to) })),
      c.dentist && t('history.dentist', c.dentist),
      c.service && t('history.service', c.service),
      c.durationMin && t('history.duration', c.durationMin),
      c.client && t('history.client', { from: client(c.client.from), to: client(c.client.to) }),
      c.notes && t('history.comment', { from: c.notes.from ?? '—', to: c.notes.to ?? '—' }),
    ].filter((line): line is string => Boolean(line));
  };

  return (
    <ol className="space-y-2">
      {[...events].reverse().map((event) => (
        <li key={event.id} className="space-y-1 rounded-lg bg-card p-3 text-sm">
          <div className="flex justify-between gap-2">
            <span className="font-medium">{t(`history.${event.type}` as MessageKey)}</span>
            <span className="text-hint">{when(event.at)}</span>
          </div>
          <div className="text-hint">{who(event)}</div>
          {lines(event).map((line) => (
            <div key={line} className="whitespace-pre-line">
              {line}
            </div>
          ))}
        </li>
      ))}
    </ol>
  );
}
