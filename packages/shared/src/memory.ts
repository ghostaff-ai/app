// The organisation's memory («Empresa»): a folder of its record, small Markdown files, one topic each
// (docs/plans/ready/agent-memory.md decision 1, docs/plans/ongoing/business-brain.md). The record is
// the master; the database keeps its projection (`memories`) for the app and the chat.

/** Where the Empresa store lives in the record. */
export const COMPANY_MEMORY_DIR = 'memoria/empresa';

/** The most files the store holds, and the most characters in one (agent-memory.md decision 6; `memories`' own check). */
export const MAX_MEMORY_FILES = 1000;
export const MAX_MEMORY_CHARS = 10240;

/** How a reply links a file of the store, and the app opens it (`/memoria/[...path]`). */
export const MEMORY_LINK_PREFIX = '/memoria/';

/**
 * A file's path inside the store, as the model or a link gives it: without the record's folder or
 * a leading slash. Null when it would leave the store, is not Markdown or is too long; the same
 * rule as `memories.path`'s check.
 */
export function memoryPath(raw: string): string | null {
  let p = raw.trim().replace(/\\/g, '/');
  for (const prefix of [MEMORY_LINK_PREFIX, `/${COMPANY_MEMORY_DIR}/`, `${COMPANY_MEMORY_DIR}/`]) if (p.startsWith(prefix)) p = p.slice(prefix.length);
  p = p.replace(/^\/+/, '');
  if (!p || p.length > 300 || !p.toLowerCase().endsWith('.md')) return null;
  const parts = p.split('/');
  if (parts.some((s) => s === '' || s === '.' || s === '..' || s === '.git' || s.startsWith('.'))) return null;
  return p;
}

/** A folder's path inside the store, '' for the store itself; null when it would leave it. */
export function memoryFolder(raw: string): string | null {
  const p = raw.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const inner = p === COMPANY_MEMORY_DIR || p === 'memoria' ? '' : p.startsWith(`${COMPANY_MEMORY_DIR}/`) ? p.slice(COMPANY_MEMORY_DIR.length + 1) : p;
  if (!inner) return '';
  return inner.split('/').some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.')) ? null : inner;
}

/** How a file is named to a person: its folders and name, without `.md`, dashes as spaces («Facturas › 2026 10 acme»). */
export function memoryTitle(path: string): string {
  return path
    .replace(/\.md$/i, '')
    .split('/')
    .map((s) => s.replace(/[-_]+/g, ' ').trim())
    .map((s) => (s ? s[0]!.toLocaleUpperCase('es') + s.slice(1) : s))
    .join(' › ');
}

// Each agent's own store (docs/plans/ongoing/agent-context.md PR 2): `memoria/agentes/<slug>/` in the
// record, the same small Markdown files; the agent reads and writes it, whoever may see the agent
// reads it in the app.

/** Where agents' own stores live in the record, one folder per agent's slug. */
export const AGENT_MEMORY_DIR = 'memoria/agentes';

/** One agent's store in the record. */
export const agentMemoryDir = (slug: string) => `${AGENT_MEMORY_DIR}/${slug}`;

/** How a reply links a file of an agent's store, and the app opens it (`/agente/[id]/memoria/[...path]`). */
export const agentMemoryLink = (agentId: string, path: string) => `/agente/${agentId}/memoria/${path}`;

const AGENT_LINK = /^\/agente\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/memoria\/(.+)$/i;

/** The agent and the file a link to an agent's store points at; null when it is not one. */
export function agentMemoryHref(href: string): { agentId: string; path: string } | null {
  const m = AGENT_LINK.exec(href.trim());
  if (!m) return null;
  const path = memoryPath(m[2]!);
  return path ? { agentId: m[1]!.toLowerCase(), path } : null;
}

/**
 * A file's path inside one agent's store, as the model or a link gives it: without the record's
 * folder, the link's prefix or a leading slash. Null when it would leave the store.
 */
export function agentMemoryPath(raw: string, agentId: string, slug: string): string | null {
  let p = raw.trim().replace(/\\/g, '/');
  for (const prefix of [agentMemoryLink(agentId, ''), `/${agentMemoryDir(slug)}/`, `${agentMemoryDir(slug)}/`]) if (p.startsWith(prefix)) p = p.slice(prefix.length);
  return memoryPath(p);
}

/** A folder's path inside one agent's store, '' for the store itself; null when it would leave it. */
export function agentMemoryFolder(raw: string, slug: string): string | null {
  const p = raw.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const dir = agentMemoryDir(slug);
  const inner = p === dir ? '' : p.startsWith(`${dir}/`) ? p.slice(dir.length + 1) : p;
  if (!inner) return '';
  return inner.split('/').some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.')) ? null : inner;
}
