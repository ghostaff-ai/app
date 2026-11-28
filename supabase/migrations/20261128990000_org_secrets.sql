-- The organisation's keys and passwords (docs/plans/ongoing/secrets-from-the-app.md):
-- what an agent on our runner gets as a variable (agents.secrets, 20261127400000_agent_secrets.sql),
-- stored from the app or with `org set-secret`. One row per secret in the vault
-- (`org-<org>-secret-<name>`, apps/engine/src/vault.ts), holding only what a person
-- reads about it: its label, the maker it is for, who stored it and when, when a run
-- last used it, and whether the last run found it. Never the value (invariant 3).
--
-- A member's value waits for an owner (as a guide's, guided-access.md): it is kept in
-- the vault under a name no run reads (`org-<org>-pending-<name>`), and `pending_*`
-- says who and when. An owner's approval moves it to the live name and fills `stored_*`.
-- A row with nothing stored yet is a member's first value, waiting.
--
-- Members read their organisation's rows: nothing here is secret, and they see which
-- keys their agents have. Only the engine and apps/sync write, with the service role.

create table public.org_secrets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The vault's name without its prefix, as agents.secrets names it.
  name text not null check (name ~ '^[a-z][a-z0-9-]{0,62}$'),
  -- What a person reads: «Contraseña de info@ordago.club».
  label text not null check (length(btrim(label)) between 1 and 80),
  -- The maker it is for, for its logo (a connector's id); none for a generic key.
  maker text check (maker ~ '^[a-z][a-z0-9-]{0,40}$'),
  -- Who stored the live value and when; null while only a member's value waits.
  -- Without a person (`org set-secret`, a backfill), the name says «Ghostaff».
  stored_by uuid references auth.users (id) on delete set null,
  stored_by_name text,
  stored_at timestamptz,
  -- When a run last got it (apps/engine/src/runner.ts).
  last_used_at timestamptz,
  -- 'missing': the last run that needed it found the row but not the value in the vault.
  status text not null default 'ok' check (status in ('ok', 'missing')),
  -- A member's value waiting for an owner's approval.
  pending_by uuid references auth.users (id) on delete set null,
  pending_by_name text,
  pending_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name),
  check ((stored_at is null) = (stored_by_name is null)),
  check ((pending_at is null) = (pending_by_name is null)),
  check (stored_at is not null or pending_at is not null)
);

alter table public.org_secrets enable row level security;

create policy "members read their organisation's keys"
  on public.org_secrets for select to authenticated
  using (public.is_member(org_id));

-- No insert, update or delete policy: only the engine and apps/sync write, with the service role.
revoke insert, update, delete, truncate on public.org_secrets from anon, authenticated;
