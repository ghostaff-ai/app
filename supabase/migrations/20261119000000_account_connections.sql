-- Accounts: an organisation's own accounts on outside services, connected by
-- signing in there and accepting (docs/plans/ongoing/connectors.md): Google,
-- and the makers' MCP servers. Same table as the AI connections, same rules:
-- never a token here (the engine keeps it in the vault), and only the engine
-- writes. Which account providers exist is the catalogue's business
-- (packages/shared/src/connectors.ts); here only their shape, so a connector
-- added there needs no migration.

alter table public.connections drop constraint connections_kind_check;
alter table public.connections add constraint connections_kind_check check (kind in ('ai', 'account'));

alter table public.connections drop constraint connections_provider_check;
alter table public.connections add constraint connections_provider_check check (
  (kind = 'ai' and provider in ('anthropic', 'openai', 'vertex'))
  or (kind = 'account' and provider ~ '^[a-z][a-z0-9]{1,30}$')
);

alter table public.connections drop constraint connections_method_check;
alter table public.connections add constraint connections_method_check
  check (method in ('api_key', 'cloud_project', 'oauth', 'mcp'));

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
  provider text not null check (provider ~ '^[a-z][a-z0-9]{1,30}$'),
  code_verifier text not null check (length(code_verifier) between 43 and 128),
  -- Where the person goes back to in the app; checked by the engine against its list.
  return_to text not null check (length(return_to) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.connection_attempts enable row level security;
revoke all on public.connection_attempts from anon, authenticated;

-- Actions an agent proposes that create or change something outside Ghostaff
-- with a connected account (publish a reel, answer a review, create an
-- invoice). The engine never runs one when the agent asks: it records it here
-- and shows it in the agent's message, and runs it only once an owner approves
-- (apps/engine/src/actions.ts). The engine runs what is stored here, never what
-- a message says, so editing a message cannot change an action. Members see an
-- organisation's actions in the threads they may see; only the engine writes.
create table public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  thread_id uuid not null references public.threads (id) on delete cascade,
  -- The agent's message that carries the action's card.
  message_id uuid not null references public.messages (id) on delete cascade,
  agent_id uuid references public.agents (id) on delete set null,
  tool text not null check (tool ~ '^[a-zA-Z0-9_-]{1,64}$'),
  input jsonb not null check (jsonb_typeof(input) = 'object'),
  -- What the person reads on the card, in Spanish.
  label text not null check (length(label) between 1 and 200),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'rejected')),
  -- What came of it: the link, or the error, as the tool said it.
  result text check (length(result) <= 4000),
  requested_by uuid references auth.users (id) on delete set null,
  decided_by uuid references auth.users (id) on delete set null,
  decided_by_name text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index agent_actions_thread on public.agent_actions (thread_id, created_at);
create index agent_actions_org_pending on public.agent_actions (org_id) where status = 'pending';

alter table public.agent_actions enable row level security;

create policy "members read the actions of threads they may see"
  on public.agent_actions for select to authenticated
  using (public.is_member(org_id) and public.thread_level(thread_id) <> 'none');

revoke insert, update, delete, truncate on public.agent_actions from anon, authenticated;
