import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmsError, TwilioSmsSender } from './sms.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const sender = (from = 'MG1') =>
  new TwilioSmsSender({ accountSid: 'AC1', authToken: 'secret', sender: from });

describe('TwilioSmsSender', () => {
  it('posts the message with basic auth and a sender number', async () => {
    const fetchMock = stubFetch(201, { sid: 'SM1' });
    const result = await sender('+12025550100').send({ to: '+12025550123', text: 'Hello' });
    expect(result).toEqual({ id: 'SM1' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('AC1:secret').toString('base64')}`,
    );
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      To: '+12025550123',
      Body: 'Hello',
      From: '+12025550100',
    });
  });

  it('uses a Messaging Service when the sender is MG…', async () => {
    const fetchMock = stubFetch(201, { sid: 'SM2' });
    await sender('MG123').send({ to: '+12025550123', text: 'Hi' });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.body as URLSearchParams).get('MessagingServiceSid')).toBe('MG123');
  });

  it('treats a rejected number as permanent and does not leak it', async () => {
    stubFetch(400, { code: 21211, message: "The 'To' number +12025550123 is not valid" });
    const error = await sender()
      .send({ to: '+12025550123', text: 'Hi' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmsError);
    expect(error).toMatchObject({ status: 400, code: 21211, permanent: true });
    expect((error as SmsError).label).toBe('sms_400_21211');
    expect(String((error as Error).message)).not.toMatch(/2025550123/);
  });

  it('retries overload, server errors and network failures', async () => {
    stubFetch(429, { code: 20429 });
    await expect(sender().send({ to: '+12025550123', text: 'Hi' })).rejects.toMatchObject({
      permanent: false,
    });
    stubFetch(503, {});
    await expect(sender().send({ to: '+12025550123', text: 'Hi' })).rejects.toMatchObject({
      permanent: false,
      label: 'sms_503_unknown',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    await expect(sender().send({ to: '+12025550123', text: 'Hi' })).rejects.toMatchObject({
      permanent: false,
      label: 'network',
    });
  });
});
