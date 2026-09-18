/** Внешние провайдеры по переменным окружения (Q5): SMS и капча. */
import { TwilioSmsSender, type SmsSender } from '@dentbook/shared/sms';
import type { Env } from '../env.js';
import { TurnstileVerifier, type CaptchaVerifier } from './captcha.js';

export function providersFromEnv(env: Env): { sms?: SmsSender; captcha?: CaptchaVerifier } {
  return {
    // Наличие ключей при SMS_PROVIDER и CAPTCHA_* проверяет loadEnv()
    ...(env.SMS_PROVIDER === 'twilio'
      ? {
          sms: new TwilioSmsSender({
            accountSid: env.TWILIO_ACCOUNT_SID!,
            authToken: env.TWILIO_AUTH_TOKEN!,
            sender: env.SMS_SENDER!,
          }),
        }
      : {}),
    ...(env.CAPTCHA_SECRET
      ? { captcha: new TurnstileVerifier(env.CAPTCHA_SITE_KEY!, env.CAPTCHA_SECRET) }
      : {}),
  };
}
