-- Routines (docs/plans/ongoing/agent-routines.md): what a person asks an
-- agent to do on its own at an hour, «cada viernes a las 9, mándame el
-- resumen de ventas». When it fires, the engine does what it does when that
-- person writes the instruction to the agent, and the answer lands in their
-- chat with it. A «Solo para mí» routine is its creator's alone; a «Para todo
-- el equipo» one is an owner's, and its answer also reaches everyone who can
-- see the agent.
--
-- The timetable is fields, never cron: the app and the agents' tool fill the
-- same fields, the card a person approves is written from them, and the
-- engine builds the cron in one place (packages/shared/src/routines.ts). They
-- allow once a day at most (decision 2 of the plan).

create table public.agent_routines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  -- `me`: only its creator gets the answer; `team`: everyone who can see the agent.
  audience text not null default 'me' check (audience in ('me', 'team')),
  title text not null check (length(trim(title)) between 1 and 80),
  instruction text not null check (length(trim(instruction)) between 1 and 2000),
  -- `days`: on these weekdays (all seven is every day); `monthly`: on this day of the month.
  kind text not null check (kind in ('days', 'monthly')),
  -- ISO weekdays, 1 Monday … 7 Sunday.
  weekdays smallint[] not null default '{1,2,3,4,5,6,7}'
    check (cardinality(weekdays) between 1 and 7 and weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  -- Up to 28, so every month has it.
  month_day smallint check (month_day between 1 and 28),
  hour smallint not null check (hour between 0 and 23),
  minute smallint not null default 0 check (minute between 0 and 59),
  timezone text not null default 'Europe/Madrid' check (length(timezone) <= 64),
  paused boolean not null default false,
  -- Why the engine paused it: its creator left, or can no longer talk to the agent.
  paused_reason text check (paused_reason in ('creator_gone')),
  -- The last fire time the engine took; a new or changed routine starts from now, never from a backlog.
  last_fired_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'monthly') = (month_day is not null))
);

create index agent_routines_agent on public.agent_routines (agent_id);
create index agent_routines_creator on public.agent_routines (org_id, created_by);
create index agent_routines_live on public.agent_routines (paused) where not paused;

alter table public.agent_routines enable row level security;

-- Someone's own routines, and the team's of the agents they can see. Nobody
-- else's «Solo para mí», owners included: it is what that person asked for.
create policy "members read their routines and the team's"
  on public.agent_routines for select to authenticated
  using (
    public.is_member(org_id)
    and (
      (audience = 'me' and created_by = auth.uid())
      or (audience = 'team' and public.agent_level(agent_id) <> 'none')
    )
  );

revoke insert, update, delete, truncate on public.agent_routines from anon, authenticated;

-- Runs and messages that a routine started -----------------------------------

alter table public.agent_runs
  add column routine_id uuid references public.agent_routines (id) on delete set null;
alter table public.agent_runs drop constraint agent_runs_origin_check;
alter table public.agent_runs
  add constraint agent_runs_origin_check check (origin in ('person', 'schedule', 'routine'));
grant select (routine_id) on public.agent_runs to authenticated;

-- A run of someone's «Solo para mí» routine is theirs alone, like the routine.
drop policy "members read the runs of agents they may see" on public.agent_runs;
create policy "members read the runs of agents they may see"
  on public.agent_runs for select to authenticated
  using (
    public.is_member(org_id)
    and public.agent_level(agent_id) <> 'none'
    and (
      routine_id is null
      or exists (
        select 1 from public.agent_routines r
        where r.id = routine_id and (r.audience = 'team' or r.created_by = auth.uid())
      )
    )
  );

-- The answer a routine started: the chat draws «🕘 Rutina · <title>» above it.
alter table public.messages
  add column routine_id uuid references public.agent_routines (id) on delete set null;

-- Who may change a routine: its creator for «Solo para mí», an owner for the team's.
create function public.may_change_routine(r public.agent_routines)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when r.audience = 'me' then r.created_by = auth.uid() and public.is_member(r.org_id)
    else public.is_owner(r.org_id)
  end;
$$;

revoke execute on function public.may_change_routine(public.agent_routines) from public, anon;
grant execute on function public.may_change_routine(public.agent_routines) to authenticated;

-- The setting's functions (rule 6: packages/shared/src/services/settings.ts) --

