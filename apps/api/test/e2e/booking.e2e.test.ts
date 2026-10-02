/**
 * Критерий «Готово» Шага 6: запись создаётся end-to-end на тестовой странице.
 * Настоящий API (Postgres и Redis в Testcontainers) на одном origin, страница «сайта
 * клиники» с формой — на другом, Chromium через Playwright. SMS уходят в тестовый
 * отправитель — он живёт только в тестах (§12).
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appointments, patients } from '@dentbook/db';
import {
  startTestDatabase,
  startTestRedis,
  type TestDatabase,
  type TestRedis,
} from '@dentbook/db/testing';
import { buildApp } from '../../src/app.js';
import {
  TestSms,
  call,
  createClinicData,
  registerClinic,
  testEnv,
  type Session,
} from '../helpers.js';

const WIDGET_DIST = fileURLToPath(new URL('../../../widget/dist', import.meta.url));
const testPage = (name: string) =>
  readFileSync(new URL(`../../../widget/test-page/${name}`, import.meta.url), 'utf8');
/** Страницы «сайта клиники»: форма на странице и форма во всплывающем окне. */
const TEST_PAGES: Record<string, string> = {
  '/': testPage('index.html'),
  '/popup': testPage('popup.html'),
};

let database: TestDatabase;
let redisServer: TestRedis;
let redis: Redis;
let api: FastifyInstance;
let apiUrl: string;
let site: Server;
let siteUrl: string;
let browser: Browser;
let owner: Session;
let key: string;
const sms = new TestSms();

const port = (server: { address(): AddressInfo | string | null }) =>
  (server.address() as AddressInfo).port;

beforeAll(async () => {
  [database, redisServer] = await Promise.all([startTestDatabase(), startTestRedis()]);
  redis = new Redis(redisServer.url);
  api = buildApp({
    env: testEnv({ WIDGET_DIST_DIR: WIDGET_DIST }),
    db: database.db,
    redis,
    sms,
    logger: false,
  });
  await api.listen({ host: '127.0.0.1', port: 0 });
  // Разные хосты — разные origin: форма ходит в API кросс-доменно, как на настоящем сайте
  apiUrl = `http://localhost:${port(api.server)}`;

  site = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const page = TEST_PAGES[url.pathname] ?? TEST_PAGES['/']!;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(
      page
        .replaceAll('%WIDGET_SRC%', `${apiUrl}/widget/dentbook-widget.js`)
        .replaceAll('%KEY%', url.searchParams.get('key') ?? key),
    );
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  siteUrl = `http://127.0.0.1:${port(site)}`;

  owner = await registerClinic(api, {
    clinicName: 'Test Dental Clinic',
    timezone: 'America/New_York',
  });
  await createClinicData(api, owner, { dentistName: 'Dr. Anna' });
  key = (
    await call<{ token: string }>(
      api,
      owner,
      {
        method: 'POST',
        url: '/v1/admin/api-keys',
        payload: { name: 'Test site', allowedOrigins: [siteUrl] },
      },
      201,
    )
  ).token;

  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  site?.close();
  await api?.close();
  redis?.disconnect();
  await Promise.all([database?.stop(), redisServer?.stop()]);
});

/** E2E_SCREENSHOTS=<каталог> — сохранить экраны формы по шагам для просмотра глазами. */
async function shot(page: Page, name: string) {
  const dir = process.env.E2E_SCREENSHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

async function openPage(width = 1024, path = '/'): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto(`${siteUrl}${path}`);
  return page;
}

