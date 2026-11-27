// The sync on a schedule (docs/plans/ongoing/ordago-agents-in-ghostaff.md, step 1):
// an organisation's `por-decidir/` read from its record (GitHub, or our record store) into the
// database, and the answers given in the app written back into the record in
// one commit, the way apps/sync does it from a checkout. Through the host's API,
// with no clone, so it fits in the engine's tick.
//
// The record wins (packages/shared/src/record/sync.ts). A write-back is a
// commit on top of the head it read: if someone pushed meanwhile, GitHub
// refuses the fast-forward and the next tick tries again on the new head.

import { createHash } from 'node:crypto';
import type { PhotoBlock, SkippedBlock } from '@ghostaff/shared';
import {
  AGENT_PHOTO_FILE,
  agentInstructionsPath,
  appendHistoryRow,
  DECISIONS_DIR,
  describeExternalSync,
  describeSync,
  EXTERNAL_DIR,
  type ExternalSyncPlan,
  type ExternalSyncRow,
  isExternalFile,
  planExternalSync,
  HISTORY_PATH,
  historyRow,
  MAX_INSTRUCTIONS,
  planSync,
  readDecision,
  readPhoto,
  type RecordFile,
  recordIdFromPath,
  type SyncAgent,
  type SyncPlan,
  writeAnswer,
} from '@ghostaff/shared/record';
import type { DecisionRow } from '@ghostaff/shared/services';
import { type ForgejoConfig, forgejoRepo } from './forgejo';
import { type MemoryStore, projectMemory } from './memory';
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
/** An agent's photo as the sync writes it (`agent_photos`). */
export interface PhotoRow {
  orgId: string;
  agentId: string;
  blocks: PhotoBlock[];
  skipped: SkippedBlock[];
  sha: string;
  updatedAt: string;
}

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
  /** The blob each agent's photo was last read from, by agent id (agent-photo.md). */
  photoShas(orgId: string): Promise<Map<string, string>>;
  /** An agent's photo read from its file, replacing the last. */
  setPhoto(photo: PhotoRow): Promise<void>;
  /** Its file could not be read: say why and keep the last good blocks (none when there were none). */
  failPhoto(orgId: string, agentId: string, sha: string, error: string): Promise<void>;
  /** Its file is gone from the record. */
  removePhoto(agentId: string): Promise<void>;
  /** The organisation's rows of `external_parties`, pending ones included. */
  externalParties(orgId: string): Promise<ExternalSyncRow[]>;
  /** What the record holds of `externos/`, into the rows. */
  applyExternal(orgId: string, plan: ExternalSyncPlan): Promise<void>;
  /** App changes now in the record: a saved row takes its path and hash, a removed one goes. */
  markExternalWritten(written: ExternalWritten[]): Promise<void>;
  /** When the record was last read, and why the last attempt failed (null when it did not). */
  syncState(orgId: string, error: string | null): Promise<void>;
}

/** An app change to `externos/` the record now has. */
export interface ExternalWritten {
  rowId: string;
  path: string;
  /** The hash of the file written; null when it was deleted. */
  hash: string | null;
  /** The row's `updated_at` when planned: a row changed again since stays pending, with the new file's hash. */
  updatedAt: string;
}

export interface RecordSyncDeps {
  store: RecordSyncStore;
  /** GitHub records: installation tokens; null when the GitHub App is not configured. */
  tokens: RepoTokens | null;
  /** Our record store; null when this environment has none. */
  forgejo: ForgejoConfig | null;
  /** The organisation's memory (memory.ts): projected from a record in our record store; none without it. */
  memory?: MemoryStore;
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
  /** Every file under `dir` at `ref`, at any depth: its path inside `dir` and its blob; empty when the folder does not exist. */
  tree(dir: string, ref: string): Promise<{ path: string; sha: string }[]>;
  /** A blob's text, by the sha `tree` gave. */
  blob(sha: string): Promise<string>;
  /** One commit on top of `head` writing these files, or deleting those whose content is null; false when the record moved meanwhile. */
  commit(head: { branch: string; sha: string }, files: RecordChange[], message: string): Promise<boolean>;
}

