// An agent asking, in its message, for an account it lacks (docs/plans/ongoing/
// connector-in-chat.md). The agent calls `ask_for_account`; the reply's writer
// (chat.ts) turns the call into a card in the message, «Necesito acceso a
// Notion», and records it here. Once the account is connected, working and
// given to the agent, the chat asks the engine to let the agent go on
// (`resumeAfterAccount` in chat.ts), which it does once.
//
// The agent can only ask. Connecting stays an owner signing in to the provider
// in the app, and giving an agent an account stays an owner's press: nothing
// here connects or grants anything.

import { type AccountAskPart, type AccountStates, accountNeed, CONNECTORS, type CatalogueConnector, isAccountAskPart, type MessagePart } from '@ghostaff/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentTools, ToolOutcome, ToolSpec } from './tools';

export const ASK_TOOL = 'ask_for_account';

/** Cards of this kind one message may carry. */
export const MAX_ASKS = 3;

export interface AskRecord {
  id: string;
  orgId: string;
  threadId: string;
  messageId: string;
  agentId: string;
  connector: string | null;
  name: string;
  need: AccountAskPart['need'];
  status: AccountAskPart['status'];
  /** The state of the message that carries the card. */
  messageState: 'working' | 'done' | 'failed';
}

/** The database as asking needs it (service role). */
export interface AskStore {
  /** The organisation's connected accounts (not its AI accounts), and whether each works. */
  accountStates(orgId: string): Promise<AccountStates>;
  propose(a: {
    orgId: string;
    threadId: string;
    messageId: string;
    agentId: string;
    connector: string | null;
    name: string;
    need: AccountAskPart['need'];
    requestedBy: string;
  }): Promise<string>;
  ask(id: string): Promise<AskRecord | null>;
  /** open → done; false when it was no longer open. */
  claim(id: string, userId: string): Promise<boolean>;
  /** done → open, when the agent could not go on after all (another reply was being written). */
  reopen(id: string): Promise<void>;
  /** Rewrites the card in its message, so everyone in the thread sees it change. */
  updateCard(messageId: string, askId: string, patch: Partial<AccountAskPart>): Promise<void>;
  /** How a member signs, for «Conectada por Ana». */
  memberName(orgId: string, userId: string): Promise<string | null>;
}

const key = (s: string) => s.trim().toLocaleLowerCase('es');

/** The catalogue's connector the model named, by id or by name; null when we have none. */
export function catalogueEntry(named: string): CatalogueConnector | null {
  const k = key(named);
  return (CONNECTORS as readonly CatalogueConnector[]).find((c) => c.id === k || key(c.name) === k) ?? null;
}

/** What is missing for this agent to use the connector, or `have` when nothing is. */
export function needFor(
  connector: CatalogueConnector | null,
  states: AccountStates,
  agentAccounts: readonly string[] | null | undefined,
): AccountAskPart['need'] | 'have' {
  return accountNeed(connector?.id ?? null, states, agentAccounts);
}

/** The tool as the model sees it: the catalogue goes in its description, so the model picks the id itself. */
export function askToolSpec(): ToolSpec {
  const list = (CONNECTORS as readonly CatalogueConnector[]).map((c) => `${c.id}: ${c.name}`).join('\n');
  return {
    name: ASK_TOOL,
    description:
      'Ask for an outside account you need and do not have (a calendar, documents, invoices, a social network…). ' +
      'The person sees a card in your message with a button to connect it, or to give it to you; once it is there you are asked to go on. ' +
      'Use it instead of saying you cannot, then end your message saying what you will do once you have it. ' +
      'Pass the id from this list, or the app\'s plain name when it is not on it:\n' +
      list,
    input_schema: {
      type: 'object',
      properties: {
        connector: { type: 'string', description: 'An id from the list, or the name of an app that is not on it.' },
        why: { type: 'string', description: 'In Spanish, one short line for the card: what you need it for («Para ver tus citas de esta semana»).' },
      },
      required: ['connector', 'why'],
    },
  };
}

/** The tool for an agent's set of tools. It only works inside a reply, which intercepts it (chat.ts). */
export const ASK_TOOLS: AgentTools = {
  specs: [askToolSpec()],
  accounts: [],
  accountProviders: [],
  stepFor: () => 'Pidiendo acceso',
  writes: () => false,
  actionFor: (name) => name,
  run: async () => ({ content: 'Solo se puede pedir una cuenta en una conversación.', isError: true }),
};

const fail = (content: string): { outcome: ToolOutcome } => ({ outcome: { content, isError: true } });

/**
 * Turns one `ask_for_account` call into a card, recorded for the engine to
 * trust later. `already` holds the cards of this message so far.
 */
