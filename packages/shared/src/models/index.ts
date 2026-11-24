import type { AccountProvider } from '../connectors';
import type { Limits } from '../aiUsage';

// The shapes the app and the sync job share. They mirror the tables in
// supabase/migrations/; a column added there is added here in the same change.

export type MembershipRole = 'owner' | 'member';

/** A company, or a person's own personal space (welcome-and-spaces.md). */
export type OrganizationKind = 'personal' | 'company';

export interface Organization {
  id: string;
  slug: string;
  name: string;
  kind: OrganizationKind;
}

/** An organisation as the signed-in person sees it: with their role and how they sign. */
export interface MyOrganization extends Organization {
  role: MembershipRole;
  displayName: string;
}

/** One per person, across organisations. */
export interface Profile {
  fullName: string;
  occupation: string | null;
  heardFrom: string | null;
}

/** What a new organisation's creator tells us: the light first step of Incorporación. */
export interface NewOrganization {
  name: string;
  website?: string;
  about?: string;
  links?: string[];
}

/** An invitation as the invited person sees it. */
export interface MyInvitation {
  id: string;
  orgId: string;
  orgName: string;
  role: MembershipRole;
  invitedByName: string;
  createdAt: string;
}

/** An organisation's open invitation, as its owners see it. */
export interface PendingInvitation {
  id: string;
  email: string;
  role: MembershipRole;
  invitedByName: string;
  createdAt: string;
}

export type Answer = 'ok' | 'no';

export interface DecisionAnswer {
  answer: Answer;
  byName: string;
  at: string;
  note: string | null;
  /** Only for a rule answered OK: the wording the person signs. */
  signedText: string | null;
  source: 'record' | 'app';
  /** With options: the id of the one chosen (null for a no given by an app from before options). */
  option: string | null;
  /** Null while an answer given in the app is not yet in the record's file. */
  writtenBackAt: string | null;
}

/** Where a claim comes from; `link` is a URL or a path in the record. */
export interface DecisionSource {
  text: string;
  link?: string;
}

/** One of a decision's options: a short verb phrase, and what happens with it. */
export interface DecisionOption {
  id: string;
  text: string;
  if?: string;
}

/** The agent that asked, when the decision points at one of the organisation's agents. */
export interface DecisionAgent {
  id: string;
  name: string;
  ghost: string;
}

export interface Decision {
  id: string;
  orgId: string;
  /** The file name in the record, without `.yaml`. */
  recordId: string;
  sourcePath: string;
  area: string;
  /** `tipo`: the class of decision. Autonomy is earned per kind. */
  kind: string;
  question: string;
  context: string;
  /** The agent that opened it and will act on the answer. */
  proposedBy: string;
  createdOn: string;
  /** Only for `kind === 'regla'`: the wording the agent proposes. */
  ruleProposal: string | null;
  // Optional parts the app lays out in fixed places (por-decidir `recomienda`,
  // `con_si`, `con_no`, `cita`, `fuentes`, `vence`); null or empty when the
  // agent did not write them.
  /** What the agent would do, as a verb: the OK button's label. */
  recommendation: string | null;
  ifYes: string | null;
  ifNo: string | null;
  /** One literal line from the most telling source. */
  quote: string | null;
  sources: DecisionSource[];
  /** `YYYY-MM-DD`: the last day the answer is useful. */
  dueOn: string | null;
  /** 2 or 3 options instead of yes or no; empty for a yes-or-no decision. */
  options: DecisionOption[];
  /** With options: the id of the agent's pick. */
  recommendedOption: string | null;
  /** `importancia: alta`: no swipe, and the pick hidden until the person chooses. */
  highStakes: boolean;
  agent: DecisionAgent | null;
  answer: DecisionAnswer | null;
  closedAt: string | null;
}

export const RULE_KIND = 'regla';

// Connections: an organisation's links to outside accounts (supabase/migrations/
// 20261114000000_connections.sql). Never a key: keys stay in the engine's vault.

export type ConnectionKind = 'ai' | 'account' | 'guided';
/** `claude` is a Claude subscription, signed in through the unmodified Claude Code the engine hosts. */
export type AiProvider = 'anthropic' | 'openai' | 'vertex' | 'claude';
export type ConnectionMethod = 'api_key' | 'cloud_project' | 'oauth' | 'mcp' | 'subscription';

export interface Connection {
  id: string;
  orgId: string;
  kind: ConnectionKind;
  provider: AiProvider | AccountProvider | string;
  method: ConnectionMethod;
  /** What the app shows to recognise it: a key's last 4 characters, the project, or the account's email. */
  hint: string;
  /** A cloud project's project and region; an account's granted scopes; a guided access's app; empty for a key. */
  settings: { project?: string; region?: string; scopes?: string[]; app?: string };
  /** The agent a guided access belongs to (it is that agent's own identity in the app); null for every other kind, or once the agent is gone. */
  agentId: string | null;
  status: 'ok' | 'failing';
  /** Why it is failing: out of its limits, no longer accepted (key revoked, signed out), or anything else. */
  statusReason: 'limited' | 'refused' | 'failed' | null;
  checkedAt: string;
  connectedByName: string;
  updatedAt: string;
  /** An AI account's place in the order the engine tries them (1 first); 0 for an outside account. */
  position: number;
  /** The name an owner gave an AI account; null shows the provider's. */
  label: string | null;
  /** A Claude subscription's latest usage limits, as Claude Code reported them. */
  limits: Limits;
  /** When an agent last worked on it. */
  lastUsedAt: string | null;
}

