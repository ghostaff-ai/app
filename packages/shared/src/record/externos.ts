import { Document, isSeq, parse } from 'yaml';
import { DEPARTMENTS, type Department, type ExternalKind } from '../models';
import { fromMadridMinute, madridMinute } from './porDecidir';

// Who an organisation works with outside, as files of its record: one Markdown
// file per party in `externos/`, the structured part as front matter and any
// free text below it (docs/plans/ongoing/external-parties.md, «The file»). The
// shape follows Órdago's `suppliers/<slug>.md`. The record is the master; the
// database's `external_parties` is its projection, and a change made in
// Ghostaff is written back on the tick. Pure, no I/O, so the sync and the tests
// share it.

export const EXTERNAL_DIR = 'externos';

const KINDS: Record<string, ExternalKind> = { persona: 'person', empresa: 'company', servicio: 'service' };
const TIPOS: Record<ExternalKind, string> = { person: 'persona', company: 'empresa', service: 'servicio' };

/** One party as its file says it, in the database's words. */
export interface RecordExternal {
  kind: ExternalKind;
  name: string;
  role: string;
  departments: Department[];
  email: string | null;
  phone: string | null;
  website: string | null;
  /** Who added or confirmed it (`alta.por`), and when (`alta.fecha`, an ISO instant); empty and null when the file does not say. */
  addedByName: string;
  addedAt: string | null;
  /** The agent that proposed it (`alta.propone`). */
  proposedByName: string | null;
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** `externos/<slug>.md` → true; anything else in the folder (a `.gitkeep`) is not a party. */
export const isExternalFile = (name: string) => /^[a-z0-9][a-z0-9-]{0,80}\.md$/.test(name);

const optText = (v: unknown, field: string): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' && typeof v !== 'number') throw new Error(`${field} must be text`);
  return String(v).trim() || null;
};

const reqText = (v: unknown, field: string, max: number): string => {
  const s = optText(v, field);
  if (!s) throw new Error(`${field} is required`);
  if (s.length > max) throw new Error(`${field} is over ${max} characters`);
  return s;
};

/** Reads a party's file. Throws, saying why, when Ghostaff cannot read it: the sync skips it. */
export function readExternal(text: string): RecordExternal {
  const m = FRONT.exec(text);
  if (!m) throw new Error('no front matter');
  const data: unknown = parse(m[1]!);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('the front matter is not a map');
  const d = data as Record<string, unknown>;
  const kind = KINDS[String(d.tipo ?? '')];
  if (!kind) throw new Error('tipo must be persona, empresa or servicio');
  const deps = d.departamentos ?? [];
  if (!Array.isArray(deps) || deps.some((x) => !(DEPARTMENTS as readonly unknown[]).includes(x))) {
    throw new Error(`departamentos must be a list of ${DEPARTMENTS.join(', ')}`);
  }
  const alta = d.alta && typeof d.alta === 'object' && !Array.isArray(d.alta) ? (d.alta as Record<string, unknown>) : {};
  const fecha = optText(alta.fecha, 'alta.fecha');
  return {
    kind,
    name: reqText(d.nombre, 'nombre', 120),
    role: reqText(d.hace, 'hace', 300),
    departments: [...new Set(deps as Department[])],
    email: optText(d.email, 'email'),
    phone: optText(d.telefono, 'telefono'),
    website: optText(d.web, 'web'),
    addedByName: optText(alta.por, 'alta.por') ?? '',
    addedAt: fecha ? fromMadridMinute(fecha) : null,
    proposedByName: optText(alta.propone, 'alta.propone'),
  };
}

/** The free text below the front matter, as it is; all of it when the file has none. */
export function externalBody(text: string): string {
  const m = FRONT.exec(text);
  return m ? text.slice(m[0].length) : text;
}

/**
 * A party's file: its front matter from `p`, then the body of `existing` kept byte for byte
 * (what a person or an organisation wrote by hand). A new file has no body.
 */
export function writeExternal(p: RecordExternal, existing: string | null = null): string {
  const alta: Record<string, string> = {};
  if (p.addedByName) alta.por = p.addedByName;
  if (p.addedAt) alta.fecha = madridMinute(new Date(p.addedAt));
  if (p.proposedByName) alta.propone = p.proposedByName;
  const front: Record<string, unknown> = {
    tipo: TIPOS[p.kind],
    nombre: p.name,
    hace: p.role,
    departamentos: p.departments,
    ...(p.email ? { email: p.email } : {}),
    ...(p.phone ? { telefono: p.phone } : {}),
    ...(p.website ? { web: p.website } : {}),
    ...(Object.keys(alta).length ? { alta } : {}),
  };
  const doc = new Document(front);
  const deps = doc.get('departamentos', true);
  if (isSeq(deps)) deps.flow = true;
  const yaml = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  const body = existing === null ? '' : externalBody(existing);
  return `---\n${yaml}---\n${body && !body.startsWith('\n') ? `\n${body}` : body}`;
}

/** The ASCII slug of a name, for its file: «Gestoría López» → `gestoria-lopez`. */
export function externalSlug(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return s || 'externo';
}

/** A free path for a new party in the folder: `<slug>.md`, then `<slug>-2.md`… */
export function freeExternalPath(name: string, taken: Set<string>): string {
  const base = externalSlug(name);
  for (let n = 1; ; n++) {
    const path = `${EXTERNAL_DIR}/${n === 1 ? base : `${base}-${n}`}.md`;
    if (!taken.has(path)) return path;
  }
}

// The sync -------------------------------------------------------------------

