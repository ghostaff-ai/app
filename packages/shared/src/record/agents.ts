// An agent's instructions are a file of its organisation's record, beside its memory
// (docs/plans/ready/agent-memory.md, «The agent's instructions live beside its memory»).

/** Where an agent's instructions live in its organisation's record. */
export const agentInstructionsPath = (slug: string) => `agentes/${slug}/AGENTS.md`;

/** The most an agent's instructions may hold: `agents.task`'s own limit. */
export const MAX_INSTRUCTIONS = 40000;

/**
 * A repo an agent on our runner may use besides its organisation's record (`agents.repos`):
 * read-only unless `write`. Reached through the record's GitHub App installation.
 */
export interface AgentRepo {
  repo: string;
  /** May push: to any branch but production's (`main`, `beta`), unless `main`. */
  write: boolean;
  /** May push to `main` and `beta` too (Órdago's `push_a_main`). Only with `write`. */
  main?: boolean;
}

/** Where a run clones a repo besides the record, under the agent's `~/repos/`: its name, or owner-name when two share one. */
export function repoDirs(repos: string[]): Map<string, string> {
  const names = repos.map((r) => r.split('/')[1]!.toLowerCase());
  return new Map(repos.map((r, i) => [r, names.filter((n) => n === names[i]).length > 1 ? r.replace('/', '-') : r.split('/')[1]!]));
}

/**
 * The organisation's secrets an agent on our runner gets as environment variables of Claude Code
 * (`agents.secrets`): variable → the name of an organisation's secret in the vault. Names only, never a value.
 */
export type AgentSecrets = Record<string, string>;

/** Variables the runner sets itself, or that change how a shell, Claude Code, gcloud, git, node or the loader behave. */
const RESERVED_ENV = new Set(['HOME', 'PATH', 'LANG', 'USER', 'SHELL', 'PWD', 'TMPDIR', 'BASH_ENV', 'ENV', 'IFS']);
const RESERVED_ENV_PREFIX = /^(CLAUDE_|ANTHROPIC_|CLOUDSDK_|GOOGLE_|GHOSTAFF_|GIT_|LD_|NODE_|SSH_)/;

/**
 * Whether a secret may become this variable: upper case, digits and underscores, and none the runner or a tool
 * relies on. The same rule as the database's check (20261127400000_agent_secrets.sql) and the runner's (isSecretEnv).
 */
export const isSecretEnv = (env: string) => /^[A-Z][A-Z0-9_]{0,63}$/.test(env) && !RESERVED_ENV.has(env) && !RESERVED_ENV_PREFIX.test(env);

/** An organisation's secret's name: lower case, digits and hyphens (it goes into the vault's secret id). */
export const isSecretName = (name: string) => /^[a-z][a-z0-9-]{0,62}$/.test(name);

/**
 * An organisation's secret's id in the vault (Secret Manager): `org-<org>-secret-<name>`, like every secret of an
 * organisation (apps/engine/src/vault.ts), so whatever finds an organisation's secrets finds these too. One per
 * organisation and name, shared by every agent that names it.
 */
export function agentSecretName(orgId: string, name: string): string {
  return `org-${orgId}-secret-${name}`.replace(/[^A-Za-z0-9_-]/g, '-');
}
