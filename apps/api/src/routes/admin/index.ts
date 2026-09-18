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
}

export const adminRoutes: FastifyPluginAsync<AdminRoutesOptions> = async (app, opts) => {
  const { db } = opts;
  await app.register(authRoutes, {
    prefix: '/auth',
    db,
    rateLimitPerMin: opts.authRateLimitPerMin,
  });

  await app.register(async (clinicScope) => {
    clinicScope.addHook('onRequest', clinicScope.authenticate);
    await clinicScope.register(meRoutes, { db });
    await clinicScope.register(clinicRoutes, { prefix: '/clinic', db });
    await clinicScope.register(userRoutes, { prefix: '/users', db });
    await clinicScope.register(locationRoutes, { prefix: '/locations', db });
    await clinicScope.register(serviceRoutes, { prefix: '/services', db });
    await clinicScope.register(dentistRoutes, { prefix: '/dentists', db });
    await clinicScope.register(availabilityRoutes, { prefix: '/availability', db });
  });
};
