/** Филиалы клиники (в интерфейсе — «office»). Удаления нет: филиал отключается. */
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { locations, type Database } from '@dentbook/db';
import { createLocationSchema, updateLocationSchema, type Location } from '@dentbook/shared';
import { notFound, parse } from '../../lib/errors.js';
import { idOf } from '../../lib/params.js';
import { authOf, MANAGERS } from '../../plugins/session.js';
import type { SlotCache } from '../../services/slot-cache.js';

const columns = {
  id: locations.id,
  name: locations.name,
  address: locations.address,
  phone: locations.phone,
  timezone: locations.timezone,
  isActive: locations.isActive,
  sortOrder: locations.sortOrder,
};

export const locationRoutes: FastifyPluginAsync<{ db: Database; cache?: SlotCache }> = async (
  app,
  { db, cache },
) => {
  const scoped = (clinicId: string, id: string) =>
    and(eq(locations.id, id), eq(locations.clinicId, clinicId));

  app.get('', async (request): Promise<Location[]> => {
    return db
      .select(columns)
      .from(locations)
      .where(eq(locations.clinicId, authOf(request).clinicId))
      .orderBy(asc(locations.sortOrder), asc(locations.name));
  });

  app.get('/:id', async (request): Promise<Location> => {
    const [row] = await db
      .select(columns)
      .from(locations)
      .where(scoped(authOf(request).clinicId, idOf(request)));
    if (!row) throw notFound();
    return row;
  });

  app.post('', { config: MANAGERS }, async (request, reply) => {
    const input = parse(createLocationSchema, request.body);
    const [row] = await db
      .insert(locations)
      .values({ ...input, clinicId: authOf(request).clinicId })
      .returning(columns);
    return reply.status(201).send(row);
  });

  app.patch('/:id', { config: MANAGERS }, async (request): Promise<Location> => {
    const { clinicId } = authOf(request);
    const input = parse(updateLocationSchema, request.body);
    const where = scoped(clinicId, idOf(request));
    const [row] =
      Object.keys(input).length > 0
        ? await db.update(locations).set(input).where(where).returning(columns)
        : await db.select(columns).from(locations).where(where);
    if (!row) throw notFound();
    // Пояс филиала, длительность или видимость услуги меняют слоты всей клиники
    await cache?.invalidateClinic(clinicId);
    return row;
  });
};
