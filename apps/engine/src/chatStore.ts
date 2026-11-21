// The team chat's database and model access for the engine: Supabase with the
// service role, and Claude through the organisation's own AI account (Vertex AI
// in its own Google Cloud project, EU region; its Claude subscription through
// Claude Code; or its API key from the vault).

import Anthropic from '@anthropic-ai/sdk';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import type { ChatMessage } from '@ghostaff/shared';
import { messageFromRow } from '@ghostaff/shared/services';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GoogleAuth } from 'google-auth-library';
import type { AiAccount, ChatAgent, ChatStore, ChatThreadHead, Level, Writer } from './chat';
import { type PrintRunner, runClaudePrint } from './claudeCode';
import { subscriptionWriter, withFallback } from './claudeWriter';
import { secretName, type Vault } from './vault';

function check<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data;
}

const text = (t: string) => [{ type: 'text', text: t }];

export function supabaseChatStore(admin: SupabaseClient): ChatStore {
  return {
    async levelFor(agentId, userId) {
      return check(await admin.rpc('agent_level_for', { target_agent: agentId, member: userId })) as Level;
    },
    async thread(id) {
      const r = check(await admin.from('threads').select('id, org_id, agent_id, title').eq('id', id).maybeSingle());
      return r ? { id: r.id, orgId: r.org_id, agentId: r.agent_id, title: r.title } : null;
    },
    async agent(id) {
      const r = check(await admin.from('agents').select('id, org_id, name, ghost, department, runner').eq('id', id).maybeSingle());
      return r ? { id: r.id, orgId: r.org_id, name: r.name, ghost: r.ghost, department: r.department, runner: r.runner } : null;
    },
    async orgAgents(orgId) {
      const rows = check(await admin.from('agents').select('id, org_id, name, ghost, department, runner').eq('org_id', orgId)) ?? [];
      return rows.map((r) => ({ id: r.id, orgId: r.org_id, name: r.name, ghost: r.ghost, department: r.department, runner: r.runner }));
    },
    async orgName(orgId) {
      const r = check(await admin.from('organizations').select('name').eq('id', orgId).single());
      return (r?.name as string | undefined) ?? '';
    },
    async memberNames(orgId) {
      return (check(await admin.from('memberships').select('display_name').eq('org_id', orgId)) ?? []).map((m) => m.display_name as string);
    },
    async recentMessages(threadId, limit): Promise<ChatMessage[]> {
      const rows = check(
        await admin
          .from('messages')
          .select('id, thread_id, author_kind, author_user, author_agent, author_name, parts, state, steps, created_at')
          .eq('thread_id', threadId)
          .order('created_at', { ascending: false })
          .limit(limit),
      );
      return (rows ?? []).map(messageFromRow).reverse();
    },
    async startReply(thread: ChatThreadHead, agent: ChatAgent, steps) {
      const { data, error } = await admin
        .from('messages')
        .insert({
          thread_id: thread.id,
          org_id: thread.orgId,
          author_kind: 'agent',
          author_agent: agent.id,
          author_name: agent.name,
          parts: [],
          state: 'working',
          steps,
        })
        .select('id')
        .single();
      // 23505: a reply is already being written in this thread.
      if (error && (error as { code?: string }).code === '23505') return null;
      if (error) throw error;
      return data.id as string;
    },
    async updateReply(id, patch) {
      const row: Record<string, unknown> = {};
      if (patch.text !== undefined) row.parts = [...text(patch.text), ...(patch.actions ?? [])];
      if (patch.steps) row.steps = patch.steps;
      if (patch.state) {
        row.state = patch.state;
        if (patch.state !== 'working') row.finished_at = new Date().toISOString();
      }
      check(await admin.from('messages').update(row).eq('id', id));
    },
    async proposeAction(a) {
      const r = check(
        await admin
          .from('agent_actions')
          .insert({
            org_id: a.orgId,
            thread_id: a.threadId,
            message_id: a.messageId,
            agent_id: a.agentId,
            tool: a.tool,
            input: a.input,
            label: a.label.slice(0, 200),
            requested_by: a.requestedBy,
          })
          .select('id')
          .single(),
      );
      if (!r) throw new Error('action not recorded');
      return r.id as string;
    },
    async touchThread(threadId) {
      check(await admin.from('threads').update({ last_message_at: new Date().toISOString() }).eq('id', threadId));
    },
    async createThread(orgId, agentId, title, createdBy) {
      const r = check(await admin.from('threads').insert({ org_id: orgId, agent_id: agentId, title, created_by: createdBy }).select('id').single());
      if (!r) throw new Error('thread not created');
      return r.id as string;
    },
    async aiAccount(orgId): Promise<AiAccount | null> {
      const rows = check(await admin.from('connections').select('provider, settings').eq('org_id', orgId).eq('kind', 'ai')) ?? [];
      // Vertex first: it keeps the model calls in the EU (invariant 2).
      const vertex = rows.find((r) => r.provider === 'vertex');
      if (vertex) return { provider: 'vertex', project: vertex.settings.project, region: vertex.settings.region };
      // Then the organisation's Claude subscription, with its Anthropic key behind it if it has one.
      const key = rows.some((r) => r.provider === 'anthropic');
      if (rows.some((r) => r.provider === 'claude')) return { provider: 'claude', keyFallback: key };
      if (key) return { provider: 'anthropic' };
      return null;
    },
  };
}