/** A row of `external_parties`, as the sync reads it with the service role. */
export interface ExternalSyncRow {
  id: string;
  path: string | null;
  kind: ExternalKind;
  name: string;
  role: string;
  departments: string[];
  email: string | null;
  phone: string | null;
  website: string | null;
  added_by_name: string;
  added_at: string;
  proposed_by_name: string | null;
  content_hash: string | null;
  pending: 'save' | 'remove' | null;
  updated_at: string;
}

/** A file of the folder at the head the sync read, with the hash the engine took of it. */
export interface ExternalFile {
  path: string;
  content: string;
  hash: string;
}

/** The columns the sync writes for a party from its file, upserted by `(org_id, path)`; every one carries the same columns. */
export interface ExternalUpsert {
  org_id: string;
  path: string;
  kind: ExternalKind;
  name: string;
  role: string;
  departments: Department[];
  email: string | null;
  phone: string | null;
  website: string | null;
  added_by_name: string;
  added_at: string;
  proposed_by_name: string | null;
  content_hash: string;
  pending: null;
  updated_at: string;
}

/** An app change going into the record: a file written (`content`) or deleted (null). */
export interface ExternalWrite {
  rowId: string;
  path: string;
  content: string | null;
  /** The row's `updated_at` when planned: a row changed again meanwhile is left pending. */
  updatedAt: string;
}

export interface ExternalSyncPlan {
  upserts: ExternalUpsert[];
  /** Rows whose file is gone from the record. */
  deletes: string[];
  writes: ExternalWrite[];
  invalid: { path: string; error: string }[];
  /** App changes dropped because the record changed the same file meanwhile: the record wins. */
  conflicts: { path: string; name: string }[];
}

const fromRow = (r: ExternalSyncRow): RecordExternal => ({
  kind: r.kind,
  name: r.name,
  role: r.role,
  departments: r.departments.filter((d): d is Department => (DEPARTMENTS as readonly string[]).includes(d)),
  email: r.email,
  phone: r.phone,
  website: r.website,
  addedByName: r.added_by_name,
  addedAt: r.added_at,
  proposedByName: r.proposed_by_name,
});

function upsertOf(orgId: string, f: ExternalFile, p: RecordExternal, row: ExternalSyncRow | undefined, now: string): ExternalUpsert {
  return {
    org_id: orgId,
    path: f.path,
    kind: p.kind,
    name: p.name,
    role: p.role,
    departments: p.departments,
    email: p.email,
    phone: p.phone,
    website: p.website,
    added_by_name: p.addedByName,
    added_at: p.addedAt ?? row?.added_at ?? now,
    proposed_by_name: p.proposedByName,
    content_hash: f.hash,
    pending: null,
    updated_at: now,
  };
}

/**
 * What one sync of an organisation's `externos/` does (external-parties.md, «The sync, both ways»):
 * the record's files into the rows, and the app's pending changes into the record on top of the
 * head it read. The record wins: a pending change to a file someone changed since it was last
 * read is dropped, and the row takes the file.
 */
export function planExternalSync(args: { orgId: string; files: ExternalFile[]; rows: ExternalSyncRow[]; now: Date }): ExternalSyncPlan {
  const { orgId, files, rows } = args;
  const now = args.now.toISOString();
  const plan: ExternalSyncPlan = { upserts: [], deletes: [], writes: [], invalid: [], conflicts: [] };
  const byPath = new Map(rows.filter((r) => r.path).map((r) => [r.path!, r]));
  const taken = new Set(files.map((f) => f.path));

  for (const f of files) {
    const row = byPath.get(f.path);
    let parsed: RecordExternal;
    try {
      parsed = readExternal(f.content);
    } catch (e) {
      plan.invalid.push({ path: f.path, error: e instanceof Error ? e.message : String(e) });
      // A file unreadable for a moment does not lose its row, nor take an app change.
      continue;
    }
    if (row?.pending && row.content_hash === f.hash) {
      plan.writes.push({
        rowId: row.id,
        path: f.path,
        content: row.pending === 'remove' ? null : writeExternal(fromRow(row), f.content),
        updatedAt: row.updated_at,
      });
      continue;
    }
    if (row?.pending) plan.conflicts.push({ path: f.path, name: row.name });
    if (!row || row.pending || row.content_hash !== f.hash) plan.upserts.push(upsertOf(orgId, f, parsed, row, now));
  }

  for (const r of rows) {
    if (r.path === null) {
      if (r.pending === 'save') {
        const path = freeExternalPath(r.name, taken);
        taken.add(path);
        plan.writes.push({ rowId: r.id, path, content: writeExternal(fromRow(r)), updatedAt: r.updated_at });
      } else {
        plan.deletes.push(r.id);
      }
      continue;
    }
    if (taken.has(r.path)) continue;
    // Its file is gone from the record: the record wins, whatever the app had pending.
    if (r.pending === 'save') plan.conflicts.push({ path: r.path, name: r.name });
    plan.deletes.push(r.id);
  }
  return plan;
}

/** One line per thing worth saying about the folder's sync, for the tick's summary. */
export function describeExternalSync(plan: ExternalSyncPlan, written: number): string[] {
  return [
    plan.upserts.length || plan.deletes.length ? `externos: ${plan.upserts.length} from the record, ${plan.deletes.length} gone` : null,
    written ? `externos: ${written} app changes written back` : null,
    ...plan.invalid.map((i) => `externos: skipped ${i.path}: ${i.error}`),
    ...plan.conflicts.map((c) => `externos: ${c.path} changed in the record; kept the record's over the app's change to ${c.name}`),
  ].filter((x): x is string => x !== null);
}
