/**
 * Сотрудники клиники. Выдать можно роли admin и registrar; owner — только при
 * регистрации клиники, его роль и активность не меняются. Удаления нет: сотрудник
 * отключается (is_active = false), его id остаётся в created_by записей.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { pgErrorCode, PG_UNIQUE_VIOLATION, users, type Database } from '@dentbook/db';
import { createUserSchema, updateUserSchema, type StaffUser } from '@dentbook/shared';
import { forbidden, notFound, parse } from '../../lib/errors.js';
import { idOf } from '../../lib/params.js';
import { hashPassword } from '../../lib/password.js';
import { authOf } from '../../plugins/session.js';
import { emailTaken } from './auth.js';
import { staffColumns, toStaffUser } from './mappers.js';

const MANAGERS = { roles: ['owner', 'admin'] } as const;

export const userRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  async function findUser(clinicId: string, id: string) {
    const [row] = await db
      .select(staffColumns)
      .from(users)
      .where(and(eq(users.id, id), eq(users.clinicId, clinicId)));
    if (!row) throw notFound();
    return row;
  }

  app.get('', { config: MANAGERS }, async (request): Promise<StaffUser[]> => {
    const { clinicId } = authOf(request);
    const rows = await db
      .select(staffColumns)
      .from(users)
      .where(eq(users.clinicId, clinicId))
      .orderBy(asc(users.createdAt), asc(users.id));
    return rows.map(toStaffUser);
  });

  app.get('/:id', { config: MANAGERS }, async (request): Promise<StaffUser> => {
    return toStaffUser(await findUser(authOf(request).clinicId, idOf(request)));
  });

  app.post('', { config: MANAGERS }, async (request, reply) => {
    const { clinicId } = authOf(request);
    const input = parse(createUserSchema, request.body);
    try {
      const [row] = await db
        .insert(users)
        .values({
          clinicId,
          email: input.email,
          fullName: input.fullName,
          role: input.role,
          passwordHash: await hashPassword(input.password),
        })
        .returning(staffColumns);
      return reply.status(201).send(toStaffUser(row!));
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) throw emailTaken();
      throw err;
    }
  });

  app.patch('/:id', { config: MANAGERS }, async (request): Promise<StaffUser> => {
    const auth = authOf(request);
    const id = idOf(request);
    const input = parse(updateUserSchema, request.body);
    const target = await findUser(auth.clinicId, id);

    const changesAccess = input.role !== undefined || input.isActive !== undefined;
    if (target.role === 'owner' && (changesAccess || auth.userId !== id)) {
      throw forbidden('The owner can only be edited by themselves, without role or status');
    }
    if (auth.userId === id && changesAccess) {
      throw forbidden('You cannot change your own role or status');
    }

    const { password, ...fields } = input;
    const changes =
      password === undefined ? fields : { ...fields, passwordHash: await hashPassword(password) };
    if (Object.keys(changes).length === 0) return toStaffUser(target);

    const [row] = await db
      .update(users)
      .set(changes)
      .where(and(eq(users.id, id), eq(users.clinicId, auth.clinicId)))
      .returning(staffColumns);
    return toStaffUser(row!);
  });
};
