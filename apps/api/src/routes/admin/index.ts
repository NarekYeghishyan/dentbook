/**
 * Админский API /v1/admin (CLAUDE.md §7).
 *
 * Изоляция тенантов (§2.2): всё, кроме /auth, живёт в области с хуком authenticate —
 * запрос без сессии сотрудника активной клиники до обработчика не доходит. Обработчик
 * берёт clinicId из request.auth и добавляет его в каждый запрос к данным; id сущности
 * из пути сам по себе ничего не открывает.
 */
import type { FastifyPluginAsync } from 'fastify';
import type { Database } from '@dentbook/db';
import type { SlotCache } from '../../services/slot-cache.js';
import { apiKeyRoutes } from './api-keys.js';
import { authRoutes } from './auth.js';
import { availabilityRoutes } from './availability.js';
import { clinicRoutes, meRoutes } from './clinic.js';
import { dentistRoutes } from './dentists.js';
import { locationRoutes } from './locations.js';
import { serviceRoutes } from './services.js';
import { userRoutes } from './users.js';

export interface AdminRoutesOptions {
  db: Database;
  authRateLimitPerMin: number;
  cache?: SlotCache;
}

export const adminRoutes: FastifyPluginAsync<AdminRoutesOptions> = async (app, opts) => {
  const { db } = opts;
  const withCache = opts.cache ? { db, cache: opts.cache } : { db };
  await app.register(authRoutes, {
    prefix: '/auth',
    db,
    rateLimitPerMin: opts.authRateLimitPerMin,
  });

  await app.register(async (clinicScope) => {
    clinicScope.addHook('onRequest', clinicScope.authenticate);
    await clinicScope.register(meRoutes, { db });
    await clinicScope.register(clinicRoutes, { prefix: '/clinic', ...withCache });
    await clinicScope.register(userRoutes, { prefix: '/users', db });
    await clinicScope.register(locationRoutes, { prefix: '/locations', ...withCache });
    await clinicScope.register(serviceRoutes, { prefix: '/services', ...withCache });
    await clinicScope.register(dentistRoutes, { prefix: '/dentists', ...withCache });
    await clinicScope.register(availabilityRoutes, { prefix: '/availability', ...withCache });
    await clinicScope.register(apiKeyRoutes, { prefix: '/api-keys', db });
  });
};
