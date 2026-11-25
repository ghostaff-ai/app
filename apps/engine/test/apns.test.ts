import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { apnsTransport, parseApnsSecret, type ApnsRequest } from '../src/push/apns';
import { byPlatform, type Device, type Push, type PushTransport } from '../src/push/transport';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const creds = {
  teamId: 'ABCDE12345',
  keyId: 'KEY1234567',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};

const device: Device = { token: 'tok-1', platform: 'ios', apnsEnvironment: 'production', bundleId: 'app.ghostaff' };
const push: Push = { title: 'Ana', body: 'Tienes una decisión', data: { thread: 't1' }, collapseId: null };

type Call = { host: string; path: string; headers: Record<string, string>; body: string };

function fakeRequest(answer: { status: number; body?: string } = { status: 200 }) {
  const calls: Call[] = [];
  const request: ApnsRequest = async (host, path, headers, body) => {
    calls.push({ host, path, headers, body });
    return { status: answer.status, body: answer.body ?? '' };
  };
  return { request, calls };
}

const bearer = (c: Call) => (c.headers.authorization ?? '').replace('bearer ', '');
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

describe('APNs provider token', () => {
  it('is an ES256 JWT with kid and iss/iat that verifies with the public key', async () => {
    const { request, calls } = fakeRequest();
    const now = new Date('2026-01-01T00:00:00Z');
    await apnsTransport(creds, { request, now: () => now }).send(device, push);
    const [h, c, s] = bearer(calls[0]!).split('.') as [string, string, string];
    expect(decode(h)).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
    expect(decode(c)).toEqual({ iss: 'ABCDE12345', iat: Math.floor(now.getTime() / 1000) });
    const ok = verify(
      'sha256',
      Buffer.from(`${h}.${c}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(s, 'base64url'),
    );
    expect(ok).toBe(true);
  });

  it('is reused within 50 minutes and remade after', async () => {
    const { request, calls } = fakeRequest();
    let now = new Date('2026-01-01T00:00:00Z');
    const t = apnsTransport(creds, { request, now: () => now });
    await t.send(device, push);
    now = new Date(now.getTime() + 49 * 60_000);
    await t.send(device, push);
    now = new Date(now.getTime() + 2 * 60_000);
    await t.send(device, push);
    expect(bearer(calls[1]!)).toBe(bearer(calls[0]!));
    expect(bearer(calls[2]!)).not.toBe(bearer(calls[0]!));
  });
});

describe('APNs request', () => {
  it('goes to the production host with the push headers and no collapse id by default', async () => {
    const { request, calls } = fakeRequest();
    await apnsTransport(creds, { request }).send(device, push);
    const call = calls[0]!;
    expect(call.host).toBe('api.push.apple.com');
    expect(call.path).toBe('/3/device/tok-1');
    expect(call.headers).toMatchObject({ 'apns-topic': 'app.ghostaff', 'apns-push-type': 'alert', 'apns-priority': '10' });
    expect(call.headers).not.toHaveProperty('apns-collapse-id');
    expect(JSON.parse(call.body)).toEqual({
      aps: { alert: { title: 'Ana', body: 'Tienes una decisión' }, sound: 'default' },
      thread: 't1',
    });
  });

  it('uses the sandbox host for a sandbox device and sends the collapse id when set', async () => {
    const { request, calls } = fakeRequest();
    await apnsTransport(creds, { request }).send(
      { ...device, apnsEnvironment: 'sandbox' },
      { ...push, collapseId: 'c1' },
    );
    expect(calls[0]!.host).toBe('api.sandbox.push.apple.com');
    expect(calls[0]!.headers['apns-collapse-id']).toBe('c1');
  });
});

describe('APNs outcomes', () => {
  const outcome = async (status: number, body?: string) =>
    apnsTransport(creds, { request: fakeRequest({ status, body }).request }).send(device, push);

  it('maps the status to a verdict', async () => {
    expect(await outcome(200)).toBe('delivered');
    expect(await outcome(410, '{"reason":"Unregistered"}')).toBe('dead');
    expect(await outcome(400, '{"reason":"BadDeviceToken"}')).toBe('dead');
    expect(await outcome(400, '{"reason":"DeviceTokenNotForTopic"}')).toBe('dead');
    expect(await outcome(400, '{"reason":"BadPriority"}')).toBe('retry');
    expect(await outcome(429)).toBe('retry');
    expect(await outcome(503)).toBe('retry');
  });

  it('retries on a network error', async () => {
    const request: ApnsRequest = async () => {
      throw new Error('ECONNRESET');
    };
    expect(await apnsTransport(creds, { request }).send(device, push)).toBe('retry');
  });
});

describe('parseApnsSecret', () => {
  const good = { teamId: 'ABCDE12345', keyId: 'K1', privateKey: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----' };

  it('accepts a complete secret', () => {
    expect(parseApnsSecret(JSON.stringify(good))).toEqual(good);
  });

  it('rejects missing or malformed fields and non-JSON', () => {
    for (const key of Object.keys(good)) {
      expect(parseApnsSecret(JSON.stringify({ ...good, [key]: undefined }))).toBeNull();
    }
    expect(parseApnsSecret(JSON.stringify({ ...good, teamId: 'short' }))).toBeNull();
    expect(parseApnsSecret(JSON.stringify({ ...good, privateKey: 'nope' }))).toBeNull();
    expect(parseApnsSecret('not json')).toBeNull();
  });
});

describe('byPlatform', () => {
  const stub = (outcome: 'delivered' | 'dead'): PushTransport => ({ send: async () => outcome });

  it('routes by platform and retries when that platform has no transport', async () => {
    const t = byPlatform(stub('delivered'), null);
    expect(await t.send(device, push)).toBe('delivered');
    expect(await t.send({ ...device, platform: 'android' }, push)).toBe('retry');
    expect(await byPlatform(null, stub('dead')).send({ ...device, platform: 'android' }, push)).toBe('dead');
  });
});
