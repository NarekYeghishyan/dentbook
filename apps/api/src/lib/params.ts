import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { uuidSchema } from '@dentbook/shared';
import { notFound } from './errors.js';

const idParams = z.object({ id: uuidSchema });

/** :id из пути. Не UUID — такой записи нет: 404, а не ошибка БД. */
export function idOf(request: FastifyRequest): string {
  const result = idParams.safeParse(request.params);
  if (!result.success) throw notFound();
  return result.data.id;
}
