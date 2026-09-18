import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@dentbook/db';
import { buildApp } from '../src/app.js';
import { testEnv } from './helpers.js';

let root: string;
let app: FastifyInstance;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'dentbook-admin-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(root, 'assets', 'index-abc123.js'), 'console.log(1)');
  // Раздача статики к БД не обращается
  app = buildApp({
    env: testEnv({ ADMIN_DIST_DIR: root, MINIAPP_DIST_DIR: root }),
    db: {} as Database,
    logger: false,
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('admin static files', () => {
  it('serves the app shell with security headers and no caching', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('id="root"');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('answers client-side routes with the app shell', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/dentists/123' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('id="root"');
  });

  it('caches hashed assets for a year', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/assets/index-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('redirects /admin to /admin/', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/admin/');
  });

  it('does not serve files outside the build', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/../package.json' });
    expect(res.body).not.toContain('"name"');
  });

  it('lets Telegram frame the Mini App and load its script, unlike the admin panel', async () => {
    const res = await app.inject({ method: 'GET', url: '/miniapp/schedule' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain(
      "script-src 'self' https://telegram.org",
    );
    expect(res.headers['content-security-policy']).toContain(
      'frame-ancestors https://web.telegram.org',
    );
  });

  it('keeps API routes and their errors intact', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/admin/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
});
