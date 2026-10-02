/**
 * Форма во всплывающем окне (data-mode="popup"): кнопки сайта с классом dentbook-open
 * открывают её поверх страницы. Окно — нативный <dialog> в Shadow DOM формы: showModal()
 * сам даёт затемнение, Esc, удержание фокуса внутри окна и возврат фокуса на кнопку сайта.
 */

import { POPUP_TRIGGER_CLASS } from '@dentbook/shared/domain';

/** Какие элементы сайта открывают окно, если в коде нет data-trigger. */
export const DEFAULT_TRIGGER = `.${POPUP_TRIGGER_CLASS}`;

export interface Popup {
  dialog: HTMLDialogElement;
  open(): void;
  /** Подписи окна и крестика — на языке формы, а он известен только после /config. */
  label(title: string, close: string): void;
}

/** Окно вокруг формы `view`; крестик встаёт в её начало, экраны формы идут после него. */
export function createPopup(view: HTMLElement): Popup {
  const dialog = document.createElement('dialog');
  dialog.className = 'pop';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.textContent = '×';
  close.addEventListener('click', () => dialog.close());
  const top = document.createElement('div');
  top.className = 'top';
  top.append(close);
  view.append(top);
  dialog.append(view);

  // Клик по затемнению закрывает окно. Нажатие должно и начаться на нём: выделение текста
  // в форме, отпущенное за её краем, окно не закрывает
  let pressedOutside = false;
  dialog.addEventListener('pointerdown', (e) => (pressedOutside = e.target === dialog));
  dialog.addEventListener('click', (e) => {
    if (pressedOutside && e.target === dialog) dialog.close();
  });

  // Страница под открытым окном не прокручивается
  const page = document.documentElement;
  let overflow = '';
  dialog.addEventListener('close', () => (page.style.overflow = overflow));

  return {
    dialog,
    open() {
      if (dialog.open) return;
      overflow = page.style.overflow;
      page.style.overflow = 'hidden';
      dialog.showModal();
    },
    label(title, text) {
      dialog.setAttribute('aria-label', title);
      close.setAttribute('aria-label', text);
      close.title = text;
    },
  };
}

/**
 * Окно открывают клики по элементам `selector`. Слушаем документ, а не сами кнопки: так
 * работают и кнопки, которые сайт добавит позже (меню, всплывающие блоки конструкторов).
 */
export function openOnClick(selector: string, open: () => void): void {
  // Опечатка в data-trigger: кнопки просто не откроют окно, а не бросают ошибку на каждый клик
  try {
    document.querySelector(selector);
  } catch {
    return;
  }
  document.addEventListener('click', (e) => {
    if (!(e.target instanceof Element) || !e.target.closest(selector)) return;
    // Ссылка href="#" не прыгает наверх, кнопка внутри формы сайта её не отправляет
    e.preventDefault();
    open();
  });
}