/** A file a commit writes, or deletes (`content` null). */
export interface RecordChange {
  path: string;
  content: string | null;
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
  /** A folder's tree sha, from its parent's listing; null when it does not exist. */
  const dirSha = async (dir: string, ref: string): Promise<string | null> => {
    const parts = dir.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) return null;
    const list = await call<Array<{ name: string; type: string; sha: string }>>('GET', `/contents${parts.length ? `/${parts.join('/')}` : ''}?ref=${ref}`);
    return (Array.isArray(list) ? list : []).find((e) => e.name === name && e.type === 'dir')?.sha ?? null;
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
    async tree(dir: string, ref: string): Promise<{ path: string; sha: string }[]> {
      const sha = await dirSha(dir, ref);
      if (!sha) return [];
      const t = must(await call<{ tree: Array<{ path: string; type: string; sha: string }>; truncated: boolean }>('GET', `/git/trees/${sha}?recursive=1`), 'tree');
      if (t.truncated) throw new GithubError(413, `tree ${dir} (too many files)`);
      return t.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha }));
    },
    blob,
    /** One commit on top of `head` with these files; false when the branch moved meanwhile. */
    async commit(head: { branch: string; sha: string }, files: RecordChange[], message: string): Promise<boolean> {
      const parent = must(await call<{ tree: { sha: string } }>('GET', `/git/commits/${head.sha}`), 'commit');
      const tree = must(
        await call<{ sha: string }>('POST', '/git/trees', {
          base_tree: parent.tree.sha,
          // A null sha deletes the file from the tree.
          tree: files.map((x) => (x.content === null ? { path: x.path, mode: '100644', type: 'blob', sha: null } : { path: x.path, mode: '100644', type: 'blob', content: x.content })),
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

/** Where the agents' folders are in a record: `agentes/<slug>/`. */
const AGENTS_DIR = 'agentes';

/**
 * Each agent's `agentes/<slug>/foto.yaml` into `agent_photos` (agent-photo.md): read again only when
 * its blob changed, a file that can't be read leaving the last good photo with why, a file gone
 * removing it. Never throws: a photo is never worth failing the organisation's sync for, so a
 * failure is one line of the tick's summary. Returns what changed.
 */
export async function projectPhotos(store: RecordSyncStore, repo: RecordRepo, orgId: string, ref: string, now: Date): Promise<string[]> {
  try {
    const agents = await store.instructedAgents(orgId);
    if (!agents.length) return [];
    const blobs = new Map((await repo.tree(AGENTS_DIR, ref)).map((f) => [f.path, f.sha]));
    const known = await store.photoShas(orgId);
    const notes: string[] = [];
    for (const a of agents) {
      const sha = blobs.get(`${a.slug}/${AGENT_PHOTO_FILE}`);
      if (!sha) {
        if (known.has(a.id)) {
          await store.removePhoto(a.id);
          notes.push(`${a.slug}: photo gone`);
        }
        continue;
      }
      if (known.get(a.id) === sha) continue;
      const raw = await repo.file(`${AGENTS_DIR}/${a.slug}/${AGENT_PHOTO_FILE}`, ref);
      if (raw === null) continue; // moved between the tree and the read: the next tick sees it
      try {
        const photo = readPhoto(raw);
        await store.setPhoto({ orgId, agentId: a.id, blocks: photo.blocks, skipped: photo.skipped, sha, updatedAt: photo.updatedAt ?? now.toISOString() });
        notes.push(`${a.slug}: photo, ${photo.blocks.length} blocks${photo.skipped.length ? `, ${photo.skipped.length} skipped` : ''}`);
      } catch (e) {
        const why = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        await store.failPhoto(orgId, a.id, sha, why);
        notes.push(`${a.slug}: photo not read (${why})`);
      }
    }
    return notes;
  } catch (e) {
    return [`photos not read: ${e instanceof Error ? e.message : String(e)}`];
  }
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * The organisation's `externos/` with its `external_parties` rows, both ways (external-parties.md):
 * the record's files into the rows, then the app's changes in one commit on the head it reads now
 * (the decisions' write-back may have moved it). Returns what happened, for the tick's summary.
 */
export async function syncExternals(store: RecordSyncStore, repo: RecordRepo, orgId: string, now: Date): Promise<string[]> {
  const head = await repo.head();
  const files = (await repo.files(EXTERNAL_DIR, head.sha))
    .filter((f) => isExternalFile(f.name))
    .map((f) => ({ path: `${EXTERNAL_DIR}/${f.name}`, content: f.content, hash: sha256(f.content) }));
  const plan = planExternalSync({ orgId, files, rows: await store.externalParties(orgId), now });
  await store.applyExternal(orgId, plan);
  if (!plan.writes.length) return describeExternalSync(plan, 0);
  const names = plan.writes.map((w) => w.path.slice(EXTERNAL_DIR.length + 1, -3)).join(', ');
  if (!(await repo.commit(head, plan.writes.map(({ path, content }) => ({ path, content })), `externos: cambios desde Ghostaff (${names})`))) {
    return [...describeExternalSync(plan, 0), 'externos: write-back waits: the record moved'];
  }
  await store.markExternalWritten(plan.writes.map((w) => ({ rowId: w.rowId, path: w.path, hash: w.content === null ? null : sha256(w.content), updatedAt: w.updatedAt })));
  return describeExternalSync(plan, plan.writes.length);
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
    const agents = await deps.store.agents(org.id);
    const plan = planSync({ orgId: org.id, files, existing: await deps.store.decisions(org.id), agents, commit: head.sha, now });
    await deps.store.apply(plan);
    const instructions = await projectInstructions(deps.store, gh, org.id, head.sha);
    // Only a record in our record store has a memory the chat reads (memory.ts).
    if (org.host === 'ghostaff' && deps.memory) instructions.push(...(await projectMemory(deps.memory, gh, org.id, head.sha, agents)));
    instructions.push(...(await projectPhotos(deps.store, gh, org.id, head.sha, now)));

    const written: string[] = [];
    let waits: string | null = null;
    if (plan.writeBacks.length) {
      const byId = new Map(files.map((x) => [x.id, x.yaml]));
      let csv = await gh.file(HISTORY_PATH, head.sha);
      const changed: RecordChange[] = [];
      const ids: string[] = [];
      for (const w of plan.writeBacks) {
        const yaml = byId.get(w.recordId);
        if (yaml === undefined) continue;
        changed.push({ path: `${DECISIONS_DIR}/${w.recordId}.yaml`, content: writeAnswer(yaml, w.recordId, w.answer) });
        csv = appendHistoryRow(csv, historyRow(readDecision(w.recordId, yaml), w.answer));
        ids.push(w.recordId);
      }
      if (changed.length) {
        changed.push({ path: HISTORY_PATH, content: csv ?? '' });
        if (await gh.commit(head, changed, `por-decidir: respuestas desde Ghostaff (${ids.join(', ')})`)) {
          written.push(...ids);
          await deps.store.markWrittenBack(plan.writeBacks.filter((w) => written.includes(w.recordId)).map((w) => w.rowId));
        } else {
          waits = 'write-back waits: the record moved';
        }
      }
    }
    const externals = await syncExternals(deps.store, gh, org.id, now);
    await deps.store.syncState(org.id, null);
    const summary = [describeSync(org.slug, plan, written), waits, ...instructions, ...externals].filter((x): x is string => !!x).join('\n');
    return { org: org.slug, ok: true, summary };
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

/** The organisation's record when it is in our record store and this engine reaches it: the one whose memory the chat reads and writes. */
export async function ownRecordRepo(deps: RecordSyncDeps, orgId: string): Promise<RecordRepo | null> {
  if (!deps.forgejo) return null;
  const org = await deps.store.orgWithRecord(orgId);
  return org?.host === 'ghostaff' ? forgejoRepo(deps.forgejo, org.repo, deps.fetch) : null;
}

/** Every organisation with a record this engine can reach, one after another. */
export async function syncAll(deps: RecordSyncDeps): Promise<OrgSyncResult[]> {
  const out: OrgSyncResult[] = [];
  for (const org of await deps.store.orgsWithRecord()) if (canReach(deps, org)) out.push(await syncOrg(deps, org));
  return out;
}
