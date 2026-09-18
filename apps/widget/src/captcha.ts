/**
 * Cloudflare Turnstile (Q5): скрипт грузится с Cloudflare, только если капча включена в
 * GET /config, — в бюджет 50 КБ не входит.
 */

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<TurnstileApi> | undefined;

function load(): Promise<TurnstileApi> {
  loading ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile'));
    script.onerror = () => reject(new Error('turnstile'));
    document.head.append(script);
  });
  return loading;
}

export interface Captcha {
  /** Токен пройденной проверки; одноразовый — после отправки кода сбрасывается. */
  token(): string | undefined;
  reset(): void;
}

export function renderCaptcha(container: HTMLElement, siteKey: string, language: string): Captcha {
  let current: string | undefined;
  let widgetId: string | undefined;
  void load().then((turnstile) => {
    widgetId = turnstile.render(container, {
      sitekey: siteKey,
      language,
      callback: (token: string) => (current = token),
      'expired-callback': () => (current = undefined),
      'error-callback': () => (current = undefined),
    });
  });
  return {
    token: () => current,
    reset() {
      current = undefined;
      if (widgetId !== undefined) window.turnstile?.reset(widgetId);
    },
  };
}
