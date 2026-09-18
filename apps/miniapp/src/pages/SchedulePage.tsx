/** Расписание врача на день: записи (с подтверждением ожидающих) и закрытое время. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { MiniappSchedule } from '@dentbook/shared';
import { api } from '../api';
import { errorText, useSession } from '../context';
import { confirmAction } from '../telegram';
import { addDays, dateIn, formatDate, formatDateTime, formatTime, todayIn } from '../time';
import { Button, Notice } from '../ui';

export function SchedulePage({ date, onDate }: { date: string; onDate(date: string): void }) {
  const { me, locale, t } = useSession();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const today = todayIn(me.clinic.timezone);

  const schedule = useQuery({
    queryKey: ['schedule', date],
    queryFn: () => api<MiniappSchedule>('GET', `/schedule?from=${date}&to=${date}`),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['schedule'] });
  const onError = (err: unknown) => setError(errorText(locale, err));

  const confirm = useMutation({
    mutationFn: (id: string) => api('POST', `/appointments/${id}/confirm`),
    onSuccess: refresh,
    onError,
  });
  const reopen = useMutation({
    mutationFn: (id: string) => api('DELETE', `/blocks/${id}`),
    onSuccess: refresh,
    onError,
  });

  /** Время в пределах дня — часами, запись через полночь — с датой. */
  const range = (startAt: string, endAt: string, timeZone: string) => {
    const sameDay = dateIn(startAt, timeZone) === date && dateIn(endAt, timeZone) === date;
    const format = sameDay ? formatTime : formatDateTime;
    return `${format(startAt, timeZone, locale)} – ${format(endAt, timeZone, locale)}`;
  };

  const data = schedule.data;
  const items = data
    ? [
        ...data.appointments.map((a) => ({ kind: 'appointment' as const, at: a.startAt, a })),
        ...data.blocks.map((b) => ({ kind: 'block' as const, at: b.startAt, b })),
      ].sort((x, y) => x.at.localeCompare(y.at))
    : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="secondary"
          aria-label={t('schedule.prev')}
          onClick={() => onDate(addDays(date, -1))}
        >
          ‹
        </Button>
        <div className="text-center">
          <div className="font-medium">{formatDate(date, locale)}</div>
          {date !== today && (
            <button type="button" className="text-sm text-link" onClick={() => onDate(today)}>
              {t('schedule.today')}
            </button>
          )}
        </div>
        <Button
          variant="secondary"
          aria-label={t('schedule.next')}
          onClick={() => onDate(addDays(date, 1))}
        >
          ›
        </Button>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {schedule.isPending && <p className="text-hint">{t('loading')}</p>}
      {schedule.isError && <Notice tone="error">{errorText(locale, schedule.error)}</Notice>}
      {data && items.length === 0 && <p className="text-hint">{t('schedule.empty')}</p>}

      <ul className="space-y-2">
        {items.map((item) =>
          item.kind === 'appointment' ? (
            <li key={item.a.id} className="space-y-1 rounded-lg bg-card p-3">
              <div className="flex justify-between gap-2">
                <span className="font-medium">
                  {range(item.a.startAt, item.a.endAt, item.a.timeZone)}
                </span>
                <span className="text-sm text-hint">{item.a.office}</span>
              </div>
              <div>{item.a.service}</div>
              {item.a.client && (
                <div className="text-sm">
                  {item.a.client.fullName} ·{' '}
                  <a className="text-link" href={`tel:${item.a.client.phone}`}>
                    {item.a.client.phone}
                  </a>
                </div>
              )}
              {item.a.notes && <div className="text-sm text-hint">{item.a.notes}</div>}
              {item.a.status === 'pending' && (
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-sm text-danger">{t('schedule.pending')}</span>
                  <Button disabled={confirm.isPending} onClick={() => confirm.mutate(item.a.id)}>
                    {t('schedule.confirm')}
                  </Button>
                </div>
              )}
            </li>
          ) : (
            <li
              key={item.b.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-hint/50 p-3"
            >
              <div>
                <div className="font-medium">
                  {range(item.b.startAt, item.b.endAt, data!.timeZone)}
                </div>
                <div className="text-sm text-hint">
                  {t('schedule.closed')}
                  {item.b.reason ? ` · ${item.b.reason}` : ''}
                </div>
              </div>
              <Button
                variant="secondary"
                disabled={reopen.isPending}
                onClick={async () => {
                  if (await confirmAction(t('schedule.reopenConfirm'))) reopen.mutate(item.b.id);
                }}
              >
                {t('schedule.reopen')}
              </Button>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
