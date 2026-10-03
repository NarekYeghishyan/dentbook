/**
 * Время врача на день — сетка: свободное выбирается кнопкой, занятое показано рядом.
 * Запись — одна красная клетка на время её начала, нажатие открывает эту запись; закрытое
 * время — серая клетка, она не нажимается.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import type { MiniappAppointment, MiniappSlots } from '@dentbook/shared';
import { api } from './api';
import { errorText, useSession } from './context';
import { formatTime } from './time';
import { Button, Notice } from './ui';

const BUSY_LOOK = {
  booked: 'bg-danger text-white',
  closed: 'bg-hint/25 text-hint',
} as const;

export function SlotPicker({
  service,
  locationId,
  date,
  appointmentId,
  value,
  onChange,
  onOpen,
}: {
  /** Услуга из списка или своя: тогда только длительность (null — ещё не введена). */
  service: { serviceId: string } | { durationMin: number | null };
  locationId: string;
  date: string;
  /** Перенос этой записи: её собственное время показывается свободным. */
  appointmentId?: string;
  value: string | null;
  onChange(slot: string): void;
  /** Нажата красная клетка: открыть эту запись. */
  onOpen(appointment: MiniappAppointment): void;
}) {
  const { locale, t } = useSession();
  // Чьё время считать: услуга из списка или своя длительность; null — спрашивать не о чем
  const what =
    'serviceId' in service
      ? service.serviceId
        ? { serviceId: service.serviceId }
        : null
      : service.durationMin !== null
        ? { durationMin: String(service.durationMin) }
        : null;
  const query = { ...what, locationId, date, ...(appointmentId ? { appointmentId } : {}) };
  const slots = useQuery({
    queryKey: ['slots', what, locationId, date, appointmentId ?? null],
    queryFn: () => api<MiniappSlots>('GET', `/slots?${new URLSearchParams(query).toString()}`),
    enabled: Boolean(what && locationId && date),
    staleTime: 0,
  });
  const opening = useMutation({
    mutationFn: (id: string) => api<MiniappAppointment>('GET', `/appointments/${id}`),
    onSuccess: onOpen,
  });

  const data = slots.data && !slots.isFetching ? slots.data : null;
  const cells = data
    ? [
        ...data.slots.map((at) => ({ at, kind: 'free' as const, id: undefined })),
        ...data.busy.map((b) => ({ at: b.startAt, kind: b.kind, id: b.appointmentId })),
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
      {opening.isError && <Notice tone="error">{errorText(locale, opening.error)}</Notice>}
      {data && data.slots.length === 0 && <p className="text-hint">{t('book.noSlots')}</p>}
      {data && cells.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {cells.map((cell) => {
            const time = formatTime(cell.at, data.timeZone, locale);
            if (cell.kind === 'free') {
              return (
                <Button
                  key={`free-${cell.at}`}
                  variant={cell.at === value ? 'primary' : 'secondary'}
                  aria-pressed={cell.at === value}
                  onClick={() => onChange(cell.at)}
                >
                  {time}
                </Button>
              );
            }
            const look = `rounded-lg px-3 py-2 text-center text-sm font-medium ${BUSY_LOOK[cell.kind]}`;
            const content = (
              <>
                {time}
                <span className="sr-only">, {label[cell.kind]}</span>
              </>
            );
            const { id } = cell;
            return id ? (
              <button
                key={`${cell.kind}-${cell.at}`}
                type="button"
                data-busy={cell.kind}
                className={`${look} disabled:opacity-50`}
                disabled={opening.isPending}
                onClick={() => opening.mutate(id)}
              >
                {content}
              </button>
            ) : (
              <span key={`${cell.kind}-${cell.at}`} data-busy={cell.kind} className={look}>
                {content}
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
