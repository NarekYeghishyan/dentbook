/**
 * Дашборд клиники (Шаг 9, Q17): записи за период по источникам, отмены и неявки, загрузка
 * врачей и записи, которые ждут подтверждения. Период — местные даты клиники (§2.3).
 */
import { useState } from 'react';
import { exportUrl, useDashboard, useLocations } from '../api/hooks';
import { useCanManage, useSession } from '../components/Layout';
import {
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
} from '../components/ui';
import { useI18n, type MessageKey } from '../i18n';
import { addDays, formatDateTime, mondayOf, monthEndOf, monthStartOf, todayIn } from '../lib/time';

export function DashboardPage() {
  const { t, locale } = useI18n();
  const { clinic } = useSession();
  const canManage = useCanManage();
  const locations = useLocations();
  const today = todayIn(clinic.timezone);
  const [range, setRange] = useState({ from: mondayOf(today), to: addDays(mondayOf(today), 6) });
  const [locationId, setLocationId] = useState('');
  const query = { ...range, ...(locationId ? { locationId } : {}) };
  const dashboard = useDashboard(query);
  const data = dashboard.data;

  const kpis: [MessageKey, number | undefined][] = [
    ['dashboard.bookings', data?.bookings.total],
    ['dashboard.completed', data?.completed],
    ['dashboard.noShow', data?.noShow],
    ['dashboard.cancelled', data?.cancelled],
  ];
  const hours = (minutes: number) => (minutes / 60).toFixed(1);

  return (
    <div className="space-y-6">
      <PageHeader title={t('dashboard.title')}>
        {canManage && (
          <a
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            href={exportUrl(query)}
          >
            {t('journal.export')}
          </a>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-end gap-3">
        <Button
          variant="secondary"
          onClick={() => setRange({ from: mondayOf(today), to: addDays(mondayOf(today), 6) })}
        >
          {t('dashboard.thisWeek')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => setRange({ from: monthStartOf(today), to: monthEndOf(today) })}
        >
          {t('dashboard.thisMonth')}
        </Button>
        <Field label={t('dashboard.from')}>
          <Input
            type="date"
            value={range.from}
            onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })}
          />
        </Field>
        <Field label={t('dashboard.to')}>
          <Input
            type="date"
            value={range.to}
            onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })}
          />
        </Field>
        {(locations.data?.length ?? 0) > 1 && (
          <Field label={t('field.office')}>
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">{t('dashboard.allOffices')}</option>
              {locations.data!.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {dashboard.isPending && <Loading />}
      <ErrorText error={dashboard.error} />
      {data && (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {kpis.map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-white p-4">
                <dt className="text-xs text-slate-500">{t(label)}</dt>
                <dd className="text-2xl font-semibold text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-slate-600">
            {(['widget', 'telegram', 'admin'] as const)
              .map((s) => `${t(`source.${s}` as MessageKey)}: ${data.bookings.bySource[s]}`)
              .join(' · ')}
          </p>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={t('dashboard.load')}>
              <p className="mb-3 text-xs text-slate-500">{t('dashboard.loadHint')}</p>
              <ul className="space-y-3">
                {data.dentists.map((d) => {
                  const share = d.workingMin > 0 ? Math.min(1, d.bookedMin / d.workingMin) : 0;
                  return (
                    <li key={d.id} className="text-sm">
                      <div className="mb-1 flex justify-between gap-2">
                        <span className="font-medium text-slate-800">{d.fullName}</span>
                        <span className="text-slate-500">
                          {Math.round(share * 100)}% ·{' '}
                          {t('dashboard.hours', {
                            booked: hours(d.bookedMin),
                            working: hours(d.workingMin),
                          })}
                        </span>
                      </div>
                      <div className="h-2 rounded bg-slate-100">
                        <div
                          className="h-2 rounded bg-teal-500"
                          style={{ width: `${share * 100}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
            <Card title={t('dashboard.pending')}>
              {data.pending.length === 0 && (
                <p className="text-sm text-slate-500">{t('dashboard.noPending')}</p>
              )}
              <ul className="divide-y divide-slate-100 text-sm">
                {data.pending.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 py-2">
                    <span className="text-slate-900">{p.client}</span>
                    <span className="text-slate-500">
                      {formatDateTime(p.startAt, data.timeZone, locale)} · {p.dentist}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
