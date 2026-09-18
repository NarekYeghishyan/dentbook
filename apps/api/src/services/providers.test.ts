import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnstileVerifier } from './captcha.js';
import { TwilioSmsSender } from './sms-twilio.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('TwilioSmsSender', () => {
  it('posts the message with basic auth and a sender number', async () => {
    const fetchMock = stubFetch(201, { sid: 'SM1' });
    await new TwilioSmsSender({
      accountSid: 'AC1',
      authToken: 'secret',
      sender: '+12025550100',
    }).send({
      to: '+12025550123',
      text: 'Hello',
    });
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
    const fetchMock = stubFetch(201, {});
    await new TwilioSmsSender({ accountSid: 'AC1', authToken: 's', sender: 'MG123' }).send({
      to: '+12025550123',
      text: 'Hi',
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.body as URLSearchParams).get('MessagingServiceSid')).toBe('MG123');
  });

  it('fails without leaking the phone number', async () => {
    stubFetch(400, { code: 21211, message: "The 'To' number +12025550123 is not valid" });
    const sending = new TwilioSmsSender({ accountSid: 'AC1', authToken: 's', sender: 'MG1' }).send({
      to: '+12025550123',
      text: 'Hi',
    });
    await expect(sending).rejects.toThrow('Twilio responded 400, code 21211');
    await expect(sending).rejects.not.toThrow(/2025550123/);
  });
});

describe('TurnstileVerifier', () => {
  it('sends the secret, token and IP and reads success', async () => {
    const fetchMock = stubFetch(200, { success: true });
    const verifier = new TurnstileVerifier('site', 'secret');
    expect(await verifier.verify('token', '203.0.113.7')).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      secret: 'secret',
      response: 'token',
      remoteip: '203.0.113.7',
    });
  });

  it('rejects a failed check', async () => {
    stubFetch(200, { success: false, 'error-codes': ['invalid-input-response'] });
    expect(await new TurnstileVerifier('site', 'secret').verify('bad', '1.1.1.1')).toBe(false);
  });
});
