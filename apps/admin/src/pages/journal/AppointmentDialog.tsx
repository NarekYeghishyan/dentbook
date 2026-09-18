/** Запись в журнале: данные и действия регистратуры (Q17). */
import { Link } from 'react-router-dom';
import type { JournalAppointment } from '@dentbook/shared';
import { useAppointmentAction } from '../../api/hooks';
import { Badge, Button, Modal } from '../../components/ui';
import { useI18n, type MessageKey } from '../../i18n';
import { formatDateTime, formatTime } from '../../lib/time';
import { useJournalError } from './errors';

const STATUS_TONE = {
  pending: 'amber',
  confirmed: 'green',
  completed: 'slate',
  no_show: 'red',
  cancelled: 'slate',
} as const;

export function AppointmentDialog({
  appointment,
  dentistName,
  timeZone,
  onClose,
  onDone,
}: {
  appointment: JournalAppointment;
  dentistName: string;
  timeZone: string;
  onClose(): void;
  onDone(): void;
}) {
  const { t, locale } = useI18n();
  const action = useAppointmentAction();
  const errorText = useJournalError();
  const started = Date.parse(appointment.startAt) <= Date.now();
  const upcoming = !started && ['pending', 'confirmed'].includes(appointment.status);
  const canMark = started && appointment.status !== 'cancelled';

  const run = (kind: 'confirm' | 'cancel' | 'outcome', status?: 'completed' | 'no_show') => {
    if (kind === 'cancel' && !window.confirm(t('appointment.cancelConfirm'))) return;
    action.mutate(
      { id: appointment.id, action: kind, ...(status ? { status } : {}) },
      { onSuccess: onDone },
    );
  };

  const rows: [MessageKey, string][] = [
    [
      'appointment.when',
      `${formatDateTime(appointment.startAt, timeZone, locale)} – ${formatTime(
        appointment.endAt,
        timeZone,
        locale,
      )}`,
    ],
    ['field.dentist', dentistName],
    ['field.service', appointment.service],
    ['appointment.source', t(`source.${appointment.source}` as MessageKey)],
  ];

  return (
    <Modal title={t('appointment.title')} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-base font-medium text-slate-900">
              {appointment.client?.fullName ?? '—'}
            </p>
            {appointment.client && (
              <a className="text-teal-700 hover:underline" href={`tel:${appointment.client.phone}`}>
                {appointment.client.phone}
              </a>
            )}
          </div>
          <Badge tone={STATUS_TONE[appointment.status]}>
            {t(`status.${appointment.status}` as MessageKey)}
          </Badge>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-500">{t(label)}</dt>
              <dd className="text-slate-900">{value}</dd>
            </div>
          ))}
          {appointment.notes && (
            <>
              <dt className="text-slate-500">{t('appointment.notes')}</dt>
              <dd className="whitespace-pre-line text-slate-900">{appointment.notes}</dd>
            </>
          )}
        </dl>

        {action.error !== null && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-700">
            {errorText(action.error)}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {upcoming && appointment.status === 'pending' && (
            <Button disabled={action.isPending} onClick={() => run('confirm')}>
              {t('appointment.confirm')}
            </Button>
          )}
          {upcoming && (
            <Button variant="danger" disabled={action.isPending} onClick={() => run('cancel')}>
              {t('appointment.cancel')}
            </Button>
          )}
          {canMark && (
            <>
              <Button
                variant={appointment.status === 'completed' ? 'primary' : 'secondary'}
                disabled={action.isPending}
                onClick={() => run('outcome', 'completed')}
              >
                {t('appointment.came')}
              </Button>
              <Button
                variant={appointment.status === 'no_show' ? 'danger' : 'secondary'}
                disabled={action.isPending}
                onClick={() => run('outcome', 'no_show')}
              >
                {t('appointment.noShow')}
              </Button>
            </>
          )}
          {appointment.client && (
            <Link
              to={`/clients/${appointment.client.id}`}
              className="ml-auto self-center text-teal-700 hover:underline"
            >
              {t('appointment.openClient')}
            </Link>
          )}
        </div>
      </div>
    </Modal>
  );
}
