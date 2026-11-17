-- The team chat, its data and who may use it (docs/plans/ongoing/team-chat.md).
--
-- Each member has one of three levels on each agent of their organisation:
--   none  doesn't see the agent, its threads or its messages;
--   read  sees them;
--   talk  also starts threads and writes in them.
-- An owner always talks. A member without a row of their own gets the agent's
-- member_default: 'talk' for Secretaría (everyone's way in, decision #2 of
-- app-design.md), 'read' for the rest (team-chat.md, decision 7). Only owners
-- set levels, per agent and person, or per agent when inviting someone.
--
-- Threads and messages belong to one agent and follow its levels. The app
-- writes them only through start_thread and post_message; the engine writes
-- the agent's messages with the service role, and acts with the rights of the
-- person who asked (it never passes work to an agent that person can't talk to).

-- Levels -------------------------------------------------------------------

alter table public.agents
  add column member_default text not null default 'read' check (member_default in ('none', 'read', 'talk'));

update public.agents set member_default = 'talk' where ghost = 'secretaria';

create table public.agent_access (
  agent_id uuid not null references public.agents (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  level text not null check (level in ('none', 'read', 'talk')),
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (agent_id, user_id)
);

create index agent_access_org_id on public.agent_access (org_id);

alter table public.agent_access enable row level security;

create policy "owners read their organisation's levels, members their own"
  on public.agent_access for select to authenticated
  using (public.is_owner(org_id) or user_id = auth.uid());

revoke insert, update, delete, truncate on public.agent_access from anon, authenticated;

/** The signed-in person's level on an agent: 'none' for an agent of another organisation or none at all. */
create function public.agent_level(target_agent uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when m.role = 'owner' then 'talk'
      else coalesce(x.level, a.member_default)
    end
    from public.agents a
    join public.memberships m on m.org_id = a.org_id and m.user_id = auth.uid()
    left join public.agent_access x on x.agent_id = a.id and x.user_id = auth.uid()
    where a.id = target_agent
  ), 'none');
$$;

revoke execute on function public.agent_level(uuid) from public, anon;
grant execute on function public.agent_level(uuid) to authenticated;

-- A member with 'none' doesn't see the agent at all.
drop policy "members read their organisation's agents" on public.agents;
create policy "members read the agents they may see"
  on public.agents for select to authenticated
  using (public.is_member(org_id) and public.agent_level(id) <> 'none');

/** An owner sets one member's level on one agent. */
create function public.set_agent_access(target_agent uuid, member uuid, new_level text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_org uuid;
  member_role text;
begin
  select a.org_id into target_org from public.agents a where a.id = target_agent;
  if not found or not public.is_owner(target_org) then
    raise exception 'only an owner sets who may use an agent' using errcode = '42501';
  end if;
  if new_level is null or new_level not in ('none', 'read', 'talk') then
    raise exception 'level must be none, read or talk' using errcode = '22023';
  end if;
  select m.role into member_role from public.memberships m where m.org_id = target_org and m.user_id = member;
  if not found then
    raise exception 'not a member of this organisation' using errcode = '22023';
  end if;
  if member_role = 'owner' then
    raise exception 'an owner always talks to every agent' using errcode = '22023';
  end if;

  insert into public.agent_access (agent_id, user_id, org_id, level, set_by)
  values (target_agent, member, target_org, new_level, auth.uid())
  on conflict (agent_id, user_id)
  do update set level = excluded.level, set_by = excluded.set_by, set_at = now();
end;
$$;

revoke execute on function public.set_agent_access(uuid, uuid, text) from public, anon;
grant execute on function public.set_agent_access(uuid, uuid, text) to authenticated;

/** Every member of the agent's organisation with their level on it, for its owners. */
create function public.list_agent_access(target_agent uuid)
returns table (user_id uuid, display_name text, role text, level text, is_default boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.agents;
begin
  select * into a from public.agents x where x.id = target_agent;
  if not found or not public.is_owner(a.org_id) then
    raise exception 'only an owner sees who may use an agent' using errcode = '42501';
  end if;
  return query
    select m.user_id, m.display_name, m.role,
           case when m.role = 'owner' then 'talk' else coalesce(x.level, a.member_default) end,
           m.role <> 'owner' and x.level is null
    from public.memberships m
    left join public.agent_access x on x.agent_id = a.id and x.user_id = m.user_id
    where m.org_id = a.org_id
    order by m.role = 'owner' desc, m.display_name;
end;
$$;

revoke execute on function public.list_agent_access(uuid) from public, anon;
grant execute on function public.list_agent_access(uuid) to authenticated;

/** The signed-in person's level on each agent of an organisation they may see. */
create function public.my_agent_levels(target_org uuid)
returns table (agent_id uuid, level text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, public.agent_level(a.id)
  from public.agents a
  where a.org_id = target_org and public.agent_level(a.id) <> 'none';
$$;

revoke execute on function public.my_agent_levels(uuid) from public, anon;
grant execute on function public.my_agent_levels(uuid) to authenticated;

-- Secretaría talks to everyone by default; every other agent is read-only for
-- members until an owner says otherwise.
create or replace function public.create_agent(target_org uuid, name text, ghost text, department text)
returns public.agents
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agents;
begin
  if not public.is_owner(target_org) then
    raise exception 'only an owner adds agents' using errcode = '42501';
  end if;
  if nullif(trim(name), '') is null or length(trim(name)) > 60 then
    raise exception 'a name of up to 60 characters is required' using errcode = '22023';
  end if;
  -- A ceiling so one organisation cannot fill the table.
  if (select count(*) from public.agents x where x.org_id = target_org) >= 50 then
    raise exception 'too many agents' using errcode = '54000';
  end if;

  insert into public.agents (org_id, name, ghost, department, created_by, member_default)
  values (target_org, trim(name), ghost, department, auth.uid(),
          case when ghost = 'secretaria' then 'talk' else 'read' end)
  returning * into a;
  return a;
end;
$$;

-- Invitations carry the levels the owner chose, applied when accepted --------

alter table public.invitations
  add column agent_levels jsonb not null default '{}'::jsonb check (jsonb_typeof(agent_levels) = 'object');

drop function public.invite_member(uuid, text, text);

create function public.invite_member(
  target_org uuid,
  invitee_email text,
  invitee_role text default 'member',
  agent_levels jsonb default '{}'::jsonb
)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  inviter text;
  clean text := lower(trim(invitee_email));
  levels jsonb := coalesce(agent_levels, '{}'::jsonb);
  i public.invitations;
begin
  if not public.is_owner(target_org) then
    raise exception 'only an owner invites' using errcode = '42501';
  end if;
  if invitee_role not in ('owner', 'member') then
    raise exception 'role must be owner or member' using errcode = '22023';
  end if;
  if clean !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'not an email' using errcode = '22023';
  end if;
  if jsonb_typeof(levels) <> 'object' or exists (
    select 1 from jsonb_each(levels) e
    where jsonb_typeof(e.value) <> 'string'
       or e.value #>> '{}' not in ('none', 'read', 'talk')
       or not exists (select 1 from public.agents a where a.id::text = e.key and a.org_id = target_org)
  ) then
    raise exception 'agent levels must name this organisation''s agents with none, read or talk' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.memberships m join auth.users u on u.id = m.user_id
    where m.org_id = target_org and lower(u.email) = clean
  ) then
    raise exception 'already a member' using errcode = '23505';
  end if;

  select m.display_name into inviter
  from public.memberships m where m.org_id = target_org and m.user_id = auth.uid();

  insert into public.invitations (org_id, email, role, invited_by, invited_by_name, agent_levels)
  values (target_org, clean, invitee_role, auth.uid(), inviter, levels)
  on conflict (org_id, email) where accepted_at is null
  do update set role = excluded.role, invited_by = excluded.invited_by,
                invited_by_name = excluded.invited_by_name, agent_levels = excluded.agent_levels,
                created_at = now()
  returning * into i;
  return i;
end;
$$;

revoke execute on function public.invite_member(uuid, text, text, jsonb) from public, anon;
grant execute on function public.invite_member(uuid, text, text, jsonb) to authenticated;

create or replace function public.accept_invitation(invitation_id uuid)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  i public.invitations;
  o public.organizations;
begin
  select * into me from public.profiles where user_id = auth.uid();
  if not found then
    raise exception 'profile first' using errcode = '42501';
  end if;
  select * into i from public.invitations
  where id = invitation_id and accepted_at is null and email = public.my_email()
  for update;
  if not found then
    -- Same error for someone else's invitation: nothing learnt about it.
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;

  insert into public.memberships (org_id, user_id, role, display_name)
  values (i.org_id, auth.uid(), i.role, me.full_name)
  on conflict (org_id, user_id) do nothing;

  -- The levels chosen when inviting, for the agents still on the team. An
  -- owner always talks, so theirs are not stored.
  if i.role = 'member' then
    insert into public.agent_access (agent_id, user_id, org_id, level, set_by)
    select a.id, auth.uid(), i.org_id, e.value, i.invited_by
    from jsonb_each_text(i.agent_levels) e
    join public.agents a on a.id::text = e.key and a.org_id = i.org_id
    where e.value in ('none', 'read', 'talk')
    on conflict (agent_id, user_id) do nothing;
  end if;

  update public.invitations set accepted_at = now() where id = i.id;

  select * into o from public.organizations where id = i.org_id;
  return o;
end;
$$;

-- Threads and messages ------------------------------------------------------

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  -- One topic per thread; the agent may retitle it once it has read it.
  title text not null check (title = trim(title) and length(title) between 1 and 120),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index threads_agent_recent on public.threads (agent_id, last_message_at desc);
create index threads_org_id on public.threads (org_id);

alter table public.threads enable row level security;

create policy "members read the threads of agents they may see"
  on public.threads for select to authenticated
  using (public.is_member(org_id) and public.agent_level(agent_id) <> 'none');

revoke insert, update, delete, truncate on public.threads from anon, authenticated;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  author_kind text not null check (author_kind in ('person', 'agent')),
  author_user uuid references auth.users (id) on delete set null,
  author_agent uuid references public.agents (id) on delete set null,
  -- How the author signs, kept when the person leaves or the agent is removed.
  author_name text not null,
  -- The AI SDK's message shape: a list of parts, e.g. [{"type": "text", "text": "…"}].
  parts jsonb not null check (jsonb_typeof(parts) = 'array'),
  created_at timestamptz not null default now()
);

create index messages_thread_time on public.messages (thread_id, created_at);
create index messages_org_id on public.messages (org_id);

alter table public.messages enable row level security;

/** The signed-in person's level on a thread: that of its agent. */
create function public.thread_level(target_thread uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select public.agent_level(t.agent_id) from public.threads t where t.id = target_thread), 'none');
$$;

revoke execute on function public.thread_level(uuid) from public, anon;
grant execute on function public.thread_level(uuid) to authenticated;

create policy "members read the messages of threads they may see"
  on public.messages for select to authenticated
  using (public.is_member(org_id) and public.thread_level(thread_id) <> 'none');

revoke insert, update, delete, truncate on public.messages from anon, authenticated;

/** Starts a thread with an agent the person may talk to, with their first message. */
create function public.start_thread(target_agent uuid, body text, title text default null)
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
  if nullif(clean, '') is null or length(clean) > 8000 then
    raise exception 'a message of up to 8000 characters is required' using errcode = '22023';
  end if;
  select m.display_name into me from public.memberships m where m.org_id = a.org_id and m.user_id = auth.uid();

  insert into public.threads (org_id, agent_id, title, created_by)
  values (a.org_id, a.id, left(coalesce(nullif(trim(title), ''), regexp_replace(clean, '\s+', ' ', 'g')), 120), auth.uid())
  returning * into t;
  insert into public.messages (thread_id, org_id, author_kind, author_user, author_name, parts)
  values (t.id, t.org_id, 'person', auth.uid(), me, jsonb_build_array(jsonb_build_object('type', 'text', 'text', clean)));
  return t;
end;
$$;

revoke execute on function public.start_thread(uuid, text, text) from public, anon;
grant execute on function public.start_thread(uuid, text, text) to authenticated;

/** Writes in a thread whose agent the person may talk to. */
create function public.post_message(target_thread uuid, body text)
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
  if not found or public.agent_level(t.agent_id) <> 'talk' then
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

revoke execute on function public.post_message(uuid, text) from public, anon;
grant execute on function public.post_message(uuid, text) to authenticated;

-- Everyone in a thread sees new messages live; Realtime applies the policies above.
alter publication supabase_realtime add table public.threads, public.messages;
