import { describe, expect, it } from 'vitest';
import { setupBot } from './setup.js';

function fakeApi() {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return true as const;
    };
  return {
    calls,
    api: {
      setWebhook: record('setWebhook'),
      setChatMenuButton: record('setChatMenuButton'),
      setMyCommands: record('setMyCommands'),
    },
  };
}

describe('setupBot (§8)', () => {
  it('points the webhook and the menu button at the platform', async () => {
    const { api, calls } = fakeApi();
    const result = await setupBot(api, {
      publicBaseUrl: 'https://dentbook.example.com',
      webhookSecret: 'secret-secret-secret',
    });

    expect(result).toEqual({
      webhookUrl: 'https://dentbook.example.com/telegram/webhook',
      miniAppUrl: 'https://dentbook.example.com/miniapp/',
    });
    expect(calls[0]).toEqual({
      method: 'setWebhook',
      args: [
        'https://dentbook.example.com/telegram/webhook',
        { secret_token: 'secret-secret-secret', allowed_updates: ['message', 'callback_query'] },
      ],
    });
    expect(calls[1]!.args[0]).toMatchObject({
      menu_button: { type: 'web_app', web_app: { url: 'https://dentbook.example.com/miniapp/' } },
    });
  });

  it('describes /start in every interface language', async () => {
    const { api, calls } = fakeApi();
    await setupBot(api, { publicBaseUrl: 'https://x.example', webhookSecret: 'secret-secret-12' });

    const commands = calls.filter((c) => c.method === 'setMyCommands');
    expect(commands.map((c) => c.args[1])).toEqual([
      {},
      { language_code: 'ru' },
      { language_code: 'hy' },
    ]);
    const descriptions = commands.map(
      (c) => (c.args[0] as { description: string }[])[0]!.description,
    );
    expect(new Set(descriptions).size).toBe(3);
  });
});
