// FCM HTTP v1 over plain fetch; the OAuth access token comes from
// google-auth-library, so no firebase-admin.

import { GoogleAuth } from 'google-auth-library';
import type { Device, Outcome, Push, PushTransport } from './transport';

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

function defaultAccessToken(): () => Promise<string> {
  const auth = new GoogleAuth({ scopes: [SCOPE] });
  return async () => {
    const token = await auth.getAccessToken();
    if (!token) throw new Error('no FCM access token');
    return token;
  };
}

function errorOf(body: unknown): { status: string; message: string; codes: string[] } {
  const error = (body as { error?: { status?: unknown; message?: unknown; details?: unknown } } | null)?.error;
  const details = Array.isArray(error?.details) ? (error.details as Array<{ errorCode?: unknown }>) : [];
  return {
    status: typeof error?.status === 'string' ? error.status : '',
    message: typeof error?.message === 'string' ? error.message : '',
    codes: details.flatMap((d) => (typeof d?.errorCode === 'string' ? [d.errorCode] : [])),
  };
}

const REQUEST_TIMEOUT_MS = 10_000;

/** `promise`, or the signal's reason once it aborts: for a call that takes no signal of its own. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function fcmTransport(
  projectId: string,
  opts: { accessToken?: () => Promise<string>; fetch?: typeof fetch; timeoutMs?: number } = {},
): PushTransport {
  const accessToken = opts.accessToken ?? defaultAccessToken();
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  return {
    async send(device: Device, push: Push): Promise<Outcome> {
      // One deadline for the token and the request, so a stalled Google never holds the drain: it is a `retry`.
      const signal = AbortSignal.timeout(timeoutMs);
      let res: Response;
      try {
        const token = await untilAborted(accessToken(), signal);
        res = await doFetch(url, {
          method: 'POST',
          signal,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: device.token,
              notification: { title: push.title, body: push.body },
              data: push.data,
              android: {
                priority: 'high',
                ...(push.collapseId ? { collapse_key: push.collapseId } : {}),
                notification: { channel_id: 'default' },
              },
            },
          }),
        });
      } catch {
        return 'retry';
      }
      if (res.ok) return 'delivered';
      if (res.status === 404) return 'dead';
      if (res.status === 400) {
        const e = errorOf(await res.json().catch(() => null));
        if (e.codes.includes('UNREGISTERED')) return 'dead';
        // INVALID_ARGUMENT also answers a malformed payload, which is our bug, not a dead device.
        if (e.status === 'INVALID_ARGUMENT' && /token/i.test(e.message)) return 'dead';
      }
      return 'retry';
    },
  };
}
