// The sync on a schedule (docs/plans/ongoing/ordago-agents-in-ghostaff.md, step 1):
// an organisation's `por-decidir/` read from its record on GitHub into the
// database, and the answers given in the app written back into the record in
// one commit, the way apps/sync does it from a checkout. Through GitHub's API,
// with no clone, so it fits in the engine's tick.
//
// The record wins (packages/shared/src/record/sync.ts). A write-back is a
// commit on top of the head it read: if someone pushed meanwhile, GitHub
// refuses the fast-forward and the next tick tries again on the new head.

import {
  appendHistoryRow,
  DECISIONS_DIR,
  describeSync,
  HISTORY_PATH,
  historyRow,
  planSync,
  readDecision,
  type RecordFile,
  recordIdFromPath,
  type SyncPlan,
  writeAnswer,
} from '@ghostaff/shared/record';
import type { DecisionRow } from '@ghostaff/shared/services';
import { GITHUB_API, githubHeaders, type RepoTokens } from './githubApp';

type Fetch = typeof fetch;

export interface RecordOrg {
  id: string;
  slug: string;
  repo: string;
  installation: number;
}

/** The database as the sync needs it (service role). */
export interface RecordSyncStore {
  orgsWithRecord(): Promise<RecordOrg[]>;
  orgWithRecord(orgId: string): Promise<RecordOrg | null>;
  decisions(orgId: string): Promise<DecisionRow[]>;
  apply(plan: SyncPlan): Promise<void>;
  markWrittenBack(rowIds: string[]): Promise<void>;
  /** When the record was last read, and why the last attempt failed (null when it did not). */
  syncState(orgId: string, error: string | null): Promise<void>;
}

export interface RecordSyncDeps {
  store: RecordSyncStore;
  tokens: RepoTokens;
  fetch?: Fetch;
  now?: () => Date;
}

export class GithubError extends Error {
  constructor(
    readonly status: number,
    what: string,
  ) {
    super(`GitHub ${status} on ${what}`);
  }
}

/**
 * The few calls the sync makes on one record, whichever host keeps it: GitHub (githubRepo, an
 * organisation that brings its own repo) or our record store (forgejoRepo in forgejo.ts).
 */
export interface RecordRepo {
  /** The default branch and the commit at its head. */
  head(): Promise<{ branch: string; sha: string }>;
  /** The files directly in `dir` at `ref`; empty when the folder does not exist. */
  files(dir: string, ref: string): Promise<{ name: string; content: string }[]>;
  /** One file at `ref`, or null. */
  file(path: string, ref: string): Promise<string | null>;
  /** One commit on top of `head` with these files; false when the record moved meanwhile. */
  commit(head: { branch: string; sha: string }, files: { path: string; content: string }[], message: string): Promise<boolean>;
}

