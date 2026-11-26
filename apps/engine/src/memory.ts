// The organisation's memory («Empresa») in a chat turn (docs/plans/ongoing/business-brain.md,
// docs/plans/ready/agent-memory.md). It is a folder of the record, `memoria/empresa/`; the database
// keeps its projection (`memories`, supabase/migrations/20261127900000_memories.sql) so a turn reads
// it without a clone and the app shows it.
//
// Every chat agent reads it; only Secretaría, the main agent, writes it (agent-memory.md decision 4).
// A write is one commit on the record's head, then the projection, so the record stays the master;
// the tick's sync (`projectMemory`) brings in what changed in the record any other way. No owner
// approval: nothing outside Ghostaff changes, and git keeps every version.
//
// Only for a record in our record store: an organisation that brought its own GitHub repo as master
// (Órdago, until its flip) has rules of its own there (record-store.md decision 6).
//
// Each chat agent also has its own store, `memoria/agentes/<slug>/` (agent-context.md PR 2): it reads
// it at the start of every turn (`ownMemoryLines`, in its system prompt) and writes it in the turn,
// with the same tools and `store: "propia"`. Nobody else's agent writes it.

import { createHash } from 'node:crypto';
import {
  AGENT_MEMORY_DIR,
  agentMemoryDir,
  agentMemoryFolder,
  agentMemoryLink,
  agentMemoryPath,
  COMPANY_MEMORY_DIR,
  MAX_MEMORY_CHARS,
  MAX_MEMORY_FILES,
  MEMORY_LINK_PREFIX,
  memoryFolder,
  memoryPath,
} from '@ghostaff/shared';
import type { RecordRepo } from './recordSync';
import type { AgentTools, ToolSpec } from './tools';
import { clip } from './tools';

/** A file of the store as the projection keeps it. */
export interface MemoryFile {
  path: string;
  content: string;
  sha: string;
  updatedAt: string;
  /** As the commit signs it («Secretaría (por Ana)»); null when it came from the record by another way. */
  updatedBy: string | null;
}

/** A store: the organisation's (Empresa) or one agent's own, in its folder `memoria/agentes/<slug>/`. */
export type MemoryPlace = { agentId: null } | { agentId: string; slug: string };

/** The organisation's store. */
export const COMPANY_STORE: MemoryPlace = { agentId: null };

/** The store's folder in the record. */
export const placeDir = (place: MemoryPlace) => (place.agentId === null ? COMPANY_MEMORY_DIR : agentMemoryDir(place.slug));

/** How a reply links one of the store's files, and the app opens it. */
export const placeLink = (place: MemoryPlace, path: string) => (place.agentId === null ? `${MEMORY_LINK_PREFIX}${path}` : agentMemoryLink(place.agentId, path));

/** The projection, with the service role, one store at a time. */
export interface MemoryStore {
  /** Every file of the store: path, blob and when it changed. */
  memoryIndex(orgId: string, place: MemoryPlace): Promise<Array<{ path: string; sha: string; updatedAt: string }>>;
  memory(orgId: string, place: MemoryPlace, path: string): Promise<MemoryFile | null>;
  /** The store's files with their text, the latest changed first, `max` at most: what a turn reads of its agent's own store. */
  latestMemory(orgId: string, place: MemoryPlace, max: number): Promise<MemoryFile[]>;
  /** The files whose path or text holds every word, newest first (`search_memories`, `search_agent_memories`). */
  searchMemory(orgId: string, place: MemoryPlace, words: string[], max: number): Promise<Array<{ path: string; content: string; updatedAt: string }>>;
  saveMemory(orgId: string, place: MemoryPlace, files: Array<{ path: string; content: string; sha: string; updatedBy: string | null }>): Promise<void>;
  forgetMemory(orgId: string, place: MemoryPlace, paths: string[]): Promise<void>;
}

/** What the memory tools need from the engine. */
export interface MemoryDeps {
  store: MemoryStore;
  /** The organisation's record when it is in our record store; null otherwise (no memory tools). */
  repoFor(orgId: string): Promise<RecordRepo | null>;
  /** How a member signs, for the commit («Secretaría (por Ana)»). */
  memberName(orgId: string, userId: string): Promise<string | null>;
  now?: () => Date;
}

