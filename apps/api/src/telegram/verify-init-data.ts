/**
 * Проверка initData Mini App (CLAUDE.md §8, https://core.telegram.org/bots/webapps):
 * подпись HMAC-SHA256 с секретом HMAC('WebAppData', BOT_TOKEN) и свежесть auth_date —
 * не старше часа. Без обеих проверок любой мог бы назваться чужим врачом.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramWebAppUser {
  /** В личном чате с ботом user.id = chat.id — по нему находится врач (dentists.telegram_chat_id). */
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface VerifiedInitData {
  user: TelegramWebAppUser;
  authDate: Date;
}

export class InitDataError extends Error {
  constructor(reason: string) {
    super(`Invalid Mini App init data: ${reason}`);
    this.name = 'InitDataError';
  }
}

/** Не старше часа (§8). */
export const INIT_DATA_MAX_AGE_SEC = 60 * 60;
/** Часы клиента и сервера расходятся — небольшой запас «из будущего». */
const CLOCK_SKEW_SEC = 60;

export function verifyInitData(
  initData: string,
  botToken: string,
  options: { now?: Date; maxAgeSec?: number } = {},
): VerifiedInitData {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) throw new InitDataError('no hash');
  params.delete('hash');

  // Все поля, кроме hash (signature — входит), по алфавиту, через перевод строки
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex')))
    throw new InitDataError('bad signature');

  const authDate = Number(params.get('auth_date'));
  if (!Number.isInteger(authDate) || authDate <= 0) throw new InitDataError('no auth_date');
  const nowSec = (options.now ?? new Date()).getTime() / 1000;
  const age = nowSec - authDate;
  if (age > (options.maxAgeSec ?? INIT_DATA_MAX_AGE_SEC) || age < -CLOCK_SKEW_SEC) {
    throw new InitDataError('expired');
  }

  let user: unknown;
  try {
    user = JSON.parse(params.get('user') ?? 'null');
  } catch {
    throw new InitDataError('bad user');
  }
  if (
    typeof user !== 'object' ||
    user === null ||
    !Number.isSafeInteger((user as { id?: unknown }).id)
  ) {
    throw new InitDataError('no user');
  }
  return { user: user as TelegramWebAppUser, authDate: new Date(authDate * 1000) };
}
