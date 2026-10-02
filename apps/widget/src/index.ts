/**
 * Встраивание формы записи на сайт клиники. Форма прямо на странице:
 *
 *   <div id="dentbook-booking"></div>
 *   <script src="https://…/widget/dentbook-widget.js" data-key="pk_…"
 *           data-target="#dentbook-booking" async></script>
 *
 * или во всплывающем окне — по клику на кнопки сайта с классом dentbook-open:
 *
 *   <a href="#" class="dentbook-open">Book a visit</a>
 *   <script src="https://…/widget/dentbook-widget.js" data-key="pk_…"
 *           data-mode="popup" async></script>
 *
 * data-key — ключ из панели («Сайт»), data-target — куда встроить (иначе — сразу после
 * скрипта), data-mode="popup" — окно вместо формы на странице, data-trigger — CSS-селектор
 * кнопок, открывающих окно (иначе — .dentbook-open), data-locale — en | ru | hy (иначе —
 * язык из настроек клиники). Адрес API — origin самого скрипта. Вручную:
 * DentBook.mount(element, { key, apiBase, popup }) — у окна open() его открывает.
 */
import { mountWidget } from './app';
import { isLocale } from './i18n';
import { DEFAULT_TRIGGER, openOnClick } from './popup';

export { mountWidget as mount };

// currentScript есть только во время синхронного выполнения скрипта — берём сразу
const script = document.currentScript as HTMLScriptElement | null;

function boot(): void {
  if (!script?.dataset.key) return;
  const { key, target, locale, api, mode, trigger } = script.dataset;
  const options = {
    key,
    apiBase: api ?? new URL(script.src).origin,
    locale: isLocale(locale) ? locale : undefined,
  };
  if (mode === 'popup') {
    // Окну место на странице не нужно: оно открывается поверх неё
    const host = document.createElement('div');
    document.body.append(host);
    openOnClick(trigger || DEFAULT_TRIGGER, mountWidget(host, { ...options, popup: true }).open);
    return;
  }
  let host = target ? document.querySelector<HTMLElement>(target) : null;
  if (!host) {
    host = document.createElement('div');
    script.after(host);
  }
  mountWidget(host, options);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
