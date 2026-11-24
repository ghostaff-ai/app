// An agent's instructions are a file of its organisation's record, beside its memory
// (docs/plans/ready/agent-memory.md, «The agent's instructions live beside its memory»).

/** Where an agent's instructions live in its organisation's record. */
export const agentInstructionsPath = (slug: string) => `agentes/${slug}/AGENTS.md`;

/** The most an agent's instructions may hold: `agents.task`'s own limit. */
export const MAX_INSTRUCTIONS = 40000;