export async function proposeAsk(
  store: AskStore,
  at: { orgId: string; threadId: string; messageId: string; agentId: string; agentAccounts: readonly string[] | null | undefined; userId: string },
  input: unknown,
  already: readonly AccountAskPart[],
): Promise<{ part?: AccountAskPart; outcome: ToolOutcome }> {
  const i = (typeof input === 'object' && input !== null ? input : {}) as { connector?: unknown; why?: unknown };
  const named = typeof i.connector === 'string' ? i.connector.replace(/\s+/g, ' ').trim() : '';
  if (named.length < 1 || named.length > 80) return fail('Di qué cuenta necesitas: un id de la lista o el nombre de la aplicación.');
  const why = typeof i.why === 'string' ? i.why.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  const connector = catalogueEntry(named);
  const name = connector?.name ?? named;
  if (already.some((p) => key(p.name) === key(name))) return fail(`Ya has pedido ${name} en este mensaje.`);
  if (already.length >= MAX_ASKS) return fail(`Ya hay ${MAX_ASKS} peticiones en este mensaje: espera a tenerlas.`);
  const need = needFor(connector, await store.accountStates(at.orgId), at.agentAccounts);
  if (need === 'have') return fail(`Ya tienes ${name}: usa sus herramientas.`);
  const askId = await store.propose({
    orgId: at.orgId,
    threadId: at.threadId,
    messageId: at.messageId,
    agentId: at.agentId,
    connector: connector?.id ?? null,
    name,
    need,
    requestedBy: at.userId,
  });
  const part: AccountAskPart = { type: 'account_ask', askId, name, why, need, status: 'open', ...(connector ? { connector: connector.id } : {}) };
  const content =
    need === 'unsupported'
      ? `Todavía no podemos conectar ${name}: la tarjeta deja pedirlo. Dilo así y, si hay otra forma de hacerlo, proponla.`
      : `Tarjeta mostrada: quien es propietario puede ${need === 'grant' ? `darte acceso a ${name}` : `conectar ${name}`} desde esta conversación. ` +
        'Termina tu mensaje diciendo qué harás cuando la tengas; no sigas con lo que la necesita. Te avisarán para que sigas.';
  return { part, outcome: { content, isError: false } };
}

/** The card, as the agent reads its own past message. */
export function askLine(p: AccountAskPart): string {
  const state = p.status === 'done' ? 'ya la tengo' : p.need === 'unsupported' ? 'todavía no se puede conectar' : 'todavía no la tengo';
  return `[Pedí acceso a ${p.name}: ${state}.]`;
}

/** The lines for the cards of a message, empty when it has none. */
export function askLines(parts: readonly MessagePart[]): string[] {
  return parts.filter(isAccountAskPart).map(askLine);
}

/** The AskStore over Supabase with the service role. */
export function supabaseAskStore(admin: SupabaseClient): AskStore {
  const check = <T>(r: { data: T; error: unknown }): T => {
    if (r.error) throw r.error;
    return r.data;
  };
  return {
    async accountStates(orgId) {
      const rows = check(await admin.from('connections').select('provider, status').eq('org_id', orgId).eq('kind', 'account')) ?? [];
      return new Map(rows.map((r: { provider: string; status: 'ok' | 'failing' }) => [r.provider, r.status]));
    },
    async propose(a) {
      const r = check(
        await admin
          .from('account_asks')
          .insert({
            org_id: a.orgId,
            thread_id: a.threadId,
            message_id: a.messageId,
            agent_id: a.agentId,
            connector: a.connector,
            name: a.name.slice(0, 80),
            need: a.need,
            requested_by: a.requestedBy,
          })
          .select('id')
          .single(),
      );
      if (!r) throw new Error('ask not recorded');
      return r.id as string;
    },
    async ask(id) {
      const r = check(
        await admin
          .from('account_asks')
          .select('id, org_id, thread_id, message_id, agent_id, connector, name, need, status, messages(state)')
          .eq('id', id)
          .maybeSingle(),
      ) as Record<string, any> | null;
      if (!r) return null;
      const message = Array.isArray(r.messages) ? r.messages[0] : r.messages;
      return {
        id: r.id,
        orgId: r.org_id,
        threadId: r.thread_id,
        messageId: r.message_id,
        agentId: r.agent_id,
        connector: r.connector,
        name: r.name,
        need: r.need,
        status: r.status,
        messageState: message?.state ?? 'done',
      };
    },
    async claim(id, userId) {
      const rows =
        check(
          await admin
            .from('account_asks')
            .update({ status: 'done', done_by: userId, done_at: new Date().toISOString() })
            .eq('id', id)
            .eq('status', 'open')
            .select('id'),
        ) ?? [];
      return rows.length === 1;
    },
    async reopen(id) {
      check(await admin.from('account_asks').update({ status: 'open', done_by: null, done_at: null }).eq('id', id));
    },
    async updateCard(messageId, askId, patch) {
      const r = check(await admin.from('messages').select('parts').eq('id', messageId).maybeSingle());
      if (!r) return;
      const parts = (r.parts as MessagePart[]).map((p) => (isAccountAskPart(p) && p.askId === askId ? { ...p, ...patch } : p));
      check(await admin.from('messages').update({ parts }).eq('id', messageId));
    },
    async memberName(orgId, userId) {
      const r = check(await admin.from('memberships').select('display_name').eq('org_id', orgId).eq('user_id', userId).maybeSingle());
      return (r?.display_name as string | undefined) ?? null;
    },
  };
}
