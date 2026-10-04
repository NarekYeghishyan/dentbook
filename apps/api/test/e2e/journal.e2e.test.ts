/**
 * Критерий «Готово» Шага 9: перенос записи мышью не создаёт пересечений. Собранная панель
 * в Chromium против настоящего API: запись перетаскивается по времени и к другому врачу,
 * перенос на занятое время отклоняется и запись остаётся на месте, свободное время
 * открывает запись клиента, а сохранённую запись можно открыть и изменить.
 */
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, isoWeekday, localDateOf, zonedTimeToUtc } from '@dentbook/core';
import { appointments } from '@dentbook/db';
import { startTestDatabase, type TestDatabase } from '@dentbook/db/testing';
import type { Dentist } from '@dentbook/shared';
import {
  call,
  createClinicData,
  registerClinic,
  testApp,
  type ClinicFixture,
  type Session,
} from '../helpers.js';

const ADMIN_DIST = fileURLToPath(new URL('../../../admin/dist', import.meta.url));
const ZONE = 'America/New_York';

let database: TestDatabase;
let app: FastifyInstance;
let apiUrl: string;
let browser: Browser;
let owner: Session;
let data: ClinicFixture;
let boris: string;
let day: string;
let jane: string;

/** Ближайший будний день через 2+ суток. */
function upcomingWeekday(): string {
  let date = addDays(localDateOf(new Date(), ZONE), 2);
  while (isoWeekday(date) > 5) date = addDays(date, 1);
  return date;
}
const at = (date: string, time: string) => {
  const [h, m] = time.split(':').map(Number);
  return zonedTimeToUtc(date, h! * 60 + m!, ZONE).toISOString();
};

async function book(dentistId: string, time: string, fullName: string, phone: string) {
  return (
    await call<{ id: string }>(
      app,
      owner,
      {
        method: 'POST',
        url: '/v1/admin/appointments',
        payload: {
          locationId: data.locationId,
          serviceId: data.serviceId,
          dentistId,
          startAt: at(day, time),
          client: { fullName, phone },
        },
      },
      201,
    )
  ).id;
}

async function positionOf(id: string) {
  const [row] = await database.db
    .select({ dentistId: appointments.dentistId, startAt: appointments.startAt })
    .from(appointments)
    .where(eq(appointments.id, id));
  return { dentistId: row!.dentistId, startAt: row!.startAt.toISOString() };
}

/** E2E_SCREENSHOTS=<каталог> — сохранить экраны журнала для просмотра глазами. */
async function shot(page: Page, name: string) {
  const dir = process.env.E2E_SCREENSHOTS;
  if (dir) await page.screenshot({ path: `${dir}/journal-${name}.png`, fullPage: true });
}

/** Перетащить элемент мышью на dx, dy пикселей — как рука регистратора. */
async function drag(page: Page, label: RegExp, dx: number, dy: number) {
  const box = (await page.getByRole('button', { name: label }).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 8;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
}

beforeAll(async () => {
  database = await startTestDatabase();
  app = testApp(database.db, { ADMIN_DIST_DIR: ADMIN_DIST });
  await app.listen({ host: '127.0.0.1', port: 0 });
  apiUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

  owner = await registerClinic(app, { clinicName: 'Smile Dental', timezone: ZONE });
  data = await createClinicData(app, owner, { dentistName: 'Dr. Anna' });
  boris = (
    await call<Dentist>(
      app,
      owner,
      { method: 'POST', url: '/v1/admin/dentists', payload: { fullName: 'Dr. Boris' } },
      201,
    )
  ).id;
  await call(app, owner, {
    method: 'PUT',
    url: `/v1/admin/dentists/${boris}/services`,
    payload: { serviceIds: [data.serviceId] },
  });
  await call(app, owner, {
    method: 'PUT',
    url: `/v1/admin/dentists/${boris}/working-hours`,
    payload: {
      items: [1, 2, 3, 4, 5].map((weekday) => ({
        locationId: data.locationId,
        weekday,
        startTime: '09:00',
        endTime: '17:00',
      })),
    },
  });
  day = upcomingWeekday();
  jane = await book(data.dentistId, '10:00', 'Jane Client', '+12025558001');
  await book(boris, '11:00', 'Bob Client', '+12025558002');

  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await database?.stop();
});

async function openJournal(): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const [name, value] = owner.cookie.split('=');
  await context.addCookies([{ name: name!, value: value!, url: apiUrl }]);
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto(`${apiUrl}/admin/journal`);
  // Журнал открывается на сегодня — листаем до дня записей
  let shown = localDateOf(new Date(), ZONE);
  while (shown < day) {
    await page.getByRole('button', { name: 'Next' }).click();
    shown = addDays(shown, 1);
  }
  // Запись Bob Client тесты не двигают — по ней видно, что день загружен
  await page.getByRole('button', { name: /^11:00\sAM Bob Client$/ }).waitFor();
  return page;
}

