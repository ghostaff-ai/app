-- Routines (20261126000000_agent_routines.sql): a member makes them only with
-- an agent she may talk to, and only «Solo para mí»; the team's are an
-- owner's. Nobody sees someone else's «Solo para mí», an owner included, nor
-- its runs; nothing across organisations; ten per person; the app never
-- writes the table, and the engine's helpers are the engine's alone.
begin;
select plan(25);

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
insert into public.agents (id, org_id, name, ghost, department, member_default, slug, runner, job_project, job_region, job_name, job_identity) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Secretaría', 'secretaria', 'direccion', 'talk', null, 'chat', null, null, null, null),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Finanzas', 'finanzas', 'finanzas', 'read', null, 'chat', null, null, null, null),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Legal', 'base', 'legal', 'talk',
   'legal', 'ordago_job', 'ordago-agents', 'europe-west1', 'ordago-legal', 'ordago-legal@ordago-agents.iam.gserviceaccount.com'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'Finanzas', 'finanzas', 'finanzas', 'read', null, 'chat', null, null, null, null);
insert into public.agent_access (org_id, agent_id, user_id, level) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'talk');

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;

-- Bea, a member who talks to Finanzas.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
insert into ids select 'bea', id from public.create_routine(
  '20000000-0000-0000-0000-000000000002', 'me', 'Resumen de ventas', 'Mándame el resumen de ventas de la semana', 'days', '{5}', null, 9::smallint, 0::smallint);
select is((select title from public.agent_routines where id = (select id from ids where name = 'bea')), 'Resumen de ventas',
  'a member makes a routine for herself with an agent she talks to');
select ok((select last_fired_at <= now() from public.agent_routines where id = (select id from ids where name = 'bea')),
  '... starting from now, so nothing gone fires');
select throws_ok(
  $$ select public.create_routine('20000000-0000-0000-0000-000000000002', 'team', 'Cierre', 'Cuadra el mes', 'monthly', null, 1::smallint, 9::smallint, 0::smallint) $$,
  '42501', null, '... but not for the team: that is an owner''s');
select throws_ok(
  $$ select public.create_routine('20000000-0000-0000-0000-000000000003', 'me', 'Ley', 'Mira la ley', 'days', null, null, 9::smallint, 0::smallint) $$,
  '22023', null, 'an agent still run as Órdago''s job takes no routines');
select throws_ok(
  $$ select public.create_routine('20000000-0000-0000-0000-000000000002', 'me', 'Mal', 'Mal', 'monthly', null, null, 9::smallint, 0::smallint) $$,
  '23514', null, 'a monthly routine needs its day');
select throws_ok(
  $$ select public.create_routine('20000000-0000-0000-0000-000000000002', 'me', 'Mal', 'Mal', 'days', '{8}', null, 9::smallint, 0::smallint) $$,
  '23514', null, 'weekdays are 1 to 7');
select throws_ok(
  $$ select public.create_routine('20000000-0000-0000-0000-000000000004', 'me', 'Fuera', 'Fuera', 'days', null, null, 9::smallint, 0::smallint) $$,
  '42501', null, 'nobody makes a routine with another organisation''s agent');
select throws_ok(
  $$ insert into public.agent_routines (org_id, agent_id, audience, title, instruction, kind, hour)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'me', 'x', 'x', 'days', 9) $$,
  '42501', null, 'the app never writes the table');

-- Ten per person.
do $$ begin
  for n in 1..9 loop
    perform public.create_routine('20000000-0000-0000-0000-000000000002', 'me', 'Otra ' || n, 'Algo', 'days', null, null, 8::smallint, 0::smallint);
  end loop;
end $$;
select throws_ok(
  $$ select public.create_routine('20000000-0000-0000-0000-000000000002', 'me', 'Once', 'Algo', 'days', null, null, 8::smallint, 0::smallint) $$,
  '54000', null, 'ten routines per person at most');
select lives_ok(
  $$ select public.update_routine((select id from ids where name = 'bea'), 'Ventas', 'Resumen corto', 'days', '{1,5}', null, 8::smallint, 30::smallint) $$,
  'she changes her own');
select results_eq($$ select weekdays, hour, minute from public.agent_routines where id = (select id from ids where name = 'bea') $$,
  $$ values ('{1,5}'::smallint[], 8::smallint, 30::smallint) $$, '... as she said');

-- Dani only reads Finanzas.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000d", "role": "authenticated"}';
select throws_ok(
  $$ select public.create_routine('20000000-0000-0000-0000-000000000002', 'me', 'Yo', 'Algo', 'days', null, null, 9::smallint, 0::smallint) $$,
  '42501', null, 'a member who only reads an agent makes no routine with it');
select is((select count(*) from public.agent_routines), 0::bigint, '... and sees nobody else''s «Solo para mí»');
select throws_ok($$ select public.set_routine_paused((select id from ids where name = 'bea'), true) $$, '42501', null,
  '... nor pauses it');

-- Ana, an owner.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select count(*) from public.agent_routines), 0::bigint, 'an owner does not see a member''s «Solo para mí» either');
select throws_ok($$ select public.delete_routine((select id from ids where name = 'bea')) $$, '42501', null, '... nor deletes it');
insert into ids select 'team', id from public.create_routine(
  '20000000-0000-0000-0000-000000000002', 'team', 'Cierre del mes', 'Cuadra el mes y dime qué falta', 'monthly', null, 2::smallint, 9::smallint, 30::smallint);
select is((select audience from public.agent_routines where id = (select id from ids where name = 'team')), 'team', 'an owner makes one for the team');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000d", "role": "authenticated"}';
select results_eq($$ select title from public.agent_routines $$, $$ values ('Cierre del mes') $$,
  'a member who sees the agent sees the team''s routines');
select throws_ok($$ select public.update_routine((select id from ids where name = 'team'), 'x', 'x', 'days', null, null, 9::smallint, 0::smallint) $$,
  '42501', null, '... but only an owner changes them');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.agent_routines), 0::bigint, 'another organisation sees none of them');

-- Runs and the engine's helpers.
reset role;
insert into public.agent_runs (org_id, agent_id, origin, state, summary, routine_id) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'routine', 'done', 'Ventas: 1.200 €', (select id from ids where name = 'bea')),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'routine', 'done', 'Falta una factura', (select id from ids where name = 'team'));
select is(public.post_routine_copies((select id from ids where name = 'team'), 'Falta una factura', '00000000-0000-0000-0000-00000000000a'), 2,
  'a team routine''s answer reaches everyone else who sees the agent');
select is(public.notify_owners('10000000-0000-0000-0000-000000000001', 'He pausado una rutina.'), 1, 'Secretaría tells each owner');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000d", "role": "authenticated"}';
select results_eq($$ select summary from public.agent_runs $$, $$ values ('Falta una factura') $$,
  'a member sees the team routine''s run, not someone else''s «Solo para mí»');
select throws_ok($$ select public.post_routine_copies((select id from ids where name = 'team'), 'x', null) $$, '42501', null,
  'only the engine posts a routine''s answer');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select results_eq($$ select summary from public.agent_runs order by summary $$, $$ values ('Falta una factura'), ('Ventas: 1.200 €') $$,
  'she sees the runs of her own routine');

select * from finish();
rollback;
