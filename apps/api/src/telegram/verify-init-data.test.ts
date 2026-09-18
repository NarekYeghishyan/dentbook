import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InitDataError, verifyInitData } from './verify-init-data.js';

const BOT_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const NOW = new Date('2030-01-01T12:00:00Z');
const nowSec = NOW.getTime() / 1000;
const user = { id: 424242, first_name: 'Anna', language_code: 'en' };

/** initData так, как её подписывает Telegram (https://core.telegram.org/bots/webapps). */
function sign(fields: Record<string, string>, token = BOT_TOKEN): string {
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const fields = (overrides: Record<string, string> = {}) => ({
  query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
  user: JSON.stringify(user),
  auth_date: String(nowSec - 60),
  signature: 'ed25519-signature-is-part-of-the-hmac',
  ...overrides,
});

describe('verifyInitData (CLAUDE.md §8)', () => {
  it('accepts data signed by the bot and returns the Telegram user', () => {
    const result = verifyInitData(sign(fields()), BOT_TOKEN, { now: NOW });
    expect(result.user).toEqual(user);
    expect(result.authDate).toEqual(new Date((nowSec - 60) * 1000));
  });

  it('rejects a forged signature: the user id was swapped after signing', () => {
    const signed = new URLSearchParams(sign(fields()));
    signed.set('user', JSON.stringify({ ...user, id: 1 }));
    expect(() => verifyInitData(signed.toString(), BOT_TOKEN, { now: NOW })).toThrow(InitDataError);
  });

  it('rejects data signed for another bot', () => {
    const foreign = sign(fields(), '987654321:ZZZ-other-bot-token');
    expect(() => verifyInitData(foreign, BOT_TOKEN, { now: NOW })).toThrow('bad signature');
  });

  it('rejects a made-up hash and a missing hash', () => {
    const signed = new URLSearchParams(sign(fields()));
    signed.set('hash', 'a'.repeat(64));
    expect(() => verifyInitData(signed.toString(), BOT_TOKEN, { now: NOW })).toThrow(
      'bad signature',
    );
    signed.delete('hash');
    expect(() => verifyInitData(signed.toString(), BOT_TOKEN, { now: NOW })).toThrow('no hash');
  });

  it('rejects data older than an hour, however well signed', () => {
    const stale = sign(fields({ auth_date: String(nowSec - 3601) }));
    expect(() => verifyInitData(stale, BOT_TOKEN, { now: NOW })).toThrow('expired');
    const hourOld = sign(fields({ auth_date: String(nowSec - 3599) }));
    expect(verifyInitData(hourOld, BOT_TOKEN, { now: NOW }).user.id).toBe(user.id);
  });

  it('rejects data from the future beyond clock skew', () => {
    const future = sign(fields({ auth_date: String(nowSec + 600) }));
    expect(() => verifyInitData(future, BOT_TOKEN, { now: NOW })).toThrow('expired');
  });

  it('rejects signed data without a user', () => {
    const { user: _user, ...withoutUser } = fields();
    expect(() => verifyInitData(sign(withoutUser), BOT_TOKEN, { now: NOW })).toThrow('no user');
  });
});
