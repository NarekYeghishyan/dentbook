/**
 * Telegram WebApp (https://core.telegram.org/bots/webapps): скрипт telegram-web-app.js
 * подключён в index.html. Вне Telegram initData пустая — приложение просит открыть его
 * из бота.
 */

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: { language_code?: string } };
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  showConfirm(message: string, callback: (ok: boolean) => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const webApp = (): TelegramWebApp | undefined => window.Telegram?.WebApp;

export const initData = (): string => webApp()?.initData ?? '';

/** Подтверждение — нативным окном Telegram, в браузере — обычным confirm. */
export function confirmAction(message: string): Promise<boolean> {
  const app = webApp();
  if (!app?.initData) return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => app.showConfirm(message, resolve));
}
