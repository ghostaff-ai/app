-- One refresh of an account's token at a time, across every engine instance
-- (docs/plans/ongoing/connectors.md, «Known gaps»). A provider that rotates
-- refresh tokens kills the old one when it hands out a new one, and some revoke
-- the whole grant when the old one is used again: two instances refreshing the
-- same account in the same instant can cost the organisation its connection.
-- So the engine takes a short lease here before it refreshes, and an instance
-- that finds it taken waits for the token the holder saves to the vault.
-- Only the engine touches this: no policy, no grant to the app's roles.

create table public.refresh_leases (
  org_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider ~ '^[a-z][a-z0-9]{1,30}$'),
  -- Which engine instance holds it (a random id per process).
  holder text not null check (length(holder) between 1 and 100),
  until timestamptz not null,
  primary key (org_id, provider)
);

alter table public.refresh_leases enable row level security;
revoke all on public.refresh_leases from anon, authenticated;

-- Takes the account's lease for `seconds` if it is free, expired, or already
-- ours; true when this caller holds it now. One statement, so two instances
-- asking at once cannot both get it.
create function public.take_refresh_lease(target_org uuid, target_provider text, who text, seconds integer)
returns boolean
language sql
volatile
set search_path = ''
as $$
  with taken as (
    insert into public.refresh_leases as l (org_id, provider, holder, until)
    values (target_org, target_provider, who, now() + make_interval(secs => seconds))
    on conflict (org_id, provider) do update
      set holder = excluded.holder, until = excluded.until
      where l.until < now() or l.holder = excluded.holder
    returning 1
  )
  select exists (select 1 from taken);
$$;

-- Gives the lease back, only if this caller still holds it.
create function public.release_refresh_lease(target_org uuid, target_provider text, who text)
returns void
language sql
volatile
set search_path = ''
as $$
  delete from public.refresh_leases
  where org_id = target_org and provider = target_provider and holder = who;
$$;

revoke execute on function public.take_refresh_lease(uuid, text, text, integer) from public, anon, authenticated;
revoke execute on function public.release_refresh_lease(uuid, text, text) from public, anon, authenticated;
grant execute on function public.take_refresh_lease(uuid, text, text, integer) to service_role;
grant execute on function public.release_refresh_lease(uuid, text, text) to service_role;
