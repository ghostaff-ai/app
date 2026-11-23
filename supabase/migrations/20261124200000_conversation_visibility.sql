-- Who reads and writes a conversation (docs/plans/ongoing/chat-permissions.md):
-- whoever opens it decides, owner or not, and the agent's levels stay the
-- ceiling.
--
--   private  only the opener (and the agent);
--   read     also everyone who may see the agent, reading only;
--   write    also everyone who may see the agent, each by their level on it.
--
-- A person's chat with an agent (personal_of) is always private. An owner
-- doesn't see someone else's private conversation either. Only the opener
-- changes a conversation's visibility; an owner sets each agent's default for
-- new ones.

alter table public.threads
  add column visibility text not null default 'private' check (visibility in ('private', 'read', 'write'));

-- The shared threads of before were read and written by level: that is «write».
update public.threads set visibility = 'write' where personal_of is null;

alter table public.threads
  add constraint threads_personal_chats_are_private check (personal_of is null or visibility = 'private');

alter table public.agents
  add column chat_default text not null default 'private' check (chat_default in ('private', 'read', 'write'));

-- The rule ----------------------------------------------------------------

/**
 * A member's level on a conversation: their level on its agent, lowered to
 * what the conversation lets others do. The one rule; thread_level() is it for
 * the signed-in person. For the engine (service role), which acts with the
 * rights of whoever asked.
 */
create function public.thread_level_for(target_thread uuid, member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when t.personal_of is not null then
        case when t.personal_of = member then public.agent_level_for(t.agent_id, member) else 'none' end
      when t.created_by = member then public.agent_level_for(t.agent_id, member)
      when t.visibility = 'private' then 'none'
      when t.visibility = 'read' then
        case when public.agent_level_for(t.agent_id, member) = 'none' then 'none' else 'read' end
      else public.agent_level_for(t.agent_id, member)
    end
    from public.threads t
    where t.id = target_thread
  ), 'none');
$$;

revoke execute on function public.thread_level_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.thread_level_for(uuid, uuid) to service_role;

