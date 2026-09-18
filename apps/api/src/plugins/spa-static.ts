/**
 * Собранные SPA на том же домене, что и API (Q14): панель клиники на /admin/ и Mini App
 * врача на /miniapp/. Хешированные файлы кешируются на год, index.html — no-cache,
 * маршруты SPA отдают index.html. Заголовки безопасности — свои у каждого приложения.
 * TODO(Шаг 10): отдавать статику nginx'ом или CDN.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync } from 'fastify';

const csp = (...rules: string[]) =>
  [
    "default-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    ...rules,
  ].join('; ');

const COMMON = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' };

/** Панель: чужие фреймы запрещены. style-атрибуты ставит перетаскивание (dnd-kit). */
export const ADMIN_HEADERS = {
  ...COMMON,
  'content-security-policy': csp(
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "frame-ancestors 'none'",
  ),
  'x-frame-options': 'DENY',
};

/** Mini App: скрипт Telegram и встраивание в Telegram Web (web.telegram.org). */
export const MINIAPP_HEADERS = {
  ...COMMON,
  'content-security-policy': csp(
    "script-src 'self' https://telegram.org",
    "style-src 'self' 'unsafe-inline'",
    'frame-ancestors https://web.telegram.org https://*.telegram.org',
  ),
};

export interface SpaStaticOptions {
  root: string;
  /** '/admin/' — со слешем на конце. Не `prefix`: это имя у register() занято Fastify. */
  basePath: string;
  headers: Record<string, string>;
}

export const spaStatic: FastifyPluginAsync<SpaStaticOptions> = async (
  app,
  { root, basePath: prefix, headers },
) => {
  if (!existsSync(join(root, 'index.html'))) {
    app.log.warn({ root, prefix }, 'build not found, not served');
    return;
  }
  const bare = prefix.replace(/\/$/, '');

  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith(prefix) || request.url === bare) reply.headers(headers);
  });

  await app.register(fastifyStatic, {
    root,
    prefix,
    // Маршруты только для существующих файлов; остальное — index.html ниже
    wildcard: false,
    index: false,
    setHeaders(res, path) {
      // Файлы в assets/ с хешем в имени не меняются; index.html перечитывается всегда
      res.header(
        'cache-control',
        path.includes(join('assets', '')) ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });

  app.get(bare, (_request, reply) => reply.redirect(prefix));
  // Маршруты SPA (/admin/dentists/…) обрабатывает клиентский роутер
  app.get(`${prefix}*`, (_request, reply) =>
    reply.header('cache-control', 'no-cache').sendFile('index.html'),
  );
};
