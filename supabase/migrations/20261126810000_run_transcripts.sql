-- Each run's transcript on our runner (docs/plans/ongoing/ordago-agents-in-ghostaff.md,
-- «What Ghostaff builds for it», item 4): Claude Code's stream-json, redacted of
-- every secret the run held, gzipped, so an agent can read what it (and, when
-- its row says so, the other agents of its organisation) did in earlier runs.
-- Órdago's Dirección reads the others' for its weekly review.
--
-- The transcripts live in a private bucket of this project (Frankfurt:
-- invariant 2), at <org_id>/<agent_id>/<run_id>.jsonl.gz. Only the engine reads
-- and writes there, with the service role: there is no policy at all, so no
-- person reaches them through the Storage API. A run reads them only through
-- the engine, which checks that the run it reads is of its own organisation
-- (invariant 1) and of its own agent, or that its agent reads its
-- organisation's runs. They are kept 90 days, like the old system's bucket;
-- the tick deletes older ones through the Storage API.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('run-transcripts', 'run-transcripts', false, 20971520, array['application/gzip'])
on conflict (id) do nothing;

-- Whether the agent's runs may read the runs of the other agents of its
-- organisation (Órdago's Dirección); every agent reads its own. Only the
-- service role sets it (20261117000000_agents.sql): `org add-agents` from the
-- agent's yaml, or by hand.
alter table public.agents add column reads_org_runs boolean not null default false;

-- Where the run's transcript is in the bucket; null while it has none (the
-- run has not ended, it ended before Claude Code ran, or the upload failed).
-- Members already read their organisation's runs; nothing here is secret.
alter table public.agent_runs
  add column transcript_path text check (transcript_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jsonl\.gz$');

/**
 * The transcripts stored before `before`, oldest first: what the tick deletes
 * through the Storage API (deleting the rows here would leave the files). It
 * reads the bucket, not agent_runs, so a transcript whose run or agent was
 * deleted goes too. The engine's alone.
 */
create function public.expired_run_transcripts(before timestamptz, max_rows integer default 200)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'run-transcripts' and o.created_at < before
  order by o.created_at
  limit least(greatest(max_rows, 1), 1000);
$$;

revoke execute on function public.expired_run_transcripts(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.expired_run_transcripts(timestamptz, integer) to service_role;
