-- Routines (20261126000000_agent_routines.sql, 20261128710000_routines_for_everyone.sql):
-- every routine is the team's. Anyone who talks to the agent makes one; its
-- creator or an owner changes, pauses or deletes it; whoever sees the agent
-- sees its routines and their runs; nothing across organisations; ten per
-- person; the app never writes the table, and the engine's helpers are the
-- engine's alone.
begin;
select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'dani@example.com');

insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería'),
  ('10000000-0000-0000-0000-000000000002', 'taller', 'Taller');

insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'member', 'Bea'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 'member', 'Dani'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'owner', 'Carla');

-- Finanzas: Bea talks to it, Dani only reads it. Legal is still one of Órdago's jobs.
insert into public.agents (id, org_id, name, ghost, department, member_default, slug, runner, job_project, job_region, job_name, job_identity, is_main) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Secretaría', 'secretaria', 'direccion', 'talk', null, 'chat', null, null, null, null, true),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Finanzas', 'finanzas', 'finanzas', 'read', null, 'chat', null, null, null, null, false),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Legal', 'base', 'legal', 'talk',
   'legal', 'ordago_job', 'ordago-agents', 'europe-west1', 'ordago-legal', 'ordago-legal@ordago-agents.iam.gserviceaccount.com', false),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'Finanzas', 'finanzas', 'finanzas', 'read', null, 'chat', null, null, null, null, false);
insert into public.agent_access (org_id, agent_id, user_id, level) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'talk');

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;

-- Bea, a member who talks to Finanzas.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
insert into ids select 'bea', id from public.create_routine(
  '20000000-0000-0000-0000-000000000002', 'Resumen de ventas', 'Mándame el resumen de ventas de la semana', 'days', '{5}', null, 9::smallint, 0::smallint);
select is((select title from public.agent_routines where id = (select id from ids where name = 'bea')), 'Resumen de ventas',
  'a member makes a routine with an agent she talks to');
select ok((select last_fired_at <= now() from public.agent_routines where id = (select id from ids where name = 'bea')),
  '... starting from now, so nothing gone fires');
select hasnt_column('public', 'agent_routines', 'audience', 'there is no «Solo para mí»: every routine is the team''s');
select throws_ok(
  $$ select public.create_routine('20000000-0000-0000-0000-000000000003', 'Ley', 'Mira la ley', 'days', null, null, 9::smallint, 0::smallint) $$,
  '22023', null, 'an agent still run as Órdago''s job takes no routines');
select throws_ok(
  $$ select public.create_routine('20000000-0000-0000-0000-000000000002', 'Mal', 'Mal', 'monthly', null, null, 9::smallint, 0::smallint) $$,
  '23514', null, 'a monthly routine needs its day');
select throws_ok(
  $$ select public.create_routine('20000000-0000-0000-0000-000000000002', 'Mal', 'Mal', 'days', '{8}', null, 9::smallint, 0::smallint) $$,
  '23514', null, 'weekdays are 1 to 7');
select throws_ok(
  $$ select public.create_routine('20000000-0000-0000-0000-000000000004', 'Fuera', 'Fuera', 'days', null, null, 9::smallint, 0::smallint) $$,
  '42501', null, 'nobody makes a routine with another organisation''s agent');
select throws_ok(
  $$ insert into public.agent_routines (org_id, agent_id, title, instruction, kind, hour)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'x', 'x', 'days', 9) $$,
  '42501', null, 'the app never writes the table');

-- Ten per person.
do $$ begin
  for n in 1..9 loop
    perform public.create_routine('20000000-0000-0000-0000-000000000002', 'Otra ' || n, 'Algo', 'days', null, null, 8::smallint, 0::smallint);
  end loop;
end $$;
select throws_ok(
  $$ select public.create_routine('20000000-0000-0000-0000-000000000002', 'Once', 'Algo', 'days', null, null, 8::smallint, 0::smallint) $$,
  '54000', null, 'ten routines per person at most');
select lives_ok(
  $$ select public.update_routine((select id from ids where name = 'bea'), 'Ventas', 'Resumen corto', 'days', '{1,5}', null, 8::smallint, 30::smallint) $$,
  'she changes her own');
select results_eq($$ select weekdays, hour, minute from public.agent_routines where id = (select id from ids where name = 'bea') $$,
  $$ values ('{1,5}'::smallint[], 8::smallint, 30::smallint) $$, '... as she said');

-- Dani only reads Finanzas.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000d", "role": "authenticated"}';
select throws_ok(
  $$ select public.create_routine('20000000-0000-0000-0000-000000000002', 'Yo', 'Algo', 'days', null, null, 9::smallint, 0::smallint) $$,
  '42501', null, 'a member who only reads an agent makes no routine with it');
select is((select count(*) from public.agent_routines where id = (select id from ids where name = 'bea')), 1::bigint,
  '... but sees the routines of the agents she sees, Bea''s too');
select throws_ok($$ select public.set_routine_paused((select id from ids where name = 'bea'), true) $$, '42501', null,
  '... and pauses none she didn''t make');
select throws_ok($$ select public.update_routine((select id from ids where name = 'bea'), 'x', 'x', 'days', null, null, 9::smallint, 0::smallint) $$,
  '42501', null, '... nor changes it');

-- Ana, an owner.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select count(*) from public.agent_routines), 10::bigint, 'an owner sees every routine');
select lives_ok($$ select public.set_routine_paused((select id from ids where name = 'bea'), true) $$, '... pauses a member''s');
select lives_ok($$ select public.set_routine_paused((select id from ids where name = 'bea'), false) $$, '... and resumes it');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.agent_routines), 0::bigint, 'another organisation sees none of them');

-- Runs and the engine's helpers.
reset role;
insert into public.agent_runs (org_id, agent_id, origin, state, summary, routine_id) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'routine', 'done', 'Ventas: 1.200 €', (select id from ids where name = 'bea'));
select is(public.notify_owners('10000000-0000-0000-0000-000000000001', 'He pausado una rutina.'), 1, 'the main agent says it once, in its chat');
select is((select count(*)::int from public.messages m join public.agents a on a.id = m.author_agent where a.is_main), 1, '... one message');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000d", "role": "authenticated"}';
select results_eq($$ select summary from public.agent_runs $$, $$ values ('Ventas: 1.200 €') $$,
  'whoever sees the agent sees its routines'' runs');
select throws_ok($$ select public.notify_owners('10000000-0000-0000-0000-000000000001', 'x') $$, '42501', null,
  'only the engine writes as the main agent');

-- Ana deletes Bea's routine: an owner may.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select lives_ok($$ select public.delete_routine((select id from ids where name = 'bea')) $$, 'an owner deletes a member''s routine');

select * from finish();
rollback;
