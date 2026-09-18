import { NavLink, Navigate, Outlet, useNavigate, useOutletContext } from 'react-router-dom';
import type { MeResponse } from '@dentbook/shared';
import { LOCALES, type Locale } from '@dentbook/shared/domain';
import { isUnauthorized } from '../api/client';
import { useLogout, useMe } from '../api/hooks';
import { LOCALE_NAMES, useI18n, type MessageKey } from '../i18n';
import { Button, ErrorText, Loading, Select } from './ui';

const NAV: { to: string; label: MessageKey; managersOnly?: boolean }[] = [
  { to: '/calendar', label: 'nav.calendar' },
  { to: '/dentists', label: 'nav.dentists' },
  { to: '/services', label: 'nav.services' },
  { to: '/offices', label: 'nav.offices' },
  { to: '/website', label: 'nav.website', managersOnly: true },
  { to: '/staff', label: 'nav.staff', managersOnly: true },
  { to: '/settings', label: 'nav.settings' },
];

export function LanguageSelect() {
  const { locale, setLocale, t } = useI18n();
  return (
    <Select
      aria-label={t('common.language')}
      className="w-auto"
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {LOCALE_NAMES[l]}
        </option>
      ))}
    </Select>
  );
}

/** Каркас страниц после входа. Без сессии — на страницу входа. */
export function Layout() {
  const { t } = useI18n();
  const me = useMe();
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

  const { user, clinic } = me.data;
  const isManager = user.role !== 'registrar';

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-teal-700">DentBook</p>
            <p className="text-xs text-slate-500">{clinic.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden whitespace-nowrap text-sm text-slate-600 md:inline">
              {user.fullName} · {t(`role.${user.role}` as MessageKey)}
            </span>
            <LanguageSelect />
            <Button
              variant="secondary"
              onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/login') })}
            >
              {t('nav.logout')}
            </Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
          {NAV.filter((item) => isManager || !item.managersOnly).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                  isActive
                    ? 'border-teal-600 text-teal-700'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`
              }
            >
              {t(item.label)}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet context={me.data} />
      </main>
    </div>
  );
}

/** Текущий сотрудник и клиника на страницах внутри Layout. */
export const useSession = () => useOutletContext<MeResponse>();

/** Регистратура только смотрит; менять данные клиники могут owner и admin (ADR-0006). */
export const useCanManage = () => useSession().user.role !== 'registrar';
