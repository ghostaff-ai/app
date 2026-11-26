// The organisation's memory («Empresa») in a chat turn (docs/plans/ongoing/business-brain.md,
// docs/plans/ready/agent-memory.md). It is a folder of the record, `memoria/empresa/`; the database
// keeps its projection (`memories`, supabase/migrations/20261127350000_memories.sql) so a turn reads
// it without a clone and the app shows it.
//
// Every chat agent reads it; only Secretaría, the main agent, writes it (agent-memory.md decision 4).
// A write is one commit on the record's head, then the projection, so the record stays the master;
// the tick's sync (`projectMemory`) brings in what changed in the record any other way. No owner
// approval: nothing outside Ghostaff changes, and git keeps every version.
//
// Only for a record in our record store: an organisation that brought its own GitHub repo as master
// (Órdago, until its flip) has rules of its own there (record-store.md decision 6).

import { createHash } from 'node:crypto';
import { COMPANY_MEMORY_DIR, MAX_MEMORY_CHARS, MAX_MEMORY_FILES, MEMORY_LINK_PREFIX, memoryFolder, memoryPath } from '@ghostaff/shared';
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

/** The projection, with the service role. */
export interface MemoryStore {
  /** Every file of the store: path, blob and when it changed. */
  memoryIndex(orgId: string): Promise<Array<{ path: string; sha: string; updatedAt: string }>>;
  memory(orgId: string, path: string): Promise<MemoryFile | null>;
  /** The files whose path or text holds every word, newest first (`search_memories`). */
  searchMemory(orgId: string, words: string[], max: number): Promise<Array<{ path: string; content: string; updatedAt: string }>>;
  saveMemory(orgId: string, files: Array<{ path: string; content: string; sha: string; updatedBy: string | null }>): Promise<void>;
  forgetMemory(orgId: string, paths: string[]): Promise<void>;
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
 * The store's files read from the record into the projection, the record winning: new and changed
 * files saved, files gone from the record forgotten. A file over the limits is left out and named.
 * Returns what changed, for the tick's summary.
 */
export async function projectMemory(store: MemoryStore, repo: RecordRepo, orgId: string, ref: string): Promise<string[]> {
  const notes: string[] = [];
  const inRecord = (await repo.tree(COMPANY_MEMORY_DIR, ref)).filter((f) => memoryPath(f.path) === f.path).sort((a, b) => a.path.localeCompare(b.path));
  if (inRecord.length > MAX_MEMORY_FILES) notes.push(`memory: ${inRecord.length} files, only the first ${MAX_MEMORY_FILES} read`);
  const known = new Map((await store.memoryIndex(orgId)).map((r) => [r.path, r.sha]));
  const keep = new Set<string>();
  const save: Array<{ path: string; content: string; sha: string; updatedBy: null }> = [];
  for (const f of inRecord.slice(0, MAX_MEMORY_FILES)) {
    if (known.get(f.path) === f.sha) {
      keep.add(f.path);
      continue;
    }
    const content = await repo.blob(f.sha);
    if (content.length > MAX_MEMORY_CHARS) {
      notes.push(`memory: ${f.path} over ${MAX_MEMORY_CHARS} characters, not read`);
      continue;
    }
    keep.add(f.path);
    save.push({ path: f.path, content, sha: f.sha, updatedBy: null });
  }
  const gone = [...known.keys()].filter((p) => !keep.has(p));
  if (save.length) await store.saveMemory(orgId, save);
  if (gone.length) await store.forgetMemory(orgId, gone);
  if (save.length || gone.length) notes.push(`memory: ${save.length} from the record, ${gone.length} gone`);
  return notes;
}

const VIEW = 'memory_view';
const SEARCH = 'memory_search';
const CREATE = 'memory_create';
const REPLACE = 'memory_str_replace';

const READ_SPECS: ToolSpec[] = [
  {
    name: VIEW,
    description:
      'Mira la memoria de la empresa: sin `path`, o con una carpeta, lista sus carpetas y ficheros; con un fichero (.md), lo lee entero. ' +
      'Las rutas son dentro de la memoria, por ejemplo `proveedores/gestoria.md`.',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Una carpeta o un fichero .md; vacío para la raíz.' } } },
  },
  {
    name: SEARCH,
    description:
      'Busca en la memoria de la empresa los ficheros que contienen todas las palabras dadas (en la ruta o en el texto), los más recientes primero, con las líneas que coinciden. ' +
      'Usa pocas palabras clave (un nombre, un mes, un concepto) y prueba otras si no encuentras nada.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Palabras clave separadas por espacios.' } }, required: ['query'] },
  },
];

