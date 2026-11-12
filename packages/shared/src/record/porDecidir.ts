import { isMap, parse, parseDocument } from 'yaml';
import { RULE_KIND } from '../models';

// The decision files an agent leaves for a person: one YAML file per decision
// in the record's `por-decidir/`. The format is Órdago's
// (ordago-app/business/por-decidir/README.md); this is a port of the Órdago
// panel's reader and writer (ordago-apps/apps/ordago-panel/lib/decisiones.ts),
// minus Órdago's fixed list of areas: each organisation has its own.
// Pure, no I/O, so the app, the sync job and the tests share it.

export const DECISIONS_DIR = 'por-decidir';

export interface RecordAnswer {
  decision: 'ok' | 'no';
  /** Who answered, as they sign (`Álvaro`). */
  por: string;
  /** `YYYY-MM-DD HH:mm`, Madrid time, as the panel writes it. */
  fecha: string;
  nota?: string;
  /** Only in a rule: the wording the person signs. */
  texto?: string;
}

export interface RecordRule {
  propuesta: string;
  origen: string;
  cambia?: string;
}

export interface RecordDecision {
  id: string;
  area: string;
  tipo: string;
  pregunta: string;
  contexto: string;
  propone: string;
  creada: string;
  regla?: RecordRule;
  respuesta?: RecordAnswer;
}

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const text = (v: unknown, field: string, id: string): string => {
  if (typeof v === 'number' || v instanceof Date) v = dateish(v);
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${DECISIONS_DIR}/${id}.yaml: missing \`${field}\``);
  return v.trim();
};

// YAML 1.1 readers turn `2026-11-07` into a Date; the `yaml` package keeps it a
// string by default, but be safe either way.
const dateish = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

/** A decision id is its file name: lowercase, digits and hyphens, so it cannot leave `por-decidir/`. */
export function validateRecordId(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Unknown decision: ${String(id)}`);
  return id;
}

/** `por-decidir/seo-x.yaml` → `seo-x`; null for anything that is not a decision file (the README). */
export function recordIdFromPath(path: string): string | null {
  const m = /^(?:.*\/)?([a-z0-9][a-z0-9-]*)\.ya?ml$/.exec(path);
  return m?.[1] ?? null;
}

export function readDecision(id: string, yaml: string): RecordDecision {
  validateRecordId(id);
  const d = parse(yaml) as Record<string, unknown> | null;
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error(`${DECISIONS_DIR}/${id}.yaml is not a YAML map`);

  const area = text(d.area, 'area', id);
  if (!KEBAB.test(area)) throw new Error(`${DECISIONS_DIR}/${id}.yaml: \`area\` is kebab-case («${area}»)`);
  const tipo = text(d.tipo, 'tipo', id);
  if (!KEBAB.test(tipo)) throw new Error(`${DECISIONS_DIR}/${id}.yaml: \`tipo\` is kebab-case («${tipo}»)`);

  const r = d.respuesta as Record<string, unknown> | null | undefined;
  let respuesta: RecordAnswer | undefined;
  if (r) {
    if (r.decision !== 'ok' && r.decision !== 'no') throw new Error(`${DECISIONS_DIR}/${id}.yaml: \`respuesta.decision\` must be ok or no`);
    respuesta = { decision: r.decision, por: text(r.por, 'respuesta.por', id), fecha: text(r.fecha, 'respuesta.fecha', id) };
    if (typeof r.nota === 'string' && r.nota.trim()) respuesta.nota = r.nota.trim();
    if (typeof r.texto === 'string' && r.texto.trim()) respuesta.texto = r.texto.trim();
  }

  let regla: RecordRule | undefined;
  if (tipo === RULE_KIND) {
    regla = { propuesta: text(d.propuesta, 'propuesta', id), origen: text(d.origen, 'origen', id) };
    if (d.cambia != null) regla.cambia = text(d.cambia, 'cambia', id);
  }

  return {
    id,
    area,
    tipo,
    pregunta: text(d.pregunta, 'pregunta', id),
    contexto: text(d.contexto, 'contexto', id),
    propone: text(d.propone, 'propone', id),
    creada: text(d.creada, 'creada', id),
    ...(regla ? { regla } : {}),
    ...(respuesta ? { respuesta } : {}),
  };
}

/** Writes the answer into the YAML without touching anything else (comments and order kept). */
export function writeAnswer(yaml: string, id: string, answer: RecordAnswer): string {
  const doc = parseDocument(yaml);
  if (!isMap(doc.contents)) throw new Error(`${DECISIONS_DIR}/${id}.yaml is not a YAML map`);
  const current = readDecision(id, yaml);
  if (current.respuesta) throw new Error(`${DECISIONS_DIR}/${id}.yaml already has an answer`);
  if (answer.texto != null && !current.regla) throw new Error('Only a rule carries signed text.');
  if (current.regla && answer.decision === 'ok' && !answer.texto?.trim()) throw new Error('A rule is signed with its text.');
  const r: Record<string, string> = { decision: answer.decision, por: answer.por, fecha: answer.fecha };
  if (answer.nota?.trim()) r.nota = answer.nota.trim();
  if (answer.decision === 'ok' && answer.texto?.trim()) r.texto = answer.texto.trim();
  doc.set('respuesta', doc.createNode(r));
  return doc.toString();
}

/** A timestamp as the panel writes `respuesta.fecha`: `YYYY-MM-DD HH:mm`, Madrid time. */
export function madridMinute(at: Date): string {
  return at.toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 16);
}

/** The inverse of `madridMinute`, good enough for a timestamptz column (Madrid offset resolved). */
export function fromMadridMinute(fecha: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(fecha);
  if (!m) throw new Error(`Not a date: ${fecha}`);
  const local = `${m[1]}T${m[2] ?? '00:00'}:00`;
  // Find the UTC instant whose Madrid wall-clock reading is `local`.
  const guess = new Date(`${local}Z`);
  const offsetMs = Date.parse(`${madridMinute(guess).replace(' ', 'T')}:00Z`) - guess.getTime();
  return new Date(guess.getTime() - offsetMs).toISOString();
}
