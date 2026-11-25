// An agent asking a person to decide, from its chat (docs/plans/ready/decision-model.md,
// decision 5). The agent calls `pedir_decision`; the reply's writer (chat.ts) turns
// the call into a decision file in the organisation's record (`por-decidir/`, the
// same file a run would write), synced into the database at once, and a card in
// the agent's message. The card and the deck are one decision: answering either
// answers both. The record wins, as for every decision.

import { type DecisionPart, isDecisionPart, isDecisionQuotePart, type MessagePart } from '@ghostaff/shared';
import { kebab, MAX_OPTIONS, readDecision, type RecordDecision, type RecordOption, writeDecision } from '@ghostaff/shared/record';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentTools, ToolOutcome, ToolSpec } from './tools';

export const DECISION_TOOL = 'pedir_decision';

/** Decisions one message may open. */
export const MAX_DECISIONS = 3;

/** Opens a decision file in the organisation's record and brings it into the database. */
export interface DecisionOpener {
  /**
   * Commits `por-decidir/<id>.yaml` (a free id, from `base`) and syncs it; returns the row's id, the
   * record id it took, and points the row at the agent. Null when the organisation has no record this engine reaches.
   */
  open(a: { orgId: string; agentId: string; base: string; decision: (id: string) => string }): Promise<{ decisionId: string; recordId: string } | null>;
  /** What the agent reads of its decisions in the conversation: the question, the options and the answer if any. */
  briefs(ids: string[]): Promise<Map<string, DecisionBrief>>;
}

export interface DecisionBrief {
  id: string;
  question: string;
  /** The words of each choice, the pick first. */
  choices: string[];
  /** The answer in words («El viernes», «no», «OK»), by whom; null while it waits. */
  answer: { what: string; by: string; note: string | null } | null;
  closed: boolean;
}

export function decisionToolSpec(): ToolSpec {
  return {
    name: DECISION_TOOL,
    description:
      'Ask a person to decide something that is theirs to decide (money, something public, a client, a change of plan), instead of asking in your text. ' +
      'It becomes a card in your message and in their Decisiones tab; they answer with one tap. ' +
      'Give a yes-or-no question with `recomienda` (what you would do, as a short verb phrase: the OK button), `con_si` and `con_no`; ' +
      `or 2 to ${MAX_OPTIONS} \`opciones\` with \`recomienda\` set to the id of the one you would pick. ` +
      'Mark `importancia: alta` only when getting it wrong is costly to undo. All text in Spanish. ' +
      'After it, say in one line that it waits for their answer, and do not act on it until they answer.',
    input_schema: {
      type: 'object',
      properties: {
        pregunta: { type: 'string', description: 'The question, short, ending in «?».' },
        contexto: { type: 'string', description: 'What they need to decide in a minute: the figure, where it comes from, what happens with each answer.' },
        tipo: { type: 'string', description: 'The class of decision in kebab-case (precio, publicar-post, cambiar-proveedor…). Reuse one you used before.' },
        recomienda: { type: 'string', description: 'Yes-or-no: your pick as a short verb phrase («Subir a 4,20 €»). With options: the id of your pick.' },
        con_si: { type: 'string', description: 'Yes-or-no only: what you do with the OK, one sentence.' },
        con_no: { type: 'string', description: 'Yes-or-no only: what happens with the no, one sentence.' },
        opciones: {
          type: 'array',
          description: `2 to ${MAX_OPTIONS} options instead of yes or no.`,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'kebab-case, unique.' },
              texto: { type: 'string', description: 'A short verb phrase: the button.' },
              con: { type: 'string', description: 'What happens with it, one sentence.' },
            },
            required: ['id', 'texto'],
          },
        },
        cita: { type: 'string', description: 'One literal line from the most telling source.' },
        fuentes: { type: 'array', items: { type: 'string' }, description: 'Where what you say comes from, one per item.' },
        vence: { type: 'string', description: 'YYYY-MM-DD: the last day the answer is useful.' },
        importancia: { type: 'string', enum: ['alta'], description: 'Only when a wrong answer is costly to undo.' },
      },
      required: ['pregunta', 'contexto', 'tipo', 'recomienda'],
    },
  };
}

