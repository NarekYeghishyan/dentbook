import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true);
    expect(await verifyPassword('correct-horse-batterY', hash)).toBe(false);
  });

  it('salts every hash', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$/);
  });

  it.each(['', 'bcrypt$x', 'scrypt$32768$8$1$', 'scrypt$x$y$z$c2FsdA==$aGFzaA=='])(
    'treats a malformed stored hash %j as a mismatch',
    async (stored) => {
      expect(await verifyPassword('anything', stored)).toBe(false);
    },
  );
});
