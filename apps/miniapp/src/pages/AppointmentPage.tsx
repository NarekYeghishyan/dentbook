/**
 * Запись из расписания врача. Клиента и комментарий можно поправить всегда; предстоящую
 * запись — ещё перенести на другое свободное время или отменить. Клиенту о переносе и
 * отмене уходит SMS, как при действиях регистратуры. «История» — кто и что менял.
 * Отменённая запись — только для просмотра: кто отменил, и история открыта сразу.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { MiniappAppointment } from '@dentbook/shared';
import { api, ApiError } from '../api';
import { errorText, useSession } from '../context';
import { SlotPicker } from '../SlotPicker';
import { confirmAction } from '../telegram';
import { dateIn, formatDateTime } from '../time';
import { Button, Field, Input, Notice, Textarea } from '../ui';
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
  const { locale, t } = useSession();
  const client = useQueryClient();
  const date = dateIn(a.startAt, a.timeZone);
  const [fullName, setFullName] = useState(a.client?.fullName ?? '');
  const [phone, setPhone] = useState(a.client?.phone ?? '');
  const [notes, setNotes] = useState(a.notes ?? '');
  const [day, setDay] = useState(date);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const cancelled = a.status === 'cancelled';
  const [showHistory, setShowHistory] = useState(cancelled);
  /** Ошибка показывается у той части страницы, где её вызвали. */
  const [error, setError] = useState<{ part: Part; text: string } | null>(null);

  const upcoming =
    (a.status === 'pending' || a.status === 'confirmed') && Date.parse(a.startAt) > Date.now();
  const finish = (target: string, message: string) => {
    void client.invalidateQueries({ queryKey: ['schedule'] });
    void client.invalidateQueries({ queryKey: ['slots'] });
    void client.invalidateQueries({ queryKey: ['history', a.id] });
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
    mutationFn: (startAt: string) => api('POST', `/appointments/${a.id}/move`, { startAt }),
    onSuccess: (_, startAt) =>
      finish(
        dateIn(startAt, a.timeZone),
        t('edit.moved', { when: formatDateTime(startAt, a.timeZone, locale) }),
      ),
    onError: (err) => {
      failed('move')(err);
      if (err instanceof ApiError && err.code === 'slot_taken') {
        setMoveTo(null);
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
        <div className="text-sm text-hint">{a.office}</div>
        {cancelled && <div className="text-sm text-danger">{t(cancelledLabel(a.cancelledBy))}</div>}
      </div>
      {showHistory && <HistoryList appointmentId={a.id} />}

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
          {errorAt('details')}
          <Button type="submit" className="w-full" disabled={busy}>
            {t('edit.save')}
          </Button>
        </form>
      )}

      {upcoming && (
        <section className="space-y-3">
          <h2 className="font-medium">{t('edit.move')}</h2>
          <Field label={t('book.date')}>
            <Input
              type="date"
              required
              value={day}
              onChange={(e) => {
                setDay(e.target.value);
                setMoveTo(null);
              }}
            />
          </Field>
          <SlotPicker
            service={{ serviceId: a.serviceId }}
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
            disabled={!moveTo || moveTo === a.startAt || busy}
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
