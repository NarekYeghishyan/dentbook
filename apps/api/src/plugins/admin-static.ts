/**
 * Собранная админка на /admin/ того же домена, что и API (Q14): cookie сессии без CORS.
 * TODO(Шаг 10): отдавать статику nginx'ом или CDN — сейчас её раздаёт процесс API,
 * для панели одной клиники этого хватает.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync } from 'fastify';

const PREFIX = '/admin/';

/** Заголовки для страниц админки: никаких чужих скриптов и фреймов. */
const SECURITY_HEADERS = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    // style-атрибуты ставит перетаскивание (dnd-kit)
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
};

export const adminStatic: FastifyPluginAsync<{ root: string }> = async (app, { root }) => {
  if (!existsSync(join(root, 'index.html'))) {
    app.log.warn({ root }, 'admin build not found, /admin is not served');
    return;
  }

  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith(PREFIX) || request.url === '/admin') reply.headers(SECURITY_HEADERS);
  });

  await app.register(fastifyStatic, {
    root,
    prefix: PREFIX,
    // Маршруты только для существующих файлов; остальное — index.html ниже
    wildcard: false,
    index: false,
    setHeaders(res, path) {
      // Файлы в assets/ с хешем в имени не меняются; index.html перечитывается всегда
      res.header(
        'cache-control',
        path.includes(`${join('assets', '')}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });

  app.get('/admin', (_request, reply) => reply.redirect(PREFIX));
  // Маршруты SPA (/admin/dentists/…) обрабатывает React Router
  app.get(`${PREFIX}*`, (_request, reply) =>
    reply.header('cache-control', 'no-cache').sendFile('index.html'),
  );
};
