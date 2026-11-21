-- Ghostaff's own agent runner (docs/plans/ongoing/ordago-agents-in-ghostaff.md, step 5).
--
-- An agent with runner `ghostaff` runs as the Cloud Run job `agent-runner` in
-- Ghostaff's project: the unmodified Claude Code in a container. Its row
-- carries what that run needs: its task (the prompt), model, tools and turns,
-- and when its timetable last started it, so the tick starts a scheduled run
-- once. Members already read agent rows: nothing here is secret. The org's
-- Claude credential and the record token never touch the database; the engine
-- hands them to the run from the vault and GitHub.
--
-- One service account runs every organisation's agents, so a run proves it is
-- itself with a one-time nonce the engine gave it at launch. Only the nonce's
-- SHA-256 is stored, and members cannot read even that.

alter table public.agents
  add column task text check (length(task) <= 40000),
  add column model text check (model ~ '^[a-z0-9][a-z0-9.\[\]-]{0,63}$'),
  add column tools text[] check (cardinality(tools) <= 60),
  add column max_turns integer check (max_turns between 1 and 1000),
  -- The last time the tick started it by its timetable (or when it was set up to run here).
  add column last_scheduled_at timestamptz,
  add constraint agents_ghostaff_complete check (
    runner <> 'ghostaff' or (task is not null and model is not null and tools is not null and max_turns is not null)
  );

alter table public.agent_runs
  -- SHA-256 (hex) of the run's one-time nonce; null for runs of other runners.
  add column nonce_hash text check (nonce_hash ~ '^[0-9a-f]{64}$'),
  -- When the run fetched its spec: once only.
  add column spec_fetched_at timestamptz;

-- Members read a run's public columns only (packages/shared lists them); the nonce's hash stays with the engine.
revoke select on public.agent_runs from anon, authenticated;
grant select (id, org_id, agent_id, origin, requested_by, thread_id, message_id, state, summary, noteworthy,
  decisions_opened, started_at, finished_at) on public.agent_runs to authenticated;
