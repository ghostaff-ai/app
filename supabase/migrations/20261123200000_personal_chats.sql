-- One chat per person with each agent (docs/plans/ongoing/three-tabs.md,
-- decision 3): a tap on an agent in Equipo opens one long conversation, as in
-- WhatsApp, that only that person and the agent see. The titled, shared
-- threads of team-chat.md stay readable as they were; the agent's «Avisos»
-- thread stays shared and shows inside every personal chat.

alter table public.threads
  add column personal_of uuid references auth.users (id) on delete cascade;

create unique index threads_one_chat_per_person on public.threads (agent_id, personal_of) where personal_of is not null;

-- Someone else's personal chat is invisible: its thread, and through
-- thread_level its messages, which every policy and function below reads.
create or replace function public.thread_level(target_thread uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.agent_level(t.agent_id) from public.threads t
     where t.id = target_thread and (t.personal_of is null or t.personal_of = auth.uid())),
    'none');
$$;

drop policy "members read the threads of agents they may see" on public.threads;
create policy "members read the threads of agents they may see"
  on public.threads for select to authenticated
  using (
    public.is_member(org_id)
    and public.agent_level(agent_id) <> 'none'
    and (personal_of is null or personal_of = auth.uid())
  );

/** Writes in a thread the person may talk in: never in someone else's personal chat. */
create or replace function public.post_message(target_thread uuid, body text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.threads;
  me text;
  clean text := trim(body);
  msg public.messages;
begin
  select * into t from public.threads x where x.id = target_thread;
  if not found or public.thread_level(target_thread) <> 'talk' then
    raise exception 'you may not write in this thread' using errcode = '42501';
  end if;
  if nullif(clean, '') is null or length(clean) > 8000 then
    raise exception 'a message of up to 8000 characters is required' using errcode = '22023';
  end if;
  select m.display_name into me from public.memberships m where m.org_id = t.org_id and m.user_id = auth.uid();

  insert into public.messages (thread_id, org_id, author_kind, author_user, author_name, parts)
  values (t.id, t.org_id, 'person', auth.uid(), me, jsonb_build_array(jsonb_build_object('type', 'text', 'text', clean)))
  returning * into msg;
  update public.threads set last_message_at = msg.created_at where id = t.id;
  return msg;
end;
$$;

/**
 * Writes to an agent in the person's own chat with it, opening the chat with
 * the first message. Returns the message; its thread_id is the chat.
 */
create function public.chat_with(target_agent uuid, body text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agents;
  chat uuid;
begin
  select * into a from public.agents x where x.id = target_agent;
  if not found or public.agent_level(target_agent) <> 'talk' then
    raise exception 'you may not talk to this agent' using errcode = '42501';
  end if;
  insert into public.threads (org_id, agent_id, title, created_by, personal_of)
  values (a.org_id, a.id, a.name, auth.uid(), auth.uid())
  on conflict (agent_id, personal_of) where personal_of is not null do nothing;
  select t.id into chat from public.threads t where t.agent_id = a.id and t.personal_of = auth.uid();
  return public.post_message(chat, body);
end;
$$;

revoke execute on function public.chat_with(uuid, text) from public, anon;
grant execute on function public.chat_with(uuid, text) to authenticated;

-- The thread list says which thread is the person's chat and which the
-- agent's «Avisos», so Equipo can show one row per agent.
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
  personal boolean,
  notices boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id, t.agent_id, t.title, t.created_at, t.last_message_at,
         lm.author_name, lm.text,
         coalesce(lm.author_user is distinct from auth.uid() and lm.created_at > coalesce(r.read_at, '-infinity'), false),
         t.personal_of is not null, t.notices
  from public.threads t
  left join public.thread_reads r on r.thread_id = t.id and r.user_id = auth.uid()
  left join lateral (
    select m.author_name, m.author_user, m.created_at,
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
