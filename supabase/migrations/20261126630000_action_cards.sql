-- The OK cards in Decisiones (docs/plans/ready/decision-model.md, PR 3): what an
-- agent wants to do outside Ghostaff (agent_actions) waits in the deck too, for
-- the people who would approve it there, beside the decisions. It is not a row
-- in decisions: a decision is seen by every member, and an action follows its
-- conversation's privacy. The deck and the chat's card act on the same action
-- through the engine (POST /actions/:id/approve|reject); only «Más tarde» is
-- the deck's own, here.

/**
 * The actions waiting for the signed-in person in this organisation: pending,
 * in a conversation they see, once the agent has finished the message, and
 * theirs to approve (an owner's, or their own for a card that waits for whoever
 * asked). The preview is the card's own, from the message.
 */
create function public.my_pending_actions(target_org uuid)
returns table (
  id uuid,
  thread_id uuid,
  agent_id uuid,
  agent_name text,
  agent_ghost text,
  label text,
  preview text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.thread_id, a.agent_id, ag.name, ag.ghost, a.label,
         coalesce((
           select p->>'preview' from jsonb_array_elements(m.parts) p
           where p->>'type' = 'action' and p->>'actionId' = a.id::text
           limit 1
         ), ''),
         a.created_at
  from public.agent_actions a
  join public.messages m on m.id = a.message_id
  left join public.agents ag on ag.id = a.agent_id
  where a.org_id = target_org
    and public.is_member(target_org)
    and a.status = 'pending'
    and m.state <> 'working'
    and (case when a.decider = 'requester' then a.requested_by = auth.uid() else public.is_owner(target_org) end)
    and public.thread_level(a.thread_id) <> 'none'
  order by a.created_at desc
  limit 100;
$$;

revoke execute on function public.my_pending_actions(uuid) from public, anon;
grant execute on function public.my_pending_actions(uuid) to authenticated;

-- «Más tarde» on an OK card: the same as on a decision (20261124600000_decision_snoozes.sql),
-- personal, and only for an action the person sees.
create table public.action_snoozes (
  action_id uuid not null references public.agent_actions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  until timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (action_id, user_id)
);

create index action_snoozes_mine on public.action_snoozes (user_id, org_id, until);

alter table public.action_snoozes enable row level security;

create policy "people read their own action snoozes"
  on public.action_snoozes for select to authenticated
  using (user_id = auth.uid() and public.is_member(org_id));

revoke insert, update, delete, truncate on public.action_snoozes from anon, authenticated;

/** Puts an action the person sees aside until `until`: within the next 30 days. */
create function public.snooze_action(target_action uuid, until timestamptz)
returns public.action_snoozes
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agent_actions;
  s public.action_snoozes;
begin
  select * into a from public.agent_actions where id = target_action;
  if not found or not public.is_member(a.org_id) or public.thread_level(a.thread_id) = 'none' then
    raise exception 'action not found' using errcode = 'P0002';
  end if;
  if until <= now() or until > now() + interval '30 days' then
    raise exception 'until must be within the next 30 days' using errcode = '22023';
  end if;
  insert into public.action_snoozes (action_id, user_id, org_id, until)
  values (a.id, auth.uid(), a.org_id, until)
  on conflict (action_id, user_id) do update set until = excluded.until, created_at = now()
  returning * into s;
  return s;
end;
$$;

revoke execute on function public.snooze_action(uuid, timestamptz) from public, anon;
grant execute on function public.snooze_action(uuid, timestamptz) to authenticated;

/** Brings an action the person put aside back now. */
create function public.unsnooze_action(target_action uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.action_snoozes where action_id = target_action and user_id = auth.uid();
$$;

revoke execute on function public.unsnooze_action(uuid) from public, anon;
grant execute on function public.unsnooze_action(uuid) to authenticated;

-- The daily push leaves out an OK card the person put aside, as it does a decision.
create or replace function public.daily_push_candidates()
returns table (user_id uuid, time_zone text, org_id uuid, org_name text, waiting integer)
language sql
stable
security definer
set search_path = ''
as $$
  with people as (
    select distinct on (d.user_id) d.user_id, d.time_zone
    from public.device_tokens d
    order by d.user_id, d.updated_at desc
  )
  select p.user_id, p.time_zone, o.id, o.name, w.waiting
  from people p
  join public.memberships ms on ms.user_id = p.user_id
  join public.organizations o on o.id = ms.org_id
  cross join lateral (
    select (
      (select count(*) from public.decisions dc
       where dc.org_id = ms.org_id and dc.answer is null and dc.closed_at is null
         and not exists (
           select 1 from public.decision_snoozes s
           where s.decision_id = dc.id and s.user_id = p.user_id and s.until > now()
         ))
      + (select count(*) from public.agent_actions a
         where a.org_id = ms.org_id and a.status = 'pending'
           and (case when a.decider = 'requester' then a.requested_by = p.user_id else ms.role = 'owner' end)
           and public.thread_level_for(a.thread_id, p.user_id) <> 'none'
           and not exists (
             select 1 from public.action_snoozes s
             where s.action_id = a.id and s.user_id = p.user_id and s.until > now()
           ))
    )::integer as waiting
  ) w
  where w.waiting > 0
  order by p.user_id, o.name;
$$;

revoke execute on function public.daily_push_candidates() from public, anon, authenticated;
grant execute on function public.daily_push_candidates() to service_role;
