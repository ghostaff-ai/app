-- Each chat agent's own memory (docs/plans/ongoing/agent-context.md PR 2; agent-memory.md decision 1):
-- a folder of the organisation's record, `memoria/agentes/<slug>/`, that the agent reads at the start
-- of a turn and writes in it. `memories` (20261127900000_memories.sql) keeps its projection beside
-- Empresa's, written only by the engine; whoever may see the agent reads it in the app.

-- Every agent has a slug ------------------------------------------------------
-- The store's folder needs one; agents hired in Equipo had none (only runner agents did). From the
-- name, as `slug_for` makes an organisation's: `Atención al cliente` -> `atencion-al-cliente`, a
-- suffix when taken in the organisation, always starting with a letter (`agents.slug`'s check).

create function public.agent_slug_for(target_org uuid, name text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  base text := trim(both '-' from regexp_replace(public.plain_text(coalesce(name, '')), '[^a-z0-9]+', '-', 'g'));
  candidate text;
  n integer := 1;
begin
  if base !~ '^[a-z]' then base := trim(both '-' from 'agente-' || base); end if;
  base := rtrim(left(base, 41), '-');
  candidate := base;
  while exists (select 1 from public.agents a where a.org_id = target_org and a.slug = candidate) loop
    n := n + 1;
    candidate := rtrim(left(base, 41 - length(n::text) - 1), '-') || '-' || n;
  end loop;
  return candidate;
end;
$$;

revoke execute on function public.agent_slug_for(uuid, text) from public, anon, authenticated;

create function public.agents_fill_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is null then new.slug := public.agent_slug_for(new.org_id, new.name); end if;
  return new;
end;
$$;

create trigger agents_fill_slug before insert on public.agents
  for each row execute function public.agents_fill_slug();

-- One statement per agent, so each sees the slugs given before it.
do $$
declare
  a record;
begin
  for a in select id, org_id, name from public.agents where slug is null order by created_at, id loop
    update public.agents set slug = public.agent_slug_for(a.org_id, a.name) where id = a.id;
  end loop;
end;
$$;

-- What a store's rows point at, so an agent's store is always in its own organisation.
alter table public.agents add constraint agents_id_org unique (id, org_id);

-- Agents' stores in the projection -------------------------------------------

alter table public.memories
  add column agent_id uuid,
  drop constraint memories_store_check,
  add constraint memories_store_check check (store in ('empresa', 'agente')),
  add constraint memories_store_agent check ((store = 'agente') = (agent_id is not null)),
  add constraint memories_agent_fk foreign key (agent_id, org_id) references public.agents (id, org_id) on delete cascade,
  drop constraint memories_pkey,
  add constraint memories_key unique nulls not distinct (org_id, store, agent_id, path);

create index memories_agent on public.memories (agent_id) where agent_id is not null;

create policy "who may see an agent reads its memory"
  on public.memories for select to authenticated
  using (store = 'agente' and public.agent_level(agent_id) <> 'none');

-- The engine's search over one agent's store, as `search_memories` over Empresa.
create function public.search_agent_memories(target_agent uuid, words text[], max integer default 20)
returns table (path text, content text, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.path, m.content, m.updated_at
  from public.memories m
  where m.store = 'agente'
    and m.agent_id = target_agent
    and coalesce(array_length(words, 1), 0) > 0
    and not exists (
      select 1 from unnest(words) w
      where position(lower(w) in lower(m.path || E'\n' || m.content)) = 0
    )
  order by m.updated_at desc
  limit least(greatest(max, 1), 50);
$$;

revoke execute on function public.search_agent_memories(uuid, text[], integer) from public, anon, authenticated;
grant execute on function public.search_agent_memories(uuid, text[], integer) to service_role;
