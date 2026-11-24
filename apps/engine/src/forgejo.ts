// Our own record store (docs/plans/ongoing/record-store.md): one Forgejo per environment, on a VM in
// the environment's project, reached only on its internal address. Every organisation's record is a
// private repo of the Forgejo organisation `records`, named by the organisation's id. The engine is
// Forgejo's admin, with a token in Secret Manager; each agent is a Forgejo user with write on its own
// organisation's repo only, and a run gets a token for that user, revoked when the run reports.
//
// Checked against Forgejo 15.0.12 (LTS): a user's token can only be created or deleted with that
// user's basic auth (an admin token with `Sudo` is refused), so the engine sets a random password it
// never keeps, uses it once and forgets it. `POST /contents` writes several files in one commit and
// answers 409 when a file's `sha` is not the one at the branch's tip.

import { randomBytes } from 'node:crypto';
import type { RecordRepo } from './recordSync';

type Fetch = typeof fetch;

export interface ForgejoConfig {
  /** Forgejo's base URL on the VPC, e.g. http://10.132.0.5:3000 */
  url: string;
  adminToken: string;
  /** The admin's username: the pusher the pre-receive hook lets write anything. */
  adminUser: string;
}

/** The Forgejo organisation that owns every record. */
export const RECORDS_OWNER = 'records';
export const RECORD_BRANCH = 'main';

export class ForgejoError extends Error {
  constructor(
    readonly status: number,
    what: string,
  ) {
    super(`Forgejo ${status} on ${what}`);
  }
}

/** The repo (`records/<org id>`) holding one organisation's record. */
export const recordRepoName = (orgId: string) => `${RECORDS_OWNER}/${orgId.toLowerCase()}`;

/** The Forgejo user an agent pushes as: 38 characters, inside Forgejo's 40. */
export const agentUsername = (agentId: string) => `agent-${agentId.replace(/-/g, '').toLowerCase()}`;
const AGENT_USER = /^agent-[0-9a-f]{32}$/;

/** A run's token name, carrying when it was made so the tick can sweep what a run never revoked. */
export const runTokenName = (runId: string, now: Date) => `run-${runId}-${Math.floor(now.getTime() / 1000)}`;
export const runTokenMadeAt = (name: string): Date | null => {
  const m = /^run-[0-9a-f-]{36}-(\d+)$/i.exec(name);
  return m ? new Date(Number(m[1]) * 1000) : null;
};

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const password = () => `${randomBytes(24).toString('base64url')}-A1`;

