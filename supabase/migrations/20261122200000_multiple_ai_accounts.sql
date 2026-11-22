-- Several AI accounts per organisation, in the order an owner picks, each with
-- its usage (docs/plans/ready/multiple-ai-accounts.md).
--
-- Until now an organisation had at most one AI connection per provider. Now it
-- may have any number (two Claude subscriptions, a key and a subscription…).
-- The engine tries them by `position` and moves to the next only when one
-- fails before writing. Each connection's secret lives in the vault under its
-- own id. Outside accounts (kind 'account') stay one per provider.

-- One outside account per provider; AI connections are free. The engine's
-- upsert of an outside account targets (org_id, account_key).
alter table public.connections drop constraint connections_org_id_provider_key;
alter table public.connections
  add column account_key text generated always as (case when kind = 'account' then provider end) stored;
alter table public.connections add constraint connections_one_account_per_provider unique (org_id, account_key);

-- Its place in the order the engine tries AI accounts (1 first).
alter table public.connections add column position integer not null default 0 check (position >= 0);
-- A name the owner gives it («Claude de Jaime»); null shows the provider's name.
alter table public.connections add column label text check (label is null or length(label) between 1 and 60);
-- The latest state of a subscription's usage limits, as Claude Code reports
-- them: {"five_hour": {"utilization": 0.4, "resets_at": "…", "status": "allowed"}, "seven_day": {…}, "read_at": "…"}.
alter table public.connections add column limits jsonb not null default '{}'::jsonb;
-- Why it is `failing`: limited (out of its limits), refused (key or sign-in no longer valid), failed (anything else).
alter table public.connections add column status_reason text check (status_reason in ('limited', 'refused', 'failed'));
alter table public.connections add column last_used_at timestamptz;

-- Today's AI connections keep the order the engine used: Google Cloud, the subscription, the key.
update public.connections c set position = o.n
from (
  select id, row_number() over (
    partition by org_id
    order by array_position(array['vertex', 'claude', 'anthropic', 'openai'], provider), created_at
  ) as n
  from public.connections where kind = 'ai'
) o
where c.id = o.id;

-- A new AI connection goes to the bottom of its organisation's list.
create function public.connections_place_last()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'ai' and new.position = 0 then
    select coalesce(max(c.position), 0) + 1 into new.position
    from public.connections c where c.org_id = new.org_id and c.kind = 'ai';
  end if;
  return new;
end;
$$;

create trigger connections_place_last before insert on public.connections
  for each row execute function public.connections_place_last();

-- An owner sets the order: every AI connection of the organisation, first to last.
create function public.set_ai_order(target_org uuid, ordered uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_ids uuid[];
begin
  if not public.is_owner(target_org) then
    raise exception 'only an owner orders the AI accounts' using errcode = '42501';
  end if;
  select coalesce(array_agg(id order by id), '{}') into current_ids
  from public.connections where org_id = target_org and kind = 'ai';
  if ordered is null
     or cardinality(ordered) <> cardinality(current_ids)
     or (select array_agg(x order by x) from unnest(ordered) x) is distinct from current_ids then
    raise exception 'give every AI account of the organisation exactly once' using errcode = '22023';
  end if;
  update public.connections c set position = o.n, updated_at = now()
  from unnest(ordered) with ordinality as o(id, n)
  where c.id = o.id and c.org_id = target_org;
end;
$$;

revoke execute on function public.set_ai_order(uuid, uuid[]) from public, anon;
grant execute on function public.set_ai_order(uuid, uuid[]) to authenticated;

-- An owner names an AI connection; an empty name goes back to the provider's.
create function public.rename_ai_connection(target uuid, new_label text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
  clean text := nullif(btrim(regexp_replace(coalesce(new_label, ''), '\s+', ' ', 'g')), '');
begin
  select c.org_id into org from public.connections c where c.id = target and c.kind = 'ai';
  -- Not found reads the same as not an owner: never reveal another organisation's ids.
  if org is null or not public.is_owner(org) then
    raise exception 'only an owner names the AI accounts' using errcode = '42501';
  end if;
  if length(clean) > 60 then
    raise exception 'a name of 60 characters at most' using errcode = '22023';
  end if;
  update public.connections set label = clean, updated_at = now() where id = target;
end;
$$;

revoke execute on function public.rename_ai_connection(uuid, text) from public, anon;
grant execute on function public.rename_ai_connection(uuid, text) to authenticated;

-- Which AI connection a run of our runner works on, so its usage lands on that card.
alter table public.agent_runs add column connection_id uuid references public.connections (id) on delete set null;

-- What each AI connection did: one row per chat reply or runner run, written by
-- the engine. Tokens as the provider counted them; the cost is our estimate at
-- list price (null on a subscription, which is paid by plan, not by token).
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  connection_id uuid not null references public.connections (id) on delete cascade,
  agent_id uuid references public.agents (id) on delete set null,
  source text not null check (source in ('chat', 'run')),
  outcome text not null check (outcome in ('ok', 'limited', 'refused', 'failed')),
  model text check (length(model) <= 80),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cache_read_tokens bigint not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens bigint not null default 0 check (cache_write_tokens >= 0),
  cost_usd numeric(12, 6) check (cost_usd >= 0),
  at timestamptz not null default now()
);

create index ai_usage_connection_recent on public.ai_usage (connection_id, at desc);
create index ai_usage_org_recent on public.ai_usage (org_id, at desc);

alter table public.ai_usage enable row level security;

create policy "members read their organisation's AI usage"
  on public.ai_usage for select to authenticated
  using (public.is_member(org_id));

-- Only the engine writes, with the service role.
revoke insert, update, delete, truncate on public.ai_usage from anon, authenticated;

-- Usage per AI connection, agent and day (Madrid), since a day. Runs as the
-- caller, so row-level security keeps it to their own organisation.
create function public.ai_usage_daily(target_org uuid, since date)
returns table (
  connection_id uuid,
  agent_id uuid,
  day date,
  uses bigint,
  failures bigint,
  input_tokens bigint,
  output_tokens bigint,
  cache_read_tokens bigint,
  cache_write_tokens bigint,
  cost_usd numeric,
  last_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    u.connection_id,
    u.agent_id,
    (u.at at time zone 'Europe/Madrid')::date as day,
    count(*) filter (where u.outcome = 'ok'),
    count(*) filter (where u.outcome <> 'ok'),
    sum(u.input_tokens)::bigint,
    sum(u.output_tokens)::bigint,
    sum(u.cache_read_tokens)::bigint,
    sum(u.cache_write_tokens)::bigint,
    sum(u.cost_usd),
    max(u.at)
  from public.ai_usage u
  where u.org_id = target_org and u.at >= (since::timestamp at time zone 'Europe/Madrid')
  group by 1, 2, 3
$$;

revoke execute on function public.ai_usage_daily(uuid, date) from public, anon;
grant execute on function public.ai_usage_daily(uuid, date) to authenticated;
