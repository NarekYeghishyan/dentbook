/**
 * Врач записывает своего клиента: услуга, офис, день → свободное время → имя,
 * необязательные телефон и комментарий (appointments.notes).
 * Услуга — из списка или «Другое». Длительность сначала — как у услуги (у «Другого» —
 * 30 минут), врач может изменить её для этой записи; сетка времени считается по ней.
 * «Другое» остаётся только у этой записи, в списке услуг его нет.
 * Без SMS-кода, запись сразу подтверждена (§1, Шаг 7).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { MiniappAppointment } from '@dentbook/shared';
import { BOOKING_DURATION_MAX, BOOKING_DURATION_MIN } from '@dentbook/shared/domain';
import { api, ApiError } from '../api';
import { errorText, useSession } from '../context';
import { SlotPicker } from '../SlotPicker';
import { dateIn, formatDateTime } from '../time';
import { Button, Field, Input, Notice, Select, Textarea } from '../ui';

/** Значение пункта «Другое» в списке услуг. */
const CUSTOM = 'custom';

/** Длительность из поля ввода — или null, пока она не годится. */
function durationOf(value: string): number | null {
  const minutes = Number(value);
  return Number.isInteger(minutes) &&
    minutes >= BOOKING_DURATION_MIN &&
    minutes <= BOOKING_DURATION_MAX
    ? minutes
    : null;
}

export function BookPage({
  date,
  onDone,
  onOpen,
}: {
  date: string;
  onDone(date: string, message: string): void;
  /** Красная клетка в сетке: открыть эту запись. */
  onOpen(appointment: MiniappAppointment): void;
}) {
  const { me, locale, t } = useSession();
  const client = useQueryClient();
  /** Длительность по умолчанию: у услуги — её, у «Другого» — 30 минут. */
  const defaultDuration = (id: string) =>
    String(me.services.find((s) => s.id === id)?.durationMin ?? 30);
  const [serviceId, setServiceId] = useState(me.services[0]?.id ?? CUSTOM);
  const [duration, setDuration] = useState(() => defaultDuration(serviceId));
  const [locationId, setLocationId] = useState(me.locations[0]?.id ?? '');
  const [day, setDay] = useState(date);
  const [startAt, setStartAt] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const custom = serviceId === CUSTOM;
  const durationMin = durationOf(duration);

  const book = useMutation({
    mutationFn: (startAt: string) =>
      api<{ startAt: string; timeZone: string }>('POST', '/appointments', {
        ...(custom ? { customService: { durationMin } } : { serviceId, durationMin }),
        locationId,
        startAt,
        // Номер в любом виде или пусто: к E.164 его приводит API, если он так читается
        client: { fullName: fullName.trim(), phone: phone.trim() },
        ...(notes.trim() ? { notes: notes.trim() } : {}),
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
        void client.invalidateQueries({ queryKey: ['slots'] });
      }
    },
  });

  if (me.locations.length === 0) {
    return <p className="text-hint">{t('book.unavailable')}</p>;
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!startAt) return;
    setError(null);
    book.mutate(startAt);
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
            setDuration(defaultDuration(e.target.value));
            resetTime();
          }}
        >
          {me.services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {t('book.duration', { min: s.durationMin })}
            </option>
          ))}
          <option value={CUSTOM}>{t('book.custom')}</option>
        </Select>
      </Field>
      <Field
        label={t('book.durationField', { min: BOOKING_DURATION_MIN, max: BOOKING_DURATION_MAX })}
      >
        <Input
          type="number"
          inputMode="numeric"
          required
          min={BOOKING_DURATION_MIN}
          max={BOOKING_DURATION_MAX}
          value={duration}
          onChange={(e) => {
            setDuration(e.target.value);
            resetTime();
          }}
        />
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

      <SlotPicker
        service={custom ? { durationMin } : { serviceId, durationMin }}
        locationId={locationId}
        date={day}
        value={startAt}
        onChange={setStartAt}
        onOpen={onOpen}
      />

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
              maxLength={50}
              autoComplete="off"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Field label={t('book.comment')}>
            <Textarea
              rows={3}
              maxLength={1000}
              autoComplete="off"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
