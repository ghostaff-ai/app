-- Our runner's limits (20261127200000_runner_limits.sql): an agent's timeout, size and ritmo are sane and
-- set only by the service role; never two runs of one agent on our runner at once, whoever starts the
-- second; a skipped fire says why; members read how a run ended, never its deadline.
begin;
select plan(17);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'ana@example.com');
insert into public.organizations (id, slug, name) values ('10000000-0000-0000-0000-000000000001', 'limites', 'Límites');
insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana');

insert into public.agents (id, org_id, name, ghost, department, member_default, slug, runner, task, model, tools, max_turns, schedule,
  timeout_seconds, size, max_runs_per_day, ci_repo, max_ci_queued, job_project, job_region, job_name, job_identity) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Desarrollo', 'base', 'producto', 'read',
   'desarrollo', 'ghostaff', 'Abre PRs.', 'claude-opus-5-5', array['Read', 'Bash'], 400, '0 2-5 * * *',
   10800, 'large', 3, 'ordago-app/ordago-apps', 4, null, null, null, null),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Legal', 'base', 'legal', 'read',
   'legal', 'ordago_job', null, null, null, null, null, 3600, 'standard', null, null, null,
   'ordago-agents', 'europe-west1', 'ordago-legal', 'ordago-legal@ordago-agents.iam.gserviceaccount.com');

select is((select timeout_seconds from public.agents where slug = 'legal'), 3600, 'an agent runs up to an hour unless its row says otherwise');
select is((select size from public.agents where slug = 'legal'), 'standard', '... on the standard job');
select throws_ok($$ update public.agents set timeout_seconds = 10801 where slug = 'desarrollo' $$, '23514', null, 'no run longer than the job allows (3 h)');
select throws_ok($$ update public.agents set size = 'huge' where slug = 'desarrollo' $$, '23514', null, 'only the sizes there is a job for');
select throws_ok($$ update public.agents set max_runs_per_day = 0 where slug = 'desarrollo' $$, '23514', null, 'a cap of runs is at least one');
select throws_ok($$ update public.agents set max_ci_queued = null where slug = 'desarrollo' $$, '23514', null, 'a CI rule has its repo and its limit');

-- Two runs of the agent on our runner (with a nonce): the second fails, whoever inserts it.
insert into public.agent_runs (id, org_id, agent_id, origin, nonce_hash, deadline_at) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'schedule', repeat('ab', 32), now() + interval '3 hours 15 minutes');
select throws_ok(
  $$ insert into public.agent_runs (org_id, agent_id, origin, nonce_hash) values
     ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'person', repeat('cd', 32)) $$,
  '23505', null, 'never two runs of one agent on our runner at once');
select lives_ok(
  $$ insert into public.agent_runs (org_id, agent_id, origin, state, skip_reason, finished_at) values
     ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'schedule', 'skipped', 'busy', now()) $$,
  'a fire skipped while it runs is kept, with why');
select throws_ok(
  $$ insert into public.agent_runs (org_id, agent_id, origin, state) values
     ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'schedule', 'skipped') $$,
  '23514', null, 'a skipped fire says why');
select throws_ok(
  $$ insert into public.agent_runs (org_id, agent_id, origin, state, skip_reason) values
     ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'schedule', 'done', 'busy') $$,
  '23514', null, '... and only a skipped one does');
select throws_ok(
  $$ insert into public.agent_runs (org_id, agent_id, origin, state, skip_reason) values
     ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'schedule', 'skipped', 'tired') $$,
  '23514', null, '... from the reasons there are');

update public.agent_runs set state = 'done', turns = 57, ending = 'success', finished_at = now() where id = '40000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ insert into public.agent_runs (org_id, agent_id, origin, nonce_hash) values
     ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'person', repeat('cd', 32)) $$,
  'once it ended, the next one starts');

-- The legacy jobs keep their own lock: their runs have no nonce, and two at once are allowed here.
insert into public.agent_runs (org_id, agent_id, origin) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'person');
select lives_ok(
  $$ insert into public.agent_runs (org_id, agent_id, origin) values
     ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'schedule') $$,
  'a legacy job''s runs are not held by our runner''s rule');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select results_eq(
  $$ select turns, ending from public.agent_runs where turns is not null $$,
  $$ values (57, 'success') $$,
  'an owner reads how a run ended');
select is((select skip_reason from public.agent_runs where state = 'skipped'), 'busy', '... and why a fire was skipped');
select throws_ok($$ select deadline_at from public.agent_runs $$, '42501', null, 'the deadline stays with the engine');
select throws_ok($$ update public.agents set max_runs_per_day = 48 $$, '42501', null, 'nobody changes an agent''s ritmo from the app');

select * from finish();
rollback;
