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
