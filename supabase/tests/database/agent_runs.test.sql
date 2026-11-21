-- What agents did on their own (20261121100000_agent_runners.sql): a run is
-- read by those who may see its agent, never across organisations, and only
-- the engine records it (invariant 1). An agent's runner and the account that
-- reports for it are set only by the service role.
begin;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com');

insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería'),
  ('10000000-0000-0000-0000-000000000002', 'taller', 'Taller');

insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'member', 'Bea'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'owner', 'Carla');

insert into public.agents (id, org_id, name, ghost, department, member_default, slug, runner, job_project, job_region, job_name, job_identity) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Legal', 'base', 'legal', 'read',
   'legal', 'ordago_job', 'ordago-agents', 'europe-west1', 'ordago-legal', 'ordago-legal@ordago-agents.iam.gserviceaccount.com'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Finanzas', 'finanzas', 'finanzas', 'none',
   'finanzas', 'chat', null, null, null, null);

insert into public.agent_runs (org_id, agent_id, origin, state, summary, noteworthy) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'schedule', 'done', 'Revisé la ley de Murcia.', true),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'schedule', 'done', 'Cuadré octubre.', false);

select throws_ok(
  $$ insert into public.agents (org_id, name, ghost, department, runner) values
     ('10000000-0000-0000-0000-000000000001', 'Suelto', 'base', 'producto', 'ordago_job') $$,
  '23514', null, 'a job agent says where its job is and who reports for it');
select throws_ok(
  $$ insert into public.agents (org_id, name, ghost, department, job_identity) values
     ('10000000-0000-0000-0000-000000000002', 'Copia', 'base', 'legal', 'ordago-legal@ordago-agents.iam.gserviceaccount.com') $$,
  '23505', null, 'one account reports for one agent only');

set local role authenticated;

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select count(*) from public.agent_runs), 2::bigint, 'an owner sees every run of her organisation');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select results_eq($$ select summary from public.agent_runs $$, $$ values ('Revisé la ley de Murcia.') $$,
  'a member sees the runs of the agents she may see, not the others');
select is((select runner from public.agents where slug = 'legal'), 'ordago_job', 'she reads how the agent runs');
select throws_ok(
  $$ insert into public.agent_runs (org_id, agent_id, origin) values
     ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'person') $$,
  '42501', null, 'nobody records a run from the app');
select throws_ok($$ update public.agent_runs set summary = 'otra cosa' $$, '42501', null, '... nor changes one');
select throws_ok($$ update public.agents set job_identity = 'x@y-z.iam.gserviceaccount.com' $$, '42501', null,
  'nobody changes who reports for an agent from the app');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.agent_runs), 0::bigint, 'another organisation sees none of its runs');

reset role;
select is((select count(*) from public.agent_runs), 2::bigint, 'both runs still there');

select * from finish();
rollback;
