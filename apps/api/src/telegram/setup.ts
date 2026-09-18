/**
 * Настройка бота на стороне Telegram (§8): вебхук с секретом, кнопка меню → Mini App,
 * команда /start. Повторный запуск безопасен — вызовы идемпотентны.
 */
import type { Api } from 'grammy';
import { LOCALES } from '@dentbook/shared/domain';
import { translate } from '../i18n/index.js';

/** Какие обновления нужны боту: /start и кнопки под алертами. */
export const ALLOWED_UPDATES = ['message', 'callback_query'] as const;

export interface BotSetup {
  publicBaseUrl: string;
  webhookSecret: string;
}

type SetupApi = Pick<Api, 'setWebhook' | 'setChatMenuButton' | 'setMyCommands'>;

export async function setupBot(api: SetupApi, { publicBaseUrl, webhookSecret }: BotSetup) {
  const webhookUrl = new URL('/telegram/webhook', publicBaseUrl).toString();
  const miniAppUrl = new URL('/miniapp/', publicBaseUrl).toString();

  await api.setWebhook(webhookUrl, {
    secret_token: webhookSecret,
    allowed_updates: [...ALLOWED_UPDATES],
  });
  // Текст кнопки меню у Telegram один на всех — базовый язык (§9)
  await api.setChatMenuButton({
    menu_button: {
      type: 'web_app',
      text: translate('en', 'tg.menuButton'),
      web_app: { url: miniAppUrl },
    },
  });
  for (const locale of LOCALES) {
    const commands = [{ command: 'start', description: translate(locale, 'tg.cmdStart') }];
    // Английский — вариант по умолчанию для всех языков без своего перевода
    await api.setMyCommands(commands, locale === 'en' ? {} : { language_code: locale });
  }
  return { webhookUrl, miniAppUrl };
}
