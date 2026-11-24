-- Each organisation's own identity in Google Cloud (docs/architecture.md,
-- «A customer's Google Cloud»; docs/plans/ongoing/customer-cloud-access.md).
--
-- A customer lets Ghostaff into their Google Cloud by granting roles to a
-- service account that belongs to their organisation only, never to one
-- Ghostaff shares across customers: then an organisation that types another's
-- project gets Google's 403, whatever our code does. The engine creates the
-- account the first time an owner asks for it, in the environment's tenants
-- project, and keeps it for the organisation's life, so a customer's grants
-- survive reconnecting. It mints short-lived tokens as it; no key exists.
--
-- Only the engine reads or writes this table (service role). The email is no
-- secret, but the app asks the engine for it, which creates it if need be.

create table public.cloud_accounts (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  email text not null unique check (email ~ '^org-[0-9a-f]{24}@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$'),
  -- Google's numeric id: an account re-created under the same email is another account.
  unique_id text not null check (unique_id ~ '^[0-9]{10,30}$'),
  created_at timestamptz not null default now()
);

alter table public.cloud_accounts enable row level security;
revoke all on public.cloud_accounts from anon, authenticated;
