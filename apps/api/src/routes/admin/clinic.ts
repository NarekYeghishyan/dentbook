/** Текущий сотрудник и настройки его клиники. */
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { clinics, users, type Database } from '@dentbook/db';
import { updateClinicSchema, type MeResponse } from '@dentbook/shared';
import { notFound, parse } from '../../lib/errors.js';
import { authOf } from '../../plugins/session.js';
import { loadClinic, staffColumns, toStaffUser } from './mappers.js';

export const meRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.get('/me', async (request): Promise<MeResponse> => {
    const { userId, clinicId } = authOf(request);
    const [user] = await db
      .select(staffColumns)
      .from(users)
      .where(and(eq(users.id, userId), eq(users.clinicId, clinicId)));
    if (!user) throw notFound();
    return { user: toStaffUser(user), clinic: await loadClinic(db, clinicId) };
  });
};

export const clinicRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.get('', async (request) => loadClinic(db, authOf(request).clinicId));

  app.patch('', { config: { roles: ['owner', 'admin'] } }, async (request) => {
    const { clinicId } = authOf(request);
    const input = parse(updateClinicSchema, request.body);
    if (Object.keys(input).length > 0) {
      await db.update(clinics).set(input).where(eq(clinics.id, clinicId));
    }
    return loadClinic(db, clinicId);
  });
};
