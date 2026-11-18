-- Accounts: an organisation's own accounts on outside services, connected by
-- signing in there and accepting (docs/plans/ongoing/connectors.md). Google is
-- the first. Same table as the AI connections, same rules: never a token here
-- (the engine keeps it in the vault), and only the engine writes.

alter table public.connections drop constraint connections_kind_check;
alter table public.connections add constraint connections_kind_check check (kind in ('ai', 'account'));

alter table public.connections drop constraint connections_provider_check;
alter table public.connections add constraint connections_provider_check
  check (provider in ('anthropic', 'openai', 'vertex', 'google'));

alter table public.connections drop constraint connections_method_check;
alter table public.connections add constraint connections_method_check
  check (method in ('api_key', 'cloud_project', 'oauth'));

-- A connect in progress: the owner has been sent to the provider and has not
-- come back yet. `state` travels to the provider and back and is the only way
-- to find the row; `code_verifier` (PKCE) proves the code that comes back was
-- asked for here. Short-lived: the engine refuses a row older than ten
-- minutes and deletes it when it is used. Nobody reads or writes it from the
-- app: no policy at all, so the service role is the only way in.
create table public.connection_attempts (
  state text primary key check (length(state) between 32 and 128),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google')),
  code_verifier text not null check (length(code_verifier) between 43 and 128),
  -- Where the person goes back to in the app; checked by the engine against its list.
  return_to text not null check (length(return_to) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.connection_attempts enable row level security;
revoke all on public.connection_attempts from anon, authenticated;
