/** Карточка врача: профиль, услуги, недельный шаблон, исключения расписания. */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  ConflictingAppointment,
  Dentist,
  Location,
  ScheduleExceptionType,
  WorkingHoursItem,
} from '@dentbook/shared';
import { ApiError } from '../api/client';
import {
  useCreateException,
  useDeleteException,
  useDentists,
  useExceptions,
  useLocations,
  useSaveWorkingHours,
  useServices,
  useSetDentistServices,
  useUpdateDentist,
  useWorkingHours,
} from '../api/hooks';
import { useCanManage, useSession } from '../components/Layout';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ErrorText,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
} from '../components/ui';
import { useI18n } from '../i18n';
import { addDays, formatDateTime, todayIn, wallTimeToIso, weekdayName } from '../lib/time';

function Profile({ dentist }: { dentist: Dentist }) {
  const { t } = useI18n();
  const canManage = useCanManage();
  const update = useUpdateDentist();
  const [fullName, setFullName] = useState(dentist.fullName);

  function submit(e: FormEvent) {
    e.preventDefault();
    update.mutate({ id: dentist.id, fullName });
  }

  return (
    <Card title={t('dentist.profile')}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t('field.fullName')}>
          <Input
            required
            disabled={!canManage}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </Field>
        <div>
          <Checkbox
            label={t('dentist.acceptsBookings')}
            checked={dentist.isActive}
            disabled={!canManage || update.isPending}
            onChange={(isActive) => update.mutate({ id: dentist.id, isActive })}
          />
        </div>
        <ErrorText error={update.error} />
        {canManage && (
          <Button type="submit" disabled={update.isPending || fullName === dentist.fullName}>
            {t('common.save')}
          </Button>
        )}
      </form>
    </Card>
  );
}