/** What the app sends the engine to connect an AI account. */
export type ConnectAiInput =
  | { orgId: string; provider: 'anthropic' | 'openai'; apiKey: string }
  | { orgId: string; provider: 'vertex'; project: string; region: string };

/**
 * Connecting a Claude subscription, one WebSocket from start to end (the engine
 * runs Claude Code's own sign-in for the owner). What the screen hears:
 * Anthropic's sign-in link, then that the code is being checked, then the
 * connection or a refusal code.
 */
export type ClaudeSessionEvent =
  | { type: 'url'; url: string }
  | { type: 'working' }
  | { type: 'done'; connection: Connection }
  | { type: 'error'; code: string };

/**
 * How a connect by sign-in ended, as the engine sends the person back to the
 * app (`?connected=<provider>&result=<result>`).
 */
export type AccountConnectResult = 'ok' | 'denied' | 'missing_scopes' | 'expired' | 'failed';

/** EU regions where Vertex AI serves Claude. The first is the default. */
export const VERTEX_EU_REGIONS = ['europe-west1', 'europe-west4'] as const;

// Agents: an organisation's team, by department (supabase/migrations/
// 20261117000000_agents.sql, 20261121100000_agent_runners.sql).

export const DEPARTMENTS = ['direccion', 'finanzas', 'legal', 'producto', 'marketing'] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const AGENT_GHOSTS = ['base', 'secretaria', 'incorporacion', 'finanzas', 'redes', 'productor'] as const;
export type AgentGhost = (typeof AGENT_GHOSTS)[number];

/**
 * Each ghost's job, as the app shows it and as the agent is told it
 * (ghostaff-producto.md, «El equipo de partida»). One place for both.
 */
export const AGENT_JOBS: Record<AgentGhost, { label: string; job: string }> = {
  base: { label: 'Agente', job: 'Un agente del equipo.' },
  secretaria: { label: 'Secretaría', job: 'Lleva tu equipo: crea contigo los agentes que necesitas y conoce cómo trabaja la empresa.' },
  incorporacion: { label: 'Incorporación', job: 'Monta el registro de la organización con lo que ya tenéis, y guarda lo nuevo que llegue.' },
  finanzas: { label: 'Finanzas', job: 'El libro al día, con un documento detrás de cada euro.' },
  redes: { label: 'Redes', job: 'Hace crecer vuestras redes, aprendiendo qué funciona.' },
  productor: { label: 'Productor', job: 'Convierte encargos y material en bruto en piezas listas para publicar.' },
};

/**
 * The name the main agent is hired under. The SQL repeats it once, in
 * `hire_main_agent`, with a comment pointing here.
 */
export const MAIN_AGENT_NAME = 'Secretaría';

export interface Agent {
  id: string;
  orgId: string;
  name: string;
  ghost: AgentGhost;
  /** The organisation's main agent (one per organisation, never removed): it changes settings and builds the team. A role, not a ghost. */
  isMain: boolean;
  department: Department;
  /** The level a member has on it until an owner chooses one: talk for Secretaría, read for the rest. */
  memberDefault: AgentLevel;
  /** Who reads a new conversation with it unless its opener says otherwise; set by an owner. */
  chatDefault: ConversationVisibility;
  /** How it runs: only in chat, as one of Órdago's jobs while they migrate, or on Ghostaff's own runner. */
  runner: AgentRunner;
  /** Its own one-line job, when it has one (Órdago's agents); else its ghost's. */
  description: string | null;
  /** When it works on its own (cron, Madrid time), or null when only when asked. */
  schedule: string | null;
  /** The connected accounts (providers) it may use; null for every one the organisation connects. */
  accounts: string[] | null;
  createdAt: string;
}

export const AGENT_RUNNERS = ['chat', 'ordago_job', 'ghostaff'] as const;
export type AgentRunner = (typeof AGENT_RUNNERS)[number];

/** One run of an agent (supabase/migrations/20261121100000_agent_runners.sql): what it did, on its own or when asked. */
export interface AgentRun {
  id: string;
  orgId: string;
  agentId: string;
  /** `routine`: one of the agent's routines started it (agent-routines.md). */
  origin: 'person' | 'schedule' | 'routine';
  state: 'running' | 'done' | 'failed';
  summary: string | null;
  noteworthy: boolean;
  decisionsOpened: number;
  startedAt: string;
  finishedAt: string | null;
}

// Who may use each agent (supabase/migrations/20261118000000_team_chat.sql):
// none doesn't see it, read sees its threads, talk also writes in them. An
// owner always talks.
export const AGENT_LEVELS = ['none', 'read', 'talk'] as const;
export type AgentLevel = (typeof AGENT_LEVELS)[number];

// Who reads and writes a conversation besides whoever opened it
// (docs/plans/ongoing/chat-permissions.md): private only them; read also
// everyone who may see the agent, reading; write also everyone who may see the
// agent, each by their level on it. The agent's levels are always the ceiling.
export const CONVERSATION_VISIBILITIES = ['private', 'read', 'write'] as const;
export type ConversationVisibility = (typeof CONVERSATION_VISIBILITIES)[number];

/** One member's level on one agent, as its owners see it. */
export interface AgentAccess {
  userId: string;
  displayName: string;
  role: MembershipRole;
  level: AgentLevel;
  /** True while the member has the agent's default level, not one an owner chose. */
  isDefault: boolean;
}

export interface NewAgent {
  orgId: string;
  name: string;
  ghost: AgentGhost;
  department: Department;
}
