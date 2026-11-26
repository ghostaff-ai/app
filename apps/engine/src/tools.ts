// What an agent can do outside Ghostaff, through an organisation's connected
// accounts (docs/plans/ongoing/connectors.md). One shape for every tool, whoever
// built it, so a connector can change how it works without agents noticing.
//
// A tool never sees which organisation it acts for, nor any token: the engine
// hands it a fresh access token for the organisation of the run, taken from the
// run and never from the model.

import type { AccountProvider, EditableField } from '@ghostaff/shared';

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
  /** For a tool that writes: the text fields a person may change before approving it («Editar»). */
  editable?: EditableSpec[];
  /** Returns what the model reads back. Throws ToolError for a failure the model should hear about. */
  run(ctx: ToolContext, input: Record<string, unknown>): Promise<string>;
}

/**
 * A text field of a writing tool's input that a person may change before
 * approving (docs/plans/ongoing/model-routing.md, decision 9). `max` is the
 * tool's own limit, or less for one too long to edit in a card.
 */
export type EditableSpec = Omit<EditableField, 'value'>;

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
  /**
   * Whether `name` creates or changes something outside Ghostaff (unknown tools count as writing).
   * `input`, when given, is the call's: a tool whose input decides it (a guided access's request: GET reads) looks at it.
   */
  writes(name: string, input?: unknown): boolean;
  /** What the approval card says a writing tool will do. */
  actionFor(name: string): string;
  /** The text fields of a writing tool a person may change before approving it; none when absent. */
  editableFor?(name: string): EditableSpec[];
  /** For a writing tool that can say exactly what it will change (a setting): the card's label and preview. Throws on bad input. */
  describe?(name: string, input: Record<string, unknown>): Promise<{ label: string; preview: string; decider?: 'owner' | 'requester' } | null>;
  /** The connected account a tool belongs to; undefined for one that belongs to none. */
  providerOf?(name: string): string | undefined;
  /** The provider of each line of `accounts`, in the same order. */
  accountProviders?: string[];
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

/**
 * Only the tools of the connected accounts one agent may use (agents.accounts,
 * set by an owner); null leaves every one.
 */
export function restrictTo(tools: AgentTools, allowed: readonly string[] | null | undefined): AgentTools {
  if (allowed == null || !tools.providerOf) return tools;
  const ok = (name: string) => {
    const p = tools.providerOf?.(name);
    return p !== undefined && allowed.includes(p);
  };
  const keep = (tools.accountProviders ?? []).map((p) => allowed.includes(p));
  return {
    ...tools,
    specs: tools.specs.filter((s) => ok(s.name)),
    accounts: tools.accounts.filter((_, i) => keep[i]),
    accountProviders: tools.accountProviders?.filter((_, i) => keep[i]),
    run: (name, input) => (ok(name) ? tools.run(name, input) : NO_TOOLS.run(name, input)),
  };
}

/** Two sets of tools as one; a name in both keeps the first's. */
export function mergeTools(a: AgentTools, b: AgentTools): AgentTools {
  const inA = new Set(a.specs.map((s) => s.name));
  const pick = (name: string) => (inA.has(name) ? a : b);
  return {
    specs: [...a.specs, ...b.specs.filter((s) => !inA.has(s.name))],
    accounts: [...a.accounts, ...b.accounts],
    accountProviders: [...(a.accountProviders ?? a.accounts.map(() => '')), ...(b.accountProviders ?? b.accounts.map(() => ''))],
    stepFor: (name) => pick(name).stepFor(name),
    writes: (name, input) => pick(name).writes(name, input),
    actionFor: (name) => pick(name).actionFor(name),
    editableFor: (name) => pick(name).editableFor?.(name) ?? [],
    describe: async (name, input) => (await pick(name).describe?.(name, input)) ?? null,
    providerOf: (name) => pick(name).providerOf?.(name),
    run: (name, input) => pick(name).run(name, input),
  };
}
