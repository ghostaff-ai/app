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
