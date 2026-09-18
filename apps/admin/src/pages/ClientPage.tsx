/** Карточка клиента (Шаг 9): данные, заметки, счётчики визитов и история записей. */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ClientCard } from '@dentbook/shared';
import { useClient, useUpdateClient } from '../api/hooks';
import { useSession } from '../components/Layout';
import {
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Loading,
  PageHeader,
} from '../components/ui';
import { useI18n, type MessageKey } from '../i18n';
import { dateIn, formatDate, formatDateTime } from '../lib/time';

const STATUS_TONE = {
  pending: 'amber',
  confirmed: 'green',
  completed: 'slate',
  no_show: 'red',
  cancelled: 'slate',
} as const;

function Details({ client }: { client: ClientCard }) {
  const { t } = useI18n();
  const update = useUpdateClient();
  const [form, setForm] = useState({
    fullName: client.fullName,
    email: client.email ?? '',
    notes: client.notes ?? '',
  });
  useEffect(
    () =>
      setForm({ fullName: client.fullName, email: client.email ?? '', notes: client.notes ?? '' }),
    [client],
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    update.mutate({
      id: client.id,
      fullName: form.fullName,
      email: form.email.trim() || null,
      notes: form.notes.trim() || null,
    });
  }

  return (
    <Card title={t('client.details')}>
      <form className="space-y-3" onSubmit={submit}>
        <Field label={t('field.fullName')}>
          <Input
            required
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </Field>
        <Field label={t('field.phone')}>
          <Input disabled value={client.phone} />
        </Field>
        <Field label={t('field.email')}>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field label={t('client.notes')}>
          <textarea
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            rows={3}
            maxLength={2000}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>
        <ErrorText error={update.error} />
        {update.isSuccess && <p className="text-sm text-emerald-700">{t('common.saved')}</p>}
        <Button type="submit" disabled={update.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </Card>
  );
}

export function ClientPage() {
  const { t, locale } = useI18n();
  const { id } = useParams();
  const { clinic } = useSession();
  const client = useClient(id!);

  if (client.isPending) return <Loading />;
  if (client.isError) return <ErrorText error={client.error} />;
  const card = client.data;
  const stats: [MessageKey, number][] = [
    ['client.upcoming', card.stats.upcoming],
    ['client.completed', card.stats.completed],
    ['client.noShow', card.stats.noShow],
    ['client.cancelled', card.stats.cancelled],
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={card.fullName}>
        <Link to="/clients" className="text-sm text-teal-700 hover:underline">
          ← {t('nav.clients')}
        </Link>
      </PageHeader>
      <p className="-mt-4 text-sm text-slate-500">
        {t('client.since', { date: formatDate(dateIn(card.createdAt, clinic.timezone), locale) })}
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-3">
            <dt className="text-xs text-slate-500">{t(label)}</dt>
            <dd className="text-xl font-semibold text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Details client={card} />
        <Card title={t('client.history')}>
          {card.appointments.length === 0 && (
            <p className="text-sm text-slate-500">{t('client.noHistory')}</p>
          )}
          <ul className="divide-y divide-slate-100 text-sm">
            {card.appointments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="font-medium text-slate-900">
                    {formatDateTime(a.startAt, a.timeZone, locale)}
                  </p>
                  <p className="text-slate-500">
                    {a.service} · {a.dentist} · {a.office}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[a.status]}>{t(`status.${a.status}` as MessageKey)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