function client(cfg: ForgejoConfig, f: Fetch) {
  const base = `${cfg.url.replace(/\/+$/, '')}/api/v1`;
  /** One call; null for a GET that finds nothing. */
  const call = async <T>(method: string, path: string, body?: unknown, auth = `token ${cfg.adminToken}`): Promise<T | null> => {
    const res = await f(`${base}${path}`, {
      method,
      headers: { Authorization: auth, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) throw new ForgejoError(res.status, `${method} ${path.split('?')[0]}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  };
  return { call, base };
}

/** The four calls the sync makes on one record, as githubRepo does for GitHub. */
export function forgejoRepo(cfg: ForgejoConfig, repo: string, f: Fetch = fetch): RecordRepo {
  const { call } = client(cfg, f);
  const at = (p: string) => `/repos/${repo}${p}`;
  const blob = async (sha: string) => {
    const b = await call<{ content: string; encoding: string }>('GET', at(`/git/blobs/${sha}`));
    if (!b) throw new ForgejoError(404, `blob ${sha}`);
    return Buffer.from(b.content, b.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
  };
  const entry = (path: string, ref: string) =>
    call<{ type: string; sha: string; name: string } | Array<{ type: string; sha: string; name: string }>>(
      'GET',
      at(`/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`),
    );
  return {
    async head() {
      const r = await call<{ default_branch: string }>('GET', at(''));
      if (!r) throw new ForgejoError(404, repo);
      const b = await call<{ commit: { id: string } }>('GET', at(`/branches/${encodeURIComponent(r.default_branch)}`));
      if (!b) throw new ForgejoError(404, 'head');
      return { branch: r.default_branch, sha: b.commit.id };
    },
    async files(dir, ref) {
      const list = await entry(dir, ref);
      const out = [];
      for (const e of Array.isArray(list) ? list : []) if (e.type === 'file') out.push({ name: e.name, content: await blob(e.sha) });
      return out;
    },
    async file(path, ref) {
      const e = await entry(path, ref);
      return e && !Array.isArray(e) && e.type === 'file' ? blob(e.sha) : null;
    },
    // Each file carries the sha it had at `head`, so Forgejo refuses (409) the commit if any of them
    // changed since; files the commit does not touch may have moved, which a GitHub record would refuse.
    async commit(head, files, message) {
      const ops = [];
      for (const x of files) {
        const e = await entry(x.path, head.sha);
        const sha = e && !Array.isArray(e) && e.type === 'file' ? e.sha : null;
        ops.push(sha ? { operation: 'update', path: x.path, sha, content: b64(x.content) } : { operation: 'create', path: x.path, content: b64(x.content) });
      }
      try {
        await call('POST', at('/contents'), { branch: head.branch, message, files: ops });
        return true;
      } catch (e) {
        if (e instanceof ForgejoError && (e.status === 409 || e.status === 422)) return false;
        throw e;
      }
    },
  };
}

/** What the engine does as Forgejo's admin. Every call is safe to repeat. */
export function forgejoAdmin(cfg: ForgejoConfig, f: Fetch = fetch, now: () => Date = () => new Date()) {
  const { call } = client(cfg, f);

  /** Sets a password nobody keeps and calls `fn` with that user's basic auth: how a user's tokens are made and deleted. */
  const asUser = async <T>(username: string, fn: (auth: string) => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const pw = password();
      await call('PATCH', `/admin/users/${username}`, { login_name: username, source_id: 0, password: pw, must_change_password: false });
      try {
        return await fn(`Basic ${Buffer.from(`${username}:${pw}`).toString('base64')}`);
      } catch (e) {
        // Another run of the same agent reset the password in between: once more.
        if (attempt === 0 && e instanceof ForgejoError && e.status === 401) continue;
        throw e;
      }
    }
  };

  return {
    /** The organisation `records` that owns every record. */
    async ensureOwner(): Promise<void> {
      if (await call('GET', `/orgs/${RECORDS_OWNER}`)) return;
      await call('POST', '/orgs', { username: RECORDS_OWNER, visibility: 'private' });
    },

    /**
     * One organisation's record: the repo, its first commit with `seed` when it is new, main protected
     * from force pushes and deletion, and its pre-receive hook. True when the repo was made now.
     */
    async ensureRecord(repo: string, seed: { path: string; content: string }[], hook: string): Promise<boolean> {
      const name = repo.split('/')[1]!;
      let created = false;
      if (!(await call('GET', `/repos/${repo}`))) {
        await call('POST', `/orgs/${RECORDS_OWNER}/repos`, { name, private: true, auto_init: false, default_branch: RECORD_BRANCH });
        created = true;
      }
      if (!(await call('GET', `/repos/${repo}/branches/${RECORD_BRANCH}`))) {
        await call('POST', `/repos/${repo}/contents`, {
          branch: RECORD_BRANCH,
          message: 'El registro de la organización, creado por Ghostaff',
          files: seed.map((x) => ({ operation: 'create', path: x.path, content: b64(x.content) })),
        });
      }
      const rules = (await call<Array<{ rule_name: string }>>('GET', `/repos/${repo}/branch_protections`)) ?? [];
      if (!rules.some((r) => r.rule_name === RECORD_BRANCH)) {
        await call('POST', `/repos/${repo}/branch_protections`, { rule_name: RECORD_BRANCH, branch_name: RECORD_BRANCH, enable_push: true });
      }
      await this.setHook(repo, hook);
      return created;
    },

    /** The record's pre-receive hook (recordHook.ts), rewritten whole. */
    async setHook(repo: string, content: string): Promise<void> {
      await call('PATCH', `/repos/${repo}/hooks/git/pre-receive`, { content });
    },

    /** The agent's user, with write on its organisation's record and nothing else. */
    async ensureAgentUser(username: string, repo: string): Promise<void> {
      if (!AGENT_USER.test(username)) throw new Error(`not an agent's username: ${username}`);
      if (!(await call('GET', `/users/${username}`))) {
        await call('POST', '/admin/users', {
          username,
          email: `${username}@agents.ghostaff.invalid`,
          password: password(),
          must_change_password: false,
          visibility: 'private',
        });
      }
      await call('PUT', `/repos/${repo}/collaborators/${username}`, { permission: 'write' });
    },

    /** A token for one run, as the agent's user, limited to repositories it may write. */
    async mintRunToken(username: string, runId: string): Promise<{ name: string; token: string }> {
      const name = runTokenName(runId, now());
      const t = await asUser(username, (auth) =>
        call<{ sha1: string }>('POST', `/users/${username}/tokens`, { name, scopes: ['write:repository'] }, auth),
      );
      if (!t?.sha1) throw new ForgejoError(500, 'token');
      return { name, token: t.sha1 };
    },

    /** Deletes a run's tokens (the first and any it renewed); nothing when they are already gone. */
    async revokeRunTokens(username: string, runId: string): Promise<void> {
      const prefix = `run-${runId.toLowerCase()}-`;
      const names = ((await call<Array<{ name: string }>>('GET', `/users/${username}/tokens`)) ?? [])
        .map((t) => t.name)
        .filter((n) => n.toLowerCase().startsWith(prefix));
      for (const n of names) await asUser(username, (auth) => call('DELETE', `/users/${username}/tokens/${encodeURIComponent(n)}`, undefined, auth));
    },

    /** Every agent's user, for the tick's sweep. */
    async agentUsers(): Promise<string[]> {
      const out: string[] = [];
      for (let page = 1; ; page++) {
        const users = (await call<Array<{ login: string }>>('GET', `/admin/users?limit=50&page=${page}`)) ?? [];
        out.push(...users.map((u) => u.login).filter((l) => AGENT_USER.test(l)));
        if (users.length < 50) return out;
      }
    },

    /** Deletes this agent's run tokens made before `before`: those of runs that never reported. */
    async sweepRunTokens(username: string, before: Date): Promise<number> {
      const stale = ((await call<Array<{ name: string }>>('GET', `/users/${username}/tokens`)) ?? [])
        .map((t) => t.name)
        .filter((n) => {
          const made = runTokenMadeAt(n);
          return made !== null && made < before;
        });
      for (const n of stale) await asUser(username, (auth) => call('DELETE', `/users/${username}/tokens/${encodeURIComponent(n)}`, undefined, auth));
      return stale.length;
    },

    /** How a run clones the record: the URL on the VPC, with the token as the password of the agent's user. */
    cloneUrl(repo: string): string {
      return `${cfg.url.replace(/\/+$/, '')}/${repo}.git`;
    },
  };
}

export type ForgejoAdmin = ReturnType<typeof forgejoAdmin>;
