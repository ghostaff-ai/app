// The sync on a schedule (docs/plans/ongoing/ordago-agents-in-ghostaff.md, step 1):
// an organisation's `por-decidir/` read from its record (GitHub, or our record store) into the
// database, and the answers given in the app written back into the record in
// one commit, the way apps/sync does it from a checkout. Through the host's API,
// with no clone, so it fits in the engine's tick.
//
// The record wins (packages/shared/src/record/sync.ts). A write-back is a
// commit on top of the head it read: if someone pushed meanwhile, GitHub
// refuses the fast-forward and the next tick tries again on the new head.

import {
  agentInstructionsPath,
  appendHistoryRow,
  DECISIONS_DIR,
  describeSync,
  HISTORY_PATH,
  historyRow,
  MAX_INSTRUCTIONS,
  planSync,
  readDecision,
  type RecordFile,
  recordIdFromPath,
  type SyncAgent,
  type SyncPlan,
  writeAnswer,
} from '@ghostaff/shared/record';
import type { DecisionRow } from '@ghostaff/shared/services';
import { type ForgejoConfig, forgejoRepo } from './forgejo';
import { GITHUB_API, githubHeaders, type RepoTokens } from './githubApp';

type Fetch = typeof fetch;

/**
 * An organisation with a record: in our record store (`ghostaff`, a repo made with the organisation,
 * docs/plans/ongoing/record-store.md), or on GitHub as the master it brought (`github`, through our
 * GitHub App's installation on that one repo).
 */
export type RecordOrg = { id: string; slug: string; repo: string } & ({ host: 'github'; installation: number } | { host: 'ghostaff' });

/** An organisation still without a record: the tick gives it one in our record store. */
export interface OrgWithoutRecord {
  id: string;
  slug: string;
  name: string;
}

/** An agent as the sync projects its instructions (agentInstructionsPath). */
export interface InstructedAgent {
  id: string;
  slug: string;
  task: string | null;
  /** Whether `task` is the projection of its file in the record. */
  taskInRecord: boolean;
}

/** The database as the sync needs it (service role). */
export interface RecordSyncStore {
  orgsWithRecord(): Promise<RecordOrg[]>;
  orgWithRecord(orgId: string): Promise<RecordOrg | null>;
  orgsWithoutRecord(): Promise<OrgWithoutRecord[]>;
  /** Marks the organisation's record as made in our record store; false when it got one meanwhile. */
  setOwnRecord(orgId: string, repo: string): Promise<boolean>;
  decisions(orgId: string): Promise<DecisionRow[]>;
  /** Every agent of the organisation, to point each decision at the one that asked. */
  agents(orgId: string): Promise<SyncAgent[]>;
  apply(plan: SyncPlan): Promise<void>;
  markWrittenBack(rowIds: string[]): Promise<void>;
  /** Points the decision with this record id at the agent that asked; its row id, or null when it is not there. */
  pointDecision(orgId: string, recordId: string, agentId: string): Promise<string | null>;
  /** The organisation's agents that have a slug, so a file of their own. */
  instructedAgents(orgId: string): Promise<InstructedAgent[]>;
  /** The agent's instructions from its file (`task` set), or its file gone (`task` kept as it was). */
  setInstructions(agentId: string, change: { task: string; inRecord: true } | { inRecord: false }): Promise<void>;
  /** When the record was last read, and why the last attempt failed (null when it did not). */
  syncState(orgId: string, error: string | null): Promise<void>;
}

export interface RecordSyncDeps {
  store: RecordSyncStore;
  /** GitHub records: installation tokens; null when the GitHub App is not configured. */
  tokens: RepoTokens | null;
  /** Our record store; null when this environment has none. */
  forgejo: ForgejoConfig | null;
  fetch?: Fetch;
  now?: () => Date;
}

/** Whether this engine can reach the organisation's record at all. */
export const canReach = (deps: Pick<RecordSyncDeps, 'tokens' | 'forgejo'>, org: RecordOrg) =>
  org.host === 'github' ? deps.tokens !== null : deps.forgejo !== null;

