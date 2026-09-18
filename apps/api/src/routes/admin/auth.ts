/** Регистрация клиники, вход и выход. Роуты без сессии. */
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { clinics, pgErrorCode, PG_UNIQUE_VIOLATION, users, type Database } from '@dentbook/db';
import { loginSchema, registerClinicSchema } from '@dentbook/shared';
import { ApiError, parse, unauthorized } from '../../lib/errors.js';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '../../lib/password.js';

export interface AuthRoutesOptions {
  db: Database;
  /** Попыток в минуту с одного IP на каждый роут. */
  rateLimitPerMin: number;
}

/**
 * Email занят. Отдельного кода в §7 нет: validation_failed + 409 — админка по статусу
 * показывает «email уже зарегистрирован».
 */
export const emailTaken = () =>
  new ApiError(409, 'validation_failed', 'Email is already registered');

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  app,
  { db, rateLimitPerMin },
) => {
  const config = { rateLimit: { max: rateLimitPerMin, timeWindow: 60_000 } };

  app.post('/register', { config }, async (request, reply) => {
    const input = parse(registerClinicSchema, request.body);
    const passwordHash = await hashPassword(input.password);
    try {
      const created = await db.transaction(async (tx) => {
        const [clinic] = await tx
          .insert(clinics)
          .values({
            name: input.clinicName,
            timezone: input.timezone,
            currency: input.currency,
            locale: input.locale,
          })
          .returning({ id: clinics.id });
        const [owner] = await tx
          .insert(users)
          .values({
            clinicId: clinic!.id,
            email: input.email,
            passwordHash,
            fullName: input.fullName,
            role: 'owner',
          })
          .returning({ id: users.id });
        return { clinicId: clinic!.id, userId: owner!.id };
      });
      await app.session.start(reply, created.userId);
      return reply.status(201).send(created);
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) throw emailTaken();
      throw err;
    }
  });

  app.post('/login', { config }, async (request, reply) => {
    const input = parse(loginSchema, request.body);
    const [user] = await db
      .select({ id: users.id, passwordHash: users.passwordHash, isActive: users.isActive })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    // Проверка идёт и для несуществующего email: время ответа не выдаёт, есть ли он
    const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !valid || !user.isActive) throw unauthorized('Invalid email or password');

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await app.session.start(reply, user.id);
    return reply.status(204).send();
  });

  app.post('/logout', async (_request, reply) => {
    app.session.end(reply);
    return reply.status(204).send();
  });
};
