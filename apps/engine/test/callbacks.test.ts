import type { AccountProvider } from '@ghostaff/shared';
import { describe, expect, it } from 'vitest';
import { type AccountDeps, type Attempt, callbackKey, callbackUrl, returnFromProvider } from '../src/accounts';
import { registerClientLenient } from '../src/mcp';

const ENGINE = 'https://engine.example';

function depsWith(attempt: Attempt): AccountDeps {
  return {
    accounts: { findAttempt: async (s: string) => (s === attempt.state ? attempt : null), takeAttempt: async () => attempt } as never,
    vault: null as never,
    providers: {},
    publicUrl: ENGINE,
    returnOrigins: [],
    tools: [],
  };
}

const attempt = (provider: AccountProvider): Attempt => ({
  state: 'st',
  orgId: 'o',
  userId: 'u',
  provider,
  codeVerifier: 'v',
  returnTo: 'ghostaff://conexiones',
  createdAt: new Date().toISOString(),
});

describe('one callback for every Google card', () => {
  it('sends every Google card back to /google/callback, and the rest to their own', () => {
    for (const p of ['google', 'searchconsole', 'analytics', 'youtube', 'googlebusiness'] as const) {
      expect(callbackUrl(ENGINE, p)).toBe(`${ENGINE}/connections/oauth/google/callback`);
    }
    expect(callbackKey('notion')).toBe('notion');
    expect(callbackUrl(ENGINE, 'microsoft')).toBe(`${ENGINE}/connections/oauth/microsoft/callback`);
  });

  it('finds the card from the attempt, and refuses a path that is not its callback', async () => {
    const deps = depsWith(attempt('searchconsole'));
    const to = await returnFromProvider(deps, 'google', { state: 'st', code: 'c' });
    expect(new URL(to!).searchParams.get('connected')).toBe('searchconsole');
    expect(await returnFromProvider(deps, 'searchconsole', { state: 'st', code: 'c' })).toBeNull();
    expect(await returnFromProvider(deps, 'notion', { state: 'st', code: 'c' })).toBeNull();
  });
});

describe('registerClientLenient', () => {
  const reply = (status: number, body: unknown): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  const meta = { redirect_uris: ['https://engine.example/connections/oauth/holded/callback'], client_name: 'Ghostaff' };

  it('reads a field sent as null as absent (Holded: software_id null)', async () => {
    const got = await registerClientLenient('https://as/register', reply(201, { client_id: 'abc', software_id: null, ...meta }), meta);
    expect(got.client_id).toBe('abc');
    expect('software_id' in got).toBe(false);
  });

  it("keeps the server's own reason when it refuses", async () => {
    const refuse = reply(403, { error: 'registration_not_supported', error_description: 'Only pre-registered partners' });
    await expect(registerClientLenient('https://as/register', refuse, meta)).rejects.toThrow(/403.*registration_not_supported/);
  });
});
