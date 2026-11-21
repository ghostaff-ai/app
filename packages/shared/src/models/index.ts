import type { AccountProvider } from '../connectors';

// The shapes the app and the sync job share. They mirror the tables in
// supabase/migrations/; a column added there is added here in the same change.

export type MembershipRole = 'owner' | 'member';

export interface Organization {
  id: string;
  slug: string;
  name: string;
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
  /** Null while an answer given in the app is not yet in the record's file. */
  writtenBackAt: string | null;
}

/** Where a claim comes from; `link` is a URL or a path in the record. */
export interface DecisionSource {
  text: string;
  link?: string;
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
  answer: DecisionAnswer | null;
  closedAt: string | null;
}

export const RULE_KIND = 'regla';

// Connections: an organisation's links to outside accounts (supabase/migrations/
// 20261114000000_connections.sql). Never a key: keys stay in the engine's vault.

export type ConnectionKind = 'ai' | 'account';
export type AiProvider = 'anthropic' | 'openai' | 'vertex';
export type ConnectionMethod = 'api_key' | 'cloud_project' | 'oauth' | 'mcp';

export interface Connection {
  id: string;
  orgId: string;
  kind: ConnectionKind;
  provider: AiProvider | AccountProvider;
  method: ConnectionMethod;
  /** What the app shows to recognise it: a key's last 4 characters, the project, or the account's email. */
  hint: string;
  /** A cloud project's project and region; an account's granted scopes; empty for a key. */
  settings: { project?: string; region?: string; scopes?: string[] };
  status: 'ok' | 'failing';
  checkedAt: string;
  connectedByName: string;
  updatedAt: string;
}

/** What the app sends the engine to connect an AI account. */
export type ConnectAiInput =
  | { orgId: string; provider: 'anthropic' | 'openai'; apiKey: string }
  | { orgId: string; provider: 'vertex'; project: string; region: string };

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
  secretaria: { label: 'Secretaría', job: 'Que no se escape nada: lee el correo y te trae solo lo que necesita de ti.' },
  incorporacion: { label: 'Incorporación', job: 'Monta el registro de la organización con lo que ya tenéis, y guarda lo nuevo que llegue.' },
  finanzas: { label: 'Finanzas', job: 'El libro al día, con un documento detrás de cada euro.' },
  redes: { label: 'Redes', job: 'Hace crecer vuestras redes, aprendiendo qué funciona.' },
  productor: { label: 'Productor', job: 'Convierte encargos y material en bruto en piezas listas para publicar.' },
};

export interface Agent {
  id: string;
  orgId: string;
  name: string;
  ghost: AgentGhost;
  department: Department;
  /** The level a member has on it until an owner chooses one: talk for Secretaría, read for the rest. */
  memberDefault: AgentLevel;
  /** How it runs: only in chat, as one of Órdago's jobs while they migrate, or on Ghostaff's own runner. */
  runner: AgentRunner;
  /** Its own one-line job, when it has one (Órdago's agents); else its ghost's. */
  description: string | null;
  /** When it works on its own (cron, Madrid time), or null when only when asked. */
  schedule: string | null;
  createdAt: string;
}

export const AGENT_RUNNERS = ['chat', 'ordago_job', 'ghostaff'] as const;
export type AgentRunner = (typeof AGENT_RUNNERS)[number];

/** One run of an agent (supabase/migrations/20261121100000_agent_runners.sql): what it did, on its own or when asked. */
export interface AgentRun {
  id: string;
  orgId: string;
  agentId: string;
  origin: 'person' | 'schedule';
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
