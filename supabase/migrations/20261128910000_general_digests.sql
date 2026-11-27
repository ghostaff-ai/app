-- What the agents learn from General (docs/plans/ready/general-chat.md,
-- decision 2): once a day ends in Madrid, the engine summarises what the
-- organisation's people said in General that day, and every agent reads the
-- latest summaries. The summary is the engine's: it is a projection of what
-- every member can already read, but nothing in the app needs it, so no member
-- reads it: row-level security on, no policy, no grant but the service role's.

create table public.general_digests (
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The Madrid day it summarises.
  day date not null,
  summary text not null check (length(summary) between 1 and 20000),
  -- The newest message it covers. No foreign key: that message may go, the summary still holds.
  through_message uuid not null,
  created_at timestamptz not null default now(),
  primary key (org_id, day)
);

alter table public.general_digests enable row level security;
revoke all on table public.general_digests from anon, authenticated;
grant select, insert, update, delete on table public.general_digests to service_role;

/**
 * The days to summarise, for the engine's tick: each organisation's General
 * with messages on a Madrid day in [since, until) that has no summary yet,
 * oldest first. `until` is the start of today in Madrid, so only finished days.
 */
create function public.general_digests_due(since timestamptz, until timestamptz)
returns table (org_id uuid, thread_id uuid, day date)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct t.org_id, t.id, (m.created_at at time zone 'Europe/Madrid')::date as day
  from public.threads t
  join public.messages m on m.thread_id = t.id
  where t.kind = 'general'
    and m.created_at >= since and m.created_at < until
    and not exists (
      select 1 from public.general_digests d
      where d.org_id = t.org_id and d.day = (m.created_at at time zone 'Europe/Madrid')::date
    )
  order by day, t.org_id;
$$;

revoke execute on function public.general_digests_due(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.general_digests_due(timestamptz, timestamptz) to service_role;
