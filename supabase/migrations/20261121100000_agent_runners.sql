-- How each agent runs, and what its runs did
-- (docs/plans/ongoing/ordago-agents-in-ghostaff.md, steps 2 and 3).
--
-- While Órdago's agents migrate, an agent runs one of three ways:
--   chat        only answers in the team chat (every agent so far);
--   ordago_job  still a Cloud Run job in Órdago's project (ghostaff-ai/agents):
--               the engine starts it with what a person wrote, and the job
--               reports back to the engine when it ends;
--   ghostaff    our own runner, in Ghostaff's project (step 5).
-- `job_identity` is the service account a job reports as: the engine accepts a
-- report only from the account registered for that agent (decision 7).
--
-- Members read their agents' runner details (nothing secret: where it runs,
-- its timetable, its job); only the service role sets them.

alter table public.agents drop constraint agents_department_check;
alter table public.agents add constraint agents_department_check
  check (department in ('direccion', 'finanzas', 'legal', 'producto', 'marketing'));

alter table public.agents
  -- Its name in its runner (`legal`, the file proyectos/ordago/agentes/legal.yaml).
  add column slug text check (slug ~ '^[a-z][a-z0-9_-]{0,40}$'),
  add column runner text not null default 'chat' check (runner in ('chat', 'ordago_job', 'ghostaff')),
  add column description text check (length(description) <= 1000),
  -- Cron, in Madrid time, as its runner reads it; null when it only works when asked.
  add column schedule text check (length(schedule) <= 100),
  add column job_project text check (job_project ~ '^[a-z][a-z0-9-]{4,28}[a-z0-9]$'),
  add column job_region text check (job_region ~ '^[a-z]+-[a-z]+[0-9]$'),
  add column job_name text check (job_name ~ '^[a-z][a-z0-9-]{0,62}$'),
  add column job_identity text check (job_identity ~ '^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$'),
  add constraint agents_job_complete check (
    runner <> 'ordago_job' or (job_project is not null and job_region is not null and job_name is not null and job_identity is not null)
  );

create unique index agents_org_slug on public.agents (org_id, slug) where slug is not null;
-- One service account reports for one agent only.
create unique index agents_job_identity on public.agents (job_identity) where job_identity is not null;

-- Runs -----------------------------------------------------------------------

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  -- `person`: someone asked in a thread; `schedule`: its timetable started it.
  origin text not null check (origin in ('person', 'schedule')),
  requested_by uuid references auth.users (id) on delete set null,
  thread_id uuid references public.threads (id) on delete set null,
  -- The agent's message that waits for this run's answer.
  message_id uuid references public.messages (id) on delete set null,
  state text not null default 'running' check (state in ('running', 'done', 'failed')),
  -- What the agent said at the end, as it says it to people.
  summary text check (length(summary) <= 20000),
  -- Whether it had something to tell people (else it is only in «Hecho sin ti»).
  noteworthy boolean not null default false,
  decisions_opened integer not null default 0 check (decisions_opened >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index agent_runs_org_recent on public.agent_runs (org_id, started_at desc);
create index agent_runs_agent on public.agent_runs (agent_id, started_at desc);

alter table public.agent_runs enable row level security;

create policy "members read the runs of agents they may see"
  on public.agent_runs for select to authenticated
  using (public.is_member(org_id) and public.agent_level(agent_id) <> 'none');

revoke insert, update, delete, truncate on public.agent_runs from anon, authenticated;
