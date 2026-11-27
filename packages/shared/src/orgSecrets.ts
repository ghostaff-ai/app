import type { Agent, OrgSecret } from './models';

// Conexiones › Claves (docs/plans/ongoing/secrets-from-the-app.md): the organisation's keys, each with
// the agents that get it. A key an agent names (agents.secrets) that nobody has stored shows too, as
// missing, so the person can store it and the agent gets it on its next run.

/** One row of Claves: a key, stored or waiting (`secret`), or missing (`secret` null), and who uses it. */
export interface KeyRow {
  name: string;
  secret: OrgSecret | null;
  /** The agents that get it, by name, each with the variable it becomes. */
  agents: { id: string; name: string; env: string }[];
}

/** The keys first, by label; then the missing ones, by name. */
export function keyRows(secrets: readonly OrgSecret[], agents: readonly Pick<Agent, 'id' | 'name' | 'secrets'>[]): KeyRow[] {
  const users = (name: string) =>
    agents
      .flatMap((a) => Object.entries(a.secrets ?? {}).filter(([, n]) => n === name).map(([env]) => ({ id: a.id, name: a.name, env })))
      .sort((x, y) => x.name.localeCompare(y.name, 'es'));
  const stored = [...secrets]
    .sort((a, b) => a.label.localeCompare(b.label, 'es'))
    .map((s) => ({ name: s.name, secret: s, agents: users(s.name) }));
  const known = new Set(secrets.map((s) => s.name));
  const missing = [...new Set(agents.flatMap((a) => Object.values(a.secrets ?? {})))]
    .filter((n) => !known.has(n))
    .sort()
    .map((name) => ({ name, secret: null, agents: users(name) }));
  return [...stored, ...missing];
}

/** The value as pasted, typed or piped: the one trailing newline a paste or a pipe adds is dropped, nothing else. */
export const cleanSecretValue = (raw: string): string => raw.replace(/\r?\n$/, '');

/**
 * Why a value cannot be a key, or null: the runner hides each value from its logs only from 8 characters on,
 * and an environment variable holds neither a NUL nor more than 64 KB.
 */
export function secretValueProblem(value: string): 'too_short' | 'too_long' | 'nul' | null {
  if (value.length < 8) return 'too_short';
  if (value.length > 65536) return 'too_long';
  if (value.includes('\0')) return 'nul';
  return null;
}

/** A key's name from what a person calls it: «Contraseña de info@ordago.club» → `contrasena-de-info-ordago-club`. '' when nothing is left. */
export function secretNameFromLabel(label: string): string {
  const slug = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return '';
  return (/^[a-z]/.test(slug) ? slug : `k-${slug}`).slice(0, 63).replace(/-+$/, '');
}

/** A label for a key nobody named: `correo-info` → «Correo info». */
export function secretLabelFromName(name: string): string {
  const words = name.replace(/-+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
