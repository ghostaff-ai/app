-- The record connector (docs/plans/ongoing/ordago-agents-in-ghostaff.md, step 1).
--
-- An organisation's record is a git repo. While Órdago migrates it stays on
-- GitHub, reached through our GitHub App «Ghostaff Registro» installed on that
-- one repo; the engine syncs it on a schedule. Members read where their
-- record lives and how the last sync went; only the service role (the sync
-- CLI, the engine) sets or changes it.

alter table public.organizations
  add column record_repo text check (record_repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  add column record_installation bigint check (record_installation > 0),
  add column record_synced_at timestamptz,
  add column record_sync_error text check (length(record_sync_error) <= 500),
  add constraint organizations_record_complete check ((record_repo is null) = (record_installation is null));

-- One repo is one organisation's record, never two (invariant 1).
create unique index organizations_record_repo on public.organizations (lower(record_repo)) where record_repo is not null;
