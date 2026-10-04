/**
 * Заметки о клиенте записи (Q19) — те же, что в карточке клиента в панели: регистратуры,
 * врачей (комментарии к записям) и клиента с сайта. Врач их только читает; свой комментарий
 * он пишет к записи, и тот попадает сюда же.
 */
import { useQuery } from '@tanstack/react-query';
import type { ClientNote } from '@dentbook/shared';
import { api } from '../api';
import { errorText, useSession } from '../context';
import { formatDateTime } from '../time';
import { Notice } from '../ui';
import { actorLabel } from './HistoryList';

export function ClientNotes({ appointmentId }: { appointmentId: string }) {
  const { locale, t, me } = useSession();
  const notes = useQuery({
    queryKey: ['client-notes', appointmentId],
    queryFn: () => api<ClientNote[]>('GET', `/appointments/${appointmentId}/client-notes`),
    staleTime: 0,
  });

  return (
    <section className="space-y-2">
      <h2 className="font-medium">{t('notes.title')}</h2>
      {notes.isPending && <p className="text-sm text-hint">{t('loading')}</p>}
      {notes.isError && <Notice tone="error">{errorText(locale, notes.error)}</Notice>}
      {notes.data?.length === 0 && <p className="text-sm text-hint">{t('notes.empty')}</p>}
      {notes.data && notes.data.length > 0 && (
        <ol className="space-y-2" aria-label={t('notes.title')}>
          {notes.data.map((note) => (
            <li key={note.id} className="space-y-1 rounded-lg bg-card p-3 text-sm">
              <div className="whitespace-pre-line">{note.text}</div>
              <div className="text-hint">
                {formatDateTime(note.at, me.clinic.timezone, locale)} ·{' '}
                {actorLabel(t, note.author, note.authorName)}
                {note.edited && ` · ${t('notes.edited')}`}
              </div>
              {note.appointment && (
                <div className="text-hint">
                  {note.appointment.id === appointmentId
                    ? t('notes.thisBooking')
                    : t('notes.onBooking', {
                        when: formatDateTime(
                          note.appointment.startAt,
                          note.appointment.timeZone,
                          locale,
                        ),
                      })}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
