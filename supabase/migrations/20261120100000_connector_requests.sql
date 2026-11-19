-- Asking for a connector we lack (docs/plans/ongoing/connectors.md, phase 0,
-- kind C, «What comes next is chosen by demand»). Any member of an
-- organisation can name an app Conexiones does not list; each organisation's
-- request for an app counts once, and the most asked-for app goes next.
-- Members see their own organisation's requests; we count across them with
-- the service role:
--   select lower(name), count(*) from public.connector_requests group by 1 order by 2 desc;

create table public.connector_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null,
  requested_by_name text not null,
  name text not null check (length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

-- One request per organisation and app, whatever the letters' case.
create unique index connector_requests_once on public.connector_requests (org_id, lower(name));

alter table public.connector_requests enable row level security;

create policy "members read their organisation's requests"
  on public.connector_requests for select to authenticated
  using (public.is_member(org_id));

revoke insert, update, delete, truncate on public.connector_requests from anon, authenticated;

/** Records that the caller's organisation wants a connector for `wanted`; asking again changes nothing. */
create function public.request_connector(target_org uuid, wanted text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := btrim(regexp_replace(coalesce(wanted, ''), '\s+', ' ', 'g'));
  who text;
begin
  select m.display_name into who from public.memberships m
  where m.org_id = target_org and m.user_id = auth.uid();
  if not found then
    raise exception 'not a member of this organisation' using errcode = '42501';
  end if;
  if length(clean) not between 1 and 80 then
    raise exception 'say which app, in 80 characters at most' using errcode = '22023';
  end if;
  insert into public.connector_requests (org_id, requested_by, requested_by_name, name)
  values (target_org, auth.uid(), who, clean)
  on conflict (org_id, lower(name)) do nothing;
end;
$$;

revoke execute on function public.request_connector(uuid, text) from public, anon;
grant execute on function public.request_connector(uuid, text) to authenticated;
