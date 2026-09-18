/**
 * Mini App врача (§8, Шаг 7): расписание, закрытие времени, запись своих клиентов.
 * Открывается из бота; вне Telegram подписи initData нет — только подсказка.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { MiniappMe } from '@dentbook/shared';
import { api } from './api';
import { errorText, SessionContext, useSession, type Session } from './context';
import { pickLocale, translate, type MessageKey } from './i18n';
import { BlockPage } from './pages/BlockPage';
import { BookPage } from './pages/BookPage';
import { SchedulePage } from './pages/SchedulePage';
import { initData, webApp } from './telegram';
import { todayIn } from './time';
import { Notice } from './ui';

type Tab = 'schedule' | 'block' | 'book';
const TABS: { tab: Tab; label: MessageKey }[] = [
  { tab: 'schedule', label: 'tab.schedule' },
  { tab: 'block', label: 'tab.block' },
  { tab: 'book', label: 'tab.book' },
];

const telegramLanguage = () => webApp()?.initDataUnsafe.user?.language_code;

export function App() {
  const signed = initData() !== '';
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<MiniappMe>('GET', '/me'),
    enabled: signed,
    staleTime: Infinity,
  });

  const locale = pickLocale(telegramLanguage() ?? navigator.language, me.data?.clinic.locale);
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

function Main() {
  const { me, t } = useSession();
  const [tab, setTab] = useState<Tab>('schedule');
  const [date, setDate] = useState(() => todayIn(me.clinic.timezone));
  const [flash, setFlash] = useState<string | null>(null);

  const open = (next: Tab) => {
    setTab(next);
    setFlash(null);
  };
  const done = (day: string, message: string) => {
    setDate(day);
    setTab('schedule');
    setFlash(message);
  };

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <header>
        <div className="font-semibold">{me.dentist.fullName}</div>
        <div className="text-sm text-hint">{me.clinic.name}</div>
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
      {tab === 'schedule' && (
        <SchedulePage
          date={date}
          onDate={(day) => {
            setDate(day);
            setFlash(null);
          }}
        />
      )}
      {tab === 'block' && <BlockPage date={date} onDone={done} />}
      {tab === 'book' && <BookPage date={date} onDone={done} />}
    </div>
  );
}
