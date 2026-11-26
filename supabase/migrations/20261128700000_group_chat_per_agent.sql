-- One chat per agent, shared like a WhatsApp group
-- (docs/plans/ongoing/group-chat-per-agent.md, Jaime 2026-11-26). Everyone who
-- may see an agent reads its one chat; everyone who may talk to it writes
-- there, each message signed by its author. It reverses three-tabs.md
-- decisions 3 (a private chat per person and agent) and 12 (a copy per person
-- of what the agent does alone), and chat-permissions.md (each conversation's
-- own visibility): the level on the agent is the only rule left.
--
-- What exists folds in, by date: the personal chats, the titled conversations
-- and their marks, actions, asks, guides, runs and pushes. The agent's own
-- copies, one per person, are kept once.

-- No pushes from the fold itself: failing a stale reply below would send one.
alter table public.messages disable trigger messages_notify;

-- The fold ---------------------------------------------------------------------

-- A thread holds one reply being written at a time
-- (messages_one_working_per_thread): per agent, every «working» message but
-- the newest has long been abandoned.
update public.messages m
set state = 'failed', finished_at = coalesce(m.finished_at, now())
where m.state = 'working'
  and m.id <> (
    select w.id from public.messages w
    join public.threads wt on wt.id = w.thread_id
    where wt.agent_id = (select t.agent_id from public.threads t where t.id = m.thread_id)
      and w.state = 'working'
    order by w.created_at desc, w.id desc
    limit 1
  );

-- Each agent keeps its oldest thread; every other one folds into it.
create temporary table group_chat_fold as
select t.id as old_id,
       first_value(t.id) over (partition by t.agent_id order by t.created_at, t.id) as keep_id
from public.threads t;
delete from group_chat_fold where old_id = keep_id;

update public.messages x set thread_id = f.keep_id from group_chat_fold f where x.thread_id = f.old_id;
update public.agent_actions x set thread_id = f.keep_id from group_chat_fold f where x.thread_id = f.old_id;
update public.account_asks x set thread_id = f.keep_id from group_chat_fold f where x.thread_id = f.old_id;
update public.guides x set thread_id = f.keep_id from group_chat_fold f where x.thread_id = f.old_id;
update public.agent_runs x set thread_id = f.keep_id from group_chat_fold f where x.thread_id = f.old_id;
update public.push_outbox x set thread_id = f.keep_id from group_chat_fold f where x.thread_id = f.old_id;

-- What a person had read stays read: their latest mark on any of the agent's threads.
insert into public.thread_reads (thread_id, user_id, org_id, read_at)
select f.keep_id, r.user_id, r.org_id, max(r.read_at)
from public.thread_reads r
join group_chat_fold f on f.old_id = r.thread_id
group by f.keep_id, r.user_id, r.org_id
on conflict (thread_id, user_id) do update set read_at = greatest(public.thread_reads.read_at, excluded.read_at);

delete from public.threads t using group_chat_fold f where t.id = f.old_id;
drop table group_chat_fold;

-- What each agent summarised of a conversation covered that conversation
-- alone (agent-context.md): a folded chat has messages from the others it
-- never read, older than what it covers. The summaries start again.
delete from public.conversation_summaries;

-- The agent's own copies, once ---------------------------------------------------
-- A message nothing points at (no action, ask, guide or run) that repeats an
-- earlier one of the same agent: a routine's answer copied to others within the
-- hour of its firing (routines fire once a day at most), or the same words of
-- the agent within a minute (one copy per person of what it did alone).

delete from public.messages m
where m.author_kind = 'agent'
  and m.state <> 'working'
  and not exists (select 1 from public.agent_actions x where x.message_id = m.id)
  and not exists (select 1 from public.account_asks x where x.message_id = m.id)
  and not exists (select 1 from public.guides x where x.message_id = m.id)
  and not exists (select 1 from public.agent_runs x where x.message_id = m.id)
  and exists (
    select 1 from public.messages k
    where k.thread_id = m.thread_id
      and k.author_kind = 'agent'
      and k.author_agent is not distinct from m.author_agent
      and (k.created_at, k.id) < (m.created_at, m.id)
      and (
        (m.routine_id is not null and k.routine_id = m.routine_id and m.created_at - k.created_at < interval '1 hour')
        or (k.parts = m.parts and m.created_at - k.created_at < interval '1 minute')
      )
  );

-- Each chat is titled with its agent's name and dates from its newest message.
update public.threads t
set title = left(a.name, 120),
    last_message_at = coalesce((select max(m.created_at) from public.messages m where m.thread_id = t.id), t.last_message_at)
from public.agents a
where a.id = t.agent_id;

alter table public.messages enable trigger messages_notify;

-- The shape --------------------------------------------------------------------

drop function public.start_thread(uuid, text, text, text);
drop function public.set_conversation_visibility(uuid, text);
drop function public.conversation_readers(uuid);
drop function public.set_agent_chat_default(uuid, text);
drop function public.post_to_personal_chats(uuid, text);
drop function public.post_routine_copies(uuid, text, uuid);

