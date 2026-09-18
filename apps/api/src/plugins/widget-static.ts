/**
 * Бандл формы записи для сайтов клиник: /widget/dentbook-widget.js (Шаг 6).
 * Адрес постоянный — его вставляют в HTML сайта, поэтому кеш короткий: обновление
 * виджета доходит до клиентов за минуты. Скрипт подключают чужие сайты — политика
 * ресурсов разрешает загрузку с любого Origin.
 * TODO(Шаг 10): отдавать через nginx или CDN.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync } from 'fastify';

export const WIDGET_FILE = 'dentbook-widget.js';

export const widgetStatic: FastifyPluginAsync<{ root: string }> = async (app, { root }) => {
  if (!existsSync(join(root, WIDGET_FILE))) {
    app.log.warn({ root }, 'widget build not found, /widget is not served');
    return;
  }
  await app.register(fastifyStatic, {
    root,
    prefix: '/widget/',
    // @fastify/static уже зарегистрирован для админки — reply.sendFile там
    decorateReply: false,
    wildcard: false,
    index: false,
    setHeaders(res) {
      res.header('cache-control', 'public, max-age=300');
      res.header('cross-origin-resource-policy', 'cross-origin');
      res.header('access-control-allow-origin', '*');
    },
  });
};