describe('booking form on a clinic website (Step 6)', () => {
  it('a client books a visit end to end', async () => {
    const page = await openPage();
    await page.getByRole('button', { name: /Checkup/ }).waitFor();
    await shot(page, '1-service');
    await page.getByRole('button', { name: /Checkup/ }).click();

    // Одна клиника, один офис — сразу выбор времени; первый свободный день уже выбран
    const firstSlot = page.locator('button.slot').first();
    await firstSlot.waitFor();
    const time = (await firstSlot.textContent())!.trim();
    await shot(page, '2-time');
    await firstSlot.click();

    await page.getByText(/The time is held for you for \d+:\d\d/).waitFor();
    await page.getByLabel('Full name').fill('Jane Client');
    await page.getByLabel('Mobile phone').fill('(202) 555-0199');
    await page.getByLabel('Email (optional)').fill('jane@example.com');
    await shot(page, '3-details');
    await page.getByRole('button', { name: 'Send code' }).click();

    await page.getByText('We texted a 6-digit code to +12025550199.').waitFor();
    await page.getByLabel('Code').fill(sms.lastCode('+12025550199'));
    await shot(page, '4-code');
    await page.getByRole('button', { name: 'Book' }).click();

    await page.getByText('You are booked!').waitFor();
    await shot(page, '5-done');
    await expect(page.getByText(time, { exact: false }).first().isVisible()).resolves.toBe(true);
    await page.getByText('Dentist: Dr. Anna').waitFor();

    const [booked] = await database.db
      .select({ status: appointments.status, name: patients.fullName })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .where(and(eq(appointments.clinicId, owner.clinicId), eq(patients.phone, '+12025550199')));
    expect(booked).toEqual({ status: 'confirmed', name: 'Jane Client' });
    await page.close();
  });

  it('going back from the details step releases the held time', async () => {
    const page = await openPage();
    await page.getByRole('button', { name: /Checkup/ }).click();
    const firstSlot = page.locator('button.slot').first();
    await firstSlot.waitFor();
    const time = (await firstSlot.textContent())!.trim();
    await firstSlot.click();
    await page.getByText(/The time is held for you/).waitFor();

    await page.getByRole('button', { name: '← Back' }).click();
    // Холд снят: то же время снова в списке, ошибок на странице нет
    await page.locator('button.slot', { hasText: time }).first().waitFor();
    await page.close();
  });

  it('a hold that expires while the client types sends them back to choose a time', async () => {
    const page = await openPage();
    await page.getByRole('button', { name: /Checkup/ }).click();
    await page.locator('button.slot').first().click();
    await page.getByText(/The time is held for you/).waitFor();

    // Время холда вышло на сервере — ответ hold_expired на подтверждении
    await database.db
      .update(appointments)
      .set({ holdExpiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(appointments.clinicId, owner.clinicId), eq(appointments.status, 'hold')));
    await page.getByLabel('Full name').fill('Late Client');
    await page.getByLabel('Mobile phone').fill('(202) 555-0177');
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByText('We texted a 6-digit code to +12025550177.').waitFor();
    await page.getByLabel('Code').fill(sms.lastCode('+12025550177'));
    await page.getByRole('button', { name: 'Book' }).click();

    await page.getByText('The time you held has expired. Please choose a time again.').waitFor();
    await page.locator('button.slot').first().waitFor();
    await page.close();
  });

  it("keeps the clinic site's styles out of the form", async () => {
    const page = await openPage();
    const button = page.getByRole('button', { name: /Checkup/ });
    await button.waitFor();
    const { color, font } = await button.evaluate((el) => {
      const style = getComputedStyle(el);
      return { color: style.color, font: style.fontFamily };
    });
    expect(color).not.toBe('rgb(255, 0, 0)');
    expect(font).not.toContain('Comic Sans');
    await page.close();
  });

  it('works on a phone screen', async () => {
    const page = await openPage(375);
    await page.getByRole('button', { name: /Checkup/ }).click();
    await page.locator('button.slot').first().waitFor();
    await shot(page, '6-phone');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await page.close();
  });

  it('shows a friendly message when the key does not fit the website', async () => {
    const page = await browser.newPage();
    await page.goto(`${siteUrl}/?key=pk_revokedorunknownkey`);
    await page.getByText('Online booking is not available right now').waitFor();
    await page.close();
  });

  it('serves the bundle within the 50 KB gzip budget', async () => {
    const res = await fetch(`${apiUrl}/widget/dentbook-widget.js`, {
      headers: { 'accept-encoding': 'identity' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    const { gzipSync } = await import('node:zlib');
    const size = gzipSync(Buffer.from(await res.arrayBuffer())).length;
    expect(size).toBeLessThan(50 * 1024);
  });
});

describe('booking form in a popup on a clinic website', () => {
  it('stays closed and quiet until a site button opens it, then books a visit', async () => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
    page.on('pageerror', (error) => {
      throw error;
    });
    const calls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/v1/public/')) calls.push(request.url());
    });
    await page.goto(`${siteUrl}/popup`);
    const dialog = page.getByRole('dialog', { name: 'Online booking' });
    expect(await dialog.isVisible()).toBe(false);
    // Окно не ходит в API, пока его не открыли: кнопки записи стоят на многих страницах
    expect(calls).toEqual([]);

    await page.getByRole('button', { name: 'Book a visit', exact: true }).click();
    await dialog.getByRole('button', { name: /Checkup/ }).click();
    await shot(page, '7-popup-time');
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');
    await dialog.locator('button.slot').first().click();

    await dialog.getByText(/The time is held for you/).waitFor();
    await dialog.getByLabel('Full name').fill('Pat Popup');
    // Escape в списке стран закрывает список, а не окно
    await dialog.getByRole('button', { name: 'Country code' }).click();
    await page.keyboard.press('Escape');
    expect(await dialog.isVisible()).toBe(true);
    await dialog.getByLabel('Mobile phone').fill('(202) 555-0133');
    await dialog.getByRole('button', { name: 'Send code' }).click();
    await dialog.getByText('We texted a 6-digit code to +12025550133.').waitFor();
    await dialog.getByLabel('Code', { exact: true }).fill(sms.lastCode('+12025550133'));
    await dialog.getByRole('button', { name: 'Book', exact: true }).click();
    await dialog.getByText('You are booked!').waitFor();
    await shot(page, '8-popup-done');

    // Крестик закрывает окно и возвращает прокрутку; ссылка открывает его на том же шаге
    await dialog.getByRole('button', { name: 'Close' }).click();
    await dialog.waitFor({ state: 'hidden' });
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
    await page.getByRole('link', { name: 'Book online' }).click();
    await dialog.getByText('You are booked!').waitFor();

    const [booked] = await database.db
      .select({ status: appointments.status })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .where(and(eq(appointments.clinicId, owner.clinicId), eq(patients.phone, '+12025550133')));
    expect(booked).toEqual({ status: 'confirmed' });
    await page.close();
  });

  it('closes on Escape and on a click outside; buttons added later open it too', async () => {
    const page = await openPage(1024, '/popup');
    const dialog = page.getByRole('dialog', { name: 'Online booking' });
    await page.evaluate(() => {
      const button = document.createElement('button');
      button.className = 'dentbook-open';
      button.textContent = 'Added later';
      document.querySelector('main')!.append(button);
    });
    await page.getByRole('button', { name: 'Added later' }).click();
    await dialog.getByRole('button', { name: /Checkup/ }).waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });

    await page.getByRole('button', { name: 'Book a visit', exact: true }).click();
    await dialog.waitFor();
    await page.mouse.click(8, 8); // затемнение вокруг окна
    await dialog.waitFor({ state: 'hidden' });
    await page.close();
  });

  it('takes the whole screen on a phone', async () => {
    const page = await openPage(375, '/popup');
    await page.getByRole('button', { name: 'Book a visit', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Online booking' });
    await dialog.getByRole('button', { name: /Checkup/ }).click();
    await dialog.locator('button.slot').first().waitFor();
    await shot(page, '9-popup-phone');
    expect(await dialog.boundingBox()).toEqual({ x: 0, y: 0, width: 375, height: 900 });
    await page.close();
  });
});