drop index public.threads_one_chat_per_person;
alter table public.threads drop constraint threads_personal_chats_are_private;
alter table public.threads drop column personal_of;
alter table public.threads drop column visibility;
alter table public.agents drop column chat_default;

create unique index threads_one_per_agent on public.threads (agent_id);

-- The queue (decision 5): a message written while the agent answers someone
-- else waits, and is answered after, one at a time, in order. A reply names
-- the person's message it answers, so the engine knows which come after it;
-- what the agent writes on its own answers none.
alter table public.messages
  add column reply_to uuid references public.messages (id) on delete set null;

-- The rule ---------------------------------------------------------------------

/**
 * A member's level on an agent's chat: their level on the agent. For the
 * engine (service role), which acts with the rights of whoever asked;
 * thread_level() is it for the signed-in person.
 */
create or replace function public.thread_level_for(target_thread uuid, member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.agent_level_for(t.agent_id, member) from public.threads t where t.id = target_thread),
    'none');
$$;

/** An agent's chat, opened the first time anyone or anything writes in it. Returns its id. */
create function public.agent_chat(target_agent uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agents;
  chat uuid;
begin
  select * into a from public.agents x where x.id = target_agent;
  if not found then
    raise exception 'agent not found' using errcode = 'P0002';
  end if;
  insert into public.threads (org_id, agent_id, title, created_by)
  values (a.org_id, a.id, left(a.name, 120), auth.uid())
  on conflict (agent_id) do nothing;
  select t.id into chat from public.threads t where t.agent_id = a.id;
  return chat;
end;
$$;

revoke execute on function public.agent_chat(uuid) from public, anon, authenticated;
grant execute on function public.agent_chat(uuid) to service_role;

-- Writing --------------------------------------------------------------------------

/** Writes to an agent in its chat, opening the chat with the first message. Returns the message. */
create or replace function public.chat_with(target_agent uuid, body text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.agents x where x.id = target_agent) or public.agent_level(target_agent) <> 'talk' then
    raise exception 'you may not talk to this agent' using errcode = '42501';
  end if;
  return public.post_message(public.agent_chat(target_agent), body);
end;
$$;

/**
 * «Preguntar» on a decision (decision-model.md, decision 7): the person writes
 * to the agent that asked, in its chat, with the decision quoted above their
 * words. Same rights as chat_with.
 */
create or replace function public.ask_about_decision(target_decision uuid, body text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.decisions;
  a public.agents;
  chat uuid;
  me text;
  clean text := trim(body);
  msg public.messages;
begin
  select * into d from public.decisions x where x.id = target_decision;
  if not found or not public.is_member(d.org_id) then
    raise exception 'decision not found' using errcode = 'P0002';
  end if;
  select * into a from public.agents x where x.id = d.agent_id and x.org_id = d.org_id;
  if not found then
    raise exception 'no agent to ask about this decision' using errcode = '22023';
  end if;
  if public.agent_level(a.id) <> 'talk' then
    raise exception 'you may not talk to this agent' using errcode = '42501';
  end if;
  if nullif(clean, '') is null or length(clean) > 8000 then
    raise exception 'a message of up to 8000 characters is required' using errcode = '22023';
  end if;

  chat := public.agent_chat(a.id);
  select m.display_name into me from public.memberships m where m.org_id = a.org_id and m.user_id = auth.uid();

  insert into public.messages (thread_id, org_id, author_kind, author_user, author_name, parts)
  values (chat, a.org_id, 'person', auth.uid(), me, jsonb_build_array(
    jsonb_build_object('type', 'decision_quote', 'decisionId', d.id, 'question', d.question),
    jsonb_build_object('type', 'text', 'text', clean)))
  returning * into msg;
  update public.threads set last_message_at = msg.created_at where id = chat;
  return msg;
end;
$$;

/**
 * A finished message from an agent in its chat: what it did on its own (a
 * report, a failed run), once for everyone who sees the agent. Returns the
 * message's id. For the engine (service role).
 */
create function public.post_to_agent_chat(target_agent uuid, body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agents;
  chat uuid;
  msg public.messages;
begin
  select * into a from public.agents x where x.id = target_agent;
  if not found then
    raise exception 'agent not found' using errcode = 'P0002';
  end if;
  if nullif(trim(body), '') is null then
    raise exception 'a message is required' using errcode = '22023';
  end if;
  chat := public.agent_chat(a.id);
  insert into public.messages (thread_id, org_id, author_kind, author_agent, author_name, parts, state, finished_at)
  values (chat, a.org_id, 'agent', a.id, a.name, jsonb_build_array(jsonb_build_object('type', 'text', 'text', body)), 'done', clock_timestamp())
  returning * into msg;
  update public.threads set last_message_at = msg.created_at where id = chat;
  return msg.id;
end;
$$;

revoke execute on function public.post_to_agent_chat(uuid, text) from public, anon, authenticated;
grant execute on function public.post_to_agent_chat(uuid, text) to service_role;

/** A word from the organisation's main agent in its chat (a routine paused, say). Returns 1, or 0 without one. */
create or replace function public.notify_owners(target_org uuid, body text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agents;
begin
  select * into a from public.agents x where x.org_id = target_org and x.is_main;
  if not found then
    return 0;
  end if;
  perform public.post_to_agent_chat(a.id, body);
  return 1;
end;
$$;

-- Following, the list and pushes ------------------------------------------------

/**
 * Whether a member follows an agent's chat: they read it, wrote in it or were
 * @mentioned in it (as a whole name: «@Ana» isn't «@Anabel»). Runs as the
 * caller, so a person asking about someone else learns only what they could
 * read anyway (never another's read marks); the trigger and the engine see all.
 */
create or replace function public.follows_thread(target_thread uuid, member uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.threads t
    where t.id = target_thread
      and (
        exists (select 1 from public.thread_reads r where r.thread_id = t.id and r.user_id = member)
        or exists (select 1 from public.messages m where m.thread_id = t.id and m.author_user = member)
        or exists (
          select 1 from public.memberships me, public.messages m, jsonb_array_elements(m.parts) p
          where me.org_id = t.org_id and me.user_id = member
            and nullif(trim(me.display_name), '') is not null
            and m.thread_id = t.id and p->>'type' = 'text'
            -- «@Ana» but not «@Anabel»: the name, its regex characters escaped, then no letter.
            and p->>'text' ~* ('@' || regexp_replace(me.display_name, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '($|[^[:alnum:]_])')
        )
      )
  );
$$;

-- One chat per agent the person sees, with its newest word. Unread compares the
-- read mark with when the last message was finished, not started.
drop function public.my_threads(uuid, uuid);
create function public.my_threads(target_org uuid, target_agent uuid default null)
returns table (
  id uuid,
  agent_id uuid,
  title text,
  created_at timestamptz,
  last_message_at timestamptz,
  last_author text,
  last_text text,
  unread boolean,
  following boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id, t.agent_id, t.title, t.created_at, t.last_message_at,
         lm.author_name, lm.text,
         coalesce(lm.author_user is distinct from auth.uid()
                  and coalesce(lm.finished_at, lm.created_at) > coalesce(r.read_at, '-infinity'), false),
         public.follows_thread(t.id, auth.uid())
  from public.threads t
  left join public.thread_reads r on r.thread_id = t.id and r.user_id = auth.uid()
  left join lateral (
    select m.author_name, m.author_user, m.created_at, m.finished_at,
           (select string_agg(p->>'text', ' ') from jsonb_array_elements(m.parts) p where p->>'type' = 'text') as text
    from public.messages m
    where m.thread_id = t.id
    order by m.created_at desc
    limit 1
  ) lm on true
  where t.org_id = target_org and (target_agent is null or t.agent_id = target_agent)
  order by t.last_message_at desc
  limit 200;
$$;

revoke execute on function public.my_threads(uuid, uuid) from public, anon;
grant execute on function public.my_threads(uuid, uuid) to authenticated;

/**
 * When an agent message is finished (inserted done or failed, or leaving
 * «working»), queues a reply push for each person who sees the agent's chat,
 * follows it and has a phone (group-chat-per-agent.md, decision 7). Whether
 * they read it since is checked when the engine claims it.
 */
create or replace function public.messages_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.threads;
begin
  if new.author_kind <> 'agent' or new.state not in ('done', 'failed')
     or (tg_op = 'UPDATE' and old.state is distinct from 'working') then
    return null;
  end if;
  select * into t from public.threads x where x.id = new.thread_id;

  insert into public.push_outbox (user_id, org_id, kind, thread_id, message_id, title, body, data, collapse_id)
  select m.user_id, t.org_id, 'reply', t.id, new.id, new.author_name,
         case new.state when 'done' then 'Te ha contestado' else 'No ha podido acabar' end,
         jsonb_build_object('kind', 'reply', 'orgId', t.org_id, 'route', '/chat/' || t.agent_id),
         t.id::text
  from public.memberships m
  where m.org_id = t.org_id
    and public.follows_thread(t.id, m.user_id)
    and public.thread_level_for(t.id, m.user_id) <> 'none'
    and exists (select 1 from public.device_tokens d where d.user_id = m.user_id)
  on conflict do nothing;
  return null;
end;
$$;

-- Voice notes ------------------------------------------------------------------------

-- A note is heard by whoever may read its message's chat. Its folder still
-- names the thread it was recorded in, which the fold may have removed: the
-- message decides, not the folder.
create or replace function public.can_hear_voice_note(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$'
      then coalesce((
        select public.thread_level(m.thread_id) <> 'none'
        from public.messages m
        where m.id = split_part(split_part(object_name, '/', 3), '.', 1)::uuid
          and m.org_id = split_part(object_name, '/', 1)::uuid
      ), false)
    else false
  end;
$$;
