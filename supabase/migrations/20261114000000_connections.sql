-- Connections: an organisation's links to outside accounts. The first kind is
-- AI (its own Anthropic or OpenAI key, or its own Google Cloud project for
-- Claude in the EU); mail, bank and the rest join this table later.
--
-- Invariant 3 (AGENTS.md): keys live in a vault, apart from everything else.
-- This table never holds a key. The key goes from the app to the engine
-- (apps/engine), which checks it, writes it to Secret Manager under a name
-- derived from the organisation and provider, and records here only that the
-- connection exists. The engine writes with the service role; the app only
-- reads, and only its own organisation's rows.

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('ai')),
  provider text not null check (provider in ('anthropic', 'openai', 'vertex')),
  -- How it connects: a pasted key, or access granted to us on the customer's
  -- own cloud project. Later: 'oauth', 'subscription'.
  method text not null check (method in ('api_key', 'cloud_project')),
  -- What the app shows to recognise it: a key's last 4 characters, or the project.
  hint text not null check (length(hint) between 1 and 80),
  -- Non-secret settings: the project and region of a cloud project.
  settings jsonb not null default '{}'::jsonb,
  status text not null default 'ok' check (status in ('ok', 'failing')),
  checked_at timestamptz not null default now(),
  connected_by uuid references auth.users (id) on delete set null,
  connected_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider)
);

alter table public.connections enable row level security;

create policy "members read their organisation's connections"
  on public.connections for select to authenticated
  using (public.is_member(org_id));

-- No insert, update or delete policy: only the engine writes, with the service role.
revoke insert, update, delete, truncate on public.connections from anon, authenticated;