const WRITE_SPECS: ToolSpec[] = [
  {
    name: CREATE,
    description:
      'Crea un fichero nuevo en la memoria de la empresa: un tema por fichero, en una carpeta por área (`clientes/`, `proveedores/`, `facturas/`, `contratos/`, `equipo/`, `como-trabajamos/`…), ' +
      'nombre en minúsculas con guiones y terminado en .md. Falla si ya existe: entonces añade a ese fichero con memory_str_replace.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Por ejemplo `facturas/2026-10-acme.md`.' },
        content: { type: 'string', description: `El texto en Markdown, ${MAX_MEMORY_CHARS} caracteres como mucho.` },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: REPLACE,
    description:
      'Cambia un fichero de la memoria de la empresa: sustituye `old_str`, que tiene que aparecer exactamente una vez, por `new_str`. ' +
      'Para añadir al final, usa como `old_str` las últimas líneas del fichero y repítelas en `new_str` seguidas de lo nuevo.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' } },
      required: ['path', 'old_str', 'new_str'],
    },
  },
];

const STEPS: Record<string, string> = {
  [VIEW]: 'Mirando la memoria de la empresa',
  [SEARCH]: 'Buscando en la memoria de la empresa',
  [CREATE]: 'Guardando en la memoria de la empresa',
  [REPLACE]: 'Guardando en la memoria de la empresa',
};

/** A failure the model hears, in words it can act on. */
class MemoryRefusal extends Error {}

const madridDay = (iso: string) =>
  new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

const str = (input: Record<string, unknown>, key: string): string => {
  const v = input[key];
  if (typeof v !== 'string') throw new MemoryRefusal(`Falta \`${key}\`, como texto.`);
  return v;
};

const fileOf = (input: Record<string, unknown>): string => {
  const p = memoryPath(str(input, 'path'));
  if (!p) throw new MemoryRefusal('La ruta tiene que ser un fichero .md dentro de la memoria, por ejemplo `proveedores/gestoria.md`, sin `..` ni carpetas que empiecen por punto.');
  return p;
};

