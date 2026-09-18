/**
 * Отчёты клиники (Шаг 9, Q17): дашборд за период и выгрузка записей в CSV. Период — местные
 * даты в поясе офиса или, без офиса, клиники (§2.3). Загрузка врача — занятые записями
 * минуты к рабочим минутам по шаблону, extra и block (движок @dentbook/core).
 */
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { dayBounds, localDateOf, workingMinutes } from '@dentbook/core';
import {
  appointments,
  clinics,
  dentists,
  locations,
  patients,
  services,
  type Database,
} from '@dentbook/db';
import type { DashboardResponse } from '@dentbook/shared';
import { APPOINTMENT_SOURCES, type Locale } from '@dentbook/shared/domain';
import { translate, type MessageKey } from '../i18n/index.js';
import { notFound } from '../lib/errors.js';
import { loadSchedules } from './availability.js';

const REPORT_STATUSES = ['pending', 'confirmed', 'completed', 'no_show', 'cancelled'] as const;
/** Занимают время врача в отчёте о загрузке. */
const BUSY_STATUSES = new Set(['pending', 'confirmed', 'completed', 'no_show']);
const PENDING_LIMIT = 10;
const MINUTE_MS = 60_000;

interface Period {
  clinicId: string;
  from: string;
  to: string;
  locationId?: string | undefined;
}

async function periodOf(db: Database, params: Period) {
  const [clinic] = await db
    .select({ timeZone: clinics.timezone, locale: clinics.locale })
    .from(clinics)
    .where(eq(clinics.id, params.clinicId));
  let timeZone = clinic!.timeZone;
  if (params.locationId) {
    const [office] = await db
      .select({ timeZone: locations.timezone })
      .from(locations)
      .where(and(eq(locations.id, params.locationId), eq(locations.clinicId, params.clinicId)));
    if (!office) throw notFound();
    timeZone = office.timeZone ?? timeZone;
  }
  return {
    timeZone,
    locale: clinic!.locale as Locale,
    start: dayBounds(params.from, timeZone).start,
    end: dayBounds(params.to, timeZone).end,
  };
}

export async function loadDashboard(
  db: Database,
  params: Period & { now: Date },
): Promise<DashboardResponse> {
  const { clinicId, from, to, locationId, now } = params;
  const { timeZone, start, end } = await periodOf(db, params);
  const inOffice = locationId ? eq(appointments.locationId, locationId) : undefined;

  const [rows, staff, offices, pending] = await Promise.all([
    db
      .select({
        status: appointments.status,
        source: appointments.source,
        dentistId: appointments.dentistId,
        startAt: appointments.startAt,
        endAt: appointments.endAt,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          inArray(appointments.status, [...REPORT_STATUSES]),
          gte(appointments.startAt, start),
          lt(appointments.startAt, end),
          inOffice,
        ),
      ),
    db
      .select({ id: dentists.id, fullName: dentists.fullName, isActive: dentists.isActive })
      .from(dentists)
      .where(eq(dentists.clinicId, clinicId))
      .orderBy(asc(dentists.priority), asc(dentists.fullName)),
    db
      .select({
        id: locations.id,
        timeZone: sql<string>`coalesce(${locations.timezone}, ${clinics.timezone})`,
      })
      .from(locations)
      .innerJoin(clinics, eq(clinics.id, locations.clinicId))
      .where(
        and(
          eq(locations.clinicId, clinicId),
          locationId ? eq(locations.id, locationId) : eq(locations.isActive, true),
        ),
      ),
    db
      .select({
        id: appointments.id,
        startAt: appointments.startAt,
        dentist: dentists.fullName,
        client: patients.fullName,
      })
      .from(appointments)
      .innerJoin(dentists, eq(dentists.id, appointments.dentistId))
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          eq(appointments.status, 'pending'),
          gte(appointments.startAt, now),
          inOffice,
        ),
      )
      .orderBy(asc(appointments.startAt))
      .limit(PENDING_LIMIT),
  ]);

  // Рабочие минуты — по каждому офису в его поясе: смены врача в разных офисах не пересекаются
  const shown = staff.filter((d) => d.isActive || rows.some((r) => r.dentistId === d.id));
  const workingOf = new Map<string, number>(shown.map((d) => [d.id, 0]));
  for (const office of offices) {
    const officeFrom = localDateOf(start, office.timeZone);
    const officeTo = localDateOf(new Date(end.getTime() - 1), office.timeZone);
    const scheduleOf = await loadSchedules(db, {
      clinicId,
      locationId: office.id,
      dentistIds: shown.map((d) => d.id),
      windowStart: dayBounds(officeFrom, office.timeZone).start,
      windowEnd: dayBounds(officeTo, office.timeZone).end,
      now,
      ignoreAppointments: true,
    });
    for (const dentist of shown) {
      const schedule = scheduleOf(dentist.id);
      workingOf.set(
        dentist.id,
        workingOf.get(dentist.id)! +
          workingMinutes({
            weeklyHours: schedule.weeklyHours,
            exceptions: schedule.exceptions,
            from: officeFrom,
            to: officeTo,
            timeZone: office.timeZone,
          }),
      );
    }
  }

  const count = (test: (r: (typeof rows)[number]) => boolean) => rows.filter(test).length;
  return {
    timeZone,
    from,
    to,
    bookings: {
      total: rows.length,
      bySource: Object.fromEntries(
        APPOINTMENT_SOURCES.map((source) => [source, count((r) => r.source === source)]),
      ) as DashboardResponse['bookings']['bySource'],
    },
    cancelled: count((r) => r.status === 'cancelled'),
    noShow: count((r) => r.status === 'no_show'),
    completed: count((r) => r.status === 'completed'),
    dentists: shown.map((d) => ({
      id: d.id,
      fullName: d.fullName,
      workingMin: workingOf.get(d.id)!,
      bookedMin: rows
        .filter((r) => r.dentistId === d.id && BUSY_STATUSES.has(r.status))
        .reduce((sum, r) => sum + (r.endAt.getTime() - r.startAt.getTime()) / MINUTE_MS, 0),
    })),
    pending: pending.map((p) => ({ ...p, startAt: p.startAt.toISOString() })),
  };
}

