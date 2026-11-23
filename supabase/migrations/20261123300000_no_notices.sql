-- No «Avisos» (docs/plans/ongoing/three-tabs.md, decision 12): what an agent
-- does on its own lands in the private chat of every person who can see the
-- agent, not in a shared thread apart. Each person keeps their own unread
-- mark, and when they answer, the agent has the message in what it reads.

/**
 * A finished message from an agent in the personal chat of every member who
 * may see it (agent_level_for not 'none'), opening the chats that don't exist
 * yet. Returns how many chats it reached. For the engine (service role).
 */
create function public.post_to_personal_chats(target_agent uuid, body text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agents;
  member uuid;
  chat uuid;
  msg public.messages;
  reached integer := 0;
begin
  select * into a from public.agents x where x.id = target_agent;
  if not found then
    raise exception 'agent not found' using errcode = 'P0002';
  end if;
  if nullif(trim(body), '') is null then
    raise exception 'a message is required' using errcode = '22023';
  end if;

  for member in
    select m.user_id from public.memberships m
    where m.org_id = a.org_id and public.agent_level_for(a.id, m.user_id) <> 'none'
  loop
    insert into public.threads (org_id, agent_id, title, created_by, personal_of)
    values (a.org_id, a.id, a.name, null, member)
    on conflict (agent_id, personal_of) where personal_of is not null do nothing;
    select t.id into chat from public.threads t where t.agent_id = a.id and t.personal_of = member;

    insert into public.messages (thread_id, org_id, author_kind, author_agent, author_name, parts, state, finished_at)
    values (chat, a.org_id, 'agent', a.id, a.name, jsonb_build_array(jsonb_build_object('type', 'text', 'text', body)), 'done', clock_timestamp())
    returning * into msg;
    update public.threads set last_message_at = msg.created_at where id = chat;
    reached := reached + 1;
  end loop;
  return reached;
end;
$$;

revoke execute on function public.post_to_personal_chats(uuid, text) from public, anon, authenticated;
grant execute on function public.post_to_personal_chats(uuid, text) to service_role;

-- The «Avisos» threads there are move into those chats: each message with its
-- date, for every member who may see the agent today. What a person had read
-- of «Avisos» stays read.
do $$
declare
  n public.threads;
  member uuid;
  chat uuid;
  read_notices timestamptz;
begin
  for n in select * from public.threads t where t.notices loop
    for member in
      select m.user_id from public.memberships m
      where m.org_id = n.org_id and public.agent_level_for(n.agent_id, m.user_id) <> 'none'
    loop
      insert into public.threads (org_id, agent_id, title, created_by, personal_of)
      select n.org_id, n.agent_id, a.name, null, member from public.agents a where a.id = n.agent_id
      on conflict (agent_id, personal_of) where personal_of is not null do nothing;
      select t.id into chat from public.threads t where t.agent_id = n.agent_id and t.personal_of = member;

      insert into public.messages (thread_id, org_id, author_kind, author_user, author_agent, author_name, parts, state, steps, finished_at, created_at)
      select chat, m.org_id, m.author_kind, m.author_user, m.author_agent, m.author_name, m.parts, m.state, m.steps, m.finished_at, m.created_at
      from public.messages m
      where m.thread_id = n.id;

      -- A chat opened just now dates from its newest message, not from today.
      update public.threads t
      set last_message_at = coalesce((select max(m.created_at) from public.messages m where m.thread_id = chat), t.last_message_at)
      where t.id = chat;

      select r.read_at into read_notices from public.thread_reads r where r.thread_id = n.id and r.user_id = member;
      if read_notices is not null then
        insert into public.thread_reads (thread_id, user_id, org_id, read_at)
        values (chat, member, n.org_id, read_notices)
        on conflict (thread_id, user_id) do update set read_at = greatest(public.thread_reads.read_at, excluded.read_at);
      end if;
    end loop;
  end loop;
end;
$$;

delete from public.threads where notices;
drop index public.threads_one_notices_per_agent;

-- The thread list without «Avisos».
drop function public.my_threads(uuid, uuid);
alter table public.threads drop column notices;

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
  personal boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id, t.agent_id, t.title, t.created_at, t.last_message_at,
         lm.author_name, lm.text,
         coalesce(lm.author_user is distinct from auth.uid() and lm.created_at > coalesce(r.read_at, '-infinity'), false),
         t.personal_of is not null
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
