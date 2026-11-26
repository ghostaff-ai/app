-- The organisation's memory as the app and the chat read it (docs/plans/ongoing/business-brain.md,
-- docs/plans/ready/agent-memory.md decision 1). The record is the master: `memoria/empresa/` in the
-- organisation's record. This table is its projection, written only by the engine: the tick's sync
-- (the record wins) and Secretaría's writes in a chat turn, which commit to the record first.
--
-- Only the Empresa store today; each agent's own store (`memoria/agentes/<slug>/`) joins the same
-- table later with its own read rule. Every member reads Empresa: what is filed there, the whole
-- organisation sees (business-brain.md decision 4).

create table public.memories (
  org_id uuid not null references public.organizations (id) on delete cascade,
  store text not null check (store = 'empresa'),
  -- Inside the store's folder, e.g. `facturas/2026-10-acme.md`: no leading slash, no `..`, no `.git`.
  path text not null check (
    path ~ '^[^/]+(/[^/]+)*$'
    and path !~ '(^|/)\.\.?(/|$)'
    and path !~ '(^|/)\.git(/|$)'
    and length(path) <= 300
  ),
  content text not null check (length(content) <= 10240),
  -- The file's blob in the record: what the sync compares, and what a write starts from.
  sha text not null,
  updated_at timestamptz not null default now(),
  -- Who changed it last, as the record's commit says it («Secretaría (por Ana)»); null when unknown.
  updated_by text,
  primary key (org_id, store, path)
);

alter table public.memories enable row level security;

revoke all on public.memories from anon, authenticated;
grant select on public.memories to authenticated;

create policy "members read their organisation's memory"
  on public.memories for select to authenticated
  using (store = 'empresa' and public.is_member(org_id));

-- The chat's search (agentic, no embeddings): the files whose path or text holds every word, newest
-- first. The engine's only; a person reads the table through its policy.
create function public.search_memories(target_org uuid, target_store text, words text[], max integer default 20)
returns table (path text, content text, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.path, m.content, m.updated_at
  from public.memories m
  where m.org_id = target_org
    and m.store = target_store
    and coalesce(array_length(words, 1), 0) > 0
    and not exists (
      select 1 from unnest(words) w
      where position(lower(w) in lower(m.path || E'\n' || m.content)) = 0
    )
  order by m.updated_at desc
  limit least(greatest(max, 1), 50);
$$;

revoke execute on function public.search_memories(uuid, text, text[], integer) from public, anon, authenticated;
grant execute on function public.search_memories(uuid, text, text[], integer) to service_role;
