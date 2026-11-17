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

export type ConnectionKind = 'ai';
export type AiProvider = 'anthropic' | 'openai' | 'vertex';
export type ConnectionMethod = 'api_key' | 'cloud_project';

export interface Connection {
  id: string;
  orgId: string;
  kind: ConnectionKind;
  provider: AiProvider;
  method: ConnectionMethod;
  /** What the app shows to recognise it: a key's last 4 characters, or the project. */
  hint: string;
  /** A cloud project's project and region; empty for a key. */
  settings: { project?: string; region?: string };
  status: 'ok' | 'failing';
  checkedAt: string;
  connectedByName: string;
  updatedAt: string;
}

/** What the app sends the engine to connect an AI account. */
export type ConnectAiInput =
  | { orgId: string; provider: 'anthropic' | 'openai'; apiKey: string }
  | { orgId: string; provider: 'vertex'; project: string; region: string };

/** EU regions where Vertex AI serves Claude. The first is the default. */
export const VERTEX_EU_REGIONS = ['europe-west1', 'europe-west4'] as const;

// Agents: an organisation's team, by department (supabase/migrations/
// 20261117000000_agents.sql). For now only how the app shows them.

export const DEPARTMENTS = ['direccion', 'finanzas', 'marketing'] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const AGENT_GHOSTS = ['base', 'secretaria', 'incorporacion', 'finanzas', 'redes', 'productor'] as const;
export type AgentGhost = (typeof AGENT_GHOSTS)[number];

export interface Agent {
  id: string;
  orgId: string;
  name: string;
  ghost: AgentGhost;
  department: Department;
  /** The level a member has on it until an owner chooses one: talk for Secretaría, read for the rest. */
  memberDefault: AgentLevel;
  createdAt: string;
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
