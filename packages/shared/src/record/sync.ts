import {
  DECISIONS_DIR,
  fromMadridMinute,
  madridMinute,
  readDecision,
  type RecordAnswer,
  type RecordDecision,
} from './porDecidir';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DecisionRow } from '../services';

// What one sync of an organisation's `por-decidir/` has to do, worked out
// without touching the database or the files, so it can be tested. The record
// is the source of truth: a file's content always wins over the row, except
// that an answer given in the app is kept until it has been written back.

export interface RecordFile {
  id: string;
  yaml: string;
}

/** The columns the sync job writes for a decision that is in the record. */
export interface DecisionUpsert {
  org_id: string;
  record_id: string;
  source_path: string;
  area: string;
  kind: string;
  question: string;
  context: string;
  proposed_by: string;
  created_on: string;
  rule_proposal: string | null;
  recommendation: string | null;
  if_yes: string | null;
  if_no: string | null;
  quote: string | null;
  sources: { text: string; link?: string }[];
  due_on: string | null;
  options: { id: string; text: string; if?: string }[];
  recommended_option: string | null;
  high_stakes: boolean;
  agent_id: string | null;
  source_commit: string | null;
  synced_at: string;
  closed_at: null;
  // Present only when the file carries an answer.
  answer?: 'ok' | 'no';
  answer_option?: string | null;
  answered_by_name?: string;
  answered_at?: string;
  answer_note?: string | null;
  answer_text?: string | null;
  answer_source?: 'record';
  written_back_at?: string;
}

