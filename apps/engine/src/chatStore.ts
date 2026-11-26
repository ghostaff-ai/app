// The team chat's database and model access for the engine: Supabase with the
// service role, and Claude through the organisation's own AI account (Vertex AI
// in its own Google Cloud project, EU region; its Claude subscription through
// Claude Code; or its API key from the vault).

import Anthropic from '@anthropic-ai/sdk';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { addTokens, atLimit, type ChatMessage, estimateCostUsd, limitsFromRow, limitsToRow, mergeLimits, NO_TOKENS, type TokenUsage, tokensFromUsage } from '@ghostaff/shared';
import { messageFromRow } from '@ghostaff/shared/services';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CloudAccountNotReady } from './cloudAccounts';
import { type AiAccount, AiFailure, CHAT_EFFORT, type ChatAgent, type ChatStore, type ChatThreadHead, type Level, type Writer } from './chat';
import type { FoundMessage } from './context';
import { type PrintRunner, runClaudePrint } from './claudeCode';
import { subscriptionWriter } from './claudeWriter';
import { readAiSecret, type Vault } from './vault';

function check<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data;
}

const text = (t: string) => [{ type: 'text', text: t }];

const MESSAGE_COLUMNS = 'id, thread_id, author_kind, author_user, author_agent, author_name, parts, state, steps, routine_id, created_at';

/** The most messages after a summary the engine reads at once: far past what a turn carries (context.ts). */
const CONVERSATION_ROWS = 1000;

/**
 * `afterAgentWrite` runs after each write that finishes an agent's message (the
 * push outbox's trigger has just queued its notifications): the engine drains them.
 */