/** The model agents talk with; ENGINE_CHAT_MODEL overrides it. */
export const CHAT_MODEL = process.env.ENGINE_CHAT_MODEL || 'claude-opus-5-5';

/** How many times one reply may go back to the model after running tools. */
export const MAX_TOOL_ROUNDS = 8;

/**
 * Streams with any Anthropic-shaped client. Chat is quick back-and-forth: low
 * effort. When the model asks for tools, runs them and lets it go on, until it
 * answers or reaches MAX_TOOL_ROUNDS.
 */
export function streamWith(client: Anthropic | AnthropicVertex): Writer {
  return async ({ system, messages, tools, onText, onTool }) => {
    const history: Anthropic.MessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));
    let wrote = false;
    let gap = false; // a new round after tools: separate its text from what came before
    for (let round = 0; ; round++) {
      const stream = client.messages.stream({
        model: CHAT_MODEL,
        max_tokens: 8000,
        system,
        messages: history,
        ...(tools.specs.length ? { tools: tools.specs as Anthropic.Tool[] } : {}),
        output_config: { effort: 'low' },
      });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          if (gap && wrote) onText('\n\n');
          gap = false;
          wrote = true;
          onText(event.delta.text);
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') onText('\n\nEsto no puedo hacerlo.');
      if (final.stop_reason !== 'tool_use') return;
      if (round >= MAX_TOOL_ROUNDS) {
        onText('\n\nHe llegado al límite de pasos para una respuesta. Dime si sigo.');
        return;
      }
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of final.content) {
        if (block.type !== 'tool_use') continue;
        onTool(block.name);
        const outcome = await tools.run(block.name, block.input);
        results.push({ type: 'tool_result', tool_use_id: block.id, content: outcome.content, is_error: outcome.isError });
      }
      history.push({ role: 'assistant', content: final.content }, { role: 'user', content: results });
      gap = true;
    }
  };
}

export function writerFactory(vault: Vault, auth: GoogleAuth, runClaude: PrintRunner = runClaudePrint) {
  const keyWriter = async (orgId: string): Promise<Writer> => {
    const key = await vault.get(secretName(orgId, 'anthropic'));
    if (!key) throw new Error('the organisation has no Anthropic key in the vault');
    return streamWith(new Anthropic({ apiKey: key }));
  };
  return async (orgId: string, account: AiAccount): Promise<Writer> => {
    if (account.provider === 'claude') {
      const fallback = account.keyFallback ? () => keyWriter(orgId) : null;
      const token = await vault.get(secretName(orgId, 'claude'));
      if (!token) {
        if (fallback) return fallback();
        throw new Error('the organisation has no Claude subscription token in the vault');
      }
      return withFallback(subscriptionWriter(token, runClaude, CHAT_MODEL), fallback);
    }
    if (account.provider === 'vertex') {
      // A fresh token per reply (the SDK pins its own google-auth-library version).
      const accessToken = await auth.getAccessToken();
      if (!accessToken) throw new Error('no Google access token');
      return streamWith(new AnthropicVertex({ projectId: account.project, region: account.region, accessToken }));
    }
    return keyWriter(orgId);
  };
}
