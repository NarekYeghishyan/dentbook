/** Настройки клиники: пояс, язык формы записи, правила записи. */
import { useState, type FormEvent } from 'react';
import { LOCALES, type Locale } from '@dentbook/shared/domain';
import { useUpdateClinic } from '../api/hooks';
import { useCanManage, useSession } from '../components/Layout';
import {
  Button,
  Card,
  Checkbox,
  ErrorText,
  Field,
  Input,
  PageHeader,
  Select,
  TimeZoneOptions,
} from '../components/ui';
import { LOCALE_NAMES, useI18n } from '../i18n';

export function SettingsPage() {
  const { t } = useI18n();
  const canManage = useCanManage();
  const { clinic } = useSession();
  const update = useUpdateClinic();
  const [draft, setDraft] = useState({
    name: clinic.name,
    timezone: clinic.timezone,
    locale: clinic.locale,
    currency: clinic.currency,
    minLeadMin: String(clinic.minLeadMin),
    slotStepMin: String(clinic.slotStepMin),
    maxAdvanceDays: String(clinic.maxAdvanceDays),
    bookingRequiresConfirmation: clinic.bookingRequiresConfirmation,
  });
  const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));

  function submit(e: FormEvent) {
    e.preventDefault();
    update.mutate({
      ...draft,
      minLeadMin: Number(draft.minLeadMin),
      slotStepMin: Number(draft.slotStepMin),
      maxAdvanceDays: Number(draft.maxAdvanceDays),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.title')} />
      <Card>
        <form className="space-y-4" onSubmit={submit}>
          <fieldset disabled={!canManage} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('field.clinicName')}>
                <Input
                  required
                  value={draft.name}
                  onChange={(e) => set({ name: e.target.value })}
                />
              </Field>
              <Field label={t('field.timezone')} hint={t('hint.clinicTimezone')}>
                <Select value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })}>
                  <TimeZoneOptions />
                </Select>
              </Field>
              <Field label={t('field.widgetLanguage')}>
                <Select
                  value={draft.locale}
                  onChange={(e) => set({ locale: e.target.value as Locale })}
                >
                  {LOCALES.map((l) => (
                    <option key={l} value={l}>
                      {LOCALE_NAMES[l]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('field.currency')} hint={t('hint.currency')}>
                <Input
                  required
                  maxLength={3}
                  value={draft.currency}
                  onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label={t('field.minLeadMin')} hint={t('hint.minLead')}>
                <Input
                  type="number"
                  min={0}
                  max={10080}
                  value={draft.minLeadMin}
                  onChange={(e) => set({ minLeadMin: e.target.value })}
                />
              </Field>
              <Field label={t('field.slotStepMin')} hint={t('hint.slotStep')}>
                <Input
                  type="number"
                  min={5}
                  max={240}
                  step={5}
                  value={draft.slotStepMin}
                  onChange={(e) => set({ slotStepMin: e.target.value })}
                />
              </Field>
              <Field label={t('field.maxAdvanceDays')} hint={t('hint.maxAdvance')}>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={draft.maxAdvanceDays}
                  onChange={(e) => set({ maxAdvanceDays: e.target.value })}
                />
              </Field>
            </div>
            <Checkbox
              label={t('settings.requiresConfirmation')}
              checked={draft.bookingRequiresConfirmation}
              onChange={(bookingRequiresConfirmation) => set({ bookingRequiresConfirmation })}
            />
            <p className="text-xs text-slate-500">{t('settings.requiresConfirmationHint')}</p>
          </fieldset>
          <ErrorText error={update.error} />
          {update.isSuccess && <p className="text-sm text-emerald-700">{t('common.saved')}</p>}
          {canManage && (
            <Button type="submit" disabled={update.isPending}>
              {t('common.save')}
            </Button>
          )}
        </form>
      </Card>
    </div>
  );
}
