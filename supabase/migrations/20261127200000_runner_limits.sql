-- What the legacy start-up of Órdago's agents (ghostaff-ai/agents' arranque) gives each agent and our
-- runner did not (docs/plans/ongoing/ordago-agents-in-ghostaff.md, «What Ghostaff builds for it», item 4).
--
-- On the agent row, set by `org add-agents` from each yaml (apps/sync/src/agents.ts):
-- - how long a run may take (`recursos.timeout`), passed to Cloud Run as the execution's timeout;
-- - its size (`recursos.cpu`/`memoria`): Cloud Run cannot change CPU or memory per execution, so each
--   size is its own job (scripts/deploy-runner.sh), and the engine starts the agent's;
-- - its `ritmo`: at most so many runs of its timetable a day (Madrid), and none while the CI of a repo
--   it opens pull requests to has more than so many runs queued.
--
-- On the run:
-- - never two runs of one agent on our runner at once, held by a unique index: the second insert fails,
--   whichever tick or request gets there second;
-- - a fire of the timetable that did not run is kept as a `skipped` run with why, so how often an agent
--   is held back can be read and its `ritmo` tuned (the legacy's arranque/metricas.py);
-- - when the engine stops waiting for it (its timeout and a margin), and how it ended: its turns and
--   Claude Code's result subtype.

alter table public.agents
  add column timeout_seconds integer not null default 3600 check (timeout_seconds between 60 and 10800),
  add column size text not null default 'standard' check (size in ('standard', 'large')),
  add column max_runs_per_day integer check (max_runs_per_day between 1 and 48),
  add column ci_repo text check (ci_repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  add column max_ci_queued integer check (max_ci_queued between 0 and 100),
  add constraint agents_ci_rule_complete check ((ci_repo is null) = (max_ci_queued is null));

alter table public.agent_runs drop constraint agent_runs_state_check;
alter table public.agent_runs
  add constraint agent_runs_state_check check (state in ('running', 'done', 'failed', 'skipped')),
  -- Why a fire of its timetable did not run: another run of it was going, the day's cap, or the CI.
  add column skip_reason text check (skip_reason in ('busy', 'daily_cap', 'ci_busy', 'ci_unreadable')),
  add constraint agent_runs_skipped_why check ((state = 'skipped') = (skip_reason is not null)),
  -- Past this, a run still «running» died without reporting, and the tick closes it.
  add column deadline_at timestamptz,
  add column turns integer check (turns between 0 and 100000),
  -- Claude Code's `result` subtype: success, error_max_turns, error_during_execution…
  add column ending text check (ending ~ '^[a-z_]{1,40}$');

-- Runs on our runner are those with a nonce; the legacy jobs keep their own lock in Órdago's bucket.
create unique index agent_runs_one_running on public.agent_runs (agent_id) where state = 'running' and nonce_hash is not null;

-- For the day's cap: the timetable's runs of an agent since a given instant.
create index agent_runs_agent_origin on public.agent_runs (agent_id, origin, started_at desc);

grant select (skip_reason, turns, ending) on public.agent_runs to authenticated;
