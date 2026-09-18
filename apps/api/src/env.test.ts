import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const required = {
  DATABASE_URL: 'postgres://localhost/dentbook',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(32),
};

describe('loadEnv (CLAUDE.md §9)', () => {
  it('applies defaults', () => {
    expect(loadEnv(required)).toMatchObject({
      NODE_ENV: 'development',
      API_PORT: 3000,
      JWT_ACCESS_TTL: 43_200,
      AUTH_RATE_LIMIT: 10,
    });
  });

  it('treats empty values as unset, like a fresh copy of .env.example', () => {
    const env = loadEnv({ ...required, JWT_ACCESS_TTL: '', API_PORT: '', ADMIN_DIST_DIR: '' });
    expect(env.JWT_ACCESS_TTL).toBe(43_200);
    expect(env.API_PORT).toBe(3000);
    expect(env.ADMIN_DIST_DIR).toBeUndefined();
  });

  it('fails on a missing or short secret, naming the variable but not its value', () => {
    expect(() => loadEnv({ ...required, JWT_SECRET: 'short-secret' })).toThrow(
      'Invalid environment configuration: JWT_SECRET',
    );
    expect(() => loadEnv({ REDIS_URL: 'redis://x', JWT_SECRET: 'x'.repeat(32) })).toThrow(
      /DATABASE_URL/,
    );
  });
});
