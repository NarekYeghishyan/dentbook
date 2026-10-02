/**
 * Время врача на день — сетка: свободное выбирается кнопкой, занятое показано рядом и не
 * нажимается. Запись — одна красная клетка на время её начала, закрытое время — серая.
 */
import { useQuery } from '@tanstack/react-query';
import type { MiniappSlots } from '@dentbook/shared';
import { api } from './api';
import { errorText, useSession } from './context';
import { formatTime } from './time';
import { Button, Notice } from './ui';

const BUSY_LOOK = {
  booked: 'bg-danger text-white',
  closed: 'bg-hint/25 text-hint',
} as const;

export function SlotPicker({
  serviceId,
  locationId,
  date,
  appointmentId,
  value,
  onChange,
}: {
  serviceId: string;
  locationId: string;
  date: string;
  /** Перенос этой записи: её собственное время показывается свободным. */
  appointmentId?: string;
  value: string | null;
  onChange(slot: string): void;
}) {
  const { locale, t } = useSession();
  const query = { serviceId, locationId, date, ...(appointmentId ? { appointmentId } : {}) };
  const slots = useQuery({
    queryKey: ['slots', serviceId, locationId, date, appointmentId ?? null],
    queryFn: () => api<MiniappSlots>('GET', `/slots?${new URLSearchParams(query).toString()}`),
    enabled: Boolean(serviceId && locationId && date),
    staleTime: 0,
  });

  const data = slots.data && !slots.isFetching ? slots.data : null;
  const cells = data
    ? [
        ...data.slots.map((at) => ({ at, kind: 'free' as const })),
        ...data.busy.map((b) => ({ at: b.startAt, kind: b.kind })),
      ].sort((a, b) => a.at.localeCompare(b.at))
    : [];
  const label = { booked: t('book.booked'), closed: t('schedule.closed') };
  const shown = (['booked', 'closed'] as const).filter((kind) =>
    cells.some((c) => c.kind === kind),
  );

  return (
    <fieldset className="space-y-1">
      <legend className="text-sm text-hint">{t('book.time')}</legend>
      {slots.isFetching && <p className="text-hint">{t('loading')}</p>}
      {slots.isError && <Notice tone="error">{errorText(locale, slots.error)}</Notice>}
      {data && data.slots.length === 0 && <p className="text-hint">{t('book.noSlots')}</p>}
      {data && cells.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {cells.map((cell) => {
            const time = formatTime(cell.at, data.timeZone, locale);
            return cell.kind === 'free' ? (
              <Button
                key={`free-${cell.at}`}
                variant={cell.at === value ? 'primary' : 'secondary'}
                aria-pressed={cell.at === value}
                onClick={() => onChange(cell.at)}
              >
                {time}
              </Button>
            ) : (
              <span
                key={`${cell.kind}-${cell.at}`}
                data-busy={cell.kind}
                className={`rounded-lg px-3 py-2 text-center text-sm font-medium ${BUSY_LOOK[cell.kind]}`}
              >
                {time}
                <span className="sr-only">, {label[cell.kind]}</span>
              </span>
            );
          })}
        </div>
      )}
      {shown.length > 0 && (
        <div className="flex gap-4 pt-1 text-xs text-hint">
          {shown.map((kind) => (
            <span key={kind} className="flex items-center gap-1">
              <span aria-hidden className={`inline-block size-3 rounded ${BUSY_LOOK[kind]}`} />
              {label[kind]}
            </span>
          ))}
        </div>
      )}
    </fieldset>
  );
}
