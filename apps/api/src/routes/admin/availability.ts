/** Календарь доступности в админке: те же слоты, что увидит виджет (§6). */
import type { FastifyPluginAsync } from 'fastify';
import { addDays } from '@dentbook/core';
import type { Database } from '@dentbook/db';
import {
  AVAILABILITY_MAX_DAYS,
  availabilityQuerySchema,
  type AvailabilityResponse,
} from '@dentbook/shared';
import { ApiError, parse } from '../../lib/errors.js';
import { authOf } from '../../plugins/session.js';
import { computeAvailability } from '../../services/availability.js';

export const availabilityRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.get('', async (request): Promise<AvailabilityResponse> => {
    const query = parse(availabilityQuerySchema, request.query);
    if (query.to < query.from || addDays(query.from, AVAILABILITY_MAX_DAYS - 1) < query.to) {
      throw new ApiError(
        400,
        'validation_failed',
        `Invalid fields: to (1 to ${AVAILABILITY_MAX_DAYS} days from "from")`,
      );
    }
    return computeAvailability(db, {
      ...query,
      clinicId: authOf(request).clinicId,
      now: new Date(),
      includeHidden: true,
    });
  });
};
