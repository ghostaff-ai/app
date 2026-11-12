import type { SupabaseClient } from '@supabase/supabase-js';
import type { Answer, Decision, MembershipRole, MyOrganization } from '../models';

// The only place the app talks to the database. Screens, hooks and components
// call these functions, never `supabase.from(...)` (the same rule as
// cultuvilla/app's service layer): one place per table to check, cache or
// migrate. Every read here runs as the signed-in person, so row-level security
// decides what comes back; nothing here filters by organisation for safety,
// only for the screen.

export interface DecisionRow {
  id: string;
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
  answer: Answer | null;
  answered_by_name: string | null;
  answered_at: string | null;
  answer_note: string | null;
  answer_text: string | null;
  answer_source: 'record' | 'app' | null;
  written_back_at: string | null;
  closed_at: string | null;
}

export function decisionFromRow(r: DecisionRow): Decision {
  return {
    id: r.id,
    orgId: r.org_id,
    recordId: r.record_id,
    sourcePath: r.source_path,
    area: r.area,
    kind: r.kind,
    question: r.question,
    context: r.context,
    proposedBy: r.proposed_by,
    createdOn: r.created_on,
    ruleProposal: r.rule_proposal,
    answer:
      r.answer && r.answered_at
        ? {
            answer: r.answer,
            byName: r.answered_by_name ?? '',
            at: r.answered_at,
            note: r.answer_note,
            signedText: r.answer_text,
            source: r.answer_source ?? 'record',
            writtenBackAt: r.written_back_at,
          }
        : null,
    closedAt: r.closed_at,
  };
}

const DECISION_COLUMNS =
  'id, org_id, record_id, source_path, area, kind, question, context, proposed_by, created_on, rule_proposal, answer, answered_by_name, answered_at, answer_note, answer_text, answer_source, written_back_at, closed_at';

interface MembershipWithOrg {
  role: MembershipRole;
  display_name: string;
  organizations: { id: string; slug: string; name: string } | null;
}

/** The organisations the signed-in person belongs to, by name. */
export async function listMyOrganizations(client: SupabaseClient, userId: string): Promise<MyOrganization[]> {
  const { data, error } = await client
    .from('memberships')
    .select('role, display_name, organizations ( id, slug, name )')
    .eq('user_id', userId)
    .returns<MembershipWithOrg[]>();
  if (error) throw error;
  return (data ?? [])
    .flatMap((m) => (m.organizations ? [{ ...m.organizations, role: m.role, displayName: m.display_name }] : []))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** The organisation's open decisions: unanswered first, then newest first. */
export async function listOpenDecisions(client: SupabaseClient, orgId: string): Promise<Decision[]> {
  const { data, error } = await client
    .from('decisions')
    .select(DECISION_COLUMNS)
    .eq('org_id', orgId)
    .is('closed_at', null)
    .order('created_on', { ascending: false })
    .returns<DecisionRow[]>();
  if (error) throw error;
  return sortInbox((data ?? []).map(decisionFromRow));
}

export function sortInbox(ds: Decision[]): Decision[] {
  return [...ds].sort((a, b) => {
    if (!a.answer !== !b.answer) return a.answer ? 1 : -1;
    return b.createdOn.localeCompare(a.createdOn);
  });
}

export async function getDecision(client: SupabaseClient, id: string): Promise<Decision | null> {
  const { data, error } = await client.from('decisions').select(DECISION_COLUMNS).eq('id', id).maybeSingle<DecisionRow>();
  if (error) throw error;
  return data ? decisionFromRow(data) : null;
}

export interface AnswerInput {
  decisionId: string;
  answer: Answer;
  note?: string;
  /** Only for a rule answered OK. */
  signedText?: string;
}

/** OK or no. The database checks membership and signs with the person's display name. */
export async function answerDecision(client: SupabaseClient, input: AnswerInput): Promise<Decision> {
  const { data, error } = await client
    .rpc('answer_decision', {
      decision_id: input.decisionId,
      answer: input.answer,
      note: input.note?.trim() || null,
      signed_text: input.signedText?.trim() || null,
    })
    .single<DecisionRow>();
  if (error) throw error;
  return decisionFromRow(data);
}
