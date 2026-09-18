/**
 * Встраивание формы записи на сайт клиники:
 *
 *   <div id="dentbook-booking"></div>
 *   <script src="https://…/widget/dentbook-widget.js" data-key="pk_…"
 *           data-target="#dentbook-booking" async></script>
 *
 * data-key — ключ из панели («Сайт»), data-target — куда встроить (иначе — сразу после
 * скрипта), data-locale — en | ru | hy (иначе — язык из настроек клиники). Адрес API —
 * origin самого скрипта. Вручную: DentBook.mount(element, { key, apiBase }).
 */
import { mountWidget } from './app';
import { isLocale } from './i18n';

export { mountWidget as mount };

// currentScript есть только во время синхронного выполнения скрипта — берём сразу
const script = document.currentScript as HTMLScriptElement | null;

function boot(): void {
  if (!script?.dataset.key) return;
  const { key, target, locale, api } = script.dataset;
  let host = target ? document.querySelector<HTMLElement>(target) : null;
  if (!host) {
    host = document.createElement('div');
    script.after(host);
  }
  mountWidget(host, {
    key,
    apiBase: api ?? new URL(script.src).origin,
    locale: isLocale(locale) ? locale : undefined,
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
