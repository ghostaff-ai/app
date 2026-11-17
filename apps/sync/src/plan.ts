import {
  DECISIONS_DIR,
  fromMadridMinute,
  madridMinute,
  readDecision,
  type RecordAnswer,
  type RecordDecision,
} from '@ghostaff/shared/record';
import type { DecisionRow } from '@ghostaff/shared/services';

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
  source_commit: string | null;
  synced_at: string;
  closed_at: null;
  // Present only when the file carries an answer.
  answer?: 'ok' | 'no';
  answered_by_name?: string;
  answered_at?: string;
  answer_note?: string | null;
  answer_text?: string | null;
  answer_source?: 'record';
  written_back_at?: string;
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
  commit: string | null;
  now: Date;
}): SyncPlan {
  const { orgId, files, existing, commit, now } = args;
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
      recommendation: d.recomienda ?? null,
      if_yes: d.con_si ?? null,
      if_no: d.con_no ?? null,
      quote: d.cita ?? null,
      sources: (d.fuentes ?? []).map((f) => (f.enlace ? { text: f.texto, link: f.enlace } : { text: f.texto })),
      due_on: d.vence ?? null,
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
