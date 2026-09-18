/**
 * Клиенты клиники (в БД — patients, в интерфейсе — client, §5): поиск для журнала и
 * карточка с историей визитов (Шаг 9). Клиент определяется телефоном (Q9).
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  appointments,
  clinics,
  dentists,
  locations,
  patients,
  services,
  type Database,
} from '@dentbook/db';
import type { ClientCard, ClientSummary, UpdateClientInput } from '@dentbook/shared';
import { notFound } from '../lib/errors.js';

/** Записи, которые попадают в историю клиента: всё, кроме холдов. */
const HISTORY_STATUSES = ['pending', 'confirmed', 'completed', 'no_show', 'cancelled'] as const;
const HISTORY_LIMIT = 200;

/** Поисковая строка для LIKE: спецсимволы экранируются, чтобы «%» не находил всех. */
const likeTerm = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function searchClients(
  db: Database,
  params: { clinicId: string; q?: string | undefined; limit: number; now: Date },
): Promise<ClientSummary[]> {
  const { clinicId, now } = params;
  const q = params.q?.trim();
  const digits = q?.replace(/\D/g, '') ?? '';
  const match = q
    ? sql`(${patients.fullName} ilike ${likeTerm(q)}${
        digits.length >= 3 ? sql` or ${patients.phone} like ${likeTerm(digits)}` : sql``
      })`
    : undefined;
  const rows = await db
    .select({
      id: patients.id,
      fullName: patients.fullName,
      phone: patients.phone,
      email: patients.email,
      visits:
        sql<number>`count(${appointments.id}) filter (where ${appointments.status} = 'completed')`.mapWith(
          Number,
        ),
      lastVisitAt: sql<Date | null>`max(${appointments.startAt}) filter (where ${appointments.status} in ('completed', 'confirmed') and ${appointments.startAt} < ${now})`,
      nextVisitAt: sql<Date | null>`min(${appointments.startAt}) filter (where ${appointments.status} in ('pending', 'confirmed') and ${appointments.startAt} >= ${now})`,
    })
    .from(patients)
    .leftJoin(
      appointments,
      and(eq(appointments.patientId, patients.id), eq(appointments.clinicId, patients.clinicId)),
    )
    .where(and(eq(patients.clinicId, clinicId), match))
    .groupBy(patients.id)
    .orderBy(asc(patients.fullName))
    .limit(params.limit);
  const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : null);
  return rows.map((r) => ({
    ...r,
    lastVisitAt: iso(r.lastVisitAt),
    nextVisitAt: iso(r.nextVisitAt),
  }));
}

export async function loadClientCard(
  db: Database,
  params: { clinicId: string; id: string; now: Date },
): Promise<ClientCard> {
  const { clinicId, id, now } = params;
  const [patient] = await db
    .select({
      id: patients.id,
      fullName: patients.fullName,
      phone: patients.phone,
      email: patients.email,
      notes: patients.notes,
      createdAt: patients.createdAt,
    })
    .from(patients)
    .where(and(eq(patients.id, id), eq(patients.clinicId, clinicId)));
  if (!patient) throw notFound();

  const history = await db
    .select({
      id: appointments.id,
      status: appointments.status,
      source: appointments.source,
      startAt: appointments.startAt,
      timeZone: sql<string>`coalesce(${locations.timezone}, ${clinics.timezone})`,
      service: services.name,
      dentist: dentists.fullName,
      office: locations.name,
    })
    .from(appointments)
    .innerJoin(clinics, eq(clinics.id, appointments.clinicId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(dentists, eq(dentists.id, appointments.dentistId))
    .innerJoin(locations, eq(locations.id, appointments.locationId))
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        eq(appointments.patientId, id),
        inArray(appointments.status, [...HISTORY_STATUSES]),
      ),
    )
    .orderBy(desc(appointments.startAt))
    .limit(HISTORY_LIMIT);

  const count = (test: (h: (typeof history)[number]) => boolean) => history.filter(test).length;
  return {
    ...patient,
    createdAt: patient.createdAt.toISOString(),
    stats: {
      completed: count((h) => h.status === 'completed'),
      noShow: count((h) => h.status === 'no_show'),
      cancelled: count((h) => h.status === 'cancelled'),
      upcoming: count(
        (h) => (h.status === 'pending' || h.status === 'confirmed') && h.startAt >= now,
      ),
    },
    appointments: history.map((h) => ({
      ...h,
      status: h.status as ClientCard['appointments'][number]['status'],
      startAt: h.startAt.toISOString(),
    })),
  };
}

export async function updateClient(
  db: Database,
  params: { clinicId: string; id: string; input: UpdateClientInput; now: Date },
): Promise<ClientCard> {
  const { clinicId, id, input } = params;
  const patch = Object.fromEntries(
    Object.entries({ fullName: input.fullName, email: input.email, notes: input.notes }).filter(
      ([, v]) => v !== undefined,
    ),
  );
  if (Object.keys(patch).length > 0) {
    const rows = await db
      .update(patients)
      .set(patch)
      .where(and(eq(patients.id, id), eq(patients.clinicId, clinicId)))
      .returning({ id: patients.id });
    if (rows.length === 0) throw notFound();
  }
  return loadClientCard(db, params);
}