/**
 * A new routine with an agent the caller may talk to. «Para todo el equipo»
 * is an owner's. Ten routines per person and organisation at most.
 */
create function public.create_routine(
  target_agent uuid,
  audience text,
  title text,
  instruction text,
  kind text,
  weekdays smallint[],
  month_day smallint,
  hour smallint,
  minute smallint
)
returns public.agent_routines
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agents;
  r public.agent_routines;
begin
  select * into a from public.agents x where x.id = target_agent;
  if not found or public.agent_level(target_agent) <> 'talk' then
    raise exception 'you may not talk to this agent' using errcode = '42501';
  end if;
  if a.runner = 'ordago_job' then
    raise exception 'this agent takes no routines until it moves to our runner' using errcode = '22023';
  end if;
  if audience is null or audience not in ('me', 'team') then
    raise exception 'a routine is for me or for the team' using errcode = '22023';
  end if;
  if audience = 'team' and not public.is_owner(a.org_id) then
    raise exception 'only an owner makes a routine for the team' using errcode = '42501';
  end if;
  if (select count(*) from public.agent_routines x where x.org_id = a.org_id and x.created_by = auth.uid()) >= 10 then
    raise exception 'ten routines per person at most' using errcode = '54000';
  end if;

  insert into public.agent_routines (org_id, agent_id, created_by, audience, title, instruction, kind, weekdays, month_day, hour, minute)
  values (a.org_id, a.id, auth.uid(), audience, trim(title), trim(instruction), kind,
          coalesce(weekdays, '{1,2,3,4,5,6,7}'), month_day, hour, coalesce(minute, 0))
  returning * into r;
  return r;
end;
$$;

revoke execute on function public.create_routine(uuid, text, text, text, text, smallint[], smallint, smallint, smallint) from public, anon;
grant execute on function public.create_routine(uuid, text, text, text, text, smallint[], smallint, smallint, smallint) to authenticated;

/** What it does and when. It starts again from now: a change never fires for an hour already gone. */
create function public.update_routine(
  target_routine uuid,
  title text,
  instruction text,
  kind text,
  weekdays smallint[],
  month_day smallint,
  hour smallint,
  minute smallint
)
returns public.agent_routines
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.agent_routines;
begin
  select * into r from public.agent_routines x where x.id = target_routine;
  if not found or not public.may_change_routine(r) then
    raise exception 'you may not change this routine' using errcode = '42501';
  end if;
  update public.agent_routines x
  set title = trim(update_routine.title),
      instruction = trim(update_routine.instruction),
      kind = update_routine.kind,
      weekdays = coalesce(update_routine.weekdays, '{1,2,3,4,5,6,7}'),
      month_day = update_routine.month_day,
      hour = update_routine.hour,
      minute = coalesce(update_routine.minute, 0),
      last_fired_at = now(),
      updated_at = now()
  where x.id = target_routine
  returning * into r;
  return r;
end;
$$;

revoke execute on function public.update_routine(uuid, text, text, text, smallint[], smallint, smallint, smallint) from public, anon;
grant execute on function public.update_routine(uuid, text, text, text, smallint[], smallint, smallint, smallint) to authenticated;

/**
 * Pauses or resumes. Resuming a «Solo para mí» routine needs its creator to
 * talk to the agent still, and starts from now.
 */
create function public.set_routine_paused(target_routine uuid, paused boolean)
returns public.agent_routines
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.agent_routines;
begin
  select * into r from public.agent_routines x where x.id = target_routine;
  if not found or not public.may_change_routine(r) then
    raise exception 'you may not change this routine' using errcode = '42501';
  end if;
  if paused is null then
    raise exception 'paused is required' using errcode = '22023';
  end if;
  if not paused and r.audience = 'me' and public.agent_level(r.agent_id) <> 'talk' then
    raise exception 'you may not talk to this agent' using errcode = '42501';
  end if;
  update public.agent_routines x
  set paused = set_routine_paused.paused,
      paused_reason = case when set_routine_paused.paused then x.paused_reason end,
      last_fired_at = case when set_routine_paused.paused then x.last_fired_at else now() end,
      updated_at = now()
  where x.id = target_routine
  returning * into r;
  return r;
end;
$$;

