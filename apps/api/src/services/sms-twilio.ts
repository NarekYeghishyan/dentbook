/**
 * SMS через Twilio Programmable Messaging (Q5: клиенты в США). REST без SDK: один запрос.
 * Отправитель — номер в E.164 или Messaging Service SID (MG…): для 10DLC в США обычно
 * второе.
 */
import type { SmsSender } from './sms.js';

export interface TwilioOptions {
  accountSid: string;
  authToken: string;
  /** '+1…' — номер отправителя, 'MG…' — Messaging Service. */
  sender: string;
}

export class TwilioSmsSender implements SmsSender {
  constructor(private readonly options: TwilioOptions) {}

  async send(message: { to: string; text: string }): Promise<void> {
    const { accountSid, authToken, sender } = this.options;
    const form = new URLSearchParams({ To: message.to, Body: message.text });
    form.set(sender.startsWith('MG') ? 'MessagingServiceSid' : 'From', sender);
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        },
        body: form,
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      // В тексте ошибки Twilio бывает номер получателя — наружу только код (§2.6)
      const body = (await res.json().catch(() => ({}))) as { code?: number };
      throw new Error(`Twilio responded ${res.status}, code ${body.code ?? 'unknown'}`);
    }
  }
}
