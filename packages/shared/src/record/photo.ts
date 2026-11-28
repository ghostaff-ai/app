import { parse } from 'yaml';
import {
  type FigureBlock,
  type GoalBlock,
  type HeadlinesBlock,
  type ListBlock,
  type ListItemState,
  PHOTO_LIMITS,
  type PhotoBlock,
  type PhotoPoint,
  type SeriesBlock,
  type SkippedBlock,
} from '../photo';

// An agent's photo as a file of its record, `agentes/<slug>/foto.yaml`
// (docs/plans/ongoing/agent-photo.md, «The file»): Spanish keys, the way the
// agent writes it, read into the app's blocks. A block the app doesn't draw,
// or one that breaks a limit, is skipped and named; the others still show.
// Pure, no I/O, so the sync and the tests share it.

export const AGENT_PHOTO_FILE = 'foto.yaml';

export const agentPhotoPath = (slug: string) => `agentes/${slug}/${AGENT_PHOTO_FILE}`;

/** The block types an agent may write, as it writes them. */
export const PHOTO_TYPES = ['meta', 'cifra', 'serie', 'titulares', 'lista'] as const;

export interface ReadPhoto {
  blocks: PhotoBlock[];
  skipped: SkippedBlock[];
  /** `actualizado`, as an ISO instant, when the file says it. */
  updatedAt: string | null;
}

type Map = Record<string, unknown>;

const isMap = (v: unknown): v is Map => !!v && typeof v === 'object' && !Array.isArray(v);

/** A YAML date arrives as a Date or as text: both as `YYYY-MM-DD`. */
function day(v: unknown, field: string): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v.slice(0, 10)))) return v.slice(0, 10);
  throw new Error(`${field} debe ser una fecha (AAAA-MM-DD)`);
}

function text(v: unknown, field: string): string {
  if (typeof v !== 'string' && typeof v !== 'number') throw new Error(`${field} debe ser texto`);
  const s = String(v).trim();
  if (!s) throw new Error(`falta ${field}`);
  if (s.length > PHOTO_LIMITS.text) throw new Error(`${field} pasa de ${PHOTO_LIMITS.text} caracteres`);
  return s;
}

const optText = (v: unknown, field: string): string | null => (v === undefined || v === null || v === '' ? null : text(v, field));

