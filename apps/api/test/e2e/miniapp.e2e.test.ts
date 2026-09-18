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

    // Своего клиента врач записывает без SMS-кода — запись сразу подтверждена
    await page.getByRole('button', { name: 'New booking' }).click();
    await page.getByLabel('Date', { exact: true }).fill(day);
    const slots = page.locator('fieldset button');
    await slots.first().waitFor();
    // Intl ставит между временем и AM/PM узкий неразрывный пробел
    const times = (await slots.allTextContents()).map((t) => t.replace(/\s/g, ' '));
    // Занятое и закрытое время в списке не предлагается
    expect(times).not.toContain('10:00 AM');
    expect(times).not.toContain('2:00 PM');
    await page.getByRole('button', { name: /^3:00\sPM$/ }).click();
    await page.getByLabel('Client name', { exact: true }).fill('Bob Walk-in');
    await page.getByLabel('Client phone', { exact: true }).fill('(202) 555-0199');
    await shot(page, '3-book');
    await page.getByRole('button', { name: 'Book', exact: true }).click();
    await page.getByText(/^Booked: /).waitFor();
    await page.getByText('Bob Walk-in').waitFor();
    await shot(page, '4-done');

    const rows = await database.db
      .select({ status: appointments.status, source: appointments.source })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .where(and(eq(appointments.clinicId, owner.clinicId), eq(patients.phone, '+12025550199')));
    expect(rows).toEqual([{ status: 'confirmed', source: 'telegram' }]);

    // Закрытое время открывается обратно
    await page.getByRole('button', { name: 'Reopen' }).click();
    await page.getByText('Closed', { exact: true }).waitFor({ state: 'detached' });
    await page.close();
  });
});
