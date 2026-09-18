/**
 * Публикуемые ключи pk_* для формы записи (§2.5, §7). Ключ живёт в HTML сайта клиники,
 * поэтому хранится открыто и показывается повторно. Защита — список разрешённых Origin.
 * Удаления нет: ключ отзывается и перестаёт работать сразу.
 */
import { randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { apiKeys, type Database } from '@dentbook/db';
import { createApiKeySchema, updateApiKeySchema, type ApiKey } from '@dentbook/shared';
import { notFound, parse } from '../../lib/errors.js';
import { idOf } from '../../lib/params.js';
import { authOf, MANAGERS } from '../../plugins/session.js';

const columns = {
  id: apiKeys.id,
  name: apiKeys.name,
  token: apiKeys.token,
  allowedOrigins: apiKeys.allowedOrigins,
  lastUsedAt: apiKeys.lastUsedAt,
  revokedAt: apiKeys.revokedAt,
  createdAt: apiKeys.createdAt,
};

type Row = Pick<typeof apiKeys.$inferSelect, keyof typeof columns>;

const toApiKey = (row: Row): ApiKey => ({
  ...row,
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  revokedAt: row.revokedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

/** pk_ + 32 символа base64url (192 бита). */
export const newPublishableKey = () => `pk_${randomBytes(24).toString('base64url')}`;

export const apiKeyRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  const scoped = (clinicId: string, id: string) =>
    and(eq(apiKeys.id, id), eq(apiKeys.clinicId, clinicId));

  app.get('', { config: MANAGERS }, async (request): Promise<ApiKey[]> => {
    const rows = await db
      .select(columns)
      .from(apiKeys)
      .where(eq(apiKeys.clinicId, authOf(request).clinicId))
      .orderBy(desc(apiKeys.createdAt));
    return rows.map(toApiKey);
  });

  app.post('', { config: MANAGERS }, async (request, reply) => {
    const { clinicId, userId } = authOf(request);
    const input = parse(createApiKeySchema, request.body);
    const [row] = await db
      .insert(apiKeys)
      .values({
        clinicId,
        name: input.name,
        allowedOrigins: [...new Set(input.allowedOrigins)],
        token: newPublishableKey(),
        createdBy: userId,
      })
      .returning(columns);
    return reply.status(201).send(toApiKey(row!));
  });

  app.patch('/:id', { config: MANAGERS }, async (request): Promise<ApiKey> => {
    const { clinicId } = authOf(request);
    const input = parse(updateApiKeySchema, request.body);
    const changes = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.allowedOrigins ? { allowedOrigins: [...new Set(input.allowedOrigins)] } : {}),
    };
    const where = scoped(clinicId, idOf(request));
    const [row] =
      Object.keys(changes).length > 0
        ? await db.update(apiKeys).set(changes).where(where).returning(columns)
        : await db.select(columns).from(apiKeys).where(where);
    if (!row) throw notFound();
    return toApiKey(row);
  });

  app.post('/:id/revoke', { config: MANAGERS }, async (request): Promise<ApiKey> => {
    const { clinicId } = authOf(request);
    const id = idOf(request);
    // Повторный отзыв не сдвигает дату первого
    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(scoped(clinicId, id), isNull(apiKeys.revokedAt)));
    const [row] = await db.select(columns).from(apiKeys).where(scoped(clinicId, id));
    if (!row) throw notFound();
    return toApiKey(row);
  });
};
