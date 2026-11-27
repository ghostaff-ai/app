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
