/**
 * Панель оператора платформы (Шаг 10, Q18): клиники со сводкой и их приостановка,
 * состояние платформы — провайдеры, очереди, отказы уведомлений за сутки. Данных клиентов
 * клиник здесь нет.
 */
import { Navigate, useNavigate } from 'react-router-dom';
import { isUnauthorized } from '../api/client';
import {
  useLogout,
  useOperatorClinics,
  useOperatorMe,
  usePlatformHealth,
  useSetClinicStatus,
} from '../api/hooks';
import { LanguageSelect } from '../components/Layout';
import { Badge, Button, Card, ErrorText, Loading } from '../components/ui';
import { useI18n, type MessageKey } from '../i18n';
import { dateIn, formatDate, formatDateTime } from '../lib/time';

/** Даты в панели оператора — в поясе браузера оператора: у клиник пояса разные. */
const OPERATOR_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function Clinics() {
  const { t, locale } = useI18n();
  const clinics = useOperatorClinics();
  const setStatus = useSetClinicStatus();

  function toggle(id: string, name: string, suspend: boolean) {
    if (suspend && !window.confirm(t('operator.suspendConfirm', { clinic: name }))) return;
    setStatus.mutate({ id, status: suspend ? 'suspended' : 'active' });
  }

  return (
    <Card title={t('operator.clinics')}>
      {clinics.isPending && <Loading />}
      <ErrorText error={clinics.error ?? setStatus.error} />
      {clinics.data && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="py-2 pr-4 font-medium">{t('field.clinicName')}</th>
                <th className="py-2 pr-4 font-medium">{t('operator.owner')}</th>
                <th className="py-2 pr-4 font-medium">{t('operator.created')}</th>
                <th className="py-2 pr-4 font-medium">{t('operator.dentists')}</th>
                <th className="py-2 pr-4 font-medium">{t('operator.bookings30d')}</th>
                <th className="py-2 pr-4 font-medium">{t('operator.lastBooking')}</th>
                <th className="py-2 font-medium">{t('field.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clinics.data.map((c) => (
                <tr key={c.id}>
                  <td className="py-2 pr-4 font-medium text-slate-900">{c.name}</td>
                  <td className="py-2 pr-4 text-slate-700">
                    {c.owner ? (
                      <>
                        {c.owner.fullName}
                        <span className="block text-xs text-slate-500">{c.owner.email}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2 pr-4 text-slate-700">
                    {formatDate(dateIn(c.createdAt, OPERATOR_ZONE), locale)}
                  </td>
                  <td className="py-2 pr-4 text-slate-700">
                    {c.dentists}
                    <span className="block text-xs text-slate-500">
                      {t('operator.inTelegram', { count: c.telegramDentists })}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-slate-700">{c.bookings30d}</td>
                  <td className="py-2 pr-4 text-slate-700">
                    {c.lastBookingAt ? formatDateTime(c.lastBookingAt, OPERATOR_ZONE, locale) : '—'}
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <Badge tone={c.status === 'active' ? 'green' : 'red'}>
                        {t(c.status === 'active' ? 'operator.active' : 'operator.suspended')}
                      </Badge>
                      <Button
                        variant={c.status === 'active' ? 'danger' : 'secondary'}
                        disabled={setStatus.isPending}
                        onClick={() => toggle(c.id, c.name, c.status === 'active')}
                      >
                        {t(c.status === 'active' ? 'operator.suspend' : 'operator.resume')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Health() {
  const { t, locale } = useI18n();
  const health = usePlatformHealth();
  const data = health.data;
  const providers: [MessageKey, boolean][] = data
    ? [
        ['operator.providerSms', data.providers.sms],
        ['operator.providerCaptcha', data.providers.captcha],
        ['operator.providerTelegram', data.providers.telegram],
      ]
    : [];

  return (
    <Card
      title={t('operator.health')}
      actions={
        <Button variant="secondary" onClick={() => void health.refetch()}>
          {t('operator.refresh')}
        </Button>
      }
    >
      {health.isPending && <Loading />}
      <ErrorText error={health.error} />
      {data && (
        <div className="space-y-5 text-sm">
          <p className="text-xs text-slate-500">
            {formatDateTime(data.checkedAt, OPERATOR_ZONE, locale)}
          </p>
          <ul className="flex flex-wrap gap-2">
            {providers.map(([label, on]) => (
              <li key={label}>
                <Badge tone={on ? 'green' : 'amber'}>
                  {t(label)}: {t(on ? 'operator.configured' : 'operator.notConfigured')}
                </Badge>
              </li>
            ))}
          </ul>
          <table className="w-full text-left">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 pr-4 font-medium">{t('operator.queue')}</th>
                <th className="py-1 pr-4 font-medium">{t('operator.waiting')}</th>
                <th className="py-1 pr-4 font-medium">{t('operator.delayed')}</th>
                <th className="py-1 pr-4 font-medium">{t('operator.running')}</th>
                <th className="py-1 font-medium">{t('operator.failed')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.queues.map((q) => (
                <tr key={q.name} className={q.enabled ? '' : 'text-slate-400'}>
                  <td className="py-1 pr-4 font-medium">{q.name}</td>
                  <td className="py-1 pr-4">{q.waiting}</td>
                  <td className="py-1 pr-4">{q.delayed}</td>
                  <td className="py-1 pr-4">{q.active}</td>
                  <td className={`py-1 ${q.failed > 0 ? 'font-semibold text-red-700' : ''}`}>
                    {q.failed}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <p className="mb-1 font-medium text-slate-800">{t('operator.failures')}</p>
            {data.failures24h.length === 0 ? (
              <p className="text-slate-500">{t('operator.noFailures')}</p>
            ) : (
              <ul className="space-y-1">
                {data.failures24h.map((f) => (
                  <li key={`${f.channel}-${f.lastError}`} className="flex justify-between gap-2">
                    <code className="text-xs text-slate-700">
                      {f.channel} · {f.lastError ?? '—'}
                    </code>
                    <span className="font-medium text-red-700">{f.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export function OperatorPage() {
  const { t } = useI18n();
  const me = useOperatorMe();
  const logout = useLogout();
  const navigate = useNavigate();

  if (me.isPending)
    return (
      <div className="p-8">
        <Loading />
      </div>
    );
  if (isUnauthorized(me.error)) return <Navigate to="/login" replace />;
  if (me.isError)
    return (
      <div className="p-8">
        <ErrorText error={me.error} />
      </div>
    );

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-teal-700">DentBook</p>
            <p className="text-xs text-slate-500">{t('operator.title')}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-slate-600 md:inline">{me.data.fullName}</span>
            <LanguageSelect />
            <Button
              variant="secondary"
              onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/login') })}
            >
              {t('nav.logout')}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <Health />
        <Clinics />
      </main>
    </div>
  );
}
