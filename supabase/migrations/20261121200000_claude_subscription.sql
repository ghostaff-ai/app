-- A Claude subscription as an organisation's AI connection: an owner signs in
-- through the unmodified Claude Code, which the engine runs for them
-- (apps/engine/src/claudeSession.ts, docs/plans/ongoing/llm-connectors.md).
-- Same rules as a key: the token lives in the vault, this row keeps only its
-- last 4 characters, and only the engine writes.

alter table public.connections drop constraint connections_provider_check;
alter table public.connections add constraint connections_provider_check check (
  (kind = 'ai' and provider in ('anthropic', 'openai', 'vertex', 'claude'))
  or (kind = 'account' and provider ~ '^[a-z][a-z0-9]{1,30}$')
);

alter table public.connections drop constraint connections_method_check;
alter table public.connections add constraint connections_method_check
  check (method in ('api_key', 'cloud_project', 'oauth', 'mcp', 'subscription'));

-- A subscription is only ever Claude's, and Claude only connects by subscription.
alter table public.connections add constraint connections_subscription_check
  check ((method = 'subscription') = (kind = 'ai' and provider = 'claude'));
