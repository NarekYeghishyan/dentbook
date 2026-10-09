/**
 * Выбор услуги с поиском: кнопка с выбранной услугой и список по категориям под ней.
 * Услуг в каталоге десятки — в обычном select их не найти. Список открывается в потоке
 * страницы, а не поверх неё: в Telegram на телефоне выпадающий слой обрезается экраном.
 * Размер шрифта поиска — 16 px: на iPhone меньший заставляет страницу приближаться.
 */
import { useId, useRef, useState } from 'react';
import { formatPrice, groupServices } from '@dentbook/shared/service-search';
import { useSession } from './context';

export interface PickerService {
  id: string;
  name: string;
  category: string | null;
  durationMin?: number;
  price?: string | null;
  insurancePrice?: string | null;
}

export function ServicePicker({
  services,
  value,
  onChange,
}: {
  services: readonly PickerService[];
  value: string;
  onChange(id: string): void;
}) {
  const { t, me, locale } = useSession();
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const groups = groupServices(services, query);
  const shown = groups.flatMap((g) => g.items);
  const selected = services.find((s) => s.id === value);
  const minutes = (s: PickerService) =>
    s.durationMin === undefined ? '' : t('book.duration', { min: s.durationMin });

  /** «Cash $120 · Insurance $200»; пусто, если цен нет. */
  const prices = (s: PickerService | undefined) =>
    [
      s?.price ? `${t('book.cash')} ${formatPrice(s.price, me.clinic.currency, locale)}` : '',
      s?.insurancePrice
        ? `${t('book.insurance')} ${formatPrice(s.insurancePrice, me.clinic.currency, locale)}`
        : '',
    ]
      .filter(Boolean)
      .join(' · ');

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    button.current?.focus();
  }

  return (
    <div ref={box} className="space-y-2">
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('book.service')}
        onClick={() => {
          setQuery('');
          setOpen((v) => !v);
          if (!open) requestAnimationFrame(() => search.current?.focus());
        }}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-hint/30 bg-bg px-3 py-2 text-left text-fg"
      >
        <span className="min-w-0 truncate">
          {selected ? `${selected.name}${minutes(selected) && ` · ${minutes(selected)}`}` : '—'}
        </span>
        <span aria-hidden="true" className="text-hint">
          ▾
        </span>
      </button>
      {!open && prices(selected) && <p className="text-sm text-hint">{prices(selected)}</p>}
      {open && (
        <div className="rounded-lg border border-hint/30 bg-bg">
          <input
            ref={search}
            type="search"
            role="combobox"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label={t('book.serviceSearch')}
            placeholder={t('book.serviceSearch')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault(); // Enter в поиске не отправляет форму
                if (shown.length === 1) pick(shown[0]!.id);
              }
            }}
            className="m-2 w-[calc(100%-1rem)] rounded-lg border border-hint/30 bg-bg px-3 py-2 text-base text-fg"
          />
          <div id={listId} role="listbox" className="max-h-[50vh] overflow-y-auto pb-1">
            {groups.map((group) => (
              <div key={group.category ?? ''} role="group" aria-label={group.category ?? undefined}>
                {(group.category !== null || groups.length > 1) && (
                  <p className="sticky top-0 bg-card px-3 py-1 text-xs font-semibold uppercase text-hint">
                    {group.category ?? t('book.noCategory')}
                  </p>
                )}
                {group.items.map((s) => (
                  <div
                    key={s.id}
                    role="option"
                    aria-selected={s.id === value}
                    // mousedown не даём: фокус и клавиатура остаются в поле поиска
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(s.id)}
                    className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 py-2 ${
                      s.id === value ? 'font-semibold' : ''
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block">{s.name}</span>
                      {prices(s) && <span className="block text-sm text-hint">{prices(s)}</span>}
                    </span>
                    <span className="shrink-0 text-sm text-hint">{minutes(s)}</span>
                  </div>
                ))}
              </div>
            ))}
            {shown.length === 0 && <p className="px-3 py-2 text-hint">{t('book.serviceNone')}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