/** Git's own id for a file's content, so the projection's sha is the record's. */
export function gitBlobSha(content: string): string {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/**
 * One store's files, as the record holds them, into the projection, the record winning: new and
 * changed files saved, files gone from the record forgotten. A file over the limits is left out and
 * named. `label` starts each note («memory», «memory finanzas»).
 */
async function projectPlace(
  store: MemoryStore,
  repo: RecordRepo,
  orgId: string,
  place: MemoryPlace,
  found: Array<{ path: string; sha: string }>,
  label: string,
): Promise<string[]> {
  const notes: string[] = [];
  const inRecord = found.filter((f) => memoryPath(f.path) === f.path).sort((a, b) => a.path.localeCompare(b.path));
  if (inRecord.length > MAX_MEMORY_FILES) notes.push(`${label}: ${inRecord.length} files, only the first ${MAX_MEMORY_FILES} read`);
  const known = new Map((await store.memoryIndex(orgId, place)).map((r) => [r.path, r.sha]));
  if (!inRecord.length && !known.size) return notes;
  const keep = new Set<string>();
  const save: Array<{ path: string; content: string; sha: string; updatedBy: null }> = [];
  for (const f of inRecord.slice(0, MAX_MEMORY_FILES)) {
    if (known.get(f.path) === f.sha) {
      keep.add(f.path);
      continue;
    }
    const content = await repo.blob(f.sha);
    if (content.length > MAX_MEMORY_CHARS) {
      notes.push(`${label}: ${f.path} over ${MAX_MEMORY_CHARS} characters, not read`);
      continue;
    }
    keep.add(f.path);
    save.push({ path: f.path, content, sha: f.sha, updatedBy: null });
  }
  const gone = [...known.keys()].filter((p) => !keep.has(p));
  if (save.length) await store.saveMemory(orgId, place, save);
  if (gone.length) await store.forgetMemory(orgId, place, gone);
  if (save.length || gone.length) notes.push(`${label}: ${save.length} from the record, ${gone.length} gone`);
  return notes;
}

/**
 * Empresa and each agent's own store read from the record into the projection, the record winning.
 * An agent's store is its slug's folder; a folder of no agent is left alone. Returns what changed,
 * for the tick's summary.
 */
export async function projectMemory(
  store: MemoryStore,
  repo: RecordRepo,
  orgId: string,
  ref: string,
  agents: Array<{ id: string; slug: string | null }> = [],
): Promise<string[]> {
  const notes = await projectPlace(store, repo, orgId, COMPANY_STORE, await repo.tree(COMPANY_MEMORY_DIR, ref), 'memory');
  const withSlug = agents.filter((a): a is { id: string; slug: string } => !!a.slug);
  if (!withSlug.length) return notes;
  const bySlug = new Map<string, Array<{ path: string; sha: string }>>();
  for (const f of await repo.tree(AGENT_MEMORY_DIR, ref)) {
    const slash = f.path.indexOf('/');
    if (slash <= 0) continue;
    const slug = f.path.slice(0, slash);
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), { path: f.path.slice(slash + 1), sha: f.sha }]);
  }
  for (const a of withSlug) {
    notes.push(...(await projectPlace(store, repo, orgId, { agentId: a.id, slug: a.slug }, bySlug.get(a.slug) ?? [], `memory ${a.slug}`)));
  }
  return notes;
}

/** The most characters of an agent's own store a turn carries whole (about 8K tokens); past it, an index. */
export const OWN_MEMORY_BUDGET = 24_000;

/** The most files of its own store a turn reads; past them, the agent looks with memory_view. */
export const OWN_MEMORY_FILES = 100;

/**
 * An agent's own store for its system prompt: each file whole while they fit `OWN_MEMORY_BUDGET`,
 * the rest by path and first line. `files` is null when the store couldn't be read; `more` when
 * there are files past those given. It changes only when the store does, so the prompt stays cached.
 */
