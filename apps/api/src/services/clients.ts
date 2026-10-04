/**
 * Клиенты клиники (в БД — patients, в интерфейсе — client, §5): поиск для журнала и
 * карточка с историей визитов (Шаг 9) и историей заметок (Q19). Клиент определяется
 * телефоном (Q9).
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  appointments,
  clinics,
  dentists,
  locations,
  notifications,
  patientNotes,
  patients,
  services,
  users,
  type Database,
  type Executor,
  type Transaction,
} from '@dentbook/db';
import type {
  ClientCard,
  ClientNote,
  ClientSnapshot,
  ClientSummary,
  UpdateClientInput,
} from '@dentbook/shared';
import { notFound } from '../lib/errors.js';
import type { Actor } from './history.js';

/** Записи, которые попадают в историю клиента: всё, кроме холдов. */
const HISTORY_STATUSES = ['pending', 'confirmed', 'completed', 'no_show', 'cancelled'] as const;
const HISTORY_LIMIT = 200;

/** Пояс офиса записи, без него — клиники (§2.3). */
const zone = sql<string>`coalesce(${locations.timezone}, ${clinics.timezone})`;

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
      createdAt: patients.createdAt,
    })
    .from(patients)
    .where(and(eq(patients.id, id), eq(patients.clinicId, clinicId)));
  if (!patient) throw notFound();

  const [history, notes] = await Promise.all([
    db
      .select({
        id: appointments.id,
        status: appointments.status,
        source: appointments.source,
        startAt: appointments.startAt,
        timeZone: zone,
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
      .limit(HISTORY_LIMIT),
    loadClientNotes(db, { clinicId, patientId: id }),
  ]);

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
    notes,
  };
}

/**
 * История заметок клиента (Q19): карточка в панели и запись в Mini App. Сверху — последний
 * написанный текст; заметка к записи, которую правили, поднимается со своей правкой.
 */
export async function loadClientNotes(
  db: Database,
  params: { clinicId: string; patientId: string },
): Promise<ClientNote[]> {
  const rows = await db
    .select({
      id: patientNotes.id,
      createdAt: patientNotes.createdAt,
      updatedAt: patientNotes.updatedAt,
      text: patientNotes.text,
      author: patientNotes.author,
      userName: users.fullName,
      dentistName: dentists.fullName,
      appointmentId: appointments.id,
      startAt: appointments.startAt,
      timeZone: zone,
    })
    .from(patientNotes)
    .innerJoin(clinics, eq(clinics.id, patientNotes.clinicId))
    .leftJoin(users, eq(users.id, patientNotes.userId))
    .leftJoin(dentists, eq(dentists.id, patientNotes.dentistId))
    .leftJoin(appointments, eq(appointments.id, patientNotes.appointmentId))
    .leftJoin(locations, eq(locations.id, appointments.locationId))
    .where(
      and(eq(patientNotes.clinicId, params.clinicId), eq(patientNotes.patientId, params.patientId)),
    )
    .orderBy(desc(patientNotes.updatedAt), desc(patientNotes.id));
  return rows.map((n) => ({
    id: n.id,
    at: n.updatedAt.toISOString(),
    edited: n.updatedAt > n.createdAt,
    text: n.text,
    author: n.author,
    authorName: n.userName ?? n.dentistName ?? null,
    appointment:
      n.appointmentId && n.startAt
        ? { id: n.appointmentId, startAt: n.startAt.toISOString(), timeZone: n.timeZone }
        : null,
  }));
}

const authorOf = (author: Actor) => ({
  author: author.kind,
  userId: author.kind === 'staff' ? author.userId : null,
  dentistId: author.kind === 'dentist' ? author.dentistId : null,
});

/**
 * Заметка к записи в истории клиента (Q19). У записи одна заметка — и в истории она одна:
 * первый текст добавляет её, новый правит (автор и время — того, кто написал этот текст),
 * пустой — убирает. В истории записи (appointment_events) остаются все версии. Вызывается в
 * транзакции того изменения, которое принесло текст.
 */
export async function syncBookingNote(
  db: Executor,
  note: {
    clinicId: string;
    appointmentId: string;
    /** Нынешний клиент записи. */
    patientId: string | null;
    author: Actor;
    text: string | null | undefined;
  },
): Promise<void> {
  const { clinicId, appointmentId, patientId } = note;
  const text = note.text?.trim();
  if (!text || !patientId) {
    await db
      .delete(patientNotes)
      .where(
        and(eq(patientNotes.clinicId, clinicId), eq(patientNotes.appointmentId, appointmentId)),
      );
    return;
  }
  const written = { patientId, text, ...authorOf(note.author) };
  await db
    .insert(patientNotes)
    .values({ clinicId, appointmentId, ...written })
    .onConflictDoUpdate({
      target: patientNotes.appointmentId,
      targetWhere: sql`appointment_id IS NOT NULL`,
      set: { ...written, updatedAt: sql`now()` },
    });
}

