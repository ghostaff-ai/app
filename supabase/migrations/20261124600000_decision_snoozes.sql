-- «Más tarde» on a decision card (docs/plans/ongoing/three-tabs.md, decision 7):
-- each person puts a decision aside until a time they choose (the app offers
-- tomorrow morning). It is personal: a colleague still sees the card, and the
-- decision stays open for the agent. Only the person reads or changes theirs.

create table public.decision_snoozes (
  decision_id uuid not null references public.decisions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  until timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (decision_id, user_id)
);

create index decision_snoozes_mine on public.decision_snoozes (user_id, org_id, until);

alter table public.decision_snoozes enable row level security;

create policy "people read their own snoozes"
  on public.decision_snoozes for select to authenticated
  using (user_id = auth.uid() and public.is_member(org_id));

revoke insert, update, delete, truncate on public.decision_snoozes from anon, authenticated;

/** Puts a decision of the person's organisation aside until `until`: within the next 30 days. */
create function public.snooze_decision(target_decision uuid, until timestamptz)
returns public.decision_snoozes
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.decisions;
  s public.decision_snoozes;
begin
  select * into d from public.decisions where id = target_decision;
  if not found or not public.is_member(d.org_id) then
    raise exception 'decision not found' using errcode = 'P0002';
  end if;
  if until <= now() or until > now() + interval '30 days' then
    raise exception 'until must be within the next 30 days' using errcode = '22023';
  end if;
  insert into public.decision_snoozes (decision_id, user_id, org_id, until)
  values (d.id, auth.uid(), d.org_id, until)
  on conflict (decision_id, user_id) do update set until = excluded.until, created_at = now()
  returning * into s;
  return s;
end;
$$;

revoke execute on function public.snooze_decision(uuid, timestamptz) from public, anon;
grant execute on function public.snooze_decision(uuid, timestamptz) to authenticated;

/** Brings a decision the person put aside back now. */
create function public.unsnooze_decision(target_decision uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.decision_snoozes where decision_id = target_decision and user_id = auth.uid();
$$;

revoke execute on function public.unsnooze_decision(uuid) from public, anon;
grant execute on function public.unsnooze_decision(uuid) to authenticated;