export function supabaseChatStore(admin: SupabaseClient, opts: { afterAgentWrite?: () => void } = {}): ChatStore {
  return {
    async levelFor(agentId, userId) {
      return check(await admin.rpc('agent_level_for', { target_agent: agentId, member: userId })) as Level;
    },
    async threadLevelFor(threadId, userId) {
      return check(await admin.rpc('thread_level_for', { target_thread: threadId, member: userId })) as Level;
    },
    async thread(id) {
      const r = check(await admin.from('threads').select('id, org_id, agent_id, title').eq('id', id).maybeSingle());
      return r ? { id: r.id, orgId: r.org_id, agentId: r.agent_id, title: r.title } : null;
    },
    async agent(id) {
      const r = check(await admin.from('agents').select('id, org_id, name, slug, ghost, is_main, department, runner, accounts').eq('id', id).maybeSingle());
      return r ? { id: r.id, orgId: r.org_id, name: r.name, slug: r.slug, ghost: r.ghost, isMain: r.is_main, department: r.department, runner: r.runner, accounts: r.accounts } : null;
    },
    async orgAgents(orgId) {
      const rows = check(await admin.from('agents').select('id, org_id, name, slug, ghost, is_main, department, runner, accounts').eq('org_id', orgId)) ?? [];
      return rows.map((r) => ({ id: r.id, orgId: r.org_id, name: r.name, slug: r.slug, ghost: r.ghost, isMain: r.is_main, department: r.department, runner: r.runner, accounts: r.accounts }));
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
          .select(MESSAGE_COLUMNS)
          .eq('thread_id', threadId)
          .order('created_at', { ascending: false })
          .limit(limit),
      );
      return (rows ?? []).map(messageFromRow).reverse();
    },
    async conversation(threadId, agentId) {
      const row = check(
        await admin
          .from('conversation_summaries')
          .select('summary, through_at, through_message')
          .eq('thread_id', threadId)
          .eq('agent_id', agentId)
          .maybeSingle(),
      );
      let q = admin.from('messages').select(MESSAGE_COLUMNS).eq('thread_id', threadId);
      if (row) q = q.gt('created_at', row.through_at);
      const rows = check(await q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(CONVERSATION_ROWS));
      return {
        summary: row ? { text: row.summary as string, throughAt: row.through_at as string, throughMessage: row.through_message as string } : null,
        messages: (rows ?? []).map(messageFromRow).reverse(),
      };
    },
    async saveSummary(s) {
      return check(
        await admin.rpc('save_conversation_summary', {
          target_thread: s.threadId,
          target_agent: s.agentId,
          body: s.text,
          covers_until: s.throughAt,
          last_message: s.throughMessage,
        }),
      ) as boolean;
    },
    async searchMessages(threadId, q): Promise<FoundMessage[]> {
      const rows =
        check(
          await admin.rpc('search_thread_messages', { target_thread: threadId, words: q.words, since: q.since, until: q.until, max_rows: q.max }),
        ) ?? [];
      return (rows as Array<{ id: string; author_kind: 'person' | 'agent'; author_name: string; author_agent: string | null; created_at: string; body: string }>).map((r) => ({
        id: r.id,
        authorKind: r.author_kind,
        authorName: r.author_name,
        authorAgentId: r.author_agent,
        createdAt: r.created_at,
        text: r.body,
      }));
    },
    async startReply(thread: ChatThreadHead, agent: ChatAgent, steps, routineId) {
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
          routine_id: routineId ?? null,
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
      if (patch.text !== undefined) row.parts = [...text(patch.text), ...(patch.cards ?? [])];
      if (patch.steps) row.steps = patch.steps;
      if (patch.state) {
        row.state = patch.state;
        if (patch.state !== 'working') row.finished_at = new Date().toISOString();
      }
      check(await admin.from('messages').update(row).eq('id', id));
      if (patch.state && patch.state !== 'working') opts.afterAgentWrite?.();
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
            decider: a.decider,
          })
          .select('id')
          .single(),
      );
      if (!r) throw new Error('action not recorded');
      return r.id as string;
    },
    async deleteMessage(id) {
      check(await admin.from('messages').delete().eq('id', id));
    },
    async touchThread(threadId) {
      check(await admin.from('threads').update({ last_message_at: new Date().toISOString() }).eq('id', threadId));
    },
    async personalChat(orgId, agentId, title, userId) {
      const find = async () =>
        (check(await admin.from('threads').select('id').eq('agent_id', agentId).eq('personal_of', userId).maybeSingle()) as { id: string } | null)?.id;
      const found = await find();
      if (found) return found;
      const { data, error } = await admin
        .from('threads')
        .insert({ org_id: orgId, agent_id: agentId, title, created_by: userId, personal_of: userId })
        .select('id')
        .single();
      // Opened meanwhile by the person's first message (chat_with): use that one.
      if (error?.code === '23505') return (await find()) ?? Promise.reject(new Error('chat not created'));
      if (error || !data) throw error ?? new Error('chat not created');
      return data.id as string;
    },
    async aiAccounts(orgId): Promise<AiAccount[]> {
      const rows =
        check(
          await admin
            .from('connections')
            .select('id, provider, settings, limits')
            .eq('org_id', orgId)
            .eq('kind', 'ai')
            .order('position')
            .order('created_at'),
        ) ?? [];
      return orderAccounts(rows);
    },
    async recordAiUse(use) {
      check(
        await admin.from('ai_usage').insert({
          org_id: use.orgId,
          connection_id: use.connectionId,
          agent_id: use.agentId,
          message_id: use.messageId ?? null,
          run_id: use.runId ?? null,
          effort: use.effort ?? null,
          source: use.source,
          outcome: use.outcome,
          model: use.model?.slice(0, 80) ?? null,
          input_tokens: use.tokens.input,
          output_tokens: use.tokens.output,
          cache_read_tokens: use.tokens.cacheRead,
          cache_write_tokens: use.tokens.cacheWrite,
          cost_usd: use.costUsd,
        }),
      );
      const now = new Date().toISOString();
      const patch: Record<string, unknown> =
        use.outcome === 'ok'
          ? { status: 'ok', status_reason: null, last_used_at: now, checked_at: now }
          : { status: 'failing', status_reason: use.outcome, checked_at: now };
      if (use.limits) {
        const current = check(await admin.from('connections').select('limits').eq('id', use.connectionId).maybeSingle());
        const merged = mergeLimits(limitsFromRow(current?.limits), use.limits);
        if (merged) patch.limits = limitsToRow(merged);
      }
      check(await admin.from('connections').update(patch).eq('id', use.connectionId).eq('org_id', use.orgId));
    },
  };
}

/**
 * The rows of `connections` as accounts to try, in order: the owner's, except
 * that one at a limit that has not reset yet goes last (still tried if nothing
 * else answers). An OpenAI key is kept but the engine runs only Claude.
 */
