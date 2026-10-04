/**
 * Критерий «Готово» Шага 7: врач проходит весь цикл в Telegram без админки. Бот
 * (привязка, алерты, кнопка «Подтвердить») покрыт telegram.integration.test.ts; здесь —
 * собранный Mini App в Chromium против настоящего API. Скрипт telegram-web-app.js
 * подменяется заглушкой с initData, подписанной тестовым токеном бота, — как её подписывает
 * Telegram.
 */
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, isoWeekday, localDateOf, zonedTimeToUtc } from '@dentbook/core';
import { appointments, patients } from '@dentbook/db';
import {
  startTestDatabase,
  startTestRedis,
  type TestDatabase,
  type TestRedis,
} from '@dentbook/db/testing';
import type { HoldResponse, TelegramLink } from '@dentbook/shared';
import {
  TestOutbox,
  TestSms,
  call,
  createClinicData,
  registerClinic,
  signInitData,
  testApp,
  testTelegram,
  type ClinicFixture,
  type Session,
} from '../helpers.js';

const MINIAPP_DIST = fileURLToPath(new URL('../../../miniapp/dist', import.meta.url));
const ZONE = 'America/New_York';
const ORIGIN = 'https://clinic.example';
const ANNA_CHAT = 1001;

let database: TestDatabase;
let redisServer: TestRedis;
let redis: Redis;
let app: FastifyInstance;
let apiUrl: string;
let browser: Browser;
let owner: Session;
let data: ClinicFixture;
let key: string;
const sms = new TestSms();
const telegram = testTelegram(new TestOutbox());

/** Ближайший будний день через 2+ суток: запас от минимального времени до записи. */
function upcomingWeekday(): string {
  let date = addDays(localDateOf(new Date(), ZONE), 2);
  while (isoWeekday(date) > 5) date = addDays(date, 1);
  return date;
}
const at = (date: string, time: string) => {
  const [h, m] = time.split(':').map(Number);
  return zonedTimeToUtc(date, h! * 60 + m!, ZONE).toISOString();
};

/** Запись с сайта клиники: холд → SMS-код → подтверждение. */
async function bookFromWebsite(startAt: string): Promise<void> {
  const headers = { authorization: `Bearer ${key}`, origin: ORIGIN };
  const hold = await app.inject({
    method: 'POST',
    url: '/v1/public/holds',
    headers,
    payload: { service_id: data.serviceId, location_id: data.locationId, start_at: startAt },
  });
  expect(hold.statusCode, hold.body).toBe(201);
  const phone = '+12025553001';
  const verification = await app.inject({
    method: 'POST',
    url: '/v1/public/verifications',
    headers,
    payload: { phone },
  });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/public/appointments',
    headers,
    payload: {
      hold_id: hold.json<HoldResponse>().hold_id,
      verification_id: verification.json().verification_id,
      code: sms.lastCode(phone),
      client: { full_name: 'Jane Client', phone },
    },
  });
  expect(res.statusCode, res.body).toBe(201);
}

/** Заглушка telegram-web-app.js: WebApp с подписанной initData; showConfirm — «OK». */
const telegramStub = (initData: string) => `
  window.Telegram = { WebApp: {
    initData: ${JSON.stringify(initData)},
    initDataUnsafe: { user: { id: ${ANNA_CHAT}, language_code: 'en' } },
    colorScheme: 'light',
    ready() {}, expand() {},
    showConfirm(message, callback) { callback(true); },
  } };`;

/** E2E_SCREENSHOTS=<каталог> — сохранить экраны Mini App по шагам для просмотра глазами. */
async function shot(page: Page, name: string) {
  const dir = process.env.E2E_SCREENSHOTS;
  if (dir) await page.screenshot({ path: `${dir}/miniapp-${name}.png`, fullPage: true });
}

async function openMiniApp(initData: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.route('https://telegram.org/**', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: telegramStub(initData) }),
  );
  await page.goto(`${apiUrl}/miniapp/`);
  return page;
}

