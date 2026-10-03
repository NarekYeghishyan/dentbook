/**
 * Расписание врача на день: записи (с подтверждением ожидающих) и закрытое время.
 * «Изменить» открывает запись: клиент, комментарий, перенос, отмена. С флажком
 * «Показывать отменённые» — и отменённые записи: серым, с тем, кто отменил, и историей.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { MiniappAppointment, MiniappSchedule } from '@dentbook/shared';
import type { CancelledBy } from '@dentbook/shared/domain';
import { api } from '../api';
import { errorText, useSession } from '../context';
import type { MessageKey } from '../i18n';
import { confirmAction } from '../telegram';
import { addDays, dateIn, formatDate, formatDateTime, formatTime, todayIn } from '../time';
import { Button, Notice } from '../ui';

const CANCELLED_BY: Record<CancelledBy, MessageKey> = {
  client: 'schedule.cancelledByClient',
  clinic: 'schedule.cancelledByClinic',
  dentist: 'schedule.cancelledByYou',
  system: 'schedule.cancelled',
};

/** Подпись отменённой записи: кто отменил, если известно. */
export const cancelledLabel = (by: CancelledBy | null): MessageKey =>
  by ? CANCELLED_BY[by] : 'schedule.cancelled';

export function SchedulePage({
  date,
  onDate,
  onEdit,
  showCancelled,
  onShowCancelled,
}: {
  date: string;
  onDate(date: string): void;
  onEdit(appointment: MiniappAppointment): void;
  showCancelled: boolean;
  onShowCancelled(show: boolean): void;
}) {
  const { me, locale, t } = useSession();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const today = todayIn(me.clinic.timezone);

  // Расписание перечитывается само: записи меняют и регистратура, и сайт, а сервер
  // открытому Mini App об этом не сообщает. Раз в 15 с, пока он виден, и при возврате
  const schedule = useQuery({
    queryKey: ['schedule', date, showCancelled],
    queryFn: () =>
      api<MiniappSchedule>(
        'GET',
        `/schedule?from=${date}&to=${date}${showCancelled ? '&cancelled=true' : ''}`,
      ),
    staleTime: 0,
    refetchInterval: 15_000,
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

  const cancelled = (a: MiniappAppointment) => a.status === 'cancelled';
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
      <label className="flex items-center gap-2 text-sm text-hint">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={showCancelled}
          onChange={(e) => onShowCancelled(e.target.checked)}
        />
        {t('schedule.showCancelled')}
      </label>

      {error && <Notice tone="error">{error}</Notice>}
      {schedule.isPending && <p className="text-hint">{t('loading')}</p>}
      {schedule.isError && <Notice tone="error">{errorText(locale, schedule.error)}</Notice>}
      {data && items.length === 0 && <p className="text-hint">{t('schedule.empty')}</p>}

      <ul className="space-y-2">
        {items.map((item) =>
          item.kind === 'appointment' ? (
            <li
              key={item.a.id}
              className={`space-y-1 rounded-lg bg-card p-3 ${cancelled(item.a) ? 'text-hint' : ''}`}
            >
              <div className="flex justify-between gap-2">
                <span className={`font-medium ${cancelled(item.a) ? 'line-through' : ''}`}>
                  {range(item.a.startAt, item.a.endAt, item.a.timeZone)}
                </span>
                <span className="text-sm text-hint">{item.a.office}</span>
              </div>
              {/* Имя клиента — главное в карточке; нажатие открывает запись, как «Изменить» */}
              {item.a.client && (
                <button
                  type="button"
                  className={`block text-left text-lg font-semibold leading-snug ${cancelled(item.a) ? '' : 'text-link'}`}
                  onClick={() => onEdit(item.a)}
                >
                  {item.a.client.fullName}
                </button>
              )}
              <div className="text-sm">
                <span>{item.a.service}</span>
                {item.a.client?.phone && (
                  <>
                    {' · '}
                    <a className="text-link" href={`tel:${item.a.client.phone}`}>
                      {item.a.client.phone}
                    </a>
                  </>
                )}
              </div>
              {item.a.notes && (
                <div className="whitespace-pre-line text-sm text-hint">{item.a.notes}</div>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                {cancelled(item.a) ? (
                  <span className="text-sm">{t(cancelledLabel(item.a.cancelledBy))}</span>
                ) : (
                  <span className="text-sm text-danger">
                    {item.a.status === 'pending' && t('schedule.pending')}
                  </span>
                )}
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => onEdit(item.a)}>
                    {t(cancelled(item.a) ? 'edit.history' : 'schedule.edit')}
                  </Button>
                  {item.a.status === 'pending' && (
                    <Button disabled={confirm.isPending} onClick={() => confirm.mutate(item.a.id)}>
                      {t('schedule.confirm')}
                    </Button>
                  )}
                </div>
              </div>
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
