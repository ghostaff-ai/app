-- Routines lose «Solo para mí» (docs/plans/ongoing/group-chat-per-agent.md,
-- decision 6, Jaime 2026-11-26). With one chat per agent a routine's answer
-- lands where everyone who sees the agent reads it, so every routine is the
-- team's: anyone who talks to the agent makes one, and its creator or an owner
-- changes, pauses or deletes it. Ten per person and organisation, as before.

drop policy "members read their routines and the team's" on public.agent_routines;
drop policy "members read the runs of agents they may see" on public.agent_runs;
drop function public.create_routine(uuid, text, text, text, text, smallint[], smallint, smallint, smallint);

alter table public.agent_routines drop column audience;

create policy "members read the routines of agents they may see"
  on public.agent_routines for select to authenticated
  using (public.is_member(org_id) and public.agent_level(agent_id) <> 'none');

create policy "members read the runs of agents they may see"
  on public.agent_runs for select to authenticated
  using (public.is_member(org_id) and public.agent_level(agent_id) <> 'none');

/** Who may change a routine: its creator, while still a member, or an owner. */
create or replace function public.may_change_routine(r public.agent_routines)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_owner(r.org_id) or (r.created_by = auth.uid() and public.is_member(r.org_id));
$$;

/** A new routine with an agent the caller may talk to. Ten routines per person and organisation at most. */
create function public.create_routine(
  target_agent uuid,
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
  if (select count(*) from public.agent_routines x where x.org_id = a.org_id and x.created_by = auth.uid()) >= 10 then
    raise exception 'ten routines per person at most' using errcode = '54000';
  end if;

  insert into public.agent_routines (org_id, agent_id, created_by, title, instruction, kind, weekdays, month_day, hour, minute)
  values (a.org_id, a.id, auth.uid(), trim(title), trim(instruction), kind,
          coalesce(weekdays, '{1,2,3,4,5,6,7}'), month_day, hour, coalesce(minute, 0))
  returning * into r;
  return r;
end;
$$;

revoke execute on function public.create_routine(uuid, text, text, text, smallint[], smallint, smallint, smallint) from public, anon;
grant execute on function public.create_routine(uuid, text, text, text, smallint[], smallint, smallint, smallint) to authenticated;

/**
 * Pauses or resumes. Resuming needs whoever resumes it to talk to the agent,
 * or to be an owner, and starts from now.
 */
create or replace function public.set_routine_paused(target_routine uuid, paused boolean)
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
  if not paused and public.agent_level(r.agent_id) <> 'talk' then
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
