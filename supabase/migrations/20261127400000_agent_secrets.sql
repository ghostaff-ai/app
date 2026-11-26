-- The organisation's secrets an agent on our runner gets as environment
-- variables of Claude Code (docs/plans/ongoing/ordago-agents-in-ghostaff.md,
-- «What Ghostaff builds for it», item 3). A map {"ENV_VAR": "name"}, like the
-- `secretos:` of a ghostaff-ai/agents yaml: each name is an organisation's
-- secret in the vault (`org-<org>-secret-<name>`, apps/engine/src/vault.ts),
-- which several agents may share. Only names live here, never a value.
--
-- A variable may not replace one the runner sets or one that changes how
-- Claude Code, gcloud, git, a shell or the loader behave; the runner checks the
-- same again (apps/runner/src/lib.ts, isSecretEnv). Members read agent rows,
-- and nothing here is secret; only the service role writes them
-- (20261117000000_agents.sql).

create function public.agent_secret_env_valid(env text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select env ~ '^[A-Z][A-Z0-9_]{0,63}$'
    and env not in ('HOME', 'PATH', 'LANG', 'USER', 'SHELL', 'PWD', 'TMPDIR', 'BASH_ENV', 'ENV', 'IFS')
    and env !~ '^(CLAUDE_|ANTHROPIC_|CLOUDSDK_|GOOGLE_|GHOSTAFF_|GIT_|LD_|NODE_|SSH_)';
$$;

create function public.agent_secrets_valid(secrets jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(secrets) = 'object'
    and (select count(*) from jsonb_object_keys(secrets)) <= 20
    and not exists (
      select 1
      from jsonb_each(secrets) as s (env, name)
      where not public.agent_secret_env_valid(s.env)
        or jsonb_typeof(s.name) <> 'string'
        or (s.name #>> '{}') !~ '^[a-z][a-z0-9-]{0,62}$'
    );
$$;

alter table public.agents
  add column secrets jsonb not null default '{}'::jsonb check (public.agent_secrets_valid(secrets));
