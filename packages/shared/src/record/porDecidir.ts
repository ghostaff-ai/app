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
  /** Only in a decision with `opciones`: the id of the option chosen. */
  opcion?: string;
}

/** One of a decision's options (por-decidir/README.md, «Opciones en vez de sí o no»). */
export interface RecordOption {
  /** kebab-case, unique in the decision; what `recomienda` and `respuesta.opcion` name. */
  id: string;
  /** A short verb phrase: the option's button. */
  texto: string;
  /** What happens with it, in one sentence. */
  con?: string;
}

export const MAX_OPTIONS = 3;

export interface RecordRule {
  propuesta: string;
  origen: string;
  cambia?: string;
}

/** Where a claim comes from: what it is, and a link or a path in the record if there is one. */
export interface RecordSource {
  texto: string;
  enlace?: string;
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
  // Optional, for the app (por-decidir/README.md, «Los campos opcionales»):
  /** What the agent would do, as a verb: the OK button's label. With `opciones`, the id of the one it picks. */
  recomienda?: string;
  /** 2 or 3 options instead of yes or no; `recomienda` names one. */
  opciones?: RecordOption[];
  /** `alta`: costly to undo. The app hides the pick until the person chooses, and takes no swipe. */
  importancia?: 'alta';
  /** What the agent does with the OK, in one sentence. */
  con_si?: string;
  /** What happens with the no, in one sentence. */
  con_no?: string;
  /** One literal line from the most telling source. */
  cita?: string;
  fuentes?: RecordSource[];
  /** `YYYY-MM-DD`: the last day the answer is useful. */
  vence?: string;
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
    if (r.opcion != null) respuesta.opcion = text(r.opcion, 'respuesta.opcion', id);
  }

  let regla: RecordRule | undefined;
  if (tipo === RULE_KIND) {
    regla = { propuesta: text(d.propuesta, 'propuesta', id), origen: text(d.origen, 'origen', id) };
    if (d.cambia != null) regla.cambia = text(d.cambia, 'cambia', id);
  }

  const optional = (field: string): string | undefined => {
    const v = d[field];
    if (v == null) return undefined;
    if (typeof v === 'number' || v instanceof Date) return dateish(v);
    if (typeof v !== 'string') throw new Error(`${DECISIONS_DIR}/${id}.yaml: \`${field}\` is text`);
    return v.trim() || undefined;
  };
  const extras: Partial<RecordDecision> = {};
  for (const f of ['recomienda', 'con_si', 'con_no', 'cita'] as const) {
    const v = optional(f);
    if (v) extras[f] = v;
  }
  const vence = optional('vence');
  if (vence) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vence)) throw new Error(`${DECISIONS_DIR}/${id}.yaml: \`vence\` is a date, YYYY-MM-DD («${vence}»)`);
    extras.vence = vence;
  }
  if (d.fuentes != null) extras.fuentes = readSources(d.fuentes, id);
  if (d.opciones != null) {
    extras.opciones = readOptions(d.opciones, id);
    if (!extras.recomienda || !extras.opciones.some((o) => o.id === extras.recomienda)) {
      throw new Error(`${DECISIONS_DIR}/${id}.yaml: with \`opciones\`, \`recomienda\` is the id of one of them`);
    }
    if (respuesta?.opcion && !extras.opciones.some((o) => o.id === respuesta?.opcion)) {
      throw new Error(`${DECISIONS_DIR}/${id}.yaml: \`respuesta.opcion\` is not one of the options («${respuesta.opcion}»)`);
    }
  }
  const importancia = optional('importancia');
  if (importancia) {
    if (importancia !== 'alta') throw new Error(`${DECISIONS_DIR}/${id}.yaml: \`importancia\` is alta, or left out («${importancia}»)`);
    extras.importancia = 'alta';
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
    ...extras,
  };
}

// `opciones` is a list of 2 or 3 `{ id, texto, con? }`, ids unique and kebab-case.
function readOptions(v: unknown, id: string): RecordOption[] {
  if (!Array.isArray(v) || v.length < 2 || v.length > MAX_OPTIONS) {
    throw new Error(`${DECISIONS_DIR}/${id}.yaml: \`opciones\` is a list of 2 or ${MAX_OPTIONS}`);
  }
  const seen = new Set<string>();
  return v.map((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${DECISIONS_DIR}/${id}.yaml: \`opciones[${i}]\` is { id, texto, con }`);
    const o = item as Record<string, unknown>;
    const oid = text(o.id, `opciones[${i}].id`, id);
    if (!KEBAB.test(oid)) throw new Error(`${DECISIONS_DIR}/${id}.yaml: \`opciones[${i}].id\` is kebab-case («${oid}»)`);
    if (seen.has(oid)) throw new Error(`${DECISIONS_DIR}/${id}.yaml: two options are \`${oid}\``);
    seen.add(oid);
    const opt: RecordOption = { id: oid, texto: text(o.texto, `opciones[${i}].texto`, id) };
    if (typeof o.con === 'string' && o.con.trim()) opt.con = o.con.trim();
    return opt;
  });
}

// `fuentes` is a list; each item is a plain string or `{ texto, enlace }`.
function readSources(v: unknown, id: string): RecordSource[] {
  if (!Array.isArray(v)) throw new Error(`${DECISIONS_DIR}/${id}.yaml: \`fuentes\` is a list`);
  return v.map((item, i) => {
    if (typeof item === 'string' && item.trim()) return { texto: item.trim() };
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const o = item as Record<string, unknown>;
      const src: RecordSource = { texto: text(o.texto, `fuentes[${i}].texto`, id) };
      if (typeof o.enlace === 'string' && o.enlace.trim()) src.enlace = o.enlace.trim();
      return src;
    }
    throw new Error(`${DECISIONS_DIR}/${id}.yaml: \`fuentes[${i}]\` is text or { texto, enlace }`);
  });
}

/** Writes the answer into the YAML without touching anything else (comments and order kept). */
export function writeAnswer(yaml: string, id: string, answer: RecordAnswer): string {
  const doc = parseDocument(yaml);
  if (!isMap(doc.contents)) throw new Error(`${DECISIONS_DIR}/${id}.yaml is not a YAML map`);
  const current = readDecision(id, yaml);
  if (current.respuesta) throw new Error(`${DECISIONS_DIR}/${id}.yaml already has an answer`);
  if (answer.texto != null && !current.regla) throw new Error('Only a rule carries signed text.');
  if (current.regla && answer.decision === 'ok' && !answer.texto?.trim()) throw new Error('A rule is signed with its text.');
  if (answer.opcion != null) {
    if (!current.opciones?.some((o) => o.id === answer.opcion)) throw new Error(`Not one of the options: ${answer.opcion}`);
    // `decision` stays what the panel and the history read: ok is the agent's pick.
    if ((answer.opcion === current.recomienda) !== (answer.decision === 'ok')) throw new Error('ok is the recommended option, no any other.');
  }
  const r: Record<string, string> = { decision: answer.decision, por: answer.por, fecha: answer.fecha };
  if (answer.opcion) r.opcion = answer.opcion;
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
