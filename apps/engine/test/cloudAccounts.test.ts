import { describe, expect, it } from 'vitest';
import {
  accountEmail,
  accountIdFor,
  type CloudAccount,
  CloudAccountNotReady,
  type CloudAccountDeps,
  cloudTokens,
  ensureCloudAccount,
  type GoogleCall,
  mintCloudToken,
} from '../src/cloudAccounts';

const ORG = '7f3a9c1e-1234-4abc-8def-0123456789ab';
const OTHER = '7f3a9c1e-1234-4abc-8def-ffffffffffff';
const TENANTS = 'ghostaff-tenants-beta';
const ENGINE = 'engine@ghostaff-beta.iam.gserviceaccount.com';
const EMAIL = `org-7f3a9c1e12344abc8def0123@${TENANTS}.iam.gserviceaccount.com`;
const RESOURCE = `https://iam.googleapis.com/v1/projects/${TENANTS}/serviceAccounts/${EMAIL}`;

type Answer = { status: number; data?: unknown };

/** A fake Google: answers in order per URL suffix, and records every call. */
function google(answers: Record<string, Answer[]>) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const call: GoogleCall = async (method, url, body) => {
    calls.push({ method, url, body });
    const key = Object.keys(answers).find((k) => url.endsWith(k) && answers[k]!.length > 0);
    if (!key) throw new Error(`unexpected ${method} ${url}`);
    const a = answers[key]!.shift()!;
    return { status: a.status, data: a.data ?? {} };
  };
  return { call, calls };
}

function deps(call: GoogleCall, stored: Record<string, CloudAccount> = {}, now = () => 0): CloudAccountDeps & { stored: Record<string, CloudAccount> } {
  return {
    stored,
    store: { get: async (o) => stored[o] ?? null, put: async (o, a) => void (stored[o] = a) },
    call,
    tenantsProject: TENANTS,
    engineAccount: ENGINE,
    sleep: async () => {},
    now,
  };
}

const created = { email: EMAIL, uniqueId: '104729000000000000001', displayName: `Ghostaff org ${ORG}` };