/** The tool for an agent's set of tools. It only works inside a reply, which intercepts it (chat.ts). */
export const DECISION_TOOLS: AgentTools = {
  specs: [decisionToolSpec()],
  accounts: [],
  accountProviders: [],
  stepFor: () => 'Preparando una decisión',
  writes: () => false,
  actionFor: (name) => name,
  run: async () => ({ content: 'Solo se puede pedir una decisión en una conversación.', isError: true }),
};

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * The decision as the record keeps it, from the model's input; throws with a message the
 * model can fix from. `id` is filled in by the opener once it has a free one.
 */
export function decisionFromInput(input: unknown, who: { propone: string; area: string; today: string }): Omit<RecordDecision, 'id'> {
  const i = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const pregunta = str(i.pregunta, 300);
  const contexto = typeof i.contexto === 'string' ? i.contexto.trim().slice(0, 4000) : '';
  const tipo = kebab(str(i.tipo, 60), 40);
  const recomienda = str(i.recomienda, 120);
  if (!pregunta) throw new Error('Falta `pregunta`.');
  if (!contexto) throw new Error('Falta `contexto`: lo que hace falta para decidir en un minuto.');
  if (!tipo) throw new Error('Falta `tipo`, en kebab-case.');
  if (!recomienda) throw new Error('Falta `recomienda`.');
  const d: Omit<RecordDecision, 'id'> = { area: kebab(who.area, 40) || 'general', tipo, pregunta, contexto, propone: who.propone, creada: who.today, recomienda };
  if (Array.isArray(i.opciones) && i.opciones.length) {
    d.opciones = i.opciones.slice(0, MAX_OPTIONS + 1).map((o): RecordOption => {
      const x = (typeof o === 'object' && o !== null ? o : {}) as Record<string, unknown>;
      const texto = str(x.texto, 120);
      const opt: RecordOption = { id: kebab(str(x.id, 40) || texto, 40), texto };
      const con = str(x.con, 300);
      if (con) opt.con = con;
      return opt;
    });
    d.recomienda = kebab(recomienda, 40);
  } else {
    const con_si = str(i.con_si, 300);
    const con_no = str(i.con_no, 300);
    if (con_si) d.con_si = con_si;
    if (con_no) d.con_no = con_no;
  }
  const cita = str(i.cita, 300);
  if (cita) d.cita = cita;
  if (Array.isArray(i.fuentes)) {
    const fuentes = i.fuentes.map((f) => str(f, 200)).filter(Boolean).slice(0, 6);
    if (fuentes.length) d.fuentes = fuentes.map((texto) => ({ texto }));
  }
  const vence = str(i.vence, 10);
  if (vence) d.vence = vence;
  if (i.importancia === 'alta') d.importancia = 'alta';
  // The reader is the judge: a decision it refuses is never committed.
  readDecision('comprobando', writeDecision({ id: 'comprobando', ...d }));
  return d;
}

const fail = (content: string): { outcome: ToolOutcome } => ({ outcome: { content, isError: true } });