// --- CSV ---

const CSV_COLUMNS: MessageKey[] = [
  'csv.date',
  'csv.time',
  'csv.office',
  'csv.dentist',
  'csv.service',
  'csv.client',
  'csv.phone',
  'csv.email',
  'csv.status',
  'csv.source',
  'csv.notes',
];

/**
 * Ячейка CSV: в кавычках, если нужно, и без формул — Excel выполняет «=…», «+…», «-…», «@…»
 * (CSV injection), поэтому такие значения начинаются с апострофа.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const hhmm = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);

/** Записи периода по времени визита; дата и время — в поясе офиса записи. */
export async function exportAppointmentsCsv(db: Database, params: Period): Promise<string> {
  const { clinicId, locationId } = params;
  const { locale, start, end } = await periodOf(db, params);
  const rows = await db
    .select({
      startAt: appointments.startAt,
      timeZone: sql<string>`coalesce(${locations.timezone}, ${clinics.timezone})`,
      office: locations.name,
      dentist: dentists.fullName,
      service: services.name,
      client: patients.fullName,
      phone: patients.phone,
      email: patients.email,
      status: appointments.status,
      source: appointments.source,
      notes: appointments.notes,
    })
    .from(appointments)
    .innerJoin(clinics, eq(clinics.id, appointments.clinicId))
    .innerJoin(locations, eq(locations.id, appointments.locationId))
    .innerJoin(dentists, eq(dentists.id, appointments.dentistId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        inArray(appointments.status, [...REPORT_STATUSES]),
        gte(appointments.startAt, start),
        lt(appointments.startAt, end),
        locationId ? eq(appointments.locationId, locationId) : undefined,
      ),
    )
    .orderBy(asc(appointments.startAt));

  const lines = [CSV_COLUMNS.map((key) => csvCell(translate(locale, key)))];
  for (const r of rows) {
    lines.push(
      [
        localDateOf(r.startAt, r.timeZone),
        hhmm(r.startAt, r.timeZone),
        r.office,
        r.dentist,
        r.service,
        r.client,
        r.phone,
        r.email ?? '',
        translate(locale, `status.${r.status}` as MessageKey),
        translate(locale, `source.${r.source}` as MessageKey),
        r.notes ?? '',
      ].map(csvCell),
    );
  }
  // BOM — чтобы Excel открыл UTF-8 с кириллицей и армянским без «кракозябр»
  return `${String.fromCharCode(0xfeff)}${lines.map((line) => line.join(',')).join('\r\n')}\r\n`;
}
