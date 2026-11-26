-- Model routing, phase 0: measure before changing any model (docs/plans/
-- ongoing/model-routing.md). `ai_usage` already keeps a row per reply or run
-- with its model, tokens (cached and not) and cost; it learns which reply or
-- run it paid for, at what effort and tier, so the outcome can be joined to it.
-- An action card keeps what the agent drafted when a person edits it before
-- approving («Editar»), which is the «edited» outcome.

alter table public.ai_usage
  -- The agent's message it paid for (a chat reply, or the message a run answers in).
  add column message_id uuid references public.messages (id) on delete set null,
  add column run_id uuid references public.agent_runs (id) on delete set null,
  add column effort text check (effort in ('low', 'medium', 'high', 'xhigh', 'max')),
  -- The tier the model policy chose; null until it routes anything (phase 1).
  add column tier text check (tier in ('light', 'standard', 'deep'));

create index ai_usage_message on public.ai_usage (message_id) where message_id is not null;

-- What the agent proposed, kept only when a person changed it before approving;
-- `input` is then what ran.
alter table public.agent_actions
  add column drafted_input jsonb check (drafted_input is null or jsonb_typeof(drafted_input) = 'object');

/**
 * What became of each reply that answered (since a day, Madrid): its cost and
 * tokens, and what a person did next.
 *   accepted / edited / rejected: a card in it was approved as drafted, approved
 *     after «Editar», or rejected (the worst of its cards when it has several);
 *   followed_up: no card decided, and a person wrote next in the conversation,
 *     `next_message_id` after `seconds_to_next` (phase 1 classifies that message:
 *     accepted, asked again or took over);
 *   none: nothing yet.
 * Runs as the caller, so row-level security keeps it to replies in
 * conversations they see, in their own organisation.
 */
create function public.ai_reply_outcomes(target_org uuid, since date)
returns table (
  usage_id uuid,
  agent_id uuid,
  source text,
  message_id uuid,
  run_id uuid,
  model text,
  effort text,
  tier text,
  input_tokens bigint,
  output_tokens bigint,
  cache_read_tokens bigint,
  cache_write_tokens bigint,
  cost_usd numeric,
  at timestamptz,
  outcome text,
  next_message_id uuid,
  seconds_to_next integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    u.id, u.agent_id, u.source, u.message_id, u.run_id, u.model, u.effort, u.tier,
    u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_write_tokens, u.cost_usd, u.at,
    case
      when card.rejected then 'rejected'
      when card.edited then 'edited'
      when card.approved then 'accepted'
      when nxt.id is not null then 'followed_up'
      else 'none'
    end,
    case when card.rejected or card.edited or card.approved then null else nxt.id end,
    case when card.rejected or card.edited or card.approved then null
         else greatest(0, extract(epoch from nxt.created_at - u.at))::integer end
  from public.ai_usage u
  join public.messages m on m.id = u.message_id
  cross join lateral (
    select
      coalesce(bool_or(a.status = 'rejected'), false) as rejected,
      coalesce(bool_or(a.status <> 'pending' and a.status <> 'rejected' and a.drafted_input is not null), false) as edited,
      coalesce(bool_or(a.status <> 'pending' and a.status <> 'rejected'), false) as approved
    from public.agent_actions a
    where a.message_id = u.message_id
  ) card
  left join lateral (
    select n.id, n.created_at
    from public.messages n
    where n.thread_id = m.thread_id and n.author_kind = 'person' and n.created_at > u.at
    order by n.created_at
    limit 1
  ) nxt on true
  where u.org_id = target_org
    and u.outcome = 'ok'
    and u.at >= (since::timestamp at time zone 'Europe/Madrid')
$$;

revoke execute on function public.ai_reply_outcomes(uuid, date) from public, anon;
grant execute on function public.ai_reply_outcomes(uuid, date) to authenticated, service_role;
