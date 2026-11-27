-- Each agent's photo (docs/plans/ongoing/agent-photo.md): the blocks it keeps on its page, from its
-- record's `agentes/<slug>/foto.yaml`. The engine's sync projects the file here, already read and
-- checked (packages/shared/src/record/photo.ts); the app draws it. Whoever may see the agent reads
-- it; only the engine writes it.

create table public.agent_photos (
  agent_id uuid primary key,
  org_id uuid not null,
  -- The blocks in the app's words (packages/shared/src/photo.ts), at most 12.
  blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array' and jsonb_array_length(blocks) <= 12),
  -- The file's blocks Ghostaff could not draw, with why: [{"index": 0, "reason": "…"}].
  skipped jsonb not null default '[]'::jsonb check (jsonb_typeof(skipped) = 'array'),
  -- The file's blob the blocks come from: what the sync compares to read it again only when it changes.
  sha text not null,
  -- Why the last version of the file could not be read; the blocks stay those of the last good one.
  error text check (error is null or length(error) <= 500),
  -- When the agent says it refreshed it (`actualizado`), else when the sync read it.
  updated_at timestamptz not null default now(),
  -- Always in its agent's organisation.
  foreign key (agent_id, org_id) references public.agents (id, org_id) on delete cascade
);

create index agent_photos_org on public.agent_photos (org_id);

alter table public.agent_photos enable row level security;

create policy "who may see an agent reads its photo"
  on public.agent_photos for select to authenticated
  using (public.agent_level(agent_id) <> 'none');

revoke insert, update, delete on public.agent_photos from anon, authenticated;
grant select on public.agent_photos to authenticated;
