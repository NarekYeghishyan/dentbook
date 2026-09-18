/**
 * Капча перед отправкой SMS-кода (Шаг 6, Q5 — Cloudflare Turnstile): SMS платные, форму
 * без капчи используют для рассылки кодов на чужие номера.
 */
export interface CaptchaVerifier {
  /** Site key для виджета — отдаётся в GET /v1/public/config. */
  readonly siteKey: string;
  /** true — токен настоящий и одноразовый; сетевые сбои — исключение. */
  verify(token: string, remoteIp: string): Promise<boolean>;
}

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export class TurnstileVerifier implements CaptchaVerifier {
  constructor(
    readonly siteKey: string,
    private readonly secret: string,
  ) {}

  async verify(token: string, remoteIp: string): Promise<boolean> {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body: new URLSearchParams({ secret: this.secret, response: token, remoteip: remoteIp }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Turnstile siteverify responded ${res.status}`);
    const body = (await res.json()) as { success?: boolean };
    return body.success === true;
  }
}