revoke execute on function public.set_routine_paused(uuid, boolean) from public, anon;
grant execute on function public.set_routine_paused(uuid, boolean) to authenticated;

create function public.delete_routine(target_routine uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.agent_routines;
begin
  select * into r from public.agent_routines x where x.id = target_routine;
  if not found or not public.may_change_routine(r) then
    raise exception 'you may not change this routine' using errcode = '42501';
  end if;
  delete from public.agent_routines x where x.id = target_routine;
end;
$$;

revoke execute on function public.delete_routine(uuid) from public, anon;
grant execute on function public.delete_routine(uuid) to authenticated;

-- The engine's side (service role) -------------------------------------------

/**
 * A routine's answer, as a finished message from its agent, in the chat of
 * everyone who can see the agent but `except_user` (who got the full answer,
 * with its cards). Returns how many chats it reached.
 */
create function public.post_routine_copies(target_routine uuid, body text, except_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.agent_routines;
  a public.agents;
  member uuid;
  chat uuid;
  msg public.messages;
  reached integer := 0;
begin
  select * into r from public.agent_routines x where x.id = target_routine;
  if not found then
    raise exception 'routine not found' using errcode = 'P0002';
  end if;
  if nullif(trim(body), '') is null then
    raise exception 'a message is required' using errcode = '22023';
  end if;
  select * into a from public.agents x where x.id = r.agent_id;

  for member in
    select m.user_id from public.memberships m
    where m.org_id = a.org_id
      and public.agent_level_for(a.id, m.user_id) <> 'none'
      and m.user_id is distinct from except_user
      and (r.audience = 'team' or m.user_id = r.created_by)
  loop
    insert into public.threads (org_id, agent_id, title, created_by, personal_of)
    values (a.org_id, a.id, a.name, null, member)
    on conflict (agent_id, personal_of) where personal_of is not null do nothing;
    select t.id into chat from public.threads t where t.agent_id = a.id and t.personal_of = member;

    insert into public.messages (thread_id, org_id, author_kind, author_agent, author_name, parts, state, finished_at, routine_id)
    values (chat, a.org_id, 'agent', a.id, a.name, jsonb_build_array(jsonb_build_object('type', 'text', 'text', body)), 'done', clock_timestamp(), r.id)
    returning * into msg;
    update public.threads set last_message_at = msg.created_at where id = chat;
    reached := reached + 1;
  end loop;
  return reached;
end;
$$;

revoke execute on function public.post_routine_copies(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.post_routine_copies(uuid, text, uuid) to service_role;

/** A word from the organisation's Secretaría in each owner's chat with her (a routine paused, say). */
create function public.notify_owners(target_org uuid, body text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agents;
  owner uuid;
  chat uuid;
  msg public.messages;
  reached integer := 0;
begin
  select * into a from public.agents x where x.org_id = target_org and x.ghost = 'secretaria' order by x.created_at limit 1;
  if not found then
    return 0;
  end if;
  if nullif(trim(body), '') is null then
    raise exception 'a message is required' using errcode = '22023';
  end if;
  for owner in select m.user_id from public.memberships m where m.org_id = target_org and m.role = 'owner' loop
    insert into public.threads (org_id, agent_id, title, created_by, personal_of)
    values (a.org_id, a.id, a.name, null, owner)
    on conflict (agent_id, personal_of) where personal_of is not null do nothing;
    select t.id into chat from public.threads t where t.agent_id = a.id and t.personal_of = owner;

    insert into public.messages (thread_id, org_id, author_kind, author_agent, author_name, parts, state, finished_at)
    values (chat, a.org_id, 'agent', a.id, a.name, jsonb_build_array(jsonb_build_object('type', 'text', 'text', body)), 'done', clock_timestamp())
    returning * into msg;
    update public.threads set last_message_at = msg.created_at where id = chat;
    reached := reached + 1;
  end loop;
  return reached;
end;
$$;

revoke execute on function public.notify_owners(uuid, text) from public, anon, authenticated;
grant execute on function public.notify_owners(uuid, text) to service_role;

-- Who approves an agent's proposal (decision 1 of the plan): an owner, as for
-- every other action, or the person who asked, for their own «Solo para mí»
-- routine. The engine sets it from the tool, never from the card.
alter table public.agent_actions
  add column decider text not null default 'owner' check (decider in ('owner', 'requester'));