export function orderAccounts(
  rows: { id: string; provider: string; settings: { project?: string; region?: string } | null; limits?: unknown }[],
  now: Date = new Date(),
): AiAccount[] {
  const usable: { account: AiAccount; limited: boolean }[] = [];
  for (const r of rows) {
    const limited = atLimit(limitsFromRow(r.limits), now);
    if (r.provider === 'vertex' && r.settings?.project && r.settings.region) {
      usable.push({ account: { id: r.id, provider: 'vertex', project: r.settings.project, region: r.settings.region }, limited });
    } else if (r.provider === 'claude' || r.provider === 'anthropic') {
      usable.push({ account: { id: r.id, provider: r.provider }, limited });
    }
  }
  return [...usable.filter((u) => !u.limited), ...usable.filter((u) => u.limited)].map((u) => u.account);
}

/** What tokens cost on an account: list price for a key or Google Cloud; nothing per token on a subscription. */
export function costOf(account: AiAccount, model: string, tokens: TokenUsage): number | null {
  return account.provider === 'claude' ? null : estimateCostUsd(model, tokens);
}

/** The model agents talk with; ENGINE_CHAT_MODEL overrides it. */
export const CHAT_MODEL = process.env.ENGINE_CHAT_MODEL || 'claude-opus-5-5';

/** How many times one reply may go back to the model after running tools. */
export const MAX_TOOL_ROUNDS = 8;

/**
 * Streams with any Anthropic-shaped client. Chat is quick back-and-forth: low
 * effort (CHAT_EFFORT). When the model asks for tools, runs them and lets it go on, until it
 * answers or reaches MAX_TOOL_ROUNDS.
 *
 * Cached automatically: a turn's prefix (tools, system, the summary, the
 * messages so far) repeats from one request to the next until the summary is
 * rewritten (context.ts), so each request pays full price only for what is new.
 * The log line per reply shows how much was read from the cache.
 */
export function streamWith(client: Anthropic | AnthropicVertex): Writer {
  return async ({ system, messages, tools, onText, onTool, onUsage }) => {
    const history: Anthropic.MessageParam[] = messages.map((m) =>
      m.images?.length
        ? {
            role: m.role,
            content: [
              ...m.images.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mediaType, data: i.data } })),
              { type: 'text' as const, text: m.content },
            ],
          }
        : { role: m.role, content: m.content },
    );
    let used = NO_TOKENS;
    const done = () => {
      console.info(JSON.stringify({ message: 'chat usage', model: CHAT_MODEL, ...used }));
      onUsage?.({ model: CHAT_MODEL, effort: CHAT_EFFORT, tokens: used, limits: null });
    };
    let wrote = false;
    let gap = false; // a new round after tools: separate its text from what came before
    for (let round = 0; ; round++) {
      const stream = client.messages.stream({
        model: CHAT_MODEL,
        max_tokens: 8000,
        cache_control: { type: 'ephemeral' },
        system,
        messages: history,
        ...(tools.specs.length ? { tools: tools.specs as Anthropic.Tool[] } : {}),
        output_config: { effort: CHAT_EFFORT },
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
      used = addTokens(used, tokensFromUsage(final.usage));
      if (final.stop_reason === 'refusal') onText('\n\nEsto no puedo hacerlo.');
      if (final.stop_reason !== 'tool_use') return done();
      if (round >= MAX_TOOL_ROUNDS) {
        onText('\n\nHe llegado al límite de pasos para una respuesta. Dime si sigo.');
        return done();
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

/**
 * `cloudToken` is a token as the organisation's own Google Cloud account
 * (cloudAccounts.ts): Claude on Vertex AI is called as the organisation, so it
 * only reaches a project that organisation was let into.
 */
export function writerFactory(vault: Vault, cloudToken: (orgId: string) => Promise<string | null>, runClaude: PrintRunner = runClaudePrint) {
  return async (orgId: string, account: AiAccount, opts: { busyFails: boolean }): Promise<Writer> => {
    if (account.provider === 'vertex') {
      let accessToken: string | null;
      try {
        accessToken = await cloudToken(orgId);
      } catch (e) {
        if (e instanceof CloudAccountNotReady) throw new AiFailure('refused', 'the organisation’s Google Cloud account cannot be used');
        throw e;
      }
      if (!accessToken) throw new AiFailure('refused', 'the organisation has no Google Cloud account');
      return streamWith(new AnthropicVertex({ projectId: account.project, region: account.region, accessToken }));
    }
    const secret = await readAiSecret(vault, orgId, account);
    if (!secret) throw new AiFailure('refused', `the ${account.provider} account has nothing in the vault`);
    if (account.provider === 'claude') return subscriptionWriter(secret, runClaude, CHAT_MODEL, { busyFails: opts.busyFails });
    return streamWith(new Anthropic({ apiKey: secret }));
  };
}
