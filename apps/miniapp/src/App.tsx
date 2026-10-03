/**
 * Mini App врача (§8, Шаг 7): расписание, закрытие времени, запись своих клиентов и правка
 * своих записей.
 * Открывается из бота; вне Telegram подписи initData нет — только подсказка.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { MiniappAppointment, MiniappMe } from '@dentbook/shared';
import { LOCALE_NAMES, LOCALES, type Locale } from '@dentbook/shared/domain';
import { api } from './api';
import { errorText, SessionContext, useSession, type Session } from './context';
import { pickLocale, translate, type MessageKey } from './i18n';
import { AppointmentPage } from './pages/AppointmentPage';
import { BlockPage } from './pages/BlockPage';
import { BookPage } from './pages/BookPage';
import { SchedulePage } from './pages/SchedulePage';
import { initData, webApp } from './telegram';
import { dateIn, todayIn } from './time';
import { Notice } from './ui';

type Tab = 'schedule' | 'block' | 'book';
const TABS: { tab: Tab; label: MessageKey }[] = [
  { tab: 'schedule', label: 'tab.schedule' },
  { tab: 'block', label: 'tab.block' },
  { tab: 'book', label: 'tab.book' },
];

const telegramLanguage = () => webApp()?.initDataUnsafe.user?.language_code;

/**
 * Флажок «Показывать отменённые» помнится на этом устройстве. Хранилище может быть
 * недоступно — тогда флажок снят при каждом открытии.
 */
const SHOW_CANCELLED_KEY = 'dentbook.showCancelled';
function rememberedShowCancelled(): boolean {
  try {
    return localStorage.getItem(SHOW_CANCELLED_KEY) === '1';
  } catch {
    return false;
  }
}
function rememberShowCancelled(show: boolean) {
  try {
    localStorage.setItem(SHOW_CANCELLED_KEY, show ? '1' : '0');
  } catch {
    // Не запомнилось — флажок действует до закрытия Mini App
  }
}

export function App() {
  const signed = initData() !== '';
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<MiniappMe>('GET', '/me'),
    enabled: signed,
    staleTime: Infinity,
  });

  const locale = pickLocale(
    me.data?.dentist.locale,
    telegramLanguage() ?? navigator.language,
    me.data?.clinic.locale,
  );
  const session = useMemo<Session | null>(
    () =>
      me.data ? { me: me.data, locale, t: (key, vars) => translate(locale, key, vars) } : null,
    [me.data, locale],
  );
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  if (!signed) return <Screen>{translate(locale, 'outside')}</Screen>;
  if (me.isError) return <Screen>{errorText(locale, me.error)}</Screen>;
  if (!session) return <Screen>{translate(locale, 'loading')}</Screen>;
  return (
    <SessionContext.Provider value={session}>
      <Main />
    </SessionContext.Provider>
  );
}

function Screen({ children }: { children: string }) {
  return <p className="p-6 text-center text-hint">{children}</p>;
}

/** Переключатель языка (§9): тот же выбор, что и /language в боте. */
function LanguagePicker() {
  const { locale, t } = useSession();
  const client = useQueryClient();
  const change = useMutation({
    mutationFn: (next: Locale) => api<{ locale: Locale }>('PATCH', '/me', { locale: next }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['me'] }),
  });
  return (
    <select
      aria-label={t('language.label')}
      value={locale}
      disabled={change.isPending}
      onChange={(event) => change.mutate(event.target.value as Locale)}
      className="rounded-lg border border-hint/30 bg-bg px-2 py-1 text-sm text-fg disabled:opacity-50"
    >
      {LOCALES.map((option) => (
        <option key={option} value={option}>
          {LOCALE_NAMES[option]}
        </option>
      ))}
    </select>
  );
}

function Main() {
  const { me, t } = useSession();
  const [tab, setTab] = useState<Tab>('schedule');
  const [date, setDate] = useState(() => todayIn(me.clinic.timezone));
  const [flash, setFlash] = useState<string | null>(null);
  /** Открытая запись из расписания — поверх вкладок. */
  const [editing, setEditing] = useState<MiniappAppointment | null>(null);
  const [showCancelled, setShowCancelled] = useState(rememberedShowCancelled);

  const open = (next: Tab) => {
    setTab(next);
    setEditing(null);
    setFlash(null);
  };
  const done = (day: string, message: string) => {
    setDate(day);
    setTab('schedule');
    setEditing(null);
    setFlash(message);
  };
  const edit = (appointment: MiniappAppointment) => {
    setEditing(appointment);
    setFlash(null);
    window.scrollTo(0, 0);
  };
  /** Запись из красной клетки сетки: «Назад» вернёт на вкладку, на день этой записи. */
  const openBooked = (appointment: MiniappAppointment) => {
    setDate(dateIn(appointment.startAt, appointment.timeZone));
    edit(appointment);
  };

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{me.dentist.fullName}</div>
          <div className="text-sm text-hint">{me.clinic.name}</div>
        </div>
        <LanguagePicker />
      </header>
      <nav className="grid grid-cols-3 gap-1 rounded-lg bg-card p-1 text-sm">
        {TABS.map(({ tab: key, label }) => (
          <button
            key={key}
            type="button"
            aria-current={tab === key}
            className={`rounded-md px-2 py-2 ${tab === key ? 'bg-bg font-medium' : 'text-hint'}`}
            onClick={() => open(key)}
          >
            {t(label)}
          </button>
        ))}
      </nav>
      {flash && <Notice tone="success">{flash}</Notice>}
      {editing && (
        <AppointmentPage
          key={editing.id}
          appointment={editing}
          onBack={() => setEditing(null)}
          onDone={done}
          onOpen={openBooked}
        />
      )}
      {!editing && tab === 'schedule' && (
        <SchedulePage
          date={date}
          onDate={(day) => {
            setDate(day);
            setFlash(null);
          }}
          onEdit={edit}
          showCancelled={showCancelled}
          onShowCancelled={(show) => {
            setShowCancelled(show);
            rememberShowCancelled(show);
          }}
        />
      )}
      {!editing && tab === 'block' && <BlockPage date={date} onDone={done} />}
      {!editing && tab === 'book' && <BookPage date={date} onDone={done} onOpen={openBooked} />}
    </div>
  );
}
