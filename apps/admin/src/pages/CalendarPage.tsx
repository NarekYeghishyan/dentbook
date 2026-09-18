/**
 * Календарь доступности (критерий Шага 4): те же слоты, что предложит форма записи.
 * Пока данных нет — чек-лист первых шагов.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAvailability, useDentists, useLocations, useServices } from '../api/hooks';
import { useSession } from '../components/Layout';
import { Button, Card, ErrorText, Field, Loading, PageHeader, Select } from '../components/ui';
import { useI18n, type MessageKey } from '../i18n';
import { addDays, formatDate, formatTime, mondayOf, todayIn } from '../lib/time';

function SetupChecklist({ steps }: { steps: { done: boolean; label: MessageKey; to: string }[] }) {
  const { t } = useI18n();
  return (
    <Card title={t('setup.title')}>
      <p className="mb-4 text-sm text-slate-600">{t('setup.intro')}</p>
      <ol className="space-y-2">
        {steps.map((step, index) => (
          <li key={step.label} className="flex items-center gap-3 text-sm">
            <span
              className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${
                step.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {step.done ? '✓' : index + 1}
            </span>
            <Link to={step.to} className="font-medium text-teal-700 hover:underline">
              {t(step.label)}
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function CalendarPage() {
  const { t, locale } = useI18n();
  const { clinic } = useSession();
  const locations = useLocations();
  const services = useServices();
  const dentists = useDentists();

  const [locationId, setLocationId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [dentistId, setDentistId] = useState('');
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayIn(clinic.timezone)));

  const activeLocations = locations.data?.filter((l) => l.isActive) ?? [];
  const activeServices = services.data?.filter((s) => s.isActive) ?? [];
  const location = activeLocations.find((l) => l.id === locationId) ?? activeLocations[0];
  const service = activeServices.find((s) => s.id === serviceId) ?? activeServices[0];

  const availability = useAvailability(
    location && service
      ? {
          locationId: location.id,
          serviceId: service.id,
          from: weekStart,
          to: addDays(weekStart, 6),
          ...(dentistId ? { dentistId } : {}),
        }
      : null,
  );

  if (locations.isPending || services.isPending || dentists.isPending) return <Loading />;

  const dentistNames = new Map(dentists.data?.map((d) => [d.id, d.fullName]));
  const ready =
    activeLocations.length > 0 &&
    activeServices.length > 0 &&
    (dentists.data ?? []).some((d) => d.isActive && d.serviceIds.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t('calendar.title')} />
      {!ready && (
        <SetupChecklist
          steps={[
            { done: activeLocations.length > 0, label: 'setup.office', to: '/offices' },
            { done: activeServices.length > 0, label: 'setup.service', to: '/services' },
            {
              done: (dentists.data ?? []).some((d) => d.serviceIds.length > 0),
              label: 'setup.dentist',
              to: '/dentists',
            },
          ]}
        />
      )}

      {location && service && (
        <Card>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('field.office')}>
              <Select value={location.id} onChange={(e) => setLocationId(e.target.value)}>
                {activeLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('field.service')}>
              <Select value={service.id} onChange={(e) => setServiceId(e.target.value)}>
                {activeServices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('field.dentist')}>
              <Select value={dentistId} onChange={(e) => setDentistId(e.target.value)}>
                <option value="">{t('calendar.anyDentist')}</option>
                {dentists.data
                  ?.filter((d) => d.serviceIds.includes(service.id))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fullName}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setWeekStart(addDays(weekStart, -7))}>
                ←
              </Button>
              <Button
                variant="secondary"
                onClick={() => setWeekStart(mondayOf(todayIn(clinic.timezone)))}
              >
                {t('calendar.today')}
              </Button>
              <Button variant="secondary" onClick={() => setWeekStart(addDays(weekStart, 7))}>
                →
              </Button>
            </div>
            {availability.data && (
              <p className="text-xs text-slate-500">
                {t('calendar.timezone', { zone: availability.data.timeZone })}
              </p>
            )}
          </div>

          <p className="mt-3 text-xs text-slate-500">{t('calendar.hint')}</p>
          <ErrorText error={availability.error} />

          <div className="mt-4 grid gap-3 sm:grid-cols-7">
            {availability.data?.days.map((day) => (
              <div key={day.date} className="rounded-md border border-slate-200 p-2">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {formatDate(day.date, locale)}
                </p>
                {day.slots.length === 0 ? (
                  <p className="text-xs text-slate-400">{t('calendar.noSlots')}</p>
                ) : (
                  <ul className="flex flex-wrap gap-1 sm:flex-col">
                    {day.slots.map((slot) => {
                      const names = slot.dentistIds.map((id) => dentistNames.get(id) ?? '—');
                      return (
                        <li
                          key={slot.start}
                          title={names.join(', ')}
                          className="rounded bg-teal-50 px-1.5 py-0.5 text-xs text-teal-800"
                        >
                          {formatTime(slot.start, availability.data.timeZone, locale)}
                          {names.length > 1 && (
                            <span className="text-teal-600/70"> · {names.length}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
          {availability.isPending && <Loading />}
        </Card>
      )}
    </div>
  );
}