function num(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${field} debe ser un número`);
  return v;
}

const optNum = (v: unknown, field: string): number | null => (v === undefined || v === null ? null : num(v, field));

/** A series' points: `[[día o etiqueta, valor], …]`. */
function points(v: unknown, field: string, days: boolean): PhotoPoint[] {
  if (!Array.isArray(v)) throw new Error(`${field} debe ser una lista de [fecha, valor]`);
  if (v.length > PHOTO_LIMITS.points) throw new Error(`${field} tiene más de ${PHOTO_LIMITS.points} puntos`);
  return v.map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2) throw new Error(`${field}[${i}] debe ser [fecha, valor]`);
    const at = days ? day(p[0], `${field}[${i}]`) : p[0] instanceof Date ? day(p[0], `${field}[${i}]`) : text(p[0], `${field}[${i}]`);
    return [at, num(p[1], `${field}[${i}]`)];
  });
}

function goal(b: Map): GoalBlock {
  const pts = points(b.serie ?? [], 'serie', true);
  const valor = optNum(b.valor, 'valor');
  // `valor` alone is today's point, for an agent that keeps no history yet.
  if (valor !== null && !pts.length) pts.push([new Date().toISOString().slice(0, 10), valor]);
  if (!pts.length) throw new Error('una meta necesita serie o valor');
  const from = day(b.desde ?? pts[0]![0], 'desde');
  const by = day(b.fecha, 'fecha');
  if (Date.parse(by) <= Date.parse(from)) throw new Error('fecha debe ir después de desde');
  return {
    kind: 'goal',
    title: text(b.titulo, 'titulo'),
    unit: optText(b.unidad, 'unidad'),
    base: b.base === undefined ? pts[0]![1] : num(b.base, 'base'),
    from,
    target: num(b.objetivo, 'objetivo'),
    by,
    points: pts,
  };
}

function figure(b: Map): FigureBlock {
  return {
    kind: 'figure',
    title: text(b.titulo, 'titulo'),
    value: num(b.valor, 'valor'),
    unit: optText(b.unidad, 'unidad'),
    change: optNum(b.cambio, 'cambio'),
    period: optText(b.periodo, 'periodo'),
  };
}

function series(b: Map): SeriesBlock {
  const forma = b.forma ?? 'lineas';
  if (forma !== 'lineas' && forma !== 'barras') throw new Error('forma debe ser lineas o barras');
  const pts = points(b.puntos, 'puntos', false);
  if (!pts.length) throw new Error('una serie necesita puntos');
  return { kind: 'series', title: text(b.titulo, 'titulo'), unit: optText(b.unidad, 'unidad'), shape: forma === 'barras' ? 'bars' : 'lines', points: pts };
}

function headlines(b: Map): HeadlinesBlock {
  const h: HeadlinesBlock = { kind: 'headlines', did: optText(b.hizo, 'hizo'), found: optText(b.encontro, 'encontro'), changes: optText(b.cambia, 'cambia') };
  if (!h.did && !h.found && !h.changes) throw new Error('unos titulares necesitan hizo, encontro o cambia');
  return h;
}

const STATES: Record<string, ListItemState> = { espera: 'waiting', hecho: 'done', previsto: 'planned', fallo: 'failed' };

function list(b: Map): ListBlock {
  if (!Array.isArray(b.elementos) || !b.elementos.length) throw new Error('una lista necesita elementos');
  if (b.elementos.length > PHOTO_LIMITS.items) throw new Error(`una lista tiene como mucho ${PHOTO_LIMITS.items} elementos`);
  return {
    kind: 'list',
    title: text(b.titulo, 'titulo'),
    items: b.elementos.map((e, i) => {
      if (!isMap(e)) throw new Error(`elementos[${i}] debe ser un mapa`);
      const estado = e.estado === undefined || e.estado === null ? null : STATES[String(e.estado)];
      if (estado === undefined) throw new Error(`elementos[${i}].estado debe ser ${Object.keys(STATES).join(', ')}`);
      return { title: text(e.titulo, `elementos[${i}].titulo`), detail: optText(e.detalle, `elementos[${i}].detalle`), state: estado };
    }),
  };
}

const READERS: Record<(typeof PHOTO_TYPES)[number], (b: Map) => PhotoBlock> = { meta: goal, cifra: figure, serie: series, titulares: headlines, lista: list };

/**
 * Reads an agent's photo. Throws, saying why, only when the whole file can't be read (not YAML,
 * too big, no `bloques`): the sync then keeps the last good photo. A bad block is skipped and named.
 */
export function readPhoto(raw: string): ReadPhoto {
  if (new TextEncoder().encode(raw).length > PHOTO_LIMITS.fileBytes) throw new Error(`el fichero pasa de ${PHOTO_LIMITS.fileBytes / 1000} KB`);
  let data: unknown;
  try {
    data = parse(raw);
  } catch (e) {
    throw new Error(`no es YAML válido: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
  }
  if (!isMap(data)) throw new Error('el fichero debe ser un mapa con bloques');
  if (!Array.isArray(data.bloques)) throw new Error('falta la lista bloques');
  let updatedAt: string | null = null;
  if (data.actualizado instanceof Date) updatedAt = data.actualizado.toISOString();
  else if (typeof data.actualizado === 'string' && !Number.isNaN(Date.parse(data.actualizado))) updatedAt = new Date(data.actualizado).toISOString();

  const blocks: PhotoBlock[] = [];
  const skipped: SkippedBlock[] = [];
  data.bloques.forEach((b: unknown, index: number) => {
    if (!isMap(b)) return skipped.push({ index, reason: 'no es un mapa' });
    const read = READERS[String(b.tipo) as keyof typeof READERS];
    if (!read) return skipped.push({ index, reason: `tipo «${String(b.tipo)}» no existe; los tipos son ${PHOTO_TYPES.join(', ')}` });
    if (blocks.length >= PHOTO_LIMITS.blocks) return skipped.push({ index, reason: `pasa de ${PHOTO_LIMITS.blocks} bloques` });
    try {
      blocks.push(read(b));
    } catch (e) {
      skipped.push({ index, reason: e instanceof Error ? e.message : String(e) });
    }
  });
  return { blocks, skipped, updatedAt };
}

/** How a photo is written, for any agent: its format and its blocks. Spanish, as every prompt the agents read. */
export function photoFormat(): string[] {
  return [
    'Formato (YAML): `actualizado` (fecha y hora) y `bloques`, una lista. Tipos:',
    '- `meta`: titulo, unidad, base, desde, objetivo, fecha (cuándo alcanzarlo) y serie [[AAAA-MM-DD, valor], …]. Ghostaff calcula si vas por encima o por debajo del camino.',
    '- `cifra`: titulo, valor, unidad, cambio (fracción frente al periodo anterior: 0.06 es +6 %) y periodo.',
    '- `serie`: titulo, unidad, forma (lineas o barras) y puntos [[fecha o etiqueta, valor], …].',
    '- `titulares`: hizo, encontro y cambia, una frase cada uno, de lo último que has hecho.',
    '- `lista`: titulo y elementos, cada uno con titulo, detalle y estado (espera, hecho, previsto o fallo).',
    `Hasta ${PHOTO_LIMITS.blocks} bloques.`,
    'Nunca inventes una cifra: si no la tienes, no la pongas. Cambia qué bloques hay solo cuando te lo pidan o lo hayan aceptado.',
  ];
}

/**
 * What an agent on our runner is told about its photo: where it is, how it is written, and what to
 * do when it has none (agent-photo.md, decision 5).
 */
export function photoGuide(slug: string): string {
  const path = agentPhotoPath(slug);
  return [
    `Tu foto: \`${path}\` en el registro. Es lo que la gente ve de ti en tu ficha de Ghostaff: bloques que eliges tú y Ghostaff dibuja. Solo tú la escribes.`,
    ...photoFormat(),
    'Un bloque mal escrito no se ve; el resto sí. Actualiza sus datos en cada ejecución con lo que te dan tus conexiones.',
    'Si aún no tienes foto (el fichero no existe), no la crees por tu cuenta: al final de esta ejecución propón en tu último mensaje las dos o tres cosas que mostrarías en ella y de dónde sacarías cada dato, y pregunta si las pones.',
  ].join('\n');
}