/** Клиент записи сменился, а заметка — нет: она уходит к новому клиенту, текст и время те же. */
export async function moveBookingNote(
  db: Executor,
  note: { clinicId: string; appointmentId: string; patientId: string | null },
): Promise<void> {
  if (!note.patientId) return;
  await db
    .update(patientNotes)
    .set({ patientId: note.patientId })
    .where(
      and(
        eq(patientNotes.clinicId, note.clinicId),
        eq(patientNotes.appointmentId, note.appointmentId),
      ),
    );
}

/** Регистратура добавляет заметку в карточке клиента. Чужой клиент — 404 (§2.2). */
export async function createClientNote(
  db: Database,
  params: { clinicId: string; patientId: string; text: string; userId: string },
): Promise<{ id: string }> {
  const { clinicId, patientId } = params;
  const found = await db.$count(
    patients,
    and(eq(patients.id, patientId), eq(patients.clinicId, clinicId)),
  );
  if (found === 0) throw notFound();
  const [row] = await db
    .insert(patientNotes)
    .values({
      clinicId,
      patientId,
      text: params.text,
      ...authorOf({ kind: 'staff', userId: params.userId }),
    })
    .returning({ id: patientNotes.id });
  return { id: row!.id };
}

/** Удаление заметки — владелец или администратор (Q19); правки заметок нет. */
export async function deleteClientNote(
  db: Database,
  params: { clinicId: string; patientId: string; noteId: string },
): Promise<void> {
  const deleted = await db
    .delete(patientNotes)
    .where(
      and(
        eq(patientNotes.id, params.noteId),
        eq(patientNotes.clinicId, params.clinicId),
        eq(patientNotes.patientId, params.patientId),
      ),
    )
    .returning({ id: patientNotes.id });
  if (deleted.length === 0) throw notFound();
}

/**
 * Клиент записи после правки врачом в Mini App или регистратурой в журнале. Клиент в клинике
 * определяется телефоном (Q9): новое имя (и email) меняет карточку клиента, новый телефон
 * переводит запись на клиента с этим номером. Клиент без номера есть только у своей записи:
 * его имя правится на месте, а убранный номер даёт записи нового клиента без номера —
 * карточка клиента с этим номером не трогается. Возвращает клиента записи; если он сменился,
 * запланированные SMS уходят на его номер.
 */
export async function setBookingClient(
  tx: Transaction,
  params: {
    clinicId: string;
    appointmentId: string;
    patientId: string | null;
    before: ClientSnapshot | null;
    client: { fullName: string; phone: string | null; email?: string | undefined };
  },
): Promise<string> {
  const { clinicId, appointmentId, patientId, before, client } = params;
  if (client.phone === null && before?.phone === null && patientId) {
    await tx
      .update(patients)
      .set({ fullName: client.fullName, ...(client.email ? { email: client.email } : {}) })
      .where(and(eq(patients.id, patientId), eq(patients.clinicId, clinicId)));
    return patientId;
  }
  const [patient] = await tx
    .insert(patients)
    .values({
      clinicId,
      fullName: client.fullName,
      phone: client.phone,
      email: client.email ?? null,
    })
    .onConflictDoUpdate({
      target: [patients.clinicId, patients.phone],
      set: {
        fullName: sql`excluded.full_name`,
        email: sql`coalesce(excluded.email, ${patients.email})`,
      },
    })
    .returning({ id: patients.id });
  if (patient!.id !== patientId) {
    // Напоминание уходит на телефон клиента из notifications.patient_id — на новый номер
    await tx
      .update(notifications)
      .set({ patientId: patient!.id })
      .where(
        and(
          eq(notifications.clinicId, clinicId),
          eq(notifications.appointmentId, appointmentId),
          eq(notifications.channel, 'sms'),
          eq(notifications.status, 'scheduled'),
        ),
      );
  }
  return patient!.id;
}

export async function updateClient(
  db: Database,
  params: { clinicId: string; id: string; input: UpdateClientInput; now: Date },
): Promise<ClientCard> {
  const { clinicId, id, input } = params;
  const patch = Object.fromEntries(
    Object.entries({ fullName: input.fullName, email: input.email }).filter(
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