beforeAll(async () => {
  [database, redisServer] = await Promise.all([startTestDatabase(), startTestRedis()]);
  redis = new Redis(redisServer.url);
  app = testApp(database.db, { MINIAPP_DIST_DIR: MINIAPP_DIST }, { redis, sms, telegram });
  await app.listen({ host: '127.0.0.1', port: 0 });
  apiUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

  owner = await registerClinic(app, { clinicName: 'Smile Dental', timezone: ZONE });
  data = await createClinicData(app, owner, { dentistName: 'Dr. Anna' });
  await call(app, owner, {
    method: 'PATCH',
    url: '/v1/admin/clinic',
    payload: { bookingRequiresConfirmation: true },
  });
  key = (
    await call<{ token: string }>(
      app,
      owner,
      {
        method: 'POST',
        url: '/v1/admin/api-keys',
        payload: { name: 'Site', allowedOrigins: [ORIGIN] },
      },
      201,
    )
  ).token;

  // Привязка — как в боте: врач открывает ссылку t.me/<bot>?start=<token>
  const link = await call<TelegramLink>(
    app,
    owner,
    { method: 'POST', url: `/v1/admin/dentists/${data.dentistId}/telegram-link` },
    201,
  );
  const linked = await app.inject({
    method: 'POST',
    url: '/telegram/webhook',
    headers: { 'x-telegram-bot-api-secret-token': telegram.webhookSecret },
    payload: {
      update_id: 1,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: ANNA_CHAT, type: 'private' },
        from: { id: ANNA_CHAT, is_bot: false, first_name: 'Anna' },
        text: `/start ${new URL(link.url).searchParams.get('start')}`,
      },
    },
  });
  expect(linked.statusCode).toBe(200);

  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  redis?.disconnect();
  await Promise.all([database?.stop(), redisServer?.stop()]);
});

