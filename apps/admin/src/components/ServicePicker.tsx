/**
 * Выбор услуги с поиском: кнопка с выбранной услугой и выпадающий список по категориям.
 * Услуг в каталоге десятки — в обычном select их не найти. Разметка — combobox с listbox
 * (ARIA), список доступен с клавиатуры: ↑ ↓ Enter Esc.
 */
import { useId, useRef, useState } from 'react';
import { formatPrice, groupServices } from '@dentbook/shared/service-search';
import { useSession } from './Layout';
import { useI18n } from '../i18n';

export interface PickerService {
  id: string;
  name: string;
  category: string | null;
  price?: string | null;
  insurancePrice?: string | null;
}

export function ServicePicker({
  services,
  value,
  onChange,
  disabled,
}: {
  services: readonly PickerService[];
  value: string;
  onChange(id: string): void;
  disabled?: boolean;
}) {
  const { t, locale } = useI18n();
  const { clinic } = useSession();
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const groups = groupServices(services, query);
  const shown = groups.flatMap((g) => g.items);
  const selected = services.find((s) => s.id === value);
  /** «Cash $120 · Insurance $200»; пусто, если цен нет. */
  const prices = (s: PickerService | undefined) =>
    [
      s?.price ? `${t('services.cash')} ${formatPrice(s.price, clinic.currency, locale)}` : '',
      s?.insurancePrice
        ? `${t('services.insurance')} ${formatPrice(s.insurancePrice, clinic.currency, locale)}`
        : '',
    ]
      .filter(Boolean)
      .join(' · ');

  function show() {
    setQuery('');
    setActive(
      Math.max(
        0,
        services.findIndex((s) => s.id === value),
      ),
    );
    setOpen(true);
    requestAnimationFrame(() => search.current?.focus());
  }
  function close(toButton: boolean) {
    setOpen(false);
    if (toButton) button.current?.focus();
  }
  function pick(id: string) {
    onChange(id);
    close(true);
  }
  function keys(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length > 0) {
        setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault(); // Enter в поиске не отправляет форму
      const current = shown[active];
      if (current) pick(current.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // не закрывать окно, в котором стоит список
      close(true);
    }
  }

  let index = -1;
  return (
    <div
      ref={box}
      className="relative"
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('field.service')}
        onClick={() => (open ? close(false) : show())}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-left text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-100"
      >
        <span className="truncate">{selected?.name ?? t('common.choose')}</span>
        <span aria-hidden="true" className="text-xs text-slate-500">
          ▾
        </span>
      </button>
      {!open && prices(selected) && (
        <p className="mt-1 text-xs text-slate-600">{prices(selected)}</p>
      )}
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg">
          <input
            ref={search}
            type="text"
            role="combobox"
            autoComplete="off"
            spellCheck={false}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={shown[active] ? `${listId}-${shown[active].id}` : undefined}
            aria-label={t('services.search')}
            placeholder={t('services.search')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={keys}
            className="m-2 w-[calc(100%-1rem)] rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
          />
          <div id={listId} role="listbox" className="max-h-64 overflow-y-auto pb-1">
            {groups.map((group) => (
              <div key={group.category ?? ''} role="group" aria-label={group.category ?? undefined}>
                {(group.category !== null || groups.length > 1) && (
                  <p className="sticky top-0 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {group.category ?? t('services.noCategory')}
                  </p>
                )}
                {group.items.map((s) => {
                  index += 1;
                  const at = index;
                  return (
                    <div
                      key={s.id}
                      id={`${listId}-${s.id}`}
                      role="option"
                      aria-selected={s.id === value}
                      ref={(el) => {
                        if (el && at === active) el.scrollIntoView({ block: 'nearest' });
                      }}
                      // mousedown не даём: фокус должен остаться в поле поиска
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(s.id)}
                      className={`cursor-pointer px-3 py-1.5 text-sm ${
                        at === active ? 'bg-teal-50' : ''
                      } ${s.id === value ? 'font-semibold' : ''}`}
                    >
                      <div>{s.name}</div>
                      {prices(s) && <div className="text-xs text-slate-500">{prices(s)}</div>}
                    </div>
                  );
                })}
              </div>
            ))}
            {shown.length === 0 && (
              <p className="px-3 py-2 text-sm text-slate-500">{t('services.noMatch')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