describe('front desk journal (Step 9)', () => {
  it('moves a booking with the mouse and never onto another booking', async () => {
    const page = await openJournal();
    await shot(page, '1-day');
    // Час на сетке — 72 px
    await drag(page, /^10:00\sAM Jane Client$/, 0, 72);
    await page.getByText('Booking moved.').waitFor();
    await page.getByRole('button', { name: /^11:00\sAM Jane Client$/ }).waitFor();
    expect(await positionOf(jane)).toEqual({
      dentistId: data.dentistId,
      startAt: at(day, '11:00'),
    });

    // В колонку Dr. Boris на 11:00 — там Bob Client: сервер отказывает, запись на месте
    const annaColumn = (await page
      .locator(`[data-column="${data.dentistId}|${day}"]`)
      .boundingBox())!;
    const borisColumn = (await page.locator(`[data-column="${boris}|${day}"]`).boundingBox())!;
    const toBoris = borisColumn.x - annaColumn.x;
    await drag(page, /^11:00\sAM Jane Client$/, toBoris, 0);
    await page.getByText('This time is taken by another booking.').waitFor();
    await shot(page, '2-refused');
    expect(await positionOf(jane)).toEqual({
      dentistId: data.dentistId,
      startAt: at(day, '11:00'),
    });

    // К Dr. Boris на 13:00 — свободно
    await drag(page, /^11:00\sAM Jane Client$/, toBoris, 144);
    await page.getByText('Booking moved.').waitFor();
    await page.getByRole('button', { name: /^1:00\sPM Jane Client$/ }).waitFor();
    expect(await positionOf(jane)).toEqual({ dentistId: boris, startAt: at(day, '13:00') });
    await shot(page, '3-moved');

    // История записи: оба переноса — что изменилось и кто это сделал
    await page.getByRole('button', { name: /^1:00\sPM Jane Client$/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Booking' });
    await dialog.getByRole('button', { name: 'History' }).click();
    await dialog.getByText(/^Time: .*10:00\sAM → .*11:00\sAM$/).waitFor();
    await dialog.getByText(/^Time: .*11:00\sAM → .*1:00\sPM$/).waitFor();
    await dialog.getByText('Dentist: Dr. Anna → Dr. Boris').waitFor();
    expect(await dialog.getByText('Front desk · Olivia Owner').count()).toBeGreaterThanOrEqual(2);
    await shot(page, '3-history');

    const busy = await database.db
      .select({ startAt: appointments.startAt, dentistId: appointments.dentistId })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, owner.clinicId),
          inArray(appointments.status, ['pending', 'confirmed']),
        ),
      );
    // Ни у одного врача нет двух записей на одно время
    const keys = busy.map((b) => `${b.dentistId}|${b.startAt.toISOString()}`);
    expect(new Set(keys).size).toBe(keys.length);
    await page.context().close();
  });

  it('books a client by clicking free time, even without a phone', async () => {
    const page = await openJournal();
    const column = page.locator(`[data-column="${data.dentistId}|${day}"]`);
    const box = (await column.boundingBox())!;
    // Сетка начинается с 9:00; 15:00 — через 6 часов, 432 px
    await page.mouse.click(box.x + box.width / 2, box.y + 6 * 72 + 4);
    const dialog = page.getByRole('dialog', { name: 'New booking' });
    await dialog.waitFor();
    await dialog.getByLabel('Full name', { exact: true }).fill('Walk-in Client');
    // Телефон необязателен: поле остаётся пустым
    expect(await dialog.getByLabel('Phone (optional)').inputValue()).toBe('');
    await shot(page, '4-booking');
    await dialog.getByRole('button', { name: 'Book' }).click();
    await page.getByText('Booked.').waitFor();
    await page.getByRole('button', { name: /^3:00\sPM Walk-in Client$/ }).waitFor();
    await page.context().close();
  });

  it('edits a saved booking: opens it, Edit, changes the time and details, Save', async () => {
    const id = await book(data.dentistId, '14:00', 'Edit Client', '+12025558003');
    const page = await openJournal();
    await page.getByRole('button', { name: /^2:00\sPM Edit Client$/ }).click();
    await page
      .getByRole('dialog', { name: 'Booking' })
      .getByRole('button', { name: 'Edit' })
      .click();

    // Форма записи открывается с данными записи
    const dialog = page.getByRole('dialog', { name: 'Edit booking' });
    await dialog.waitFor();
    expect(await dialog.getByLabel('Full name', { exact: true }).inputValue()).toBe('Edit Client');
    expect(await dialog.getByLabel('Phone (optional)').inputValue()).toBe('+12025558003');
    expect(await dialog.getByLabel('Time', { exact: true }).inputValue()).toBe('14:00');
    expect(await dialog.getByLabel('Duration, min').inputValue()).toBe('30');

    await dialog.getByLabel('Time', { exact: true }).fill('16:00');
    await dialog.getByLabel('Duration, min').fill('45');
    await dialog.getByLabel('Full name', { exact: true }).fill('Edited Client');
    await dialog.getByLabel('Notes (optional)').fill('Wheelchair access');
    await shot(page, '5-edit');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await page.getByText('Changes saved.').waitFor();
    await page.getByRole('button', { name: /^4:00\sPM Edited Client$/ }).waitFor();

    const [row] = await database.db
      .select({
        startAt: appointments.startAt,
        endAt: appointments.endAt,
        notes: appointments.notes,
      })
      .from(appointments)
      .where(eq(appointments.id, id));
    expect(row).toEqual({
      startAt: new Date(at(day, '16:00')),
      endAt: new Date(at(day, '16:45')),
      notes: 'Wheelchair access',
    });

    // История: одна правка — время, длительность, клиент и заметки
    await page.getByRole('button', { name: /^4:00\sPM Edited Client$/ }).click();
    const card = page.getByRole('dialog', { name: 'Booking' });
    await card.getByRole('button', { name: 'History' }).click();
    await card.getByText('Details changed').waitFor();
    await card.getByText('Duration: 30 → 45 min').waitFor();
    await card
      .getByText(/^Client: Edit Client, \+12025558003 → Edited Client, \+12025558003$/)
      .waitFor();
    await shot(page, '6-edited');
    await page.context().close();
  });
});
