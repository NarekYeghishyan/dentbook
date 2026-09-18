/**
 * Регистратура записывает клиента (Q17): врач, услуга, время по сетке клиники, клиент —
 * найденный по имени или телефону или новый. Запись сразу подтверждена; занято — 409 и
 * ближайшее свободное время, которое можно выбрать одним нажатием.
 */
import { useState, type FormEvent } from 'react';
import type { Dentist, Service } from '@dentbook/shared';
import { toE164 } from '@dentbook/shared/phone';
import { useClients, useCreateBooking } from '../../api/hooks';
import { Button, Field, Input, Modal, Select } from '../../components/ui';
import { useI18n } from '../../i18n';
import { atMinutes, dateIn, formatTime, minutesOfDay } from '../../lib/time';
import { alternativesOf, useJournalError } from './errors';

export interface BookingDraft {
  date: string;
  /** Минуты от местной полуночи офиса. */
  minutes: number;
  dentistId: string;
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const toMinutes = (value: string) => {
  const [h, m] = value.split(':').map(Number);
  return h! * 60 + m!;
};

export function BookingDialog({
  draft,
  locationId,
  timeZone,
  slotStepMin,
  dentists,
  services,
  onClose,
  onDone,
}: {
  draft: BookingDraft;
  locationId: string;
  timeZone: string;
  slotStepMin: number;
  dentists: Dentist[];
  services: Service[];
  onClose(): void;
  onDone(): void;
}) {
  const { t, locale } = useI18n();
  const create = useCreateBooking();
  const errorText = useJournalError();
  const [dentistId, setDentistId] = useState(draft.dentistId);
  const [date, setDate] = useState(draft.date);
  const [time, setTime] = useState(hhmm(draft.minutes));
  const [query, setQuery] = useState('');
  const [client, setClient] = useState({ fullName: '', phone: '', email: '' });
  const [notes, setNotes] = useState('');
  const [phoneError, setPhoneError] = useState(false);
  const found = useClients(query.trim(), query.trim().length >= 2);

  const dentist = dentists.find((d) => d.id === dentistId);
  const offered = services.filter((s) => s.isActive && dentist?.serviceIds.includes(s.id));
  const [serviceId, setServiceId] = useState(offered[0]?.id ?? '');
  const service = offered.find((s) => s.id === serviceId) ?? offered[0];

  function submit(event: FormEvent) {
    event.preventDefault();
    const phone = toE164(client.phone);
    setPhoneError(!phone);
    if (!phone || !service) return;
    create.mutate(
      {
        locationId,
        serviceId: service.id,
        dentistId,
        startAt: atMinutes(date, toMinutes(time), timeZone),
        client: {
          fullName: client.fullName.trim(),
          phone,
          ...(client.email.trim() ? { email: client.email.trim() } : {}),
        },
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      },
      { onSuccess: onDone },
    );
  }

  const alternatives = alternativesOf(create.error);

  return (
    <Modal title={t('booking.title')} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('field.dentist')}>
            <Select value={dentistId} onChange={(e) => setDentistId(e.target.value)}>
              {dentists
                .filter((d) => d.isActive)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fullName}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('field.service')}>
            <Select
              required
              value={service?.id ?? ''}
              onChange={(e) => setServiceId(e.target.value)}
            >
              {offered.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('booking.date')}>
            <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('booking.time')}>
            <Input
              type="time"
              required
              step={slotStepMin * 60}
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
        </div>
        {offered.length === 0 && (
          <p className="text-sm text-amber-700">{t('booking.noServices')}</p>
        )}

        <fieldset className="space-y-3 border-t border-slate-100 pt-3">
          <legend className="text-sm font-medium text-slate-700">{t('booking.client')}</legend>
          <Input
            type="search"
            aria-label={t('booking.search')}
            placeholder={t('booking.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim().length >= 2 && (found.data?.length ?? 0) > 0 && (
            <ul className="max-h-40 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
              {found.data!.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="flex w-full justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                    onClick={() => {
                      setClient({ fullName: c.fullName, phone: c.phone, email: c.email ?? '' });
                      setQuery('');
                    }}
                  >
                    <span>{c.fullName}</span>
                    <span className="text-slate-500">{c.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-500">{t('booking.newClient')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('field.fullName')}>
              <Input
                required
                maxLength={200}
                value={client.fullName}
                onChange={(e) => setClient({ ...client, fullName: e.target.value })}
              />
            </Field>
            <Field label={t('field.phone')}>
              <Input
                type="tel"
                required
                value={client.phone}
                onChange={(e) => setClient({ ...client, phone: e.target.value })}
              />
            </Field>
          </div>
          <Field label={t('booking.emailOptional')}>
            <Input
              type="email"
              value={client.email}
              onChange={(e) => setClient({ ...client, email: e.target.value })}
            />
          </Field>
          <Field label={t('booking.notes')}>
            <Input maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </fieldset>

        {phoneError && (
          <p role="alert" className="text-sm text-red-700">
            {t('booking.phoneInvalid')}
          </p>
        )}
        {create.error !== null && (
          <div
            role="alert"
            className="space-y-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            <p>{errorText(create.error)}</p>
            {alternatives.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span>{t('booking.alternatives')}</span>
                {alternatives.map((alt) => (
                  <Button
                    key={alt}
                    variant="secondary"
                    onClick={() => {
                      setDate(dateIn(alt, timeZone));
                      setTime(hhmm(minutesOfDay(alt, timeZone)));
                      create.reset();
                    }}
                  >
                    {formatTime(alt, timeZone, locale)}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending || !service}>
            {t('booking.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
