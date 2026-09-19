/** Вход и регистрация клиники. */
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LOCALES, type Locale } from '@dentbook/shared/domain';
import { useLogin, useRegister } from '../api/hooks';
import { LanguageSelect } from '../components/Layout';
import { Button, ErrorText, Field, Input, Select, TimeZoneOptions } from '../components/ui';
import { LOCALE_NAMES, useI18n } from '../i18n';
import { browserTimeZone } from '../lib/time';

function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold text-teal-700">DentBook</p>
          <LanguageSelect />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="mb-5 text-xl font-semibold text-slate-900">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    // Оператор платформы — в свою панель, сотрудник клиники — в журнал
    login.mutate(
      { email, password },
      { onSuccess: ({ role }) => navigate(role === 'operator' ? '/operator' : '/journal') },
    );
  }

  return (
    <AuthCard title={t('auth.loginTitle')}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t('field.email')}>
          <Input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label={t('field.password')}>
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <ErrorText error={login.error} />
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {t('auth.login')}
        </Button>
      </form>
      <p className="mt-5 text-sm text-slate-600">
        {t('auth.noAccount')}{' '}
        <Link to="/register" className="font-medium text-teal-700 hover:underline">
          {t('auth.registerLink')}
        </Link>
      </p>
    </AuthCard>
  );
}

export function RegisterPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const register = useRegister();
  const [form, setForm] = useState({
    clinicName: '',
    timezone: browserTimeZone(),
    currency: 'USD',
    locale: locale as Locale,
    fullName: '',
    email: '',
    password: '',
  });
  const set = (field: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    register.mutate(form, { onSuccess: () => navigate('/calendar') });
  }

  return (
    <AuthCard title={t('auth.registerTitle')}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t('field.clinicName')}>
          <Input
            required
            value={form.clinicName}
            onChange={(e) => set('clinicName')(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('field.timezone')}>
            <Select value={form.timezone} onChange={(e) => set('timezone')(e.target.value)}>
              <TimeZoneOptions />
            </Select>
          </Field>
          <Field label={t('field.currency')} hint={t('hint.currency')}>
            <Input
              required
              maxLength={3}
              value={form.currency}
              onChange={(e) => set('currency')(e.target.value.toUpperCase())}
            />
          </Field>
        </div>
        <Field label={t('field.widgetLanguage')}>
          <Select value={form.locale} onChange={(e) => set('locale')(e.target.value)}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_NAMES[l]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('field.fullName')}>
          <Input
            required
            autoComplete="name"
            value={form.fullName}
            onChange={(e) => set('fullName')(e.target.value)}
          />
        </Field>
        <Field label={t('field.email')}>
          <Input
            type="email"
            required
            autoComplete="username"
            value={form.email}
            onChange={(e) => set('email')(e.target.value)}
          />
        </Field>
        <Field label={t('field.password')} hint={t('hint.password')}>
          <Input
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => set('password')(e.target.value)}
          />
        </Field>
        <ErrorText error={register.error} />
        <Button type="submit" className="w-full" disabled={register.isPending}>
          {t('auth.register')}
        </Button>
      </form>
      <p className="mt-5 text-sm text-slate-600">
        {t('auth.haveAccount')}{' '}
        <Link to="/login" className="font-medium text-teal-700 hover:underline">
          {t('auth.loginLink')}
        </Link>
      </p>
    </AuthCard>
  );
}
