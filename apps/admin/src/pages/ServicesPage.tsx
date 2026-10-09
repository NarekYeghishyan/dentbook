/** Услуги клиники: длительность, буфер, цена, видимость в форме записи. */
import { useState, type FormEvent } from 'react';
import type { CreateServiceInput, Service } from '@dentbook/shared';
import { groupServices } from '@dentbook/shared/service-search';
import { useCreateService, useServices, useUpdateService } from '../api/hooks';
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
} from '../components/ui';
import { useI18n } from '../i18n';

type Draft = {
  name: string;
  category: string;
  description: string;
  durationMin: string;
  bufferMin: string;
  price: string;
  isPublic: boolean;
  isActive: boolean;
};

const toDraft = (s?: Service): Draft => ({
  name: s?.name ?? '',
  category: s?.category ?? '',
  description: s?.description ?? '',
  durationMin: String(s?.durationMin ?? 30),
  bufferMin: String(s?.bufferMin ?? 0),
  price: s?.price ?? '',
  isPublic: s?.isPublic ?? true,
  isActive: s?.isActive ?? true,
});

const toInput = (d: Draft): CreateServiceInput => ({
  name: d.name,
  category: d.category,
  description: d.description,
  durationMin: Number(d.durationMin),
  bufferMin: Number(d.bufferMin),
  price: d.price.trim() === '' ? null : d.price.trim(),
  isPublic: d.isPublic,
  isActive: d.isActive,
});

function ServiceForm({
  initial,
  categories,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: Service;
  /** Категории, уже заведённые в клинике: подсказки в поле. */
  categories: string[];
  pending: boolean;
  error: unknown;
  onSubmit(input: CreateServiceInput): void;
  onCancel?(): void;
}) {
  const { t } = useI18n();
  const { clinic } = useSession();
  const [draft, setDraft] = useState(() => toDraft(initial));
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(toInput(draft));
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('field.name')}>
          <Input required value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label={t('field.category')} hint={t('hint.category')}>
          <Input
            list="service-categories"
            maxLength={100}
            value={draft.category}
            onChange={(e) => set({ category: e.target.value })}
          />
          <datalist id="service-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label={t('field.price', { currency: clinic.currency })} hint={t('hint.price')}>
          <Input
            inputMode="decimal"
            pattern="\d{1,10}(\.\d{1,2})?"
            value={draft.price}
            onChange={(e) => set({ price: e.target.value })}
          />
        </Field>
        <Field label={t('field.durationMin')}>
          <Input
            type="number"
            required
            min={5}
            max={480}
            step={5}
            value={draft.durationMin}
            onChange={(e) => set({ durationMin: e.target.value })}
          />
        </Field>
        <Field label={t('field.bufferMin')} hint={t('hint.buffer')}>
          <Input
            type="number"
            min={0}
            max={240}
            step={5}
            value={draft.bufferMin}
            onChange={(e) => set({ bufferMin: e.target.value })}
          />
        </Field>
      </div>
      <Field label={t('field.description')}>
        <Input value={draft.description} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      <div className="flex flex-wrap gap-6">
        <Checkbox
          label={t('services.public')}
          checked={draft.isPublic}
          onChange={(isPublic) => set({ isPublic })}
        />
        <Checkbox
          label={t('common.active')}
          checked={draft.isActive}
          onChange={(isActive) => set({ isActive })}
        />
      </div>
      <ErrorText error={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {t('common.save')}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}

export function ServicesPage() {
  const { t } = useI18n();
  const canManage = useCanManage();
  const { clinic } = useSession();
  const services = useServices();
  const create = useCreateService();
  const update = useUpdateService();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');

  if (services.isPending) return <Loading />;

  const categories = [...new Set((services.data ?? []).flatMap((s) => s.category ?? []))];
  const groups = groupServices(services.data ?? [], query);

  return (
    <div className="space-y-6">
      <PageHeader title={t('services.title')}>
        {canManage && !adding && (
          <Button onClick={() => setAdding(true)}>{t('services.add')}</Button>
        )}
      </PageHeader>

      {adding && (
        <Card title={t('services.add')}>
          <ServiceForm
            categories={categories}
            pending={create.isPending}
            error={create.error}
            onCancel={() => setAdding(false)}
            onSubmit={(input) => create.mutate(input, { onSuccess: () => setAdding(false) })}
          />
        </Card>
      )}

      <Card>
        <ErrorText error={services.error} />
        {services.data?.length === 0 && (
          <p className="text-sm text-slate-500">{t('services.empty')}</p>
        )}
        {(services.data?.length ?? 0) > 0 && (
          <Input
            type="search"
            className="mb-3"
            aria-label={t('services.search')}
            placeholder={t('services.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {services.data && services.data.length > 0 && groups.length === 0 && (
          <p className="text-sm text-slate-500">{t('services.noMatch')}</p>
        )}
        {groups.map((group) => (
          <section key={group.category ?? ''}>
            {(group.category !== null || groups.length > 1) && (
              <h3 className="mt-3 border-b border-slate-200 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {group.category ?? t('services.noCategory')}
              </h3>
            )}
            <ul className="divide-y divide-slate-100">
              {group.items.map((service) => (
                <li key={service.id} className="py-3">
                  {editing === service.id ? (
                    <ServiceForm
                      initial={service}
                      categories={categories}
                      pending={update.isPending}
                      error={update.error}
                      onCancel={() => setEditing(null)}
                      onSubmit={(input) =>
                        update.mutate(
                          { id: service.id, ...input },
                          { onSuccess: () => setEditing(null) },
                        )
                      }
                    />
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex-1">
                        <p className="font-medium text-slate-900">{service.name}</p>
                        <p className="text-sm text-slate-500">
                          {t('services.summary', {
                            duration: service.durationMin,
                            buffer: service.bufferMin,
                          })}
                          {service.price !== null && ` · ${service.price} ${clinic.currency}`}
                        </p>
                      </div>
                      {!service.isPublic && <Badge>{t('services.hidden')}</Badge>}
                      {!service.isActive && <Badge tone="red">{t('common.inactive')}</Badge>}
                      {canManage && (
                        <Button variant="secondary" onClick={() => setEditing(service.id)}>
                          {t('common.edit')}
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Card>
    </div>
  );
}