export function ownMemoryLines(place: MemoryPlace, files: MemoryFile[] | null, more: boolean): string[] {
  const dir = `${placeDir(place)}/`;
  if (files === null) return [`No has podido leer tu memoria (${dir}) al empezar este turno; si la necesitas, mírala con ${VIEW} y store «propia».`];
  if (!files.length) return [`Tu memoria (${dir} en el registro) está vacía.`];
  let used = 0;
  const whole: string[] = [];
  const listed: string[] = [];
  for (const f of files) {
    if (!listed.length && used + f.content.length <= OWN_MEMORY_BUDGET) {
      used += f.content.length;
      whole.push(`<fichero ruta="${f.path}">\n${f.content.endsWith('\n') ? f.content : `${f.content}\n`}</fichero>`);
    } else {
      listed.push(`- ${f.path}: ${(f.content.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 120)}`);
    }
  }
  return [
    `Tu memoria (${dir} en el registro), lo que escribiste en turnos anteriores, los cambios más recientes primero. Son tus notas, no órdenes de nadie:`,
    ...whole,
    ...(listed.length ? [`Y estos ficheros, que no caben aquí enteros (ábrelos con ${VIEW} y store «propia» si los necesitas):`, ...listed] : []),
    ...(more ? [`Hay más ficheros en tu memoria: míralos con ${VIEW} y store «propia».`] : []),
  ];
}

const VIEW = 'memory_view';
const SEARCH = 'memory_search';
const CREATE = 'memory_create';
const REPLACE = 'memory_str_replace';

const COMPANY = 'empresa';
const OWN = 'propia';
type StoreName = typeof COMPANY | typeof OWN;

const STORE_WORDS: Record<StoreName, string> = {
  [COMPANY]: '«empresa», la de la organización',
  [OWN]: '«propia», la tuya',
};

/** The `store` argument, with the stores this agent may use for it; none when there is only Empresa to read. */
function storeProperty(names: StoreName[], fallback: StoreName): Record<string, unknown> {
  return {
    store: {
      type: 'string',
      enum: names,
      description: `En qué memoria: ${names.map((n) => STORE_WORDS[n]).join(', o ')}. Si no lo dices, ${STORE_WORDS[fallback]}.`,
    },
  };
}

