-- An agent may handle a repo's pull requests with `gh` only when that repo says so
-- (20261127210000_agent_repos_main.sql; docs/plans/ongoing/ordago-agents-in-ghostaff.md, item 2):
-- Órdago's Desarrollo lands its own PRs in `ordago-apps` with `pnpm pr:land`. Its token may then also write
-- PRs and issues and read the repo's CI (apps/engine/src/githubApp.ts repoPermissions). `prs` needs `write`.

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
        or exists (select 1 from jsonb_object_keys(r.item) as k (key) where k.key not in ('repo', 'write', 'main', 'prs'))
        or coalesce(jsonb_typeof(r.item -> 'repo'), '') <> 'string'
        or coalesce(r.item ->> 'repo', '') !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
        or coalesce(jsonb_typeof(r.item -> 'write'), '') <> 'boolean'
        or (r.item ? 'main' and jsonb_typeof(r.item -> 'main') <> 'boolean')
        or (coalesce((r.item ->> 'main')::boolean, false) and not (r.item ->> 'write')::boolean)
        or (r.item ? 'prs' and jsonb_typeof(r.item -> 'prs') <> 'boolean')
        or (coalesce((r.item ->> 'prs')::boolean, false) and not (r.item ->> 'write')::boolean)
    )
    and (select count(distinct lower(r.item ->> 'repo')) from jsonb_array_elements(repos) as r (item)) = jsonb_array_length(repos);
$$;
