// What an agent can do outside Ghostaff, through an organisation's connected
// accounts (docs/plans/ongoing/connectors.md). One shape for every tool, whoever
// built it, so a connector can change how it works without agents noticing.
//
// A tool never sees which organisation it acts for, nor any token: the engine
// hands it a fresh access token for the organisation of the run, taken from the
// run and never from the model.

import type { AccountProvider } from '@ghostaff/shared';

/** The JSON Schema of a tool's input, as the model sees it. */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolContext {
  accessToken: string;
  fetch: typeof fetch;
  /** For a URL the model gave: reaches public addresses only (publicFetch.ts). Defaults to that real one. */
  fetchPublic?: typeof fetch;
}

export interface Tool {
  name: string;
  /** For the model: what it does and when to use it. */
  description: string;
  input_schema: ToolInputSchema;
  provider: AccountProvider;
  /** The provider scope the tool needs; it is offered only when the account granted it. Empty for a tool the account lists itself (an MCP server's). */
  scope: string;
  /** Creates or changes something outside Ghostaff. */
  writes: boolean;
  /** The line the person sees while it runs, in Spanish («Mirando tu calendario»). */
  step: string;
  /** For a tool that writes: what the approval card says it will do («Publicar en Instagram»). */
  action?: string;
  /** Returns what the model reads back. Throws ToolError for a failure the model should hear about. */
  run(ctx: ToolContext, input: Record<string, unknown>): Promise<string>;
}

/** A failure the model is told, in words it can pass on. */
export class ToolError extends Error {}

/** What the model reads back from a tool: never longer than this. */
export const TOOL_OUTPUT_LIMIT = 12_000;

export function clip(text: string): string {
  return text.length <= TOOL_OUTPUT_LIMIT ? text : `${text.slice(0, TOOL_OUTPUT_LIMIT)}\n…(recortado)`;
}

/** A tool as the Messages API takes it. */
export interface ToolSpec {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

/** The tools one organisation's agents may use in a run. */
export interface AgentTools {
  specs: ToolSpec[];
  /** For the system prompt: one line per connected account, in Spanish. */
  accounts: string[];
  /** The step line to show while `name` runs. */
  stepFor(name: string): string;
  /** Whether `name` creates or changes something outside Ghostaff (unknown tools count as writing). */
  writes(name: string): boolean;
  /** What the approval card says a writing tool will do. */
  actionFor(name: string): string;
  run(name: string, input: unknown): Promise<ToolOutcome>;
}

export const NO_TOOLS: AgentTools = {
  specs: [],
  accounts: [],
  stepFor: () => 'Trabajando',
  writes: () => true,
  actionFor: (name) => name,
  run: async (name) => ({ content: `No existe la herramienta ${name}.`, isError: true }),
};
