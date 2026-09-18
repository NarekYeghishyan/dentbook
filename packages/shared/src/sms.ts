/**
 * Отправка SMS (Q5: клиенты в США — Twilio). Общая для API (коды подтверждения — сразу,
 * клиент ждёт) и worker'а (уведомления и напоминания — из очереди с повторами). Только
 * Node: модуль не входит в бандлы фронтендов.
 */

export interface SmsSender {
  /** to — E.164. Текст не логируется: в нём код, имя клиники, время визита (§2.6). */
  send(message: { to: string; text: string }): Promise<{ id: string }>;
}

/**
 * Отказ провайдера. permanent — повтор не поможет (неверный номер, отписка, ошибка
 * настройки); иначе — перегрузка или сбой сети, повторять с паузой.
 */
export class SmsError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: number | null,
    readonly permanent: boolean,
  ) {
    super(status === null ? 'SMS provider unreachable' : `SMS provider responded ${status}`);
    this.name = 'SmsError';
  }

  /** Для notifications.last_error: только код, без ПДн. */
  get label(): string {
    return this.status === null ? 'network' : `sms_${this.status}_${this.code ?? 'unknown'}`;
  }
}

export interface TwilioOptions {
  accountSid: string;
  authToken: string;
  /** '+1…' — номер отправителя, 'MG…' — Messaging Service (для 10DLC в США обычно он). */
  sender: string;
}

/** Twilio Programmable Messaging через REST, без SDK: один запрос. */
export class TwilioSmsSender implements SmsSender {
  constructor(private readonly options: TwilioOptions) {}

  async send(message: { to: string; text: string }): Promise<{ id: string }> {
    const { accountSid, authToken, sender } = this.options;
    const form = new URLSearchParams({ To: message.to, Body: message.text });
    form.set(sender.startsWith('MG') ? 'MessagingServiceSid' : 'From', sender);
    let res: Response;
    try {
      res = await fetch(
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
    } catch {
      throw new SmsError(null, null, false);
    }
    // В тексте ошибки Twilio бывает номер получателя — наружу только код (§2.6)
    const body = (await res.json().catch(() => ({}))) as { sid?: string; code?: number };
    if (!res.ok) {
      const retry = res.status === 429 || res.status >= 500;
      throw new SmsError(res.status, body.code ?? null, !retry);
    }
    return { id: body.sid ?? '' };
  }
}