describe("an organisation's Google Cloud account", () => {
  it('is named after the organisation, within Google’s 30 characters', () => {
    expect(accountIdFor(ORG)).toBe('org-7f3a9c1e12344abc8def0123');
    expect(accountIdFor(ORG).length).toBeLessThanOrEqual(30);
    expect(accountEmail(ORG, TENANTS)).toBe(EMAIL);
  });

  it('is created once, in the tenants project, and only the engine may act as it', async () => {
    const g = google({
      '/serviceAccounts': [{ status: 200, data: created }],
      ':getIamPolicy': [{ status: 200, data: { etag: 'e1', bindings: [{ role: 'roles/viewer', members: ['user:x@y.z'] }] } }],
      ':setIamPolicy': [{ status: 200 }],
    });
    const d = deps(g.call);
    expect(await ensureCloudAccount(d, ORG)).toBe(EMAIL);
    expect(g.calls[0]).toMatchObject({ method: 'POST', body: { accountId: 'org-7f3a9c1e12344abc8def0123', serviceAccount: { displayName: `Ghostaff org ${ORG}` } } });
    // On this account's own policy, not the project's; what was there stays.
    expect(g.calls[2]).toEqual({
      method: 'POST',
      url: `${RESOURCE}:setIamPolicy`,
      body: {
        policy: {
          etag: 'e1',
          bindings: [
            { role: 'roles/viewer', members: ['user:x@y.z'] },
            { role: 'roles/iam.serviceAccountTokenCreator', members: [`serviceAccount:${ENGINE}`] },
          ],
        },
      },
    });
    expect(d.stored[ORG]).toEqual({ email: EMAIL, uniqueId: created.uniqueId });

    // The second time it is read from the database: Google is not asked again.
    expect(await ensureCloudAccount(d, ORG)).toBe(EMAIL);
    expect(g.calls).toHaveLength(3);
  });

  it('after a failure half-way, the account made before is found by name and finished', async () => {
    const g = google({
      '/serviceAccounts': [{ status: 409 }],
      [`/serviceAccounts/${EMAIL}`]: [{ status: 200, data: created }],
      // A new account can be missing for a moment.
      ':getIamPolicy': [{ status: 404 }, { status: 200, data: { etag: 'e2' } }],
      ':setIamPolicy': [{ status: 200 }],
    });
    const d = deps(g.call);
    expect(await ensureCloudAccount(d, ORG)).toBe(EMAIL);
    expect(d.stored[ORG]?.email).toBe(EMAIL);
  });

  it('never adopts an account with its name that was made for someone else', async () => {
    const g = google({
      '/serviceAccounts': [{ status: 409 }],
      [`/serviceAccounts/${EMAIL}`]: [{ status: 200, data: { ...created, displayName: `Ghostaff org ${OTHER}` } }],
    });
    const d = deps(g.call);
    await expect(ensureCloudAccount(d, ORG)).rejects.toThrow(/someone else/);
    expect(d.stored[ORG]).toBeUndefined();
  });

  it('is not stored when the engine could not be let in, so the next attempt finishes it', async () => {
    const g = google({
      '/serviceAccounts': [{ status: 200, data: created }],
      ':getIamPolicy': [{ status: 403 }],
    });
    const d = deps(g.call);
    await expect(ensureCloudAccount(d, ORG)).rejects.toThrow(/403/);
    expect(d.stored[ORG]).toBeUndefined();
  });

  it('adds the engine once, even when it is already there', async () => {
    const g = google({
      '/serviceAccounts': [{ status: 200, data: created }],
      ':getIamPolicy': [{ status: 200, data: { bindings: [{ role: 'roles/iam.serviceAccountTokenCreator', members: [`serviceAccount:${ENGINE}`] }] } }],
    });
    await ensureCloudAccount(deps(g.call), ORG);
    expect(g.calls.some((c) => c.url.endsWith(':setIamPolicy'))).toBe(false);
  });
});

describe('tokens as the organisation', () => {
  const stored = { [ORG]: { email: EMAIL, uniqueId: '1' } };
  const tokenUrl = `/projects/-/serviceAccounts/${EMAIL}:generateAccessToken`;

  it('last an hour at most, for the whole of Google Cloud as that account', async () => {
    const g = google({ [tokenUrl]: [{ status: 200, data: { accessToken: 'ya29.a', expireTime: '2026-11-24T19:00:00Z' } }] });
    expect(await mintCloudToken(deps(g.call, stored), ORG)).toEqual({ token: 'ya29.a', expiresAt: '2026-11-24T19:00:00Z' });
    expect(g.calls[0]?.body).toEqual({ scope: ['https://www.googleapis.com/auth/cloud-platform'], lifetime: '3600s' });
  });

  it('an organisation without an account has none', async () => {
    expect(await mintCloudToken(deps(google({}).call), OTHER)).toBeNull();
  });

  it('says so when the engine may not act as it yet', async () => {
    const g = google({ [tokenUrl]: [{ status: 403 }] });
    await expect(mintCloudToken(deps(g.call, stored), ORG)).rejects.toBeInstanceOf(CloudAccountNotReady);
  });

  it('the engine’s own calls reuse one until five minutes before it ends', async () => {
    let t = Date.parse('2026-11-24T18:00:00Z');
    const g = google({
      [tokenUrl]: [
        { status: 200, data: { accessToken: 'first', expireTime: '2026-11-24T19:00:00Z' } },
        { status: 200, data: { accessToken: 'second', expireTime: '2026-11-24T20:00:00Z' } },
      ],
    });
    const token = cloudTokens(deps(g.call, stored, () => t));
    expect(await token(ORG)).toBe('first');
    t = Date.parse('2026-11-24T18:54:00Z');
    expect(await token(ORG)).toBe('first');
    t = Date.parse('2026-11-24T18:56:00Z');
    expect(await token(ORG)).toBe('second');
  });
});
