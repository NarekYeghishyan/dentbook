/** Свободное время врача на день — сетка кнопок, выбранное время подсвечено. */
import { useQuery } from '@tanstack/react-query';
import type { MiniappSlots } from '@dentbook/shared';
import { api } from './api';
import { errorText, useSession } from './context';
import { formatTime } from './time';
import { Button, Notice } from './ui';

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

  return (
    <fieldset className="space-y-1">
      <legend className="text-sm text-hint">{t('book.time')}</legend>
      {slots.isFetching && <p className="text-hint">{t('loading')}</p>}
      {slots.isError && <Notice tone="error">{errorText(locale, slots.error)}</Notice>}
      {slots.data && !slots.isFetching && slots.data.slots.length === 0 && (
        <p className="text-hint">{t('book.noSlots')}</p>
      )}
      {slots.data && !slots.isFetching && (
        <div className="grid grid-cols-4 gap-2">
          {slots.data.slots.map((slot) => (
            <Button
              key={slot}
              variant={slot === value ? 'primary' : 'secondary'}
              aria-pressed={slot === value}
              onClick={() => onChange(slot)}
            >
              {formatTime(slot, slots.data.timeZone, locale)}
            </Button>
          ))}
        </div>
      )}
    </fieldset>
  );
}
