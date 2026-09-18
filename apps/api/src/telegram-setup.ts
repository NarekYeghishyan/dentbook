/**
 * Разовая настройка бота после выдачи токена или смены домена (deploy/README.md):
 *
 *   docker compose run --rm api node --import tsx apps/api/src/telegram-setup.ts
 */
import { Api } from 'grammy';
import { loadEnv } from './env.js';
import { setupBot } from './telegram/setup.js';

const env = loadEnv();
if (!env.TELEGRAM_BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN is not set');
}

const api = new Api(env.TELEGRAM_BOT_TOKEN);
const me = await api.getMe();
if (me.username !== env.TELEGRAM_BOT_USERNAME) {
  throw new Error(`TELEGRAM_BOT_USERNAME does not match the token: the bot is @${me.username}`);
}

const { webhookUrl, miniAppUrl } = await setupBot(api, {
  publicBaseUrl: env.PUBLIC_BASE_URL!,
  webhookSecret: env.TELEGRAM_WEBHOOK_SECRET!,
});
const info = await api.getWebhookInfo();

// Служебный вывод для того, кто запускает настройку; токенов и секретов в нём нет
process.stdout.write(`@${me.username}: webhook ${webhookUrl}, mini app ${miniAppUrl}\n`);
if (info.last_error_message) {
  process.stdout.write(`last webhook error: ${info.last_error_message}\n`);
}
