/**
 * Хеширование паролей сотрудников — scrypt из node:crypto, без нативных зависимостей.
 * Формат: scrypt$N$r$p$<соль base64>$<хеш base64> — параметры хранятся в строке,
 * их можно поднять позже без миграции.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  // scrypt берёт 128 * N * r байт (32 МБ при N = 2^15) — это впритык к лимиту
  // по умолчанию, поэтому лимит вдвое больше нужного
  const maxmem = 256 * (options.N ?? PARAMS.N) * (options.r ?? PARAMS.r);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { ...options, maxmem }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, n, r, p, salt, hash] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  try {
    const actual = await derive(password, Buffer.from(salt, 'base64'), {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    // Испорченные параметры в строке хеша — пароль не подходит
    return false;
  }
}

/**
 * Хеш, с которым сравнивается пароль несуществующего пользователя: вход по чужому email
 * занимает столько же времени, сколько по существующему, и не выдаёт, есть ли такой email.
 */
export const DUMMY_PASSWORD_HASH = await hashPassword(randomBytes(16).toString('hex'));
