-- Kept health history (docs/plans/ongoing/wearables.md): what a person chose to
-- keep from a band (Whoop, Google…), apart from the app's tables in its own
-- schema but under the same rules. Only a personal space holds it (health data
-- is about one person; in a company every member would read it). Only the
-- engine writes it, with the service role; the space's members only read it.
--
-- sources: one per band account whose history is kept. It outlives the
--   connection (disconnecting may keep the history, an import has none), so the
--   history hangs from the source, and deleting the source deletes it all.
-- records: the maker's record as it came, so a better normalisation later is a
--   re-run, not a re-download from a band that may be gone.
-- metrics: one value per day, metric and source, computed by code from records
--   and replaced as a whole (replace_metrics), so a day that lost its data
--   loses its numbers too.
-- A record or metric points at its source and its space together, so it can
-- never sit in a space other than its source's (and follow it if it moves).

create schema health;

create table health.sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider ~ '^[a-z][a-z0-9]{1,30}$'),
  external_user_id text not null check (length(external_user_id) between 1 and 200),
  connection_id uuid references public.connections (id) on delete set null,
  consented_at timestamptz not null,
  consent_version text not null check (length(consent_version) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (org_id, provider, external_user_id),
  -- What records and metrics point at, so their space is always their source's.
  unique (id, org_id)
);

create table health.records (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  source_id uuid not null,
  provider text not null,
  kind text not null check (kind in ('cycle', 'recovery', 'sleep', 'workout', 'body')),
  external_id text not null check (length(external_id) between 1 and 200),
  starts_at timestamptz,
  ends_at timestamptz,
  payload jsonb not null,
  updated_at timestamptz not null,
  unique (source_id, kind, external_id),
  foreign key (source_id, org_id) references health.sources (id, org_id) on delete cascade on update cascade
);

create index records_org_kind_start on health.records (org_id, kind, starts_at);

create table health.metrics (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  source_id uuid not null,
  source text not null,
  day date not null,
  metric text not null check (metric ~ '^[a-z][a-z0-9_]{1,40}$'),
  value numeric not null,
  unit text not null check (length(unit) between 1 and 20),
  unique (source_id, day, metric),
  foreign key (source_id, org_id) references health.sources (id, org_id) on delete cascade on update cascade
);

create index metrics_org_metric_day on health.metrics (org_id, metric, day);

-- Only a personal space holds health data, on insert and on any move.
create function health.sources_personal_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.organizations o where o.id = new.org_id and o.kind = 'personal'
  ) then
    raise exception 'health data belongs to a personal space' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger sources_personal_only
  before insert or update of org_id on health.sources
  for each row execute function health.sources_personal_only();

-- A source's daily metrics, replaced as a whole in one transaction: the engine
-- recomputes them from every stored record and hands them over here, so a
-- number never outlives the records it came from. Rows: [{day, metric, value, unit}].
create function health.replace_metrics(target_source uuid, rows jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  target_org uuid;
begin
  select s.org_id into target_org from health.sources s where s.id = target_source;
  if not found then
    raise exception 'no such health source' using errcode = 'P0002';
  end if;
  delete from health.metrics where source_id = target_source;
  insert into health.metrics (org_id, source_id, source, day, metric, value, unit)
  select target_org, target_source, s.provider, r.day, r.metric, r.value, r.unit
  from health.sources s,
    jsonb_to_recordset(rows) as r(day date, metric text, value numeric, unit text)
  where s.id = target_source;
end;
$$;

alter table health.sources enable row level security;
alter table health.records enable row level security;
alter table health.metrics enable row level security;

create policy "members read their space's health sources" on health.sources
  for select to authenticated using (public.is_member(org_id));
create policy "members read their space's health records" on health.records
  for select to authenticated using (public.is_member(org_id));
create policy "members read their space's health metrics" on health.metrics
  for select to authenticated using (public.is_member(org_id));

grant usage on schema health to authenticated, service_role;
grant select on health.sources, health.records, health.metrics to authenticated;
grant all on health.sources, health.records, health.metrics to service_role;
grant usage, select on all sequences in schema health to service_role;
revoke execute on function health.sources_personal_only() from public, anon, authenticated;
revoke execute on function health.replace_metrics(uuid, jsonb) from public, anon, authenticated;
grant execute on function health.replace_metrics(uuid, jsonb) to service_role;