/** A folder's direct contents, from the index. */
function listing(index: Array<{ path: string; updatedAt: string }>, folder: string): string {
  const prefix = folder ? `${folder}/` : '';
  const inside = index.filter((r) => r.path.startsWith(prefix));
  if (!inside.length) return folder ? `No hay nada en \`${folder}/\`.` : 'La memoria de la empresa está vacía.';
  const folders = new Map<string, number>();
  const files: string[] = [];
  for (const r of inside) {
    const rest = r.path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash >= 0) folders.set(rest.slice(0, slash), (folders.get(rest.slice(0, slash)) ?? 0) + 1);
    else files.push(`- ${prefix}${rest} (${madridDay(r.updatedAt)})`);
  }
  return [
    `${folder ? `\`${folder}/\`` : 'La memoria de la empresa'}: ${inside.length} fichero${inside.length === 1 ? '' : 's'}.`,
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
 * The memory tools of one agent in one organisation: to read for every agent, to write for the
 * main agent. `by` is who the agent works for in this turn, for the commit's signature.
 */
export function memoryTools(deps: MemoryDeps, repo: RecordRepo, ctx: { orgId: string; agentName: string; canWrite: boolean; userId: string | null }): AgentTools {
  const specs = ctx.canWrite ? [...READ_SPECS, ...WRITE_SPECS] : READ_SPECS;
  const names = new Set(specs.map((s) => s.name));

  /** One commit on the record's head, then the projection; once more if the record moved meanwhile. */
  const write = async (path: string, change: (current: string | null) => string, verb: string): Promise<string> => {
    const full = `${COMPANY_MEMORY_DIR}/${path}`;
    const who = ctx.userId ? await deps.memberName(ctx.orgId, ctx.userId).catch(() => null) : null;
    const by = who ? `${ctx.agentName} (por ${who})` : ctx.agentName;
    for (let attempt = 0; attempt < 2; attempt++) {
      const head = await repo.head();
      const next = change(await repo.file(full, head.sha));
      if (next.length > MAX_MEMORY_CHARS) throw new MemoryRefusal(`Quedaría en ${next.length} caracteres y el máximo es ${MAX_MEMORY_CHARS}: resúmelo o pártelo en varios ficheros.`);
      if (await repo.commit(head, [{ path: full, content: next }], `memoria: ${verb} ${path} (${by})`)) {
        await deps.store.saveMemory(ctx.orgId, [{ path, content: next, sha: gitBlobSha(next), updatedBy: by }]);
        return `Guardado en la memoria de la empresa: ${path}. Su enlace para la persona: [${path}](${MEMORY_LINK_PREFIX}${path})`;
      }
    }
    throw new MemoryRefusal('El registro ha cambiado mientras guardaba; inténtalo otra vez.');
  };

  const run = async (name: string, input: Record<string, unknown>): Promise<string> => {
    switch (name) {
      case VIEW: {
        const raw = typeof input.path === 'string' ? input.path : '';
        const file = raw.trim().toLowerCase().endsWith('.md') ? memoryPath(raw) : null;
        if (file) {
          const m = await deps.store.memory(ctx.orgId, file);
          if (!m) return `No existe \`${file}\`. Mira la carpeta con ${VIEW} o busca con ${SEARCH}.`;
          const by = m.updatedBy ? `, por ${m.updatedBy}` : '';
          return clip(`\`${file}\` (cambiado el ${madridDay(m.updatedAt)}${by}; enlace: ${MEMORY_LINK_PREFIX}${file})\n\n${m.content}`);
        }
        const folder = memoryFolder(raw);
        if (folder === null) throw new MemoryRefusal('Esa ruta no está dentro de la memoria de la empresa.');
        return clip(listing(await deps.store.memoryIndex(ctx.orgId), folder));
      }
      case SEARCH: {
        const words = [...new Set(str(input, 'query').split(/\s+/).map((w) => w.replace(/^[¿¡"'«(]+|[?!"'»),.;:]+$/g, '')).filter((w) => w.length >= 2))].slice(0, 8);
        if (!words.length) throw new MemoryRefusal('Dame al menos una palabra clave de dos letras o más.');
        const found = await deps.store.searchMemory(ctx.orgId, words, 10);
        if (!found.length) return `Nada en la memoria de la empresa con «${words.join(' ')}». Prueba con menos palabras u otras, o mira las carpetas con ${VIEW}.`;
        return clip(
          found.map((f) => [`- ${f.path} (${madridDay(f.updatedAt)}; enlace: ${MEMORY_LINK_PREFIX}${f.path})`, ...matchingLines(f.content, words)].join('\n')).join('\n'),
        );
      }
      case CREATE: {
        const path = fileOf(input);
        const content = str(input, 'content');
        if (!content.trim()) throw new MemoryRefusal('El fichero no puede estar vacío.');
        const index = await deps.store.memoryIndex(ctx.orgId);
        if (index.length >= MAX_MEMORY_FILES) throw new MemoryRefusal(`La memoria ya tiene ${MAX_MEMORY_FILES} ficheros: junta varios del mismo tema antes de crear otro.`);
        return write(
          path,
          (current) => {
            if (current !== null) throw new MemoryRefusal(`\`${path}\` ya existe: léelo con ${VIEW} y añade con ${REPLACE}.`);
            return content.endsWith('\n') ? content : `${content}\n`;
          },
          'nuevo',
        );
      }
      case REPLACE: {
        const path = fileOf(input);
        const oldStr = str(input, 'old_str');
        const newStr = str(input, 'new_str');
        if (!oldStr) throw new MemoryRefusal('`old_str` no puede estar vacío.');
        return write(
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
        return { content: own ? 'Solo Secretaría escribe en la memoria de la empresa: díselo a la persona para que se lo pase.' : `No existe la herramienta ${name}.`, isError: true };
      }
      if (typeof input !== 'object' || input === null || Array.isArray(input)) return { content: 'La entrada de la herramienta tiene que ser un objeto.', isError: true };
      try {
        return { content: await run(name, input as Record<string, unknown>), isError: false };
      } catch (e) {
        if (e instanceof MemoryRefusal) return { content: e.message, isError: true };
        console.error('memory tool failed', name, e instanceof Error ? e.message.slice(0, 200) : typeof e);
        return { content: 'No he podido usar la memoria de la empresa ahora. Dilo tal cual y no digas que está guardado.', isError: true };
      }
    },
  };
}
