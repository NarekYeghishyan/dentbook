/** Услуги клиники. Удаления нет: на услугу ссылаются записи, она отключается. */
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { services, type Database } from '@dentbook/db';
import { createServiceSchema, updateServiceSchema, type Service } from '@dentbook/shared';
import { notFound, parse } from '../../lib/errors.js';
import { idOf } from '../../lib/params.js';
import { authOf, MANAGERS } from '../../plugins/session.js';
import type { SlotCache } from '../../services/slot-cache.js';

const columns = {
  id: services.id,
  name: services.name,
  description: services.description,
  durationMin: services.durationMin,
  bufferMin: services.bufferMin,
  price: services.price,
  isPublic: services.isPublic,
  isActive: services.isActive,
  sortOrder: services.sortOrder,
};

export const serviceRoutes: FastifyPluginAsync<{ db: Database; cache?: SlotCache }> = async (
  app,
  { db, cache },
) => {
  const scoped = (clinicId: string, id: string) =>
    and(eq(services.id, id), eq(services.clinicId, clinicId));

  app.get('', async (request): Promise<Service[]> => {
    return db
      .select(columns)
      .from(services)
      .where(eq(services.clinicId, authOf(request).clinicId))
      .orderBy(asc(services.sortOrder), asc(services.name));
  });

  app.get('/:id', async (request): Promise<Service> => {
    const [row] = await db
      .select(columns)
      .from(services)
      .where(scoped(authOf(request).clinicId, idOf(request)));
    if (!row) throw notFound();
    return row;
  });

  app.post('', { config: MANAGERS }, async (request, reply) => {
    const input = parse(createServiceSchema, request.body);
    const [row] = await db
      .insert(services)
      .values({ ...input, clinicId: authOf(request).clinicId })
      .returning(columns);
    return reply.status(201).send(row);
  });

  app.patch('/:id', { config: MANAGERS }, async (request): Promise<Service> => {
    const { clinicId } = authOf(request);
    const input = parse(updateServiceSchema, request.body);
    const where = scoped(clinicId, idOf(request));
    const [row] =
      Object.keys(input).length > 0
        ? await db.update(services).set(input).where(where).returning(columns)
        : await db.select(columns).from(services).where(where);
    if (!row) throw notFound();
    // Пояс филиала, длительность или видимость услуги меняют слоты всей клиники
    await cache?.invalidateClinic(clinicId);
    return row;
  });
};
