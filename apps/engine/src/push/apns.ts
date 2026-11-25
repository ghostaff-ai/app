// APNs provider API over HTTP/2, without a JWT or APNs library: the token is one
// fixed header, two claims and an ES256 signature.

import { createPrivateKey, sign } from 'node:crypto';
import { connect } from 'node:http2';
import type { Device, Outcome, Push, PushTransport } from './transport';

export interface ApnsCredentials {
  teamId: string;
  keyId: string;
  privateKey: string;
}

export type ApnsRequest = (
  host: string,
  path: string,
  headers: Record<string, string>,
  body: string,
) => Promise<{ status: number; body: string }>;

const APNS_HOST = {
  production: 'api.push.apple.com',
  sandbox: 'api.sandbox.push.apple.com',
} as const;

// A token that no longer belongs to the topic or the key is as finished as an unregistered one.
const DEAD_REASONS = new Set(['BadDeviceToken', 'DeviceTokenNotForTopic']);

// Apple throttles providers that mint a token more than once every 20 minutes
// and rejects one older than 60. Cache for 50.
const JWT_TTL_MS = 50 * 60 * 1000;

const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

/** APNs wants the raw r‖s signature (IEEE P1363), not the DER node produces by default. */
function buildJwt(creds: ApnsCredentials, now: Date): string {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: creds.keyId }));
  const claims = base64url(JSON.stringify({ iss: creds.teamId, iat: Math.floor(now.getTime() / 1000) }));
  const signingInput = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: createPrivateKey(creds.privateKey),
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${base64url(signature)}`;
}

/**
 * The APNs secret: `{ teamId, keyId, privateKey }`. The Team ID travels with the
 * key because a key only signs for the team that issued it; a secret version is
 * the one atomic swap when the app moves to another Apple team.
 */
export function parseApnsSecret(raw: string): ApnsCredentials | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'teamId' in parsed &&
      'keyId' in parsed &&
      'privateKey' in parsed &&
      typeof parsed.teamId === 'string' &&
      typeof parsed.keyId === 'string' &&
      typeof parsed.privateKey === 'string' &&
      /^[A-Z0-9]{10}$/.test(parsed.teamId) &&
      parsed.keyId.length > 0 &&
      parsed.privateKey.includes('PRIVATE KEY')
    ) {
      return { teamId: parsed.teamId, keyId: parsed.keyId, privateKey: parsed.privateKey };
    }
    return null;
  } catch {
    return null;
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * One request per session: a drain sends a handful of pushes, not enough to keep
 * a connection warm. Settles exactly once; a stalled or closed stream rejects
 * rather than hanging the drain on one send. `open` is injectable for tests.
 */
export function http2Request(timeoutMs = REQUEST_TIMEOUT_MS, open: typeof connect = connect): ApnsRequest {
  return (host, path, headers, body) =>
    new Promise((resolve, reject) => {
      const session = open(`https://${host}`);
      let settled = false;
      const finish = (result: { status: number; body: string } | Error) => {
        if (settled) return;
        settled = true;
        session.destroy();
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      session.on('error', finish);
      session.on('close', () => finish(new Error('APNs session closed before a response')));
      // A header node refuses (a stray character in a topic, say) throws here: close the session too.
      try {
        const req = session.request({ ':method': 'POST', ':path': path, ...headers });
        let status = 0;
        let text = '';
        req.setEncoding('utf8');
        req.setTimeout(timeoutMs, () => finish(new Error('APNs request timed out')));
        req.on('response', (h) => {
          status = Number(h[':status'] ?? 0);
        });
        req.on('data', (chunk: string) => {
          text += chunk;
        });
        req.on('end', () => finish({ status, body: text }));
        req.on('close', () => finish(new Error('APNs stream closed before a response')));
        req.on('error', finish);
        req.end(body);
      } catch (e) {
        finish(e instanceof Error ? e : new Error(String(e)));
      }
    });
}

function reasonOf(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && 'reason' in parsed && typeof parsed.reason === 'string') {
      return parsed.reason;
    }
  } catch {
    // an empty or non-JSON body carries no reason
  }
  return null;
}

export function apnsTransport(
  creds: ApnsCredentials,
  opts: { request?: ApnsRequest; now?: () => Date; timeoutMs?: number } = {},
): PushTransport {
  const request = opts.request ?? http2Request(opts.timeoutMs);
  const now = opts.now ?? (() => new Date());
  let cached: { jwt: string; mintedAt: number } | null = null;

  const providerToken = (): string => {
    const at = now();
    if (cached && at.getTime() - cached.mintedAt < JWT_TTL_MS) return cached.jwt;
    cached = { jwt: buildJwt(creds, at), mintedAt: at.getTime() };
    return cached.jwt;
  };

  return {
    async send(device: Device, push: Push): Promise<Outcome> {
      const headers: Record<string, string> = {
        authorization: `bearer ${providerToken()}`,
        'apns-topic': device.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      };
      if (push.collapseId) headers['apns-collapse-id'] = push.collapseId;
      const payload = { aps: { alert: { title: push.title, body: push.body }, sound: 'default' }, ...push.data };

      let res: { status: number; body: string };
      try {
        res = await request(
          APNS_HOST[device.apnsEnvironment ?? 'production'],
          `/3/device/${encodeURIComponent(device.token)}`,
          headers,
          JSON.stringify(payload),
        );
      } catch {
        return 'retry';
      }
      if (res.status === 200) return 'delivered';
      if (res.status === 410) return 'dead';
      if (res.status === 400 && DEAD_REASONS.has(reasonOf(res.body) ?? '')) return 'dead';
      return 'retry';
    },
  };
}
