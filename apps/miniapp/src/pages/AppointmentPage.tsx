/**
 * Запись из расписания врача. Клиента и комментарий можно поправить всегда; предстоящую
 * запись — ещё сменить ей услугу, перенести на другое свободное время или отменить. Клиенту о переносе и
 * отмене уходит SMS, как при действиях регистратуры. «История» — кто и что менял.
 * Ниже — заметки о клиенте из его карточки (Q19), только для чтения.
 * Отменённая запись — только для просмотра: кто отменил, и история открыта сразу.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { MiniappAppointment } from '@dentbook/shared';
import { formatPrice } from '@dentbook/shared/service-search';
import { api, ApiError } from '../api';
import { errorText, useSession } from '../context';
import { ServicePicker } from '../ServicePicker';
import { SlotPicker } from '../SlotPicker';
import { confirmAction } from '../telegram';
import { dateIn, formatDateTime } from '../time';
import { Button, Field, Input, Notice, PhoneInput, Textarea } from '../ui';
import { ClientNotes } from './ClientNotes';
import { HistoryList } from './HistoryList';
import { cancelledLabel } from './SchedulePage';

type Part = 'details' | 'move' | 'cancel';

export function AppointmentPage({
  appointment: a,
  onBack,
  onDone,
  onOpen,
}: {
  appointment: MiniappAppointment;
  onBack(): void;
  onDone(date: string, message: string): void;
  /** Красная клетка в сетке переноса: открыть ту запись. */
  onOpen(appointment: MiniappAppointment): void;
}) {
  const { me, locale, t } = useSession();
  const client = useQueryClient();
  const date = dateIn(a.startAt, a.timeZone);
  const [fullName, setFullName] = useState(a.client?.fullName ?? '');
  const [phone, setPhone] = useState(a.client?.phone ?? '');
  const [notes, setNotes] = useState(a.notes ?? '');
  const [day, setDay] = useState(date);
  /** Время в сетке переноса: сначала — текущее время записи, оно выделено синим. */
  const [moveTo, setMoveTo] = useState<string | null>(a.startAt);
  const currentOn = (d: string) => (d === date ? a.startAt : null);
  /** Услуга записи; «Другое» и услуги не из списка врача остаются в списке как есть. */
  const [serviceId, setServiceId] = useState(a.serviceId);
  const serviceChanged = serviceId !== a.serviceId;
  const cancelled = a.status === 'cancelled';
  const [showHistory, setShowHistory] = useState(cancelled);
  /** Ошибка показывается у той части страницы, где её вызвали. */
  const [error, setError] = useState<{ part: Part; text: string } | null>(null);

  const own = me.services.find((s) => s.id === a.serviceId);
  const prices = [
    own?.price && `${t('book.cash')} ${formatPrice(own.price, me.clinic.currency, locale)}`,
    own?.insurancePrice &&
      `${t('book.insurance')} ${formatPrice(own.insurancePrice, me.clinic.currency, locale)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const upcoming =
    (a.status === 'pending' || a.status === 'confirmed') && Date.parse(a.startAt) > Date.now();
  const finish = (target: string, message: string) => {
    void client.invalidateQueries({ queryKey: ['schedule'] });
    void client.invalidateQueries({ queryKey: ['slots'] });
    void client.invalidateQueries({ queryKey: ['history', a.id] });
    void client.invalidateQueries({ queryKey: ['client-notes'] });
    onDone(target, message);
  };
  const failed = (part: Part) => (err: unknown) => setError({ part, text: errorText(locale, err) });

  const save = useMutation({
    mutationFn: () =>
      api('PATCH', `/appointments/${a.id}`, {
        // Номер в любом виде или пусто: к E.164 его приводит API, если он так читается
        client: { fullName: fullName.trim(), phone: phone.trim() },
        notes: notes.trim() || null,
      }),
    onSuccess: () => finish(date, t('edit.saved')),
    onError: failed('details'),
  });
  const move = useMutation({
    mutationFn: (startAt: string) =>
      api('POST', `/appointments/${a.id}/move`, {
        startAt,
        ...(serviceChanged ? { serviceId } : {}),
      }),
    onSuccess: (_, startAt) =>
      finish(
        dateIn(startAt, a.timeZone),
        startAt === a.startAt
          ? t('edit.serviceChanged')
          : t('edit.moved', { when: formatDateTime(startAt, a.timeZone, locale) }),
      ),
    onError: (err) => {
      failed('move')(err);
      if (err instanceof ApiError && err.code === 'slot_taken') {
        setMoveTo(currentOn(day));
        void client.invalidateQueries({ queryKey: ['slots'] });
      }
    },
  });
  const cancel = useMutation({
    mutationFn: () => api('POST', `/appointments/${a.id}/cancel`),
    onSuccess: () => finish(date, t('edit.cancelled')),
    onError: failed('cancel'),
  });
  const busy = save.isPending || move.isPending || cancel.isPending;
  const errorAt = (part: Part) =>
    error?.part === part && <Notice tone="error">{error.text}</Notice>;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    save.mutate();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-2">
        <Button variant="secondary" onClick={onBack}>
          {t('edit.back')}
        </Button>
        <Button
          variant="secondary"
          aria-expanded={showHistory}
          onClick={() => setShowHistory(!showHistory)}
        >
          {t(showHistory ? 'edit.hideHistory' : 'edit.history')}
        </Button>
      </div>
      <div className="space-y-1 rounded-lg bg-card p-3">
        <div className="font-medium">{formatDateTime(a.startAt, a.timeZone, locale)}</div>
        <div>{a.service}</div>
        {prices && <div className="text-sm text-hint">{prices}</div>}
        <div className="text-sm text-hint">{a.office}</div>
        {cancelled && <div className="text-sm text-danger">{t(cancelledLabel(a.cancelledBy))}</div>}
      </div>
      {showHistory && <HistoryList appointmentId={a.id} />}
      <ClientNotes appointmentId={a.id} />

      {!cancelled && (
        <form className="space-y-3" onSubmit={submit}>
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
            <PhoneInput autoComplete="off" value={phone} onValueChange={setPhone} />
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
          {errorAt('details')}
          <Button type="submit" className="w-full" disabled={busy}>
            {t('edit.save')}
          </Button>
        </form>
      )}

      {upcoming && (
        <section className="space-y-3">
          <h2 className="font-medium">{t('edit.move')}</h2>
          {/* не <label>: клик по варианту в списке переключал бы кнопку выбора */}
          <div className="space-y-1">
            <span className="text-sm text-hint">{t('book.service')}</span>
            <ServicePicker
              // Выбранное время остаётся: не влезет новая услуга — сервер скажет при сохранении
              services={
                me.services.some((s) => s.id === a.serviceId)
                  ? me.services
                  : [{ id: a.serviceId, name: a.service, category: null }, ...me.services]
              }
              value={serviceId}
              onChange={setServiceId}
            />
          </div>
          <Field label={t('book.date')}>
            <Input
              type="date"
              required
              value={day}
              onChange={(e) => {
                setDay(e.target.value);
                setMoveTo(currentOn(e.target.value));
              }}
            />
          </Field>
          <SlotPicker
            service={{ serviceId }}
            locationId={a.locationId}
            date={day}
            appointmentId={a.id}
            value={moveTo}
            onChange={setMoveTo}
            onOpen={onOpen}
          />
          {errorAt('move')}
          <Button
            className="w-full"
            disabled={!moveTo || (moveTo === a.startAt && !serviceChanged) || busy}
            onClick={() => moveTo && move.mutate(moveTo)}
          >
            {t('edit.moveSubmit')}
          </Button>
        </section>
      )}

      {upcoming && (
        <section className="space-y-3">
          {errorAt('cancel')}
          <Button
            variant="danger"
            className="w-full"
            disabled={busy}
            onClick={async () => {
              if (await confirmAction(t('edit.cancelConfirm'))) cancel.mutate();
            }}
          >
            {t('edit.cancel')}
          </Button>
        </section>
      )}
    </div>
  );
}
