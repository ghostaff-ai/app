-- Guided access: a guide that walks a person through giving an agent access to
-- an app the catalogue lacks, such as a self-hosted WordPress
-- (docs/plans/ready/guided-access.md). The guide is one row, moved by the
-- engine alone: row-level security on and no policy at all, so the app goes
-- through the engine. `history` holds the steps shown and the answers given,
-- never a secret (that lives in the vault from the moment the check passes).
create table public.guides (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  thread_id uuid not null references public.threads (id) on delete cascade,
  -- The agent's message that carries the guide.
  message_id uuid not null references public.messages (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  app text not null check (length(app) between 1 and 80),
  goal text not null check (length(goal) between 1 and 200),
  why text not null,
  landing jsonb not null check (jsonb_typeof(landing) = 'object'),
  history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  -- open → checked → done | rejected (a member completes it); open → done (an owner);
  -- open → blocked | handed_over (a wall, or the catalogue's button took over).
  status text not null default 'open'
    check (status in ('open', 'checked', 'done', 'rejected', 'blocked', 'handed_over')),
  blocked_reason text,
  -- How to remove the access, written by the model on the last step.
  undo text,
  started_by uuid references auth.users (id) on delete set null,
  completed_by uuid references auth.users (id) on delete set null,
  decided_by uuid references auth.users (id) on delete set null,
  resumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index guides_thread on public.guides (thread_id);

alter table public.guides enable row level security;
revoke all on public.guides from anon, authenticated;

-- The access a guide ends in is a connection, read by members like any other.
-- Its provider is `x` plus the app's slug (xwordpress). It never mixes with a
-- catalogue id: it lives under kind 'guided', belongs to one agent, and never
-- enters agents.accounts.
alter table public.connections drop constraint connections_kind_check;
alter table public.connections add constraint connections_kind_check check (kind in ('ai', 'account', 'guided'));

alter table public.connections drop constraint connections_provider_check;
alter table public.connections add constraint connections_provider_check check (
  (kind = 'ai' and provider in ('anthropic', 'openai', 'vertex', 'claude'))
  or (kind = 'account' and provider ~ '^[a-z][a-z0-9]{1,30}$')
  or (kind = 'guided' and provider ~ '^x[a-z0-9]{1,30}$')
);

alter table public.connections drop constraint connections_method_check;
alter table public.connections add constraint connections_method_check
  check (method in ('api_key', 'cloud_project', 'oauth', 'mcp', 'subscription', 'guided'));

-- A guided access belongs to one agent; no other kind has one.
alter table public.connections add column agent_id uuid references public.agents (id) on delete cascade;
alter table public.connections add constraint connections_guided_check
  check ((kind = 'guided') = (agent_id is not null) and (kind = 'guided') = (method = 'guided'));
create unique index connections_one_guided_per_agent
  on public.connections (org_id, agent_id, provider) where kind = 'guided';