describe('dentist mini app (Step 7)', () => {
  it('asks to open it from the bot when there is no Telegram signature', async () => {
    const page = await openMiniApp('');
    await page.getByText('Open the schedule from the DentBook bot in Telegram.').waitFor();
    await page.close();
  });

  it('refuses a Telegram account that is not connected to a dentist', async () => {
    const page = await openMiniApp(signInitData(424242));
    await page.getByText('This Telegram account is not connected to a dentist.').waitFor();
    await page.close();
  });

  it('a dentist confirms a booking, closes time and books their own client', async () => {
    const day = upcomingWeekday();
    await bookFromWebsite(at(day, '10:00'));

    const page = await openMiniApp(signInitData(ANNA_CHAT));
    await page.getByText('Dr. Anna').waitFor();

    // Расписание открывается на сегодня — листаем до дня записи
    let shown = localDateOf(new Date(), ZONE);
    while (shown < day) {
      await page.getByRole('button', { name: 'Next day' }).click();
      shown = addDays(shown, 1);
    }
    await page.getByText('Jane Client').waitFor();
    await page.getByText('Awaits confirmation').waitFor();
    await shot(page, '1-schedule');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await page.getByText('Awaits confirmation').waitFor({ state: 'detached' });

    // Закрыть время поверх записи нельзя: список записей, переносит регистратура (§8)
    await page.getByRole('button', { name: 'Close time' }).click();
    await page.getByLabel('Date', { exact: true }).fill(day);
    await page.getByLabel('From', { exact: true }).fill('09:30');
    await page.getByLabel('To', { exact: true }).fill('11:00');
    await page.locator('form').getByRole('button', { name: 'Close time' }).click();
    await page.getByText('This time has appointments.', { exact: false }).waitFor();
    await shot(page, '2-conflict');

    await page.getByLabel('From', { exact: true }).fill('14:00');
    await page.getByLabel('To', { exact: true }).fill('15:00');
    await page.locator('form').getByRole('button', { name: 'Close time' }).click();
    await page.getByText('Time closed.').waitFor();
    await page.getByText('Closed', { exact: true }).waitFor();

    // Своего клиента врач записывает без SMS-кода — запись сразу подтверждена.
    // Длительность сначала — как у услуги, её можно изменить для этой записи
    await page.getByRole('button', { name: 'New booking' }).click();
    expect(await page.getByLabel(/^Duration, minutes/).inputValue()).toBe('30');
    await page.getByLabel('Date', { exact: true }).fill(day);
    const slots = page.locator('fieldset button');
    await slots.first().waitFor();
    // Intl ставит между временем и AM/PM узкий неразрывный пробел
    const times = (await slots.allTextContents()).map((t) => t.replace(/\s/g, ' '));
    // Занятое и закрытое время в списке не предлагается
    expect(times).not.toContain('10:00 AM');
    expect(times).not.toContain('2:00 PM');
    // …но занятое видно рядом: запись — красной клеткой, закрытое время — серой
    const busy = (await page.locator('fieldset [data-busy]').allTextContents()).map((t) =>
      t.replace(/\s/g, ' '),
    );
    expect(busy).toEqual(['10:00 AM, Booked', '2:00 PM, Closed']);
    await page.getByRole('button', { name: /^3:00\sPM$/ }).click();
    await page.getByLabel('Client name', { exact: true }).fill('Bob Walk-in');
    await page.getByLabel('Client phone (optional)', { exact: true }).fill('(202) 555-0199');
    await page.getByLabel('Comment (optional)', { exact: true }).fill('Wants a morning call');
    await shot(page, '3-book');
    await page.getByRole('button', { name: 'Book', exact: true }).click();
    await page.getByText(/^Booked: /).waitFor();
    await page.getByText('Bob Walk-in').waitFor();
    await page.getByText('Wants a morning call').waitFor();
    await shot(page, '4-done');

    const rows = await database.db
      .select({
        status: appointments.status,
        source: appointments.source,
        notes: appointments.notes,
      })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .where(and(eq(appointments.clinicId, owner.clinicId), eq(patients.phone, '+12025550199')));
    expect(rows).toEqual([
      { status: 'confirmed', source: 'telegram', notes: 'Wants a morning call' },
    ]);

    // Закрытое время открывается обратно
    await page.getByRole('button', { name: 'Reopen' }).click();
    await page.getByText('Closed', { exact: true }).waitFor({ state: 'detached' });
    await page.close();
  });

  it('a dentist edits, moves and cancels their own booking', async () => {
    const day = upcomingWeekday();
    const page = await openMiniApp(signInitData(ANNA_CHAT));
    await page.getByText('Dr. Anna').waitFor();
    let shown = localDateOf(new Date(), ZONE);
    while (shown < day) {
      await page.getByRole('button', { name: 'Next day' }).click();
      shown = addDays(shown, 1);
    }
    const edit = async (client: string) =>
      page.locator('li', { hasText: client }).getByRole('button', { name: 'Edit' }).click();

    // Имя и комментарий
    await edit('Bob Walk-in');
    await page.getByLabel('Client name', { exact: true }).fill('Bob Walker');
    // Текст textarea входит в текст её label, поэтому — по началу подписи
    await page.getByLabel(/^Comment \(optional\)/).fill('Prefers afternoons');
    await shot(page, '5-edit');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Changes saved.').waitFor();
    await page.getByText('Prefers afternoons').waitFor();

    // Перенос на другое свободное время того же дня. Текущее время записи выделено сразу
    await edit('Bob Walker');
    await page.getByRole('button', { name: /^3:00\sPM$/, pressed: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Move', exact: true }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: /^4:00\sPM$/ }).click();
    await page.getByRole('button', { name: 'Move', exact: true }).click();
    await page.getByText(/^Moved to /).waitFor();
    await page
      .locator('li', { hasText: 'Bob Walker' })
      .getByText(/^4:00\sPM/)
      .waitFor();

    // Красная клетка в сетке времени открывает свою запись; «Назад» — на ту же вкладку
    await page.getByRole('button', { name: 'New booking' }).click();
    await page.getByLabel('Date', { exact: true }).fill(day);
    await page.locator('fieldset button[data-busy="booked"]', { hasText: /^4:00\sPM/ }).click();
    expect(await page.getByLabel('Client name', { exact: true }).inputValue()).toBe('Bob Walker');
    await page.getByRole('button', { name: '‹ Back' }).click();
    await page.getByRole('button', { name: 'Book', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Schedule', exact: true }).click();

    // Регистратура пишет заметку в карточке клиента — врач увидит её в записи (Q19)
    const [bob] = await database.db
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.clinicId, owner.clinicId), eq(patients.phone, '+12025550199')));
    await call(
      app,
      owner,
      {
        method: 'POST',
        url: `/v1/admin/clients/${bob!.id}/notes`,
        payload: { text: 'Pays in cash' },
      },
      201,
    );

    // История: что, кем и когда менялось
    // Имя клиента в карточке открывает запись так же, как «Изменить»
    await page.getByRole('button', { name: 'Bob Walker', exact: true }).click();

    // Заметки о клиенте: заметка регистратуры и комментарий врача — один, правка его
    // поменяла, а не добавила второй
    const notes = page.getByRole('list', { name: 'Client notes' });
    await notes.getByText('Pays in cash').waitFor();
    await notes.getByText('Front desk · Olivia Owner', { exact: false }).waitFor();
    const comment = notes.getByRole('listitem').filter({ hasText: 'Prefers afternoons' });
    await comment.getByText(/Dentist · Dr\. Anna · edited$/).waitFor();
    await comment.getByText('This booking').waitFor();
    expect(await notes.getByRole('listitem').count()).toBe(2);
    await shot(page, '6-client-notes');

    await page.getByRole('button', { name: 'History' }).click();
    const history = page.getByRole('list');
    await history.getByText('Moved', { exact: true }).waitFor();
    await history.getByText(/^Time: .*3:00\sPM → .*4:00\sPM$/).waitFor();
    await history
      .getByText('Client: Bob Walk-in, +12025550199 → Bob Walker, +12025550199')
      .waitFor();
    await history.getByText('Comment: Wants a morning call → Prefers afternoons').waitFor();
    await history.getByText('Dentist · Dr. Anna').first().waitFor();
    await shot(page, '6-history');

    // Отмена — запись уходит из расписания
    await page.getByRole('button', { name: 'Cancel booking' }).click();
    await page.getByText('Booking cancelled.').waitFor();
    await page.getByText('Bob Walker').waitFor({ state: 'detached' });

    // С флажком отменённая видна: кто отменил, и вместо «Изменить» — «История»
    const showCancelled = page.getByLabel('Show cancelled bookings');
    await showCancelled.check();
    const card = page.locator('li', { hasText: 'Bob Walker' });
    await card.getByText('Cancelled by you').waitFor();
    expect(await card.getByRole('button', { name: 'Edit' }).count()).toBe(0);
    await shot(page, '7-cancelled');
    await card.getByRole('button', { name: 'History' }).click();
    // Отменённую не поправить — только посмотреть, история открыта сразу
    await page.getByRole('list').getByText('Cancelled', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Save', exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Cancel booking' }).count()).toBe(0);
    await shot(page, '8-cancelled-history');

    // Флажок помнится; снятый — отменённые снова скрыты
    await page.getByRole('button', { name: '‹ Back' }).click();
    expect(await showCancelled.isChecked()).toBe(true);
    await card.waitFor();
    await showCancelled.uncheck();
    await card.waitFor({ state: 'detached' });

    const rows = await database.db
      .select({
        status: appointments.status,
        cancelledBy: appointments.cancelledBy,
        startAt: appointments.startAt,
        notes: appointments.notes,
        name: patients.fullName,
      })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .where(and(eq(appointments.clinicId, owner.clinicId), eq(patients.phone, '+12025550199')));
    expect(rows).toEqual([
      {
        status: 'cancelled',
        cancelledBy: 'dentist',
        startAt: new Date(at(day, '16:00')),
        notes: 'Prefers afternoons',
        name: 'Bob Walker',
      },
    ]);
    await page.close();
  });

  it('a dentist books "Other" for a client without a phone, and the list stays the same', async () => {
    const day = upcomingWeekday();
    const page = await openMiniApp(signInitData(ANNA_CHAT));
    await page.getByText('Dr. Anna').waitFor();
    await page.getByRole('button', { name: 'New booking' }).click();
    // Текст выбранного пункта входит в имя списка, поэтому — по началу подписи
    const serviceList = page.getByRole('combobox', { name: /^Service/ });
    const listed = await serviceList.locator('option').allTextContents();
    expect(listed.at(-1)).toBe('Other');
    await serviceList.selectOption({ label: 'Other' });
    await page.getByLabel(/^Duration, minutes/).fill('50');
    await page.getByLabel('Date', { exact: true }).fill(day);
    await page.getByRole('button', { name: /^11:00\sAM$/ }).click();
    await page.getByLabel('Client name', { exact: true }).fill('Carl Custom');
    // Телефон врач может не указывать
    await shot(page, '9-custom-service');
    await page.getByRole('button', { name: 'Book', exact: true }).click();
    await page.getByText(/^Booked: /).waitFor();
    await page
      .locator('li', { hasText: 'Carl Custom' })
      .getByText('Other', { exact: true })
      .waitFor();

    // Разовая: новой услуги в списке не появилось
    await page.getByRole('button', { name: 'New booking' }).click();
    expect(await serviceList.locator('option').allTextContents()).toEqual(listed);

    const rows = await database.db
      .select({ startAt: appointments.startAt, endAt: appointments.endAt, phone: patients.phone })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .where(and(eq(appointments.clinicId, owner.clinicId), eq(patients.fullName, 'Carl Custom')));
    expect(rows).toEqual([
      { startAt: new Date(at(day, '11:00')), endAt: new Date(at(day, '11:50')), phone: null },
    ]);
    await page.close();
  });
});
