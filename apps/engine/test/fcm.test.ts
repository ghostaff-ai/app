import { describe, expect, it } from 'vitest';
import { fcmTransport } from '../src/push/fcm';
import type { Device, Push } from '../src/push/transport';

const device: Device = { token: 'tok-a', platform: 'android', apnsEnvironment: null, bundleId: 'app.ghostaff' };
const push: Push = { title: 'Ana', body: 'Tienes una decisión', data: { thread: 't1' }, collapseId: 'c1' };

function transportAnswering(status: number, json: unknown = {}) {
  const calls: Array<{ url: string; auth: string | null; body: unknown }> = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, auth: new Headers(init.headers).get('authorization'), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
  return { transport: fcmTransport('proj-1', { accessToken: async () => 'at-1', fetch: f }), calls };
}

describe('FCM transport', () => {
  it('posts the v1 message with the access token', async () => {
    const { transport, calls } = transportAnswering(200);
    expect(await transport.send(device, push)).toBe('delivered');
    expect(calls[0]).toEqual({
      url: 'https://fcm.googleapis.com/v1/projects/proj-1/messages:send',
      auth: 'Bearer at-1',
      body: {
        message: {
          token: 'tok-a',
          notification: { title: 'Ana', body: 'Tienes una decisión' },
          data: { thread: 't1' },
          android: { priority: 'high', collapse_key: 'c1', notification: { channel_id: 'default' } },
        },
      },
    });
  });

  it('omits collapse_key when there is none', async () => {
    const { transport, calls } = transportAnswering(200);
    await transport.send(device, { ...push, collapseId: null });
    expect((calls[0]!.body as { message: { android: object } }).message.android).not.toHaveProperty('collapse_key');
  });

  it('maps failures to a verdict', async () => {
    expect(await transportAnswering(404, { error: { status: 'NOT_FOUND' } }).transport.send(device, push)).toBe('dead');
    expect(
      await transportAnswering(400, {
        error: { status: 'INVALID_ARGUMENT', details: [{ errorCode: 'UNREGISTERED' }] },
      }).transport.send(device, push),
    ).toBe('dead');
    expect(
      await transportAnswering(400, {
        error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' },
      }).transport.send(device, push),
    ).toBe('dead');
    expect(
      await transportAnswering(400, {
        error: { status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload received.' },
      }).transport.send(device, push),
    ).toBe('retry');
    expect(await transportAnswering(429).transport.send(device, push)).toBe('retry');
    expect(await transportAnswering(500).transport.send(device, push)).toBe('retry');
  });

  it('retries when the network or the access token fails', async () => {
    const down = fcmTransport('p', {
      accessToken: async () => 'at',
      fetch: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    expect(await down.send(device, push)).toBe('retry');
    const noToken = fcmTransport('p', {
      accessToken: async () => {
        throw new Error('no creds');
      },
      fetch: (async () => new Response('{}')) as unknown as typeof fetch,
    });
    expect(await noToken.send(device, push)).toBe('retry');
  });
});
