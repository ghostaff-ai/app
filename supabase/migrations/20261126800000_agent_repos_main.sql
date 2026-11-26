-- An agent may push to `main` (and `beta`) of another repo only when that repo says so
-- (20261126700000_agent_repos.sql; docs/plans/ongoing/ordago-agents-in-ghostaff.md, item 2):
-- Órdago's `push_a_main`, Orgánico on `ordago-reels`. Without it, a repo it writes takes pushes
-- to any other branch (`develop`, its own), never production's. `main` needs `write`.

create or replace function public.agent_repos_valid(repos jsonb)
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
        or exists (select 1 from jsonb_object_keys(r.item) as k (key) where k.key not in ('repo', 'write', 'main'))
        or coalesce(jsonb_typeof(r.item -> 'repo'), '') <> 'string'
        or coalesce(r.item ->> 'repo', '') !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
        or coalesce(jsonb_typeof(r.item -> 'write'), '') <> 'boolean'
        or (r.item ? 'main' and jsonb_typeof(r.item -> 'main') <> 'boolean')
        or (coalesce((r.item ->> 'main')::boolean, false) and not (r.item ->> 'write')::boolean)
    )
    and (select count(distinct lower(r.item ->> 'repo')) from jsonb_array_elements(repos) as r (item)) = jsonb_array_length(repos);
$$;
