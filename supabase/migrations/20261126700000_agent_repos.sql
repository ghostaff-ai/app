-- The repos an agent on our runner may use besides its organisation's record
-- (docs/plans/ongoing/ordago-agents-in-ghostaff.md, «What Ghostaff builds for
-- it», item 2). Each run clones them and gets a GitHub token for each, for this
-- run only: read-only unless `write` is true. They are reached through the same
-- GitHub App installation as the record, so only an organisation whose record
-- is on GitHub can have them, and only repos that installation includes.
--
-- A list of {"repo": "owner/name", "write": bool}. Members read agent rows, and
-- nothing here is secret; only the service role writes them (20261117000000_agents.sql).

create function public.agent_repos_valid(repos jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(repos) = 'array'
    and jsonb_array_length(repos) <= 10
    and not exists (
      select 1
      from jsonb_array_elements(repos) as r (item)
      where jsonb_typeof(r.item) <> 'object'
        or (select count(*) from jsonb_object_keys(r.item)) <> 2
        or jsonb_typeof(r.item -> 'repo') <> 'string'
        or (r.item ->> 'repo') !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
        or jsonb_typeof(r.item -> 'write') <> 'boolean'
    )
    and (select count(distinct lower(r.item ->> 'repo')) from jsonb_array_elements(repos) as r (item)) = jsonb_array_length(repos);
$$;

alter table public.agents
  add column repos jsonb not null default '[]'::jsonb check (public.agent_repos_valid(repos));
