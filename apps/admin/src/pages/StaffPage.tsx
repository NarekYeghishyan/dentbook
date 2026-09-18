/** Сотрудники клиники: owner и admin добавляют администраторов и регистратуру. */
import { useState, type FormEvent } from 'react';
import type { StaffUser } from '@dentbook/shared';
import { STAFF_ROLES, type StaffRole } from '@dentbook/shared/domain';
import { useCreateUser, useUpdateUser, useUsers } from '../api/hooks';
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
  Select,
} from '../components/ui';
import { useI18n, type MessageKey } from '../i18n';
import { formatDateTime } from '../lib/time';

function StaffRow({ user }: { user: StaffUser }) {
  const { t, locale } = useI18n();
  const { user: me, clinic } = useSession();
  const update = useUpdateUser();
  const [password, setPassword] = useState('');
  // Владельца и себя по роли и статусу не меняют (ADR-0006)
  const locked = user.role === 'owner' || user.id === me.id;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <p className="font-medium text-slate-900">{user.fullName}</p>
          <p className="text-sm text-slate-500">
            {user.email}
            {user.lastLoginAt &&
              ` · ${t('staff.lastLogin', { time: formatDateTime(user.lastLoginAt, clinic.timezone, locale) })}`}
          </p>
        </div>
        {!user.isActive && <Badge tone="red">{t('common.inactive')}</Badge>}
        {locked ? (
          <Badge>{t(`role.${user.role}` as MessageKey)}</Badge>
        ) : (
          <>
            <Select
              aria-label={t('field.role')}
              className="w-auto"
              value={user.role}
              disabled={update.isPending}
              onChange={(e) => update.mutate({ id: user.id, role: e.target.value as StaffRole })}
            >
              {STAFF_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`role.${role}`)}
                </option>
              ))}
            </Select>
            <Button
              variant={user.isActive ? 'danger' : 'secondary'}
              disabled={update.isPending}
              onClick={() => update.mutate({ id: user.id, isActive: !user.isActive })}
            >
              {t(user.isActive ? 'staff.deactivate' : 'staff.activate')}
            </Button>
          </>
        )}
      </div>
      {(user.role !== 'owner' || user.id === me.id) && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ id: user.id, password }, { onSuccess: () => setPassword('') });
          }}
        >
          <Input
            type="password"
            autoComplete="new-password"
            minLength={10}
            className="max-w-xs"
            placeholder={t('staff.newPassword')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={password.length === 0 || update.isPending}
          >
            {t('staff.setPassword')}
          </Button>
        </form>
      )}
      <ErrorText error={update.error} />
    </li>
  );
}

export function StaffPage() {
  const { t } = useI18n();
  const users = useUsers();
  const create = useCreateUser();
  const empty = { fullName: '', email: '', password: '', role: 'registrar' as StaffRole };
  const [form, setForm] = useState(empty);

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(form, { onSuccess: () => setForm(empty) });
  }

  if (users.isPending) return <Loading />;

  return (
    <div className="space-y-6">
      <PageHeader title={t('staff.title')} />
      <Card>
        <ErrorText error={users.error} />
        <ul className="divide-y divide-slate-100">
          {users.data?.map((user) => (
            <StaffRow key={user.id} user={user} />
          ))}
        </ul>
      </Card>
      <Card title={t('staff.add')}>
        <p className="mb-4 text-sm text-slate-600">{t('staff.addHint')}</p>
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('field.fullName')}>
              <Input
                required
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </Field>
            <Field label={t('field.email')}>
              <Input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label={t('field.password')} hint={t('hint.password')}>
              <Input
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            <Field label={t('field.role')}>
              <Select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}
              >
                {STAFF_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {t(`role.${role}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <ErrorText error={create.error} />
          <Button type="submit" disabled={create.isPending}>
            {t('common.add')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