/** A small client for the few Git data calls the sync makes on one repo. */
export function githubRepo(repo: string, token: string, f: Fetch = fetch): RecordRepo {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T | null> => {
    const res = await f(`${GITHUB_API}/repos/${repo}${path}`, {
      method,
      headers: { ...githubHeaders(token), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) throw new GithubError(res.status, `${method} ${path.split('?')[0]}`);
    return (await res.json()) as T;
  };
  const must = <T>(v: T | null, what: string): T => {
    if (v === null) throw new GithubError(404, what);
    return v;
  };
  const blob = async (sha: string) => {
    const b = must(await call<{ content: string; encoding: string }>('GET', `/git/blobs/${sha}`), `blob ${sha}`);
    return Buffer.from(b.content, b.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
  };
  return {
    /** The default branch and the commit at its head. */
    async head(): Promise<{ branch: string; sha: string }> {
      const r = must(await call<{ default_branch: string }>('GET', ''), repo);
      const ref = must(await call<{ object: { sha: string } }>('GET', `/git/ref/heads/${encodeURIComponent(r.default_branch)}`), 'head');
      return { branch: r.default_branch, sha: ref.object.sha };
    },
    /** The files directly in `dir` at `ref`; empty when the folder does not exist. */
    async files(dir: string, ref: string): Promise<{ name: string; content: string }[]> {
      const list = (await call<Array<{ name: string; type: string; sha: string }>>('GET', `/contents/${dir}?ref=${ref}`)) ?? [];
      const out = [];
      for (const e of Array.isArray(list) ? list : []) {
        if (e.type === 'file') out.push({ name: e.name, content: await blob(e.sha) });
      }
      return out;
    },
    /** One file at `ref`, or null. */
    async file(path: string, ref: string): Promise<string | null> {
      const e = await call<{ sha: string; type: string }>('GET', `/contents/${path}?ref=${ref}`);
      return e && e.type === 'file' ? blob(e.sha) : null;
    },
    /** One commit on top of `head` with these files; false when the branch moved meanwhile. */
    async commit(head: { branch: string; sha: string }, files: { path: string; content: string }[], message: string): Promise<boolean> {
      const parent = must(await call<{ tree: { sha: string } }>('GET', `/git/commits/${head.sha}`), 'commit');
      const tree = must(
        await call<{ sha: string }>('POST', '/git/trees', {
          base_tree: parent.tree.sha,
          tree: files.map((x) => ({ path: x.path, mode: '100644', type: 'blob', content: x.content })),
        }),
        'tree',
      );
      const commit = must(await call<{ sha: string }>('POST', '/git/commits', { message, tree: tree.sha, parents: [head.sha] }), 'commit');
      try {
        await call('PATCH', `/git/refs/heads/${encodeURIComponent(head.branch)}`, { sha: commit.sha, force: false });
        return true;
      } catch (e) {
        if (e instanceof GithubError && e.status === 422) return false; // not a fast-forward: someone pushed
        throw e;
      }
    },
  };
}

export interface OrgSyncResult {
  org: string;
  ok: boolean;
  summary: string;
}

/** Syncs one organisation's decisions with its record. Never throws: a failure is recorded on the organisation. */
export async function syncOrg(deps: RecordSyncDeps, org: RecordOrg): Promise<OrgSyncResult> {
  const now = deps.now?.() ?? new Date();
  try {
    const gh = githubRepo(org.repo, await deps.tokens(org.installation, org.repo), deps.fetch);
    const head = await gh.head();
    const raw = await gh.files(DECISIONS_DIR, head.sha);
    const files: RecordFile[] = raw.flatMap((x) => {
      const id = recordIdFromPath(x.name);
      return id ? [{ id, yaml: x.content }] : [];
    });
    const plan = planSync({ orgId: org.id, files, existing: await deps.store.decisions(org.id), commit: head.sha, now });
    await deps.store.apply(plan);

    const written: string[] = [];
    if (plan.writeBacks.length) {
      const byId = new Map(files.map((x) => [x.id, x.yaml]));
      let csv = await gh.file(HISTORY_PATH, head.sha);
      const changed: { path: string; content: string }[] = [];
      for (const w of plan.writeBacks) {
        const yaml = byId.get(w.recordId);
        if (yaml === undefined) continue;
        changed.push({ path: `${DECISIONS_DIR}/${w.recordId}.yaml`, content: writeAnswer(yaml, w.recordId, w.answer) });
        csv = appendHistoryRow(csv, historyRow(readDecision(w.recordId, yaml), w.answer));
        written.push(w.recordId);
      }
      if (changed.length) {
        changed.push({ path: HISTORY_PATH, content: csv ?? '' });
        const ok = await gh.commit(head, changed, `por-decidir: respuestas desde Ghostaff (${written.join(', ')})`);
        if (!ok) {
          await deps.store.syncState(org.id, null);
          return { org: org.slug, ok: true, summary: `${describeSync(org.slug, plan, [])}\nwrite-back waits: the record moved` };
        }
        await deps.store.markWrittenBack(plan.writeBacks.filter((w) => written.includes(w.recordId)).map((w) => w.rowId));
      }
    }
    await deps.store.syncState(org.id, null);
    return { org: org.slug, ok: true, summary: describeSync(org.slug, plan, written) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await deps.store.syncState(org.id, msg.slice(0, 500)).catch(() => {});
    return { org: org.slug, ok: false, summary: `${org.slug}: ${msg}` };
  }
}

/** Every organisation with a record, one after another. */
export async function syncAll(deps: RecordSyncDeps): Promise<OrgSyncResult[]> {
  const out: OrgSyncResult[] = [];
  for (const org of await deps.store.orgsWithRecord()) out.push(await syncOrg(deps, org));
  return out;
}