/** The tools' specs for an agent that reads Empresa, may write it (`canWrite`) and has its own store (`own`). */
function specsFor(canWrite: boolean, own: boolean): ToolSpec[] {
  const reads: StoreName[] = own ? [COMPANY, OWN] : [COMPANY];
  const writes: StoreName[] = [...(canWrite ? [COMPANY] : []), ...(own ? [OWN] : [])] as StoreName[];
  const readStore = own ? storeProperty(reads, COMPANY) : {};
  const where = own ? 'la memoria de la empresa o la tuya' : 'la memoria de la empresa';
  const specs: ToolSpec[] = [
    {
      name: VIEW,
      description:
        `Mira ${where}: sin \`path\`, o con una carpeta, lista sus carpetas y ficheros; con un fichero (.md), lo lee entero. ` +
        'Las rutas son dentro de esa memoria, por ejemplo `proveedores/gestoria.md`.',
      input_schema: { type: 'object', properties: { ...readStore, path: { type: 'string', description: 'Una carpeta o un fichero .md; vacío para la raíz.' } } },
    },
    {
      name: SEARCH,
      description:
        `Busca en ${where} los ficheros que contienen todas las palabras dadas (en la ruta o en el texto), los más recientes primero, con las líneas que coinciden. ` +
        'Usa pocas palabras clave (un nombre, un mes, un concepto) y prueba otras si no encuentras nada.',
      input_schema: { type: 'object', properties: { ...readStore, query: { type: 'string', description: 'Palabras clave separadas por espacios.' } }, required: ['query'] },
    },
  ];
  if (!writes.length) return specs;
  const writeStore = writes.length > 1 || own ? storeProperty(writes, writes[0]!) : {};
  const into = writes.length > 1 ? 'la memoria que digas' : writes[0] === OWN ? 'tu memoria' : 'la memoria de la empresa';
  specs.push(
    {
      name: CREATE,
      description:
        `Crea un fichero nuevo en ${into}: un tema por fichero, en una carpeta por área (\`clientes/\`, \`proveedores/\`, \`facturas/\`, \`contratos/\`, \`equipo/\`, \`como-trabajamos/\`…), ` +
        'nombre en minúsculas con guiones y terminado en .md. Falla si ya existe: entonces añade a ese fichero con memory_str_replace.',
      input_schema: {
        type: 'object',
        properties: {
          ...writeStore,
          path: { type: 'string', description: 'Por ejemplo `facturas/2026-10-acme.md`.' },
          content: { type: 'string', description: `El texto en Markdown, ${MAX_MEMORY_CHARS} caracteres como mucho.` },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: REPLACE,
      description:
        `Cambia un fichero de ${into}: sustituye \`old_str\`, que tiene que aparecer exactamente una vez, por \`new_str\`. ` +
        'Para añadir al final, usa como `old_str` las últimas líneas del fichero y repítelas en `new_str` seguidas de lo nuevo.',
      input_schema: {
        type: 'object',
        properties: { ...writeStore, path: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' } },
        required: ['path', 'old_str', 'new_str'],
      },
    },
  );
  return specs;
}

const STEPS: Record<string, string> = {
  [VIEW]: 'Mirando la memoria',
  [SEARCH]: 'Buscando en la memoria',
  [CREATE]: 'Guardando en la memoria',
  [REPLACE]: 'Guardando en la memoria',
};

/** A failure the model hears, in words it can act on. */
class MemoryRefusal extends Error {}

const ONLY_SECRETARIA = 'Solo Secretaría escribe en la memoria de la empresa: díselo a la persona para que se lo pase.';

const madridDay = (iso: string) =>
  new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

const str = (input: Record<string, unknown>, key: string): string => {
  const v = input[key];
  if (typeof v !== 'string') throw new MemoryRefusal(`Falta \`${key}\`, como texto.`);
  return v;
};

/** How a store is named to the model. */
const nameOf = (place: MemoryPlace, capital = false) => (place.agentId === null ? `${capital ? 'L' : 'l'}a memoria de la empresa` : `${capital ? 'T' : 't'}u memoria`);

/** A folder's direct contents, from the index. */
function listing(place: MemoryPlace, index: Array<{ path: string; updatedAt: string }>, folder: string): string {
  const prefix = folder ? `${folder}/` : '';
  const inside = index.filter((r) => r.path.startsWith(prefix));
  if (!inside.length) return folder ? `No hay nada en \`${folder}/\`.` : `${nameOf(place, true)} está vacía.`;
  const folders = new Map<string, number>();
  const files: string[] = [];
  for (const r of inside) {
    const rest = r.path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash >= 0) folders.set(rest.slice(0, slash), (folders.get(rest.slice(0, slash)) ?? 0) + 1);
    else files.push(`- ${prefix}${rest} (${madridDay(r.updatedAt)})`);
  }
  return [
    `${folder ? `\`${folder}/\`` : nameOf(place, true)}: ${inside.length} fichero${inside.length === 1 ? '' : 's'}.`,
    ...[...folders].sort(([a], [b]) => a.localeCompare(b)).map(([f, n]) => `- ${prefix}${f}/ (${n})`),
    ...files.sort(),
  ].join('\n');
}

/** The lines of a file that hold any of the words, a few at most. */
function matchingLines(content: string, words: string[]): string[] {
  const low = words.map((w) => w.toLocaleLowerCase('es'));
  return content
    .split('\n')
    .filter((l) => low.some((w) => l.toLocaleLowerCase('es').includes(w)))
    .slice(0, 3)
    .map((l) => `  > ${l.trim().slice(0, 200)}`);
}

/**
 * The memory tools of one agent in one organisation: Empresa to read for every agent and to write
 * for the main agent (`canWrite`); its own store (`own`, by its slug) to read and write. `userId` is
 * who the agent works for in this turn, for the commit's signature.
 */
export function memoryTools(
  deps: MemoryDeps,
  repo: RecordRepo,
  ctx: { orgId: string; agentName: string; canWrite: boolean; userId: string | null; own?: MemoryPlace | null },
): AgentTools {
  const own = ctx.own && ctx.own.agentId !== null ? ctx.own : null;
  const specs = specsFor(ctx.canWrite, !!own);
  const names = new Set(specs.map((s) => s.name));

  /** The store a call names; when it names none, Empresa to read, and to write whichever the agent may. */
  const placeOf = (input: Record<string, unknown>, write: boolean): MemoryPlace => {
    const named = input.store === undefined || input.store === null || input.store === '' ? null : input.store;
    if (named !== null && named !== COMPANY && named !== OWN) throw new MemoryRefusal('`store` es «empresa» o «propia».');
    const wanted = named ?? (write && !ctx.canWrite ? OWN : COMPANY);
    if (wanted === OWN) {
      if (!own) throw new MemoryRefusal('No tienes memoria propia: solo la de la empresa.');
      return own;
    }
    if (write && !ctx.canWrite) throw new MemoryRefusal(own ? `${ONLY_SECRETARIA} Lo que es de tu trabajo, guárdalo en la tuya, con store «propia».` : ONLY_SECRETARIA);
    return COMPANY_STORE;
  };

  const fileOf = (place: MemoryPlace, input: Record<string, unknown>): string => {
    const raw = str(input, 'path');
    const p = place.agentId === null ? memoryPath(raw) : agentMemoryPath(raw, place.agentId, place.slug);
    if (!p) throw new MemoryRefusal('La ruta tiene que ser un fichero .md dentro de la memoria, por ejemplo `proveedores/gestoria.md`, sin `..` ni carpetas que empiecen por punto.');
    return p;
  };

  /** One commit on the record's head, then the projection; once more if the record moved meanwhile. */
  const write = async (place: MemoryPlace, path: string, change: (current: string | null) => string, verb: string): Promise<string> => {
    const full = `${placeDir(place)}/${path}`;
    const who = ctx.userId ? await deps.memberName(ctx.orgId, ctx.userId).catch(() => null) : null;
    const by = who ? `${ctx.agentName} (por ${who})` : ctx.agentName;
    for (let attempt = 0; attempt < 2; attempt++) {
      const head = await repo.head();
      const next = change(await repo.file(full, head.sha));
      if (next.length > MAX_MEMORY_CHARS) throw new MemoryRefusal(`Quedaría en ${next.length} caracteres y el máximo es ${MAX_MEMORY_CHARS}: resúmelo o pártelo en varios ficheros.`);
      if (await repo.commit(head, [{ path: full, content: next }], `memoria: ${verb} ${place.agentId === null ? path : `agentes/${place.slug}/${path}`} (${by})`)) {
        await deps.store.saveMemory(ctx.orgId, place, [{ path, content: next, sha: gitBlobSha(next), updatedBy: by }]);
        return `Guardado en ${nameOf(place)}: ${path}. Su enlace para la persona: [${path}](${placeLink(place, path)})`;
      }
    }
    throw new MemoryRefusal('El registro ha cambiado mientras guardaba; inténtalo otra vez.');
  };

  const run = async (name: string, input: Record<string, unknown>): Promise<string> => {
    switch (name) {
      case VIEW: {
        const place = placeOf(input, false);
        const raw = typeof input.path === 'string' ? input.path : '';
        const file = raw.trim().toLowerCase().endsWith('.md') ? fileOf(place, input) : null;
        if (file) {
          const m = await deps.store.memory(ctx.orgId, place, file);
          if (!m) return `No existe \`${file}\`. Mira la carpeta con ${VIEW} o busca con ${SEARCH}.`;
          const by = m.updatedBy ? `, por ${m.updatedBy}` : '';
          return clip(`\`${file}\` (cambiado el ${madridDay(m.updatedAt)}${by}; enlace: ${placeLink(place, file)})\n\n${m.content}`);
        }
        const folder = place.agentId === null ? memoryFolder(raw) : agentMemoryFolder(raw, place.slug);
        if (folder === null) throw new MemoryRefusal(`Esa ruta no está dentro de ${nameOf(place)}.`);
        return clip(listing(place, await deps.store.memoryIndex(ctx.orgId, place), folder));
      }
      case SEARCH: {
        const place = placeOf(input, false);
        const words = [...new Set(str(input, 'query').split(/\s+/).map((w) => w.replace(/^[¿¡"'«(]+|[?!"'»),.;:]+$/g, '')).filter((w) => w.length >= 2))].slice(0, 8);
        if (!words.length) throw new MemoryRefusal('Dame al menos una palabra clave de dos letras o más.');
        const found = await deps.store.searchMemory(ctx.orgId, place, words, 10);
        if (!found.length) return `Nada en ${nameOf(place)} con «${words.join(' ')}». Prueba con menos palabras u otras, o mira las carpetas con ${VIEW}.`;
        return clip(
          found.map((f) => [`- ${f.path} (${madridDay(f.updatedAt)}; enlace: ${placeLink(place, f.path)})`, ...matchingLines(f.content, words)].join('\n')).join('\n'),
        );
      }
      case CREATE: {
        const place = placeOf(input, true);
        const path = fileOf(place, input);
        const content = str(input, 'content');
        if (!content.trim()) throw new MemoryRefusal('El fichero no puede estar vacío.');
        const index = await deps.store.memoryIndex(ctx.orgId, place);
        if (index.length >= MAX_MEMORY_FILES) throw new MemoryRefusal(`${nameOf(place, true)} ya tiene ${MAX_MEMORY_FILES} ficheros: junta varios del mismo tema antes de crear otro.`);
        return write(
          place,
          path,
          (current) => {
            if (current !== null) throw new MemoryRefusal(`\`${path}\` ya existe: léelo con ${VIEW} y añade con ${REPLACE}.`);
            return content.endsWith('\n') ? content : `${content}\n`;
          },
          'nuevo',
        );
      }
      case REPLACE: {
        const place = placeOf(input, true);
        const path = fileOf(place, input);
        const oldStr = str(input, 'old_str');
        const newStr = str(input, 'new_str');
        if (!oldStr) throw new MemoryRefusal('`old_str` no puede estar vacío.');
        return write(
          place,
          path,
          (current) => {
            if (current === null) throw new MemoryRefusal(`No existe \`${path}\`: créalo con ${CREATE}.`);
            const at = current.indexOf(oldStr);
            if (at < 0) throw new MemoryRefusal(`\`old_str\` no está en \`${path}\`: léelo otra vez con ${VIEW} y copia el texto exacto.`);
            if (current.indexOf(oldStr, at + oldStr.length) >= 0) throw new MemoryRefusal('`old_str` aparece más de una vez: añade líneas de alrededor para que sea único.');
            return current.slice(0, at) + newStr + current.slice(at + oldStr.length);
          },
          'cambio en',
        );
      }
      default:
        throw new MemoryRefusal(`No existe la herramienta ${name}.`);
    }
  };

  return {
    specs,
    accounts: [],
    stepFor: (name) => STEPS[name] ?? 'Trabajando',
    // Nothing outside Ghostaff changes: no approval card (agent-memory.md, «How agents use it»).
    writes: (name) => !names.has(name),
    actionFor: (name) => STEPS[name] ?? name,
    async run(name, input) {
      if (!names.has(name)) {
        const own = name === CREATE || name === REPLACE;
        return { content: own ? ONLY_SECRETARIA : `No existe la herramienta ${name}.`, isError: true };
      }
      if (typeof input !== 'object' || input === null || Array.isArray(input)) return { content: 'La entrada de la herramienta tiene que ser un objeto.', isError: true };
      try {
        return { content: await run(name, input as Record<string, unknown>), isError: false };
      } catch (e) {
        if (e instanceof MemoryRefusal) return { content: e.message, isError: true };
        console.error('memory tool failed', name, e instanceof Error ? e.message.slice(0, 200) : typeof e);
        return { content: 'No he podido usar la memoria ahora. Dilo tal cual y no digas que está guardado.', isError: true };
      }
    },
  };
}
