-- What a chat agent reads on each turn (docs/plans/ongoing/agent-context.md):
-- never the whole conversation, which grows without end in one chat per agent,
-- but a summary of everything older, the latest messages word for word, and a
-- search over the rest.
--
-- The summary is the engine's: one per agent and conversation (each agent reads
-- the conversation as itself), rewritten as the conversation grows. It can carry
-- what the agent read with its tools (mail, sheets) that nobody else saw, so no
-- member reads it: row-level security on, no policy, no grant but the service role's.

create table public.conversation_summaries (
  thread_id uuid not null references public.threads (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  summary text not null check (length(summary) between 1 and 100000),
  -- The newest message it covers, and when it was written: the turn reads what came after.
  -- No foreign key: that message may be deleted (a routine's «nothing new»), the summary still holds.
  through_at timestamptz not null,
  through_message uuid not null,
  updated_at timestamptz not null default now(),
  primary key (thread_id, agent_id)
);

create index conversation_summaries_org_id on public.conversation_summaries (org_id);

alter table public.conversation_summaries enable row level security;
revoke all on table public.conversation_summaries from anon, authenticated;
grant select, insert, update, delete on table public.conversation_summaries to service_role;

/** Lower case, without accents: «Reunión» and «REUNION» match. */
create function public.plain_text(t text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(lower(t), 'áàäâéèëêíìïîóòöôúùüûñç', 'aaaaeeeeiiiioooouuuunc');
$$;

/**
 * The search an agent runs over its conversation's messages, for the engine:
 * the messages of `target_thread` whose text has every one of `words` (case
 * and accents aside; none for any), written in [since, until), newest first.
 * The engine checks who asks; members cannot call it.
 */
create function public.search_thread_messages(target_thread uuid, words text[], since timestamptz, until timestamptz, max_rows integer)
returns table (id uuid, author_kind text, author_name text, author_agent uuid, created_at timestamptz, body text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.author_kind, m.author_name, m.author_agent, m.created_at, b.body
  from public.messages m
  cross join lateral (
    select coalesce(string_agg(p ->> 'text', E'\n' order by n), '') as body
    from jsonb_array_elements(m.parts) with ordinality as e (p, n)
    where p ->> 'type' = 'text'
  ) b
  where m.thread_id = target_thread
    and m.state <> 'working'
    and (since is null or m.created_at >= since)
    and (until is null or m.created_at < until)
    and coalesce((
      select bool_and(strpos(public.plain_text(b.body), public.plain_text(w)) > 0)
      from unnest(words) w
      where length(trim(w)) > 0
    ), true)
  order by m.created_at desc
  limit least(greatest(coalesce(max_rows, 20), 1), 50);
$$;

revoke execute on function public.search_thread_messages(uuid, text[], timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.search_thread_messages(uuid, text[], timestamptz, timestamptz, integer) to service_role;

/**
 * Keeps a new summary only if it reaches further than the one stored: two
 * replies that summarise at once never put an older summary back. True when kept.
 */
create function public.save_conversation_summary(target_thread uuid, target_agent uuid, body text, covers_until timestamptz, last_message uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with kept as (
    insert into public.conversation_summaries (thread_id, agent_id, org_id, summary, through_at, through_message)
    select t.id, target_agent, t.org_id, body, covers_until, last_message
    from public.threads t
    join public.agents a on a.id = target_agent and a.org_id = t.org_id
    where t.id = target_thread
    on conflict (thread_id, agent_id) do update
      set summary = excluded.summary, through_at = excluded.through_at, through_message = excluded.through_message, updated_at = now()
      where public.conversation_summaries.through_at < excluded.through_at
    returning 1
  )
  select exists (select 1 from kept);
$$;

revoke execute on function public.save_conversation_summary(uuid, uuid, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.save_conversation_summary(uuid, uuid, text, timestamptz, uuid) to service_role;
