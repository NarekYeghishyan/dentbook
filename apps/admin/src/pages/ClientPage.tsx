/**
 * Карточка клиента (Шаг 9): данные, история заметок (Q19), счётчики визитов и история
 * записей.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CLIENT_NOTE_MAX, type ClientCard } from '@dentbook/shared';
import { useAddClientNote, useClient, useDeleteClientNote, useUpdateClient } from '../api/hooks';
import { useCanManage, useSession } from '../components/Layout';
import {
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Loading,
  PageHeader,
  Textarea,
} from '../components/ui';
import { useI18n, type MessageKey } from '../i18n';
import { dateIn, formatDate, formatDateTime } from '../lib/time';
import { actorLabel } from './journal/AppointmentHistory';

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
  const [form, setForm] = useState({ fullName: client.fullName, email: client.email ?? '' });
  useEffect(() => setForm({ fullName: client.fullName, email: client.email ?? '' }), [client]);

  function submit(event: FormEvent) {
    event.preventDefault();
    update.mutate({ id: client.id, fullName: form.fullName, email: form.email.trim() || null });
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
          <Input disabled value={client.phone ?? '—'} />
        </Field>
        <Field label={t('field.email')}>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
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

/**
 * История заметок (Q19): новая заметка — сверху. Здесь же заметки к записям — регистратуры,
 * врача из Telegram, клиента с сайта: у записи одна заметка, и её правка меняет её здесь
 * («изменена»), а не добавляет новую. Заметки карточки не правятся; удалить может владелец
 * или администратор. Эти же заметки врач видит в Mini App.
 */
function Notes({ client }: { client: ClientCard }) {
  const { t, locale } = useI18n();
  const { clinic } = useSession();
  const canManage = useCanManage();
  const add = useAddClientNote();
  const remove = useDeleteClientNote();
  const [text, setText] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    add.mutate({ clientId: client.id, text }, { onSuccess: () => setText('') });
  }

  return (
    <Card title={t('client.notes')}>
      <form className="space-y-2" onSubmit={submit}>
        <Textarea
          aria-label={t('client.newNote')}
          placeholder={t('client.newNote')}
          required
          maxLength={CLIENT_NOTE_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <ErrorText error={add.error ?? remove.error} />
        <Button type="submit" disabled={add.isPending || text.trim() === ''}>
          {t('client.addNote')}
        </Button>
      </form>
      {client.notes.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">{t('client.noNotes')}</p>
      ) : (
        <ol className="mt-4 space-y-2 text-sm" aria-label={t('client.notes')}>
          {client.notes.map((note) => (
            <li key={note.id} className="rounded-md border border-slate-200 px-3 py-2">
              <p className="whitespace-pre-line text-slate-900">{note.text}</p>
              <div className="mt-1 flex justify-between gap-3 text-xs text-slate-500">
                <div>
                  <p>
                    {formatDateTime(note.at, clinic.timezone, locale)} ·{' '}
                    {actorLabel(t, note.author, note.authorName)}
                    {note.edited && ` · ${t('client.noteEdited')}`}
                  </p>
                  {note.appointment && (
                    <p>
                      {t('client.noteOnBooking', {
                        when: formatDateTime(
                          note.appointment.startAt,
                          note.appointment.timeZone,
                          locale,
                        ),
                      })}
                    </p>
                  )}
                </div>
                {canManage && (
                  <button
                    type="button"
                    className="self-start text-red-700 hover:underline disabled:opacity-50"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (!window.confirm(t('client.deleteNoteConfirm'))) return;
                      remove.mutate({ clientId: client.id, noteId: note.id });
                    }}
                  >
                    {t('client.deleteNote')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
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
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Details client={card} />
        <div className="space-y-6">
          <Notes client={card} />
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
                  <Badge tone={STATUS_TONE[a.status]}>
                    {t(`status.${a.status}` as MessageKey)}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