create or replace function public.thread_level(target_thread uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.thread_level_for(target_thread, auth.uid());
$$;

-- Messages, read marks and post_message already read thread_level(); the
-- threads themselves now do too, instead of repeating the rule.
drop policy "members read the threads of agents they may see" on public.threads;
create policy "members read the conversations they may see"
  on public.threads for select to authenticated
  using (public.is_member(org_id) and public.thread_level(id) <> 'none');

-- Opening and changing a conversation ---------------------------------------

drop function public.start_thread(uuid, text, text);

/**
 * Opens a titled conversation with an agent the person may talk to, with
 * their first message. Without a visibility it takes the agent's default.
 */
create function public.start_thread(target_agent uuid, body text, title text default null, visibility text default null)
returns public.threads
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agents;
  me text;
  clean text := trim(body);
  t public.threads;
begin
  select * into a from public.agents x where x.id = target_agent;
  if not found or public.agent_level(target_agent) <> 'talk' then
    raise exception 'you may not talk to this agent' using errcode = '42501';
  end if;
  if visibility is not null and visibility not in ('private', 'read', 'write') then
    raise exception 'visibility must be private, read or write' using errcode = '22023';
  end if;
  if nullif(clean, '') is null or length(clean) > 8000 then
    raise exception 'a message of up to 8000 characters is required' using errcode = '22023';
  end if;
  select m.display_name into me from public.memberships m where m.org_id = a.org_id and m.user_id = auth.uid();

  insert into public.threads (org_id, agent_id, title, created_by, visibility)
  values (a.org_id, a.id, left(coalesce(nullif(trim(title), ''), regexp_replace(clean, '\s+', ' ', 'g')), 120), auth.uid(),
          coalesce(visibility, a.chat_default))
  returning * into t;
  insert into public.messages (thread_id, org_id, author_kind, author_user, author_name, parts)
  values (t.id, t.org_id, 'person', auth.uid(), me, jsonb_build_array(jsonb_build_object('type', 'text', 'text', clean)));
  return t;
end;
$$;

revoke execute on function public.start_thread(uuid, text, text, text) from public, anon;
grant execute on function public.start_thread(uuid, text, text, text) to authenticated;

/**
 * The opener changes who reads or writes their conversation. Making it private
 * again, once someone else has written in it, would hide from them what they
 * wrote: then it can only be closed to reading.
 */
create function public.set_conversation_visibility(target_thread uuid, new_visibility text)
returns public.threads
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.threads;
begin
  select * into t from public.threads x where x.id = target_thread for update;
  if not found or public.thread_level(target_thread) = 'none' then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  if t.personal_of is not null or t.created_by is distinct from auth.uid() then
    raise exception 'only whoever opened a conversation decides who sees it' using errcode = '42501';
  end if;
  if new_visibility is null or new_visibility not in ('private', 'read', 'write') then
    raise exception 'visibility must be private, read or write' using errcode = '22023';
  end if;
  if new_visibility = 'private' and t.visibility <> 'private' and exists (
    select 1 from public.messages m
    where m.thread_id = t.id and m.author_kind = 'person' and m.author_user is distinct from auth.uid()
  ) then
    raise exception 'others have written in it: it can be closed to reading, not made private' using errcode = '55000';
  end if;

  update public.threads set visibility = new_visibility where id = t.id returning * into t;
  return t;
end;
$$;

revoke execute on function public.set_conversation_visibility(uuid, text) from public, anon;
grant execute on function public.set_conversation_visibility(uuid, text) to authenticated;

/** How many people read a conversation, its opener included, for anyone who reads it. */
create function public.conversation_readers(target_thread uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.threads;
begin
  select * into t from public.threads x where x.id = target_thread;
  if not found or public.thread_level(target_thread) = 'none' then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  return (
    select count(*)::integer from public.memberships m
    where m.org_id = t.org_id and public.thread_level_for(t.id, m.user_id) <> 'none'
  );
end;
$$;

revoke execute on function public.conversation_readers(uuid) from public, anon;
grant execute on function public.conversation_readers(uuid) to authenticated;

/** An owner sets who reads new conversations with an agent unless the opener says otherwise. */
create function public.set_agent_chat_default(target_agent uuid, new_default text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_org uuid;
begin
  select a.org_id into target_org from public.agents a where a.id = target_agent;
  if not found or not public.is_owner(target_org) then
    raise exception 'only an owner sets an agent''s default' using errcode = '42501';
  end if;
  if new_default is null or new_default not in ('private', 'read', 'write') then
    raise exception 'the default must be private, read or write' using errcode = '22023';
  end if;
  update public.agents set chat_default = new_default where id = target_agent;
end;
$$;

revoke execute on function public.set_agent_chat_default(uuid, text) from public, anon;
grant execute on function public.set_agent_chat_default(uuid, text) to authenticated;

-- The list ------------------------------------------------------------------

-- Each conversation says who sees it, whether the person opened it, and
-- whether they follow it (opened, wrote, read or were @mentioned in it): Equipo
-- shows the titled conversations they follow, the agent's page all of them.
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
  visibility text,
  mine boolean,
  following boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (
    select m.display_name from public.memberships m where m.org_id = target_org and m.user_id = auth.uid()
  )
  select t.id, t.agent_id, t.title, t.created_at, t.last_message_at,
         lm.author_name, lm.text,
         coalesce(lm.author_user is distinct from auth.uid() and lm.created_at > coalesce(r.read_at, '-infinity'), false),
         t.personal_of is not null,
         t.visibility,
         coalesce(t.personal_of = auth.uid() or t.created_by = auth.uid(), false),
         coalesce(t.personal_of = auth.uid() or t.created_by = auth.uid(), false)
           or r.read_at is not null
           or exists (select 1 from public.messages m where m.thread_id = t.id and m.author_user = auth.uid())
           or exists (
             select 1 from public.messages m, me, jsonb_array_elements(m.parts) p
             where m.thread_id = t.id and p->>'type' = 'text'
               and position(lower('@' || me.display_name) in lower(p->>'text')) > 0
           )
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
