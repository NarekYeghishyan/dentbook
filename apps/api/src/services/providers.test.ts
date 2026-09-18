import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnstileVerifier } from './captcha.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

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
