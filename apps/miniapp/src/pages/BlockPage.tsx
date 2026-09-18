/**
 * Закрыть время. Если на нём есть записи, сервер отказывает со списком — их переносит
 * регистратура, автоотмены нет (§8).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { ConflictingAppointment } from '@dentbook/shared';
import { api, ApiError } from '../api';
import { errorText, useSession } from '../context';
import { formatDateTime, wallTimeToIso } from '../time';
import { Button, Field, Input, Notice } from '../ui';

export function BlockPage({
  date,
  onDone,
}: {
  date: string;
  onDone(date: string, message: string): void;
}) {
  const { me, locale, t } = useSession();
  const client = useQueryClient();
  const timeZone = me.clinic.timezone;
  const [form, setForm] = useState({ date, from: '', to: '', reason: '' });
  const [conflicts, setConflicts] = useState<ConflictingAppointment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const block = useMutation({
    mutationFn: () =>
      api('POST', '/blocks', {
        startAt: wallTimeToIso(form.date, form.from, timeZone),
        endAt: wallTimeToIso(form.date, form.to, timeZone),
        reason: form.reason.trim() || undefined,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['schedule'] });
      onDone(form.date, t('block.done'));
    },
    onError: (err) => {
      const list = err instanceof ApiError ? err.body?.conflicts : undefined;
      if (Array.isArray(list) && list.length > 0) {
        setConflicts(list as ConflictingAppointment[]);
        setError(null);
      } else {
        setConflicts([]);
        setError(errorText(locale, err));
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setConflicts([]);
    setError(null);
    block.mutate();
  };
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm({ ...form, [field]: event.target.value });

  return (
    <form className="space-y-3" onSubmit={submit}>
      <Field label={t('block.date')}>
        <Input type="date" required value={form.date} onChange={set('date')} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('block.from')}>
          <Input type="time" required value={form.from} onChange={set('from')} />
        </Field>
        <Field label={t('block.to')}>
          <Input type="time" required min={form.from} value={form.to} onChange={set('to')} />
        </Field>
      </div>
      <p className="text-sm text-hint">{t('block.zone', { zone: timeZone })}</p>
      <Field label={t('block.reason')}>
        <Input maxLength={500} value={form.reason} onChange={set('reason')} />
      </Field>

      {error && <Notice tone="error">{error}</Notice>}
      {conflicts.length > 0 && (
        <Notice tone="error">
          <p>{t('block.conflicts')}</p>
          <ul className="mt-2 list-disc pl-5">
            {conflicts.map((c) => (
              <li key={c.id}>{formatDateTime(c.startAt, timeZone, locale)}</li>
            ))}
          </ul>
        </Notice>
      )}

      <Button type="submit" className="w-full" disabled={block.isPending}>
        {t('block.submit')}
      </Button>
    </form>
  );
}
