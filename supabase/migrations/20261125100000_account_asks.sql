-- An agent asking, in its message, for an account it lacks (docs/plans/ongoing/
-- connector-in-chat.md): «Necesito acceso a Notion» with a button to connect.
-- The card is a part of the message; this row is what the engine trusts when
-- someone asks it to let the agent go on, and moves open → done exactly once,
-- so two presses cannot make the agent answer twice. Only the engine reads and
-- writes it (the app reads the card in the message): no policy at all.
create table public.account_asks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  thread_id uuid not null references public.threads (id) on delete cascade,
  -- The agent's message that carries the card.
  message_id uuid not null references public.messages (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  -- The catalogue's id (packages/shared/src/connectors.ts); null for an app it lacks.
  connector text check (connector ~ '^[a-z][a-z0-9]{1,30}$'),
  -- The app's name as the person reads it.
  name text not null check (length(name) between 1 and 80),
  need text not null check (need in ('connect', 'reconnect', 'grant', 'unsupported')),
  status text not null default 'open' check (status in ('open', 'done')),
  requested_by uuid references auth.users (id) on delete set null,
  done_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  check ((connector is null) = (need = 'unsupported'))
);

create index account_asks_thread on public.account_asks (thread_id);

alter table public.account_asks enable row level security;
revoke all on public.account_asks from anon, authenticated;