/** An organisation's agent, as the sync matches a file's `propone` to it. */
export interface SyncAgent {
  id: string;
  slug: string | null;
  name: string;
  ghost: string;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

/**
 * The agent a file's `propone` names (decision-model.md, decision 4): by its slug, then by its
 * name, then by its ghost when only one agent has it. Null when none, or more than one, fits.
 */
export function matchAgent(propone: string, agents: SyncAgent[]): string | null {
  const p = fold(propone);
  for (const key of [(a: SyncAgent) => a.slug ?? '', (a: SyncAgent) => a.name, (a: SyncAgent) => a.ghost]) {
    const hits = agents.filter((a) => fold(key(a)) === p);
    if (hits.length === 1) return hits[0]!.id;
    if (hits.length > 1) return null;
  }
  return null;
}

export interface WriteBack {
  recordId: string;
  rowId: string;
  answer: RecordAnswer;
}

export interface SyncPlan {
  upserts: DecisionUpsert[];
  /** Row ids whose file is gone: the agent acted and deleted it. */
  close: string[];
  /** Answers given in the app that the record does not have yet. */
  writeBacks: WriteBack[];
  /** Files that could not be read; skipped, the rest still syncs. */
  invalid: { id: string; error: string }[];
  /** An app answer and a different record answer for the same decision; the record's is kept. */
  conflicts: { recordId: string; app: string; record: string }[];
}

export function planSync(args: {
  orgId: string;
  files: RecordFile[];
  existing: DecisionRow[];
  /** The organisation's agents, to point each decision at the one that asked. */
  agents?: SyncAgent[];
  commit: string | null;
  now: Date;
}): SyncPlan {
  const { orgId, files, existing, commit, now, agents = [] } = args;
  const syncedAt = now.toISOString();
  const byRecordId = new Map(existing.map((r) => [r.record_id, r]));
  const plan: SyncPlan = { upserts: [], close: [], writeBacks: [], invalid: [], conflicts: [] };
  const seen = new Set<string>();

  for (const f of files) {
    let d: RecordDecision;
    try {
      d = readDecision(f.id, f.yaml);
    } catch (e) {
      plan.invalid.push({ id: f.id, error: e instanceof Error ? e.message : String(e) });
      // Do not close a row just because its file is malformed for a moment.
      seen.add(f.id);
      continue;
    }
    seen.add(d.id);
    const row = byRecordId.get(d.id);

    const pick = d.opciones?.find((o) => o.id === d.recomienda);
    const up: DecisionUpsert = {
      org_id: orgId,
      record_id: d.id,
      source_path: `${DECISIONS_DIR}/${d.id}.yaml`,
      area: d.area,
      kind: d.tipo,
      question: d.pregunta,
      context: d.contexto,
      proposed_by: d.propone,
      created_on: d.creada.slice(0, 10),
      rule_proposal: d.regla?.propuesta ?? null,
      // With options, the pick's words: what an app from before options puts on its OK button.
      recommendation: pick ? pick.texto : (d.recomienda ?? null),
      if_yes: d.con_si ?? null,
      if_no: d.con_no ?? null,
      quote: d.cita ?? null,
      sources: (d.fuentes ?? []).map((f) => (f.enlace ? { text: f.texto, link: f.enlace } : { text: f.texto })),
      due_on: d.vence ?? null,
      options: (d.opciones ?? []).map((o) => (o.con ? { id: o.id, text: o.texto, if: o.con } : { id: o.id, text: o.texto })),
      recommended_option: pick ? pick.id : null,
      high_stakes: d.importancia === 'alta',
      // A decision asked from the chat is pointed at its agent when opened; keep that when the name does not match.
      agent_id: matchAgent(d.propone, agents) ?? row?.agent_id ?? null,
      source_commit: commit,
      synced_at: syncedAt,
      closed_at: null,
    };

    if (d.respuesta) {
      const appPending = row?.answer && row.answer_source === 'app' && !row.written_back_at;
      if (appPending && row?.answer !== d.respuesta.decision) {
        plan.conflicts.push({ recordId: d.id, app: row?.answer ?? '', record: d.respuesta.decision });
      }
      Object.assign(up, {
        answer: d.respuesta.decision,
        answer_option: d.respuesta.opcion ?? (pick && d.respuesta.decision === 'ok' ? pick.id : null),
        answered_by_name: d.respuesta.por,
        answered_at: fromMadridMinute(d.respuesta.fecha),
        answer_note: d.respuesta.nota ?? null,
        answer_text: d.respuesta.texto ?? null,
        answer_source: 'record',
        written_back_at: syncedAt,
      } satisfies Partial<DecisionUpsert>);
    } else if (row?.answer && row.answer_source === 'app' && row.answered_at) {
      plan.writeBacks.push({
        recordId: d.id,
        rowId: row.id,
        answer: {
          decision: row.answer,
          por: row.answered_by_name ?? '',
          fecha: madridMinute(new Date(row.answered_at)),
          ...(row.answer_note ? { nota: row.answer_note } : {}),
          ...(row.answer_text ? { texto: row.answer_text } : {}),
          ...(row.answer_option && pick ? { opcion: row.answer_option } : {}),
        },
      });
    }
    plan.upserts.push(up);
  }

  for (const r of existing) {
    if (!seen.has(r.record_id) && !r.closed_at) plan.close.push(r.id);
  }
  return plan;
}

/**
 * Writes a plan's rows: what the record holds, and the rows whose file is
 * gone closed. Write-backs are the caller's (into a checkout, or a commit
 * through GitHub's API); `markWrittenBack` records one once it is in the record.
 */
export async function applySync(db: SupabaseClient, plan: SyncPlan, now: Date = new Date()): Promise<void> {
  // Two batches, each with the same columns: in a mixed batch PostgREST would
  // write NULL into the answer columns of the rows that do not carry one, and
  // wipe an app answer that has not been written back yet.
  const withAnswer = plan.upserts.filter((u) => u.answer);
  const withoutAnswer = plan.upserts.filter((u) => !u.answer);
  for (const batch of [withAnswer, withoutAnswer]) {
    if (!batch.length) continue;
    const { error } = await db.from('decisions').upsert(batch, { onConflict: 'org_id,record_id' });
    if (error) throw error;
  }
  if (plan.close.length) {
    const { error } = await db.from('decisions').update({ closed_at: now.toISOString() }).in('id', plan.close);
    if (error) throw error;
  }
}

export async function markWrittenBack(db: SupabaseClient, rowIds: string[], now: Date = new Date()): Promise<void> {
  if (!rowIds.length) return;
  const { error } = await db.from('decisions').update({ written_back_at: now.toISOString() }).in('id', rowIds);
  if (error) throw error;
}

/** One line per thing worth saying about a sync, for a log. */
export function describeSync(org: string, plan: SyncPlan, writtenBack: string[]): string {
  return [
    `${org}: ${plan.upserts.length} in the record, ${plan.close.length} closed`,
    writtenBack.length ? `${writtenBack.length} app answers written back: ${writtenBack.join(', ')}` : null,
    ...plan.invalid.map((i) => `skipped ${i.id}: ${i.error}`),
    ...plan.conflicts.map((c) => `conflict on ${c.recordId}: app said ${c.app}, record says ${c.record}; kept the record's`),
  ]
    .filter(Boolean)
    .join('\n');
}
