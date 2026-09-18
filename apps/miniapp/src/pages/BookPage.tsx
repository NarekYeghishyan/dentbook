/**
 * Врач записывает своего клиента: услуга, офис, день → свободное время → имя и телефон.
 * Без SMS-кода, запись сразу подтверждена (§1, Шаг 7).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { MiniappSlots } from '@dentbook/shared';
import { toE164 } from '@dentbook/shared/phone';
import { api, ApiError } from '../api';
import { errorText, useSession } from '../context';
import { dateIn, formatDateTime, formatTime } from '../time';
import { Button, Field, Input, Notice, Select } from '../ui';

export function BookPage({
  date,
  onDone,
}: {
  date: string;
  onDone(date: string, message: string): void;
}) {
  const { me, locale, t } = useSession();
  const client = useQueryClient();
  const [serviceId, setServiceId] = useState(me.services[0]?.id ?? '');
  const [locationId, setLocationId] = useState(me.locations[0]?.id ?? '');
  const [day, setDay] = useState(date);
  const [startAt, setStartAt] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  const slots = useQuery({
    queryKey: ['slots', serviceId, locationId, day],
    queryFn: () =>
      api<MiniappSlots>(
        'GET',
        `/slots?${new URLSearchParams({ serviceId, locationId, date: day }).toString()}`,
      ),
    enabled: Boolean(serviceId && locationId && day),
    staleTime: 0,
  });

  const book = useMutation({
    mutationFn: (input: { startAt: string; phone: string }) =>
      api<{ startAt: string; timeZone: string }>('POST', '/appointments', {
        serviceId,
        locationId,
        startAt: input.startAt,
        client: { fullName: fullName.trim(), phone: input.phone },
      }),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ['schedule'] });
      void client.invalidateQueries({ queryKey: ['slots'] });
      onDone(
        dateIn(result.startAt, result.timeZone),
        t('book.done', { when: formatDateTime(result.startAt, result.timeZone, locale) }),
      );
    },
    onError: (err) => {
      setError(errorText(locale, err));
      if (err instanceof ApiError && err.code === 'slot_taken') {
        setStartAt(null);
        void slots.refetch();
      }
    },
  });

  if (me.services.length === 0 || me.locations.length === 0) {
    return <p className="text-hint">{t('book.unavailable')}</p>;
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const e164 = toE164(phone);
    if (!e164) return setError(t('error.phone'));
    if (!startAt) return;
    setError(null);
    book.mutate({ startAt, phone: e164 });
  };
  const resetTime = () => {
    setStartAt(null);
    setError(null);
  };

  return (
    <form className="space-y-3" onSubmit={submit}>
      <Field label={t('book.service')}>
        <Select
          value={serviceId}
          onChange={(e) => {
            setServiceId(e.target.value);
            resetTime();
          }}
        >
          {me.services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {t('book.duration', { min: s.durationMin })}
            </option>
          ))}
        </Select>
      </Field>
      {me.locations.length > 1 && (
        <Field label={t('book.office')}>
          <Select
            value={locationId}
            onChange={(e) => {
              setLocationId(e.target.value);
              resetTime();
            }}
          >
            {me.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t('book.date')}>
        <Input
          type="date"
          required
          value={day}
          onChange={(e) => {
            setDay(e.target.value);
            resetTime();
          }}
        />
      </Field>

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
                variant={slot === startAt ? 'primary' : 'secondary'}
                aria-pressed={slot === startAt}
                onClick={() => setStartAt(slot)}
              >
                {formatTime(slot, slots.data.timeZone, locale)}
              </Button>
            ))}
          </div>
        )}
      </fieldset>

      {startAt && (
        <>
          <Field label={t('book.name')}>
            <Input
              required
              maxLength={200}
              autoComplete="off"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </Field>
          <Field label={t('book.phone')}>
            <Input
              type="tel"
              required
              autoComplete="off"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        </>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      <Button type="submit" className="w-full" disabled={!startAt || book.isPending}>
        {t('book.submit')}
      </Button>
    </form>
  );
}