/** The sync's client for the organisation's record, on whichever host keeps it. */
async function repoOf(deps: RecordSyncDeps, org: RecordOrg): Promise<RecordRepo> {
  if (org.host === 'github') {
    if (!deps.tokens) throw new Error('the GitHub record connector is not configured');
    return githubRepo(org.repo, await deps.tokens(org.installation, org.repo), deps.fetch);
  }
  if (!deps.forgejo) throw new Error('this environment has no record store');
  return forgejoRepo(deps.forgejo, org.repo, deps.fetch);
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

/**
 * Each agent's `agentes/<slug>/AGENTS.md` read into `agents.task`, the record winning: what the
 * chat and the app read without a clone. A file too long for the row is left out and named.
 * Returns what changed, for the tick's summary.
 */
export async function projectInstructions(store: RecordSyncStore, repo: RecordRepo, orgId: string, ref: string): Promise<string[]> {
  const notes: string[] = [];
  for (const a of await store.instructedAgents(orgId)) {
    const file = await repo.file(agentInstructionsPath(a.slug), ref);
    if (file === null) {
      if (a.taskInRecord) {
        await store.setInstructions(a.id, { inRecord: false });
        notes.push(`${a.slug}: instructions file gone, keeps its last`);
      }
    } else if (file.length > MAX_INSTRUCTIONS) {
      notes.push(`${a.slug}: instructions over ${MAX_INSTRUCTIONS} characters, not read`);
    } else if (file !== a.task || !a.taskInRecord) {
      await store.setInstructions(a.id, { task: file, inRecord: true });
      notes.push(`${a.slug}: instructions from the record`);
    }
  }
  return notes;
}

/** Syncs one organisation's decisions with its record. Never throws: a failure is recorded on the organisation. */
export async function syncOrg(deps: RecordSyncDeps, org: RecordOrg): Promise<OrgSyncResult> {
  const now = deps.now?.() ?? new Date();
  try {
    const gh = await repoOf(deps, org);
    const head = await gh.head();
    const raw = await gh.files(DECISIONS_DIR, head.sha);
    const files: RecordFile[] = raw.flatMap((x) => {
      const id = recordIdFromPath(x.name);
      return id ? [{ id, yaml: x.content }] : [];
    });
    const plan = planSync({ orgId: org.id, files, existing: await deps.store.decisions(org.id), agents: await deps.store.agents(org.id), commit: head.sha, now });
    await deps.store.apply(plan);
    const instructions = await projectInstructions(deps.store, gh, org.id, head.sha);
    const withInstructions = (summary: string) => [summary, ...instructions].join('\n');

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
          return { org: org.slug, ok: true, summary: withInstructions(`${describeSync(org.slug, plan, [])}\nwrite-back waits: the record moved`) };
        }
        await deps.store.markWrittenBack(plan.writeBacks.filter((w) => written.includes(w.recordId)).map((w) => w.rowId));
      }
    }
    await deps.store.syncState(org.id, null);
    return { org: org.slug, ok: true, summary: withInstructions(describeSync(org.slug, plan, written)) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await deps.store.syncState(org.id, msg.slice(0, 500)).catch(() => {});
    return { org: org.slug, ok: false, summary: `${org.slug}: ${msg}` };
  }
}

/**
 * An agent's new decision (decisionAsks.ts): `por-decidir/<id>.yaml` committed on the record's head
 * with a free id from `base`, then the organisation synced so the row is there at once, pointed at
 * the agent. Null when the organisation has no record this engine reaches. Throws when the record
 * keeps moving under it.
 */
export async function openDecision(
  deps: RecordSyncDeps,
  a: { orgId: string; agentId: string; base: string; decision: (id: string) => string },
): Promise<{ decisionId: string; recordId: string } | null> {
  const org = await deps.store.orgWithRecord(a.orgId);
  if (!org || !canReach(deps, org)) return null;
  const repo = await repoOf(deps, org);
  for (let attempt = 0; attempt < 3; attempt++) {
    const head = await repo.head();
    let id = a.base;
    for (let n = 2; (await repo.file(`${DECISIONS_DIR}/${id}.yaml`, head.sha)) !== null; n++) {
      if (n > 20) throw new Error(`no free decision id for ${a.base}`);
      id = `${a.base}-${n}`;
    }
    const yaml = a.decision(id);
    if (!(await repo.commit(head, [{ path: `${DECISIONS_DIR}/${id}.yaml`, content: yaml }], `por-decidir: ${id} (desde el chat)`))) continue;
    const synced = await syncOrg(deps, org);
    if (!synced.ok) throw new Error(synced.summary);
    const decisionId = await deps.store.pointDecision(org.id, id, a.agentId);
    if (!decisionId) throw new Error(`${id} did not reach the database`);
    return { decisionId, recordId: id };
  }
  throw new Error('the record kept moving; try again');
}

/** Every organisation with a record this engine can reach, one after another. */
export async function syncAll(deps: RecordSyncDeps): Promise<OrgSyncResult[]> {
  const out: OrgSyncResult[] = [];
  for (const org of await deps.store.orgsWithRecord()) if (canReach(deps, org)) out.push(await syncOrg(deps, org));
  return out;
}
