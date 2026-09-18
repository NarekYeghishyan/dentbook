/** Филиалы (в БД — locations): адрес, телефон, свой часовой пояс. */
import { useState, type FormEvent } from 'react';
import type { CreateLocationInput, Location } from '@dentbook/shared';
import { useCreateLocation, useLocations, useUpdateLocation } from '../api/hooks';
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
import { timeZones } from '../lib/time';

function OfficeForm({
  initial,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: Location;
  pending: boolean;
  error: unknown;
  onSubmit(input: CreateLocationInput): void;
  onCancel(): void;
}) {
  const { t } = useI18n();
  const { clinic } = useSession();
  const [draft, setDraft] = useState({
    name: initial?.name ?? '',
    address: initial?.address ?? '',
    phone: initial?.phone ?? '',
    timezone: initial?.timezone ?? '',
    isActive: initial?.isActive ?? true,
  });
  const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ ...draft, timezone: draft.timezone || null });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('field.name')}>
          <Input required value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label={t('field.timezone')}>
          <Select value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })}>
            <option value="">{t('offices.clinicTimezone', { zone: clinic.timezone })}</option>
            {timeZones().map((zone) => (
              <option key={zone}>{zone}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('field.address')}>
          <Input value={draft.address} onChange={(e) => set({ address: e.target.value })} />
        </Field>
        <Field label={t('field.phone')}>
          <Input type="tel" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
      </div>
      <Checkbox
        label={t('common.active')}
        checked={draft.isActive}
        onChange={(isActive) => set({ isActive })}
      />
      <ErrorText error={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {t('common.save')}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

export function OfficesPage() {
  const { t } = useI18n();
  const canManage = useCanManage();
  const { clinic } = useSession();
  const locations = useLocations();
  const create = useCreateLocation();
  const update = useUpdateLocation();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  if (locations.isPending) return <Loading />;

  return (
    <div className="space-y-6">
      <PageHeader title={t('offices.title')}>
        {canManage && !adding && (
          <Button onClick={() => setAdding(true)}>{t('offices.add')}</Button>
        )}
      </PageHeader>

      {adding && (
        <Card title={t('offices.add')}>
          <OfficeForm
            pending={create.isPending}
            error={create.error}
            onCancel={() => setAdding(false)}
            onSubmit={(input) => create.mutate(input, { onSuccess: () => setAdding(false) })}
          />
        </Card>
      )}

      <Card>
        <ErrorText error={locations.error} />
        {locations.data?.length === 0 && (
          <p className="text-sm text-slate-500">{t('offices.empty')}</p>
        )}
        <ul className="divide-y divide-slate-100">
          {locations.data?.map((office) => (
            <li key={office.id} className="py-3">
              {editing === office.id ? (
                <OfficeForm
                  initial={office}
                  pending={update.isPending}
                  error={update.error}
                  onCancel={() => setEditing(null)}
                  onSubmit={(input) =>
                    update.mutate(
                      { id: office.id, ...input },
                      { onSuccess: () => setEditing(null) },
                    )
                  }
                />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1">
                    <p className="font-medium text-slate-900">{office.name}</p>
                    <p className="text-sm text-slate-500">
                      {[office.address, office.phone, office.timezone ?? clinic.timezone]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  {!office.isActive && <Badge tone="red">{t('common.inactive')}</Badge>}
                  {canManage && (
                    <Button variant="secondary" onClick={() => setEditing(office.id)}>
                      {t('common.edit')}
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
