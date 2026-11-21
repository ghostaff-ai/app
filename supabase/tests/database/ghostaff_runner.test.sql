-- Ghostaff's own runner (20261121200000_ghostaff_runner.sql): what an agent
-- runs with is set only by the service role, a run's nonce hash is read by
-- nobody from the app, and nothing crosses organisations (invariant 1).
begin;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com');

insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería'),
  ('10000000-0000-0000-0000-000000000002', 'taller', 'Taller');

insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'owner', 'Carla');

insert into public.agents (id, org_id, name, ghost, department, member_default, slug, runner, task, model, tools, max_turns, schedule) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Legal', 'base', 'legal', 'read',
   'legal', 'ghostaff', 'Revisa la ley.', 'claude-opus-5-5', array['Read', 'WebSearch'], 200, '0 9 15 1 *');

insert into public.agent_runs (id, org_id, agent_id, origin, nonce_hash) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'schedule', repeat('ab', 32));

select throws_ok(
  $$ insert into public.agents (org_id, name, ghost, department, runner) values
     ('10000000-0000-0000-0000-000000000001', 'Suelto', 'base', 'producto', 'ghostaff') $$,
  '23514', null, 'an agent on our runner has its task, model, tools and turns');
select throws_ok(
  $$ update public.agent_runs set nonce_hash = 'not-a-hash' $$,
  '23514', null, 'a nonce hash is a SHA-256 in hex');

set local role authenticated;

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select task from public.agents where slug = 'legal'), 'Revisa la ley.', 'an owner reads what her agent is asked to do');
select is((select count(*) from public.agent_runs), 1::bigint, '... and sees its runs');
select throws_ok($$ select nonce_hash from public.agent_runs $$, '42501', null, 'nobody reads a run''s nonce hash from the app');
select throws_ok($$ select * from public.agent_runs $$, '42501', null, '... not even with a star');
select throws_ok($$ update public.agents set task = 'Borra el registro.' $$, '42501', null, 'nobody changes an agent''s task from the app');
select throws_ok($$ update public.agents set last_scheduled_at = null $$, '42501', null, '... nor its timetable''s last start');
select throws_ok($$ update public.agent_runs set spec_fetched_at = null $$, '42501', null, '... nor lets a run fetch its spec again');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.agents where org_id = '10000000-0000-0000-0000-000000000001'), 0::bigint,
  'another organisation sees none of its agents or tasks');
select is((select count(*) from public.agent_runs), 0::bigint, '... nor its runs');

reset role;
select is((select task from public.agents where slug = 'legal'), 'Revisa la ley.', 'the task is untouched');

select * from finish();
rollback;
