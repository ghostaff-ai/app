// Calls from Google itself rather than from a person: Cloud Scheduler's tick,
// and an agent's job reporting how its run went. Each carries a Google ID
// token for the engine's URL, signed by Google for the caller's service
// account; the engine checks the signature, the audience and the account. No
// key of our own is involved (ordago-agents-in-ghostaff.md, decision 7).

import { OAuth2Client } from 'google-auth-library';

/** The service account email behind a Google ID token for `audience`, or null. */
export type CallerFromToken = (token: string, audience: string) => Promise<string | null>;

export function googleCaller(client = new OAuth2Client()): CallerFromToken {
  return async (token, audience) => {
    try {
      const ticket = await client.verifyIdToken({ idToken: token, audience });
      const p = ticket.getPayload();
      return p?.email && p.email_verified ? p.email.toLowerCase() : null;
    } catch {
      return null;
    }
  };
}

export const bearer = (header: string | undefined) => header?.match(/^Bearer (.+)$/)?.[1] ?? null;