/** Turns one `pedir_decision` call into a decision in the record and a card in the message. */
export async function proposeDecision(
  opener: DecisionOpener,
  at: { orgId: string; agentId: string; propone: string; area: string; today: string },
  input: unknown,
  already: readonly DecisionPart[],
): Promise<{ part?: DecisionPart; outcome: ToolOutcome }> {
  if (already.length >= MAX_DECISIONS) return fail(`Ya hay ${MAX_DECISIONS} decisiones en este mensaje: espera a que las contesten.`);
  let d: Omit<RecordDecision, 'id'>;
  try {
    d = decisionFromInput(input, at);
  } catch (e) {
    return fail(`La decisión no es válida: ${e instanceof Error ? e.message.replace(/^por-decidir\/comprobando\.yaml: /, '') : String(e)}`);
  }
  if (already.some((p) => p.question === d.pregunta)) return fail('Ya has pedido esa decisión en este mensaje.');
  const opened = await opener.open({
    orgId: at.orgId,
    agentId: at.agentId,
    base: `${kebab(at.propone, 20) || 'agente'}-${kebab(d.pregunta, 40) || 'decision'}`,
    decision: (id) => writeDecision({ id, ...d }),
  });
  if (!opened) return fail('Esta organización todavía no tiene registro donde guardar decisiones: pregunta en el texto de tu mensaje.');
  const part: DecisionPart = { type: 'decision', decisionId: opened.decisionId, question: d.pregunta };
  return {
    part,
    outcome: {
      content: `Decisión abierta: «${d.pregunta}». Está en tu mensaje y en Decisiones. Di en una línea que espera su respuesta; no actúes hasta que la tengas.`,
      isError: false,
    },
  };
}

/** A decision as the agent reads it in the conversation: in its own message, or quoted by a person who asks about it. */
export function decisionLine(b: DecisionBrief | undefined, kind: 'mine' | 'quoted', question: string): string {
  if (!b) return kind === 'mine' ? `[Pedí decidir: «${question}».]` : `[Pregunta sobre la decisión «${question}».]`;
  const state = b.answer
    ? `respondida: ${b.answer.what}, por ${b.answer.by}${b.answer.note ? ` («${b.answer.note}»)` : ''}`
    : b.closed
      ? 'cerrada sin respuesta'
      : 'todavía sin responder';
  const choices = b.choices.length ? ` Opciones: ${b.choices.map((c) => `«${c}»`).join(', ')}; la primera es la recomendada.` : '';
  return kind === 'mine' ? `[Pedí decidir: «${b.question}»; ${state}.]` : `[Pregunta sobre la decisión «${b.question}» (${state}).${choices}]`;
}

/** The decision ids a set of messages carries, to look them up once. */
export function decisionIds(parts: readonly MessagePart[][]): string[] {
  const ids = new Set<string>();
  for (const ps of parts) for (const p of ps) if (isDecisionPart(p) || isDecisionQuotePart(p)) ids.add(p.decisionId);
  return [...ids];
}

interface BriefRow {
  id: string;
  question: string;
  recommendation: string | null;
  options: { id: string; text: string }[] | null;
  recommended_option: string | null;
  answer: 'ok' | 'no' | null;
  answer_option: string | null;
  answered_by_name: string | null;
  answer_note: string | null;
  closed_at: string | null;
}

/** A decision row as the agent reads it. Pure. */
export function briefOf(r: BriefRow): DecisionBrief {
  const options = r.options ?? [];
  const pick = options.find((o) => o.id === r.recommended_option);
  const choices = options.length ? [...(pick ? [pick.text] : []), ...options.filter((o) => o !== pick).map((o) => o.text)] : [r.recommendation || 'OK', 'No'];
  const chosen = r.answer_option ? options.find((o) => o.id === r.answer_option)?.text : null;
  const what = chosen ?? (r.answer === 'ok' ? (pick?.text ?? r.recommendation ?? 'OK') : 'no');
  return {
    id: r.id,
    question: r.question,
    choices,
    answer: r.answer ? { what, by: r.answered_by_name ?? 'alguien', note: r.answer_note } : null,
    closed: !!r.closed_at,
  };
}

/** The briefs over Supabase with the service role; the ids come from messages the engine already reads. */
export async function decisionBriefs(admin: SupabaseClient, ids: string[]): Promise<Map<string, DecisionBrief>> {
  const { data, error } = await admin
    .from('decisions')
    .select('id, question, recommendation, options, recommended_option, answer, answer_option, answered_by_name, answer_note, closed_at')
    .in('id', ids.slice(0, 50))
    .returns<BriefRow[]>();
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.id, briefOf(r)]));
}
