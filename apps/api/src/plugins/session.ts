/**
 * Сессии админки: JWT (HS256) в httpOnly-cookie. Защита от CSRF — SameSite=Strict
 * и JSON-тела (форма с чужого сайта JSON не отправит, Fastify ответит 415).
 *
 * В токене только id пользователя. Роль, активность и клиника читаются из БД на каждом
 * запросе: отключение сотрудника или смена роли действуют сразу, а не после истечения
 * токена.
 */
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { clinics, users, type Database } from '@dentbook/db';
import type { UserRole } from '@dentbook/shared';
import { forbidden, unauthorized } from '../lib/errors.js';

export const SESSION_COOKIE = 'dentbook_session';
const COOKIE_PATH = '/v1/admin';

/** Роли сотрудников клиники. operator — оператор платформы, у него нет клиники. */
export type ClinicRole = Exclude<UserRole, 'operator'>;
export const CLINIC_ROLES = ['owner', 'admin', 'registrar'] as const satisfies ClinicRole[];

/** config роутов, меняющих данные клиники: регистратура их только читает (ADR-0006). */
export const MANAGERS = { roles: ['owner', 'admin'] } as const satisfies {
  roles: readonly ClinicRole[];
};

/** Кто делает запрос. clinicId участвует в каждом запросе к данным (§2.2). */
export interface AuthContext {
  userId: string;
  clinicId: string;
  role: ClinicRole;
}

export interface SessionManager {
  start(reply: FastifyReply, userId: string): Promise<void>;
  end(reply: FastifyReply): void;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
    /** Оператор платформы в роутах /operator (Шаг 10). */
    operator: { userId: string } | null;
  }
  interface FastifyInstance {
    session: SessionManager;
    /** Хук: пускает только сотрудника активной клиники с ролью из config.roles. */
    authenticate(request: FastifyRequest): Promise<void>;
    /** Хук: пускает только активного оператора платформы. */
    authenticateOperator(request: FastifyRequest): Promise<void>;
  }
  interface FastifyContextConfig {
    /** Кому доступен роут; по умолчанию — всем сотрудникам клиники. */
    roles?: readonly ClinicRole[];
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

export interface SessionOptions {
  db: Database;
  secret: string;
  ttlSec: number;
  /** Secure-cookie: в проде только HTTPS. */
  secureCookie: boolean;
}

/** request.auth внутри защищённых роутов. */
export function authOf(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

export const sessionPlugin = fp<SessionOptions>(
  async (app, { db, secret, ttlSec, secureCookie }) => {
    await app.register(fastifyCookie);
    await app.register(fastifyJwt, {
      secret,
      cookie: { cookieName: SESSION_COOKIE, signed: false },
      // Строкой с единицами: число @fastify/jwt и fast-jwt трактуют по-разному
      // (секунды и миллисекунды). Проверяется тестом на истёкшую сессию.
      sign: { expiresIn: `${ttlSec}s` },
    });

    const cookieOptions = {
      path: COOKIE_PATH,
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'strict',
    } as const;

    app.decorate('session', {
      async start(reply, userId) {
        const token = await reply.jwtSign({ sub: userId });
        reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: ttlSec });
      },
      end(reply) {
        reply.clearCookie(SESSION_COOKIE, cookieOptions);
      },
    } satisfies SessionManager);

    app.decorateRequest('auth', null);
    app.decorateRequest('operator', null);

    const sessionUser = async (request: FastifyRequest): Promise<string> => {
      try {
        return (await request.jwtVerify<{ sub: string }>()).sub;
      } catch {
        throw unauthorized();
      }
    };

    app.decorate('authenticate', async (request: FastifyRequest) => {
      const userId = await sessionUser(request);

      const [row] = await db
        .select({
          role: users.role,
          clinicId: users.clinicId,
          isActive: users.isActive,
          clinicStatus: clinics.status,
        })
        .from(users)
        .leftJoin(clinics, eq(clinics.id, users.clinicId))
        .where(eq(users.id, userId))
        .limit(1);

      if (!row || !row.isActive) throw unauthorized();
      // У оператора платформы нет клиники: его роуты — /operator
      if (row.role === 'operator' || row.clinicId === null) throw forbidden('No clinic access');
      if (row.clinicStatus !== 'active') throw forbidden('Clinic is suspended');

      const roles = request.routeOptions.config.roles ?? CLINIC_ROLES;
      if (!roles.includes(row.role)) throw forbidden();

      request.auth = { userId, clinicId: row.clinicId, role: row.role };
    });

    app.decorate('authenticateOperator', async (request: FastifyRequest) => {
      const userId = await sessionUser(request);
      const [row] = await db
        .select({ role: users.role, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!row || !row.isActive) throw unauthorized();
      if (row.role !== 'operator') throw forbidden('Platform operators only');
      request.operator = { userId };
    });
  },
);