function Services({ dentist }: { dentist: Dentist }) {
  const { t } = useI18n();
  const canManage = useCanManage();
  const services = useServices();
  const save = useSetDentistServices();
  const [selected, setSelected] = useState(new Set(dentist.serviceIds));

  useEffect(() => setSelected(new Set(dentist.serviceIds)), [dentist.serviceIds]);

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const changed =
    selected.size !== dentist.serviceIds.length ||
    dentist.serviceIds.some((id) => !selected.has(id));

  return (
    <Card title={t('dentist.services')}>
      {services.data?.length === 0 && (
        <p className="text-sm text-slate-500">
          {t('dentist.noServicesYet')}{' '}
          <Link to="/services" className="text-teal-700 hover:underline">
            {t('nav.services')}
          </Link>
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {services.data?.map((service) => (
          <Checkbox
            key={service.id}
            label={service.isActive ? service.name : `${service.name} (${t('common.inactive')})`}
            checked={selected.has(service.id)}
            disabled={!canManage}
            onChange={(on) => toggle(service.id, on)}
          />
        ))}
      </div>
      <div className="mt-4 space-y-3">
        <ErrorText error={save.error} />
        {canManage && (
          <Button
            disabled={!changed || save.isPending}
            onClick={() => save.mutate({ id: dentist.id, serviceIds: [...selected] })}
          >
            {t('common.save')}
          </Button>
        )}
      </div>
    </Card>
  );
}

type Shift = Omit<WorkingHoursItem, 'id'> & { key: string };

const toShifts = (items: WorkingHoursItem[]): Shift[] =>
  items.map(({ id, ...item }) => ({ ...item, key: id }));

function WeeklyHours({ dentistId, locations }: { dentistId: string; locations: Location[] }) {
  const { t, locale } = useI18n();
  const canManage = useCanManage();
  const hours = useWorkingHours(dentistId);
  const save = useSaveWorkingHours(dentistId);
  const [shifts, setShifts] = useState<Shift[]>([]);

  useEffect(() => {
    if (hours.data) setShifts(toShifts(hours.data));
  }, [hours.data]);

  if (hours.isPending) return <Loading />;

  const overlap =
    save.error instanceof ApiError
      ? (save.error.body as { overlap?: number[] }).overlap
      : undefined;
  const update = (index: number, patch: Partial<Shift>) =>
    setShifts((current) => current.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  function add() {
    const last = shifts.at(-1);
    setShifts((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        locationId: last?.locationId ?? locations[0]?.id ?? '',
        weekday: last ? (last.weekday % 7) + 1 : 1,
        startTime: last?.startTime ?? '09:00',
        endTime: last?.endTime ?? '17:00',
      },
    ]);
  }

  function submit() {
    save.mutate({
      items: shifts.map(({ locationId, weekday, startTime, endTime }) => ({
        locationId,
        weekday,
        startTime,
        endTime,
      })),
    });
  }

  return (
    <Card title={t('dentist.weeklyHours')}>
      <p className="mb-4 text-sm text-slate-600">{t('dentist.weeklyHoursHint')}</p>
      {shifts.length === 0 && <p className="mb-3 text-sm text-slate-500">{t('dentist.noHours')}</p>}
      <div className="space-y-2">
        {shifts.map((shift, index) => (
          <div
            key={shift.key}
            className={`grid grid-cols-2 gap-2 rounded-md p-2 sm:grid-cols-[1fr_1fr_9rem_9rem_auto] ${
              overlap?.includes(index) ? 'bg-red-50 ring-1 ring-red-200' : 'bg-slate-50'
            }`}
          >
            <Select
              aria-label={t('field.weekday')}
              disabled={!canManage}
              value={shift.weekday}
              onChange={(e) => update(index, { weekday: Number(e.target.value) })}
            >
              {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                <option key={day} value={day}>
                  {weekdayName(day, locale)}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('field.office')}
              disabled={!canManage}
              value={shift.locationId}
              onChange={(e) => update(index, { locationId: e.target.value })}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
            <Input
              type="time"
              aria-label={t('field.start')}
              disabled={!canManage}
              value={shift.startTime}
              onChange={(e) => update(index, { startTime: e.target.value })}
            />
            <Input
              type="time"
              aria-label={t('field.end')}
              disabled={!canManage}
              value={shift.endTime}
              onChange={(e) => update(index, { endTime: e.target.value })}
            />
            {canManage && (
              <Button
                variant="danger"
                aria-label={t('common.remove')}
                onClick={() => setShifts((current) => current.filter((_, i) => i !== index))}
              >
                ✕
              </Button>
            )}
            {shift.endTime <= shift.startTime && shift.endTime !== shift.startTime && (
              <p className="col-span-full text-xs text-slate-500">{t('dentist.overnight')}</p>
            )}
          </div>
        ))}
      </div>
      {canManage && (
        <div className="mt-4 space-y-3">
          {overlap && <p className="text-sm text-red-700">{t('dentist.overlap')}</p>}
          {!overlap && <ErrorText error={save.error} />}
          {locations.length === 0 && (
            <p className="text-sm text-amber-700">{t('dentist.needOffice')}</p>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" disabled={locations.length === 0} onClick={add}>
              {t('dentist.addShift')}
            </Button>
            <Button disabled={save.isPending} onClick={submit}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Conflicts({ error, timeZone }: { error: unknown; timeZone: string }) {
  const { t, locale } = useI18n();
  const conflicts =
    error instanceof ApiError
      ? (error.body as { conflicts?: ConflictingAppointment[] }).conflicts
      : undefined;
  if (!conflicts?.length) return <ErrorText error={error} />;
  return (
    <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      <p>{t('error.timeHasAppointments')}</p>
      <ul className="mt-1 list-disc pl-5">
        {conflicts.map((c) => (
          <li key={c.id}>{formatDateTime(c.startAt, timeZone, locale)}</li>
        ))}
      </ul>
    </div>
  );
}

function Exceptions({ dentistId, locations }: { dentistId: string; locations: Location[] }) {
  const { t, locale } = useI18n();
  const canManage = useCanManage();
  const { clinic } = useSession();
  const today = todayIn(clinic.timezone);
  const range = {
    from: wallTimeToIso(addDays(today, -1), '00:00', clinic.timezone),
    to: wallTimeToIso(addDays(today, 120), '00:00', clinic.timezone),
  };
  const exceptions = useExceptions(dentistId, range.from, range.to);
  const create = useCreateException(dentistId);
  const remove = useDeleteException(dentistId);

  const [form, setForm] = useState({
    type: 'block' as ScheduleExceptionType,
    locationId: '',
    startDate: today,
    startTime: '09:00',
    endDate: today,
    endTime: '18:00',
    reason: '',
  });
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));

  /** Пояс, в котором вводится и показывается время исключения (§2.3). */
  const zoneOf = (locationId: string | null) =>
    locations.find((l) => l.id === locationId)?.timezone ?? clinic.timezone;
  const officeName = (locationId: string | null) =>
    locations.find((l) => l.id === locationId)?.name ?? t('exceptions.allOffices');

  function submit(e: FormEvent) {
    e.preventDefault();
    const zone = zoneOf(form.locationId || null);
    create.mutate(
      {
        type: form.type,
        locationId: form.locationId || null,
        startAt: wallTimeToIso(form.startDate, form.startTime, zone),
        endAt: wallTimeToIso(form.endDate, form.endTime, zone),
        reason: form.reason,
      },
      { onSuccess: () => set({ reason: '' }) },
    );
  }

  return (
    <Card title={t('exceptions.title')}>
      <p className="mb-4 text-sm text-slate-600">{t('exceptions.hint')}</p>
      {exceptions.isPending && <Loading />}
      {exceptions.data?.length === 0 && (
        <p className="mb-4 text-sm text-slate-500">{t('exceptions.empty')}</p>
      )}
      <ul className="mb-4 space-y-2">
        {exceptions.data?.map((item) => {
          const zone = zoneOf(item.locationId);
          return (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm"
            >
              <Badge tone={item.type === 'block' ? 'red' : 'green'}>
                {t(item.type === 'block' ? 'exceptions.block' : 'exceptions.extra')}
              </Badge>
              <span className="text-slate-800">
                {formatDateTime(item.startAt, zone, locale)} —{' '}
                {formatDateTime(item.endAt, zone, locale)}
              </span>
              <span className="text-slate-500">· {officeName(item.locationId)}</span>
              {item.reason && <span className="text-slate-500">· {item.reason}</span>}
              {canManage && (
                <Button
                  variant="danger"
                  className="ml-auto"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(item.id)}
                >
                  {t('common.remove')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {remove.error !== null && <Conflicts error={remove.error} timeZone={clinic.timezone} />}

      {canManage && (
        <form className="space-y-4 border-t border-slate-100 pt-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('exceptions.type')}>
              <Select
                value={form.type}
                onChange={(e) => set({ type: e.target.value as ScheduleExceptionType })}
              >
                <option value="block">{t('exceptions.blockLong')}</option>
                <option value="extra">{t('exceptions.extraLong')}</option>
              </Select>
            </Field>
            <Field label={t('field.office')}>
              <Select
                required={form.type === 'extra'}
                value={form.locationId}
                onChange={(e) => set({ locationId: e.target.value })}
              >
                <option value="" disabled={form.type === 'extra'}>
                  {form.type === 'extra' ? t('common.choose') : t('exceptions.allOffices')}
                </option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('field.start')}>
              <div className="flex gap-2">
                <Input
                  type="date"
                  required
                  value={form.startDate}
                  onChange={(e) => set({ startDate: e.target.value })}
                />
                <Input
                  type="time"
                  required
                  value={form.startTime}
                  onChange={(e) => set({ startTime: e.target.value })}
                />
              </div>
            </Field>
            <Field label={t('field.end')}>
              <div className="flex gap-2">
                <Input
                  type="date"
                  required
                  value={form.endDate}
                  onChange={(e) => set({ endDate: e.target.value })}
                />
                <Input
                  type="time"
                  required
                  value={form.endTime}
                  onChange={(e) => set({ endTime: e.target.value })}
                />
              </div>
            </Field>
          </div>
          <Field label={t('exceptions.reason')}>
            <Input value={form.reason} onChange={(e) => set({ reason: e.target.value })} />
          </Field>
          <p className="text-xs text-slate-500">
            {t('calendar.timezone', { zone: zoneOf(form.locationId || null) })}
          </p>
          {create.error !== null && (
            <Conflicts error={create.error} timeZone={zoneOf(form.locationId || null)} />
          )}
          <Button type="submit" disabled={create.isPending}>
            {t('common.add')}
          </Button>
        </form>
      )}
    </Card>
  );
}

export function DentistPage() {
  const { t } = useI18n();
  const { id } = useParams();
  const dentists = useDentists();
  const locations = useLocations();

  if (dentists.isPending || locations.isPending) return <Loading />;
  const dentist = dentists.data?.find((d) => d.id === id);
  if (!dentist) {
    return <p className="text-sm text-slate-600">{t('error.not_found')}</p>;
  }
  const offices = locations.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title={dentist.fullName}>
        <Link to="/dentists" className="text-sm text-teal-700 hover:underline">
          ← {t('nav.dentists')}
        </Link>
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-2">
        <Profile dentist={dentist} />
        <Services dentist={dentist} />
      </div>
      <WeeklyHours dentistId={dentist.id} locations={offices} />
      <Exceptions dentistId={dentist.id} locations={offices} />
    </div>
  );
}
