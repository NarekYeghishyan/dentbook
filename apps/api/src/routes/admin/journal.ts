/**
 * Журнал регистратуры, записи, клиенты и отчёты (Шаг 9, Q17). Всё — в области clinicScope:
 * clinicId только из сессии (§2.2). Записывать, переносить, подтверждать, отменять и
 * отмечать визиты может любой сотрудник, включая регистратуру; выгрузка с телефонами
 * клиентов — только владелец и администратор.
 */
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { addDays } from '@dentbook/core';
import type { Database } from '@dentbook/db';
import {
  clientSearchSchema,
  JOURNAL_MAX_DAYS,
  journalQuerySchema,
  REPORT_MAX_DAYS,
  reportQuerySchema,
  rescheduleSchema,
  staffBookingSchema,
  updateClientSchema,
  visitOutcomeSchema,
} from '@dentbook/shared';
import { ApiError, parse } from '../../lib/errors.js';
import { idOf } from '../../lib/params.js';
import { authOf, MANAGERS } from '../../plugins/session.js';
import { loadClientCard, searchClients, updateClient } from '../../services/clients.js';
import {
  cancelByClinic,
  confirmByStaff,
  createStaffBooking,
  loadJournal,
  rescheduleAppointment,
  setVisitOutcome,
} from '../../services/journal.js';
import type { Notifier } from '../../services/notifier.js';
import { exportAppointmentsCsv, loadDashboard } from '../../services/reports.js';
import type { SlotCache } from '../../services/slot-cache.js';

export interface JournalRoutesOptions {
  db: Database;
  notifier: Notifier;
  cache?: SlotCache;
}

/** Диапазон дат: to не раньше from и не длиннее maxDays. */
function assertRange(range: { from: string; to: string }, maxDays: number) {
  if (range.to < range.from || addDays(range.from, maxDays - 1) < range.to) {
    throw new ApiError(400, 'validation_failed', 'Invalid fields: to');
  }
}

const noContent = (reply: FastifyReply) => reply.status(204).send();

export const journalRoutes: FastifyPluginAsync<JournalRoutesOptions> = async (
  app,
  { db, notifier, cache },
) => {
  const deps = { cache, notifier };

  app.get('/journal', async (request) => {
    const query = parse(journalQuerySchema, request.query);
    assertRange(query, JOURNAL_MAX_DAYS);
    return loadJournal(db, { clinicId: authOf(request).clinicId, ...query, now: new Date() });
  });

  // --- записи ---

  app.post('/appointments', async (request, reply) => {
    const input = parse(staffBookingSchema, request.body);
    const created = await createStaffBooking(db, deps, {
      clinicId: authOf(request).clinicId,
      input,
      now: new Date(),
    });
    return reply.status(201).send(created);
  });

  app.patch('/appointments/:id', async (request, reply) => {
    const input = parse(rescheduleSchema, request.body);
    await rescheduleAppointment(db, deps, {
      clinicId: authOf(request).clinicId,
      id: idOf(request),
      startAt: input.startAt,
      ...(input.dentistId ? { dentistId: input.dentistId } : {}),
      now: new Date(),
    });
    return noContent(reply);
  });

  app.post('/appointments/:id/confirm', async (request, reply) => {
    await confirmByStaff(db, deps, {
      clinicId: authOf(request).clinicId,
      id: idOf(request),
      now: new Date(),
    });
    return noContent(reply);
  });

  app.post('/appointments/:id/cancel', async (request, reply) => {
    await cancelByClinic(db, deps, {
      clinicId: authOf(request).clinicId,
      id: idOf(request),
      now: new Date(),
    });
    return noContent(reply);
  });

  app.post('/appointments/:id/outcome', async (request, reply) => {
    const { status } = parse(visitOutcomeSchema, request.body);
    await setVisitOutcome(db, {
      clinicId: authOf(request).clinicId,
      id: idOf(request),
      outcome: status,
      now: new Date(),
    });
    return noContent(reply);
  });

  /** Выгрузка записей периода: в ней телефоны и email клиентов — только руководителям. */
  app.get('/appointments/export', { config: MANAGERS }, async (request, reply) => {
    const query = parse(reportQuerySchema, request.query);
    assertRange(query, REPORT_MAX_DAYS);
    const csv = await exportAppointmentsCsv(db, { clinicId: authOf(request).clinicId, ...query });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="appointments-${query.from}-${query.to}.csv"`,
      )
      .header('cache-control', 'no-store')
      .send(csv);
  });

  // --- клиенты ---

  app.get('/clients', async (request) => {
    const query = parse(clientSearchSchema, request.query);
    return searchClients(db, { clinicId: authOf(request).clinicId, ...query, now: new Date() });
  });

  app.get('/clients/:id', async (request) =>
    loadClientCard(db, { clinicId: authOf(request).clinicId, id: idOf(request), now: new Date() }),
  );

  app.patch('/clients/:id', async (request) => {
    const input = parse(updateClientSchema, request.body);
    return updateClient(db, {
      clinicId: authOf(request).clinicId,
      id: idOf(request),
      input,
      now: new Date(),
    });
  });

  // --- дашборд ---

  app.get('/dashboard', async (request) => {
    const query = parse(reportQuerySchema, request.query);
    assertRange(query, REPORT_MAX_DAYS);
    return loadDashboard(db, { clinicId: authOf(request).clinicId, ...query, now: new Date() });
  });
};
