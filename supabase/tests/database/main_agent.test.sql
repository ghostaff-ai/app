-- The main agent (agent-builder slice 1): every organisation has exactly one,
-- the database keeps it that way, and nobody removes it. Órdago and the
-- organisations that predate the role are brought in by ensure_main_agent.
begin;
select plan(21);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'olga@example.com');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e1", "role": "authenticated"}';

select lives_ok($$ select public.save_profile('Olga Díaz') $$, 'Olga saves her profile');

-- A company and a personal space are born with a main agent.
select is((select count(*)::int from public.create_organization('Taller')), 1, 'Olga creates a company');
select results_eq(
  $$ select a.name, a.ghost, a.member_default::text from public.agents a
     join public.organizations o on o.id = a.org_id where o.name = 'Taller' and a.is_main $$,
  $$ values ('Secretaría'::text, 'secretaria'::text, 'talk'::text) $$,
  'the company has one main agent: Secretaría, whom members may talk to');
select is(
  (select count(*)::int from public.agents a join public.organizations o on o.id = a.org_id where o.name = 'Taller'),
  1, '... and no other agent');

create temp table mine on commit drop as select * from public.create_personal_space();
grant select on mine to authenticated;
select results_eq(
  $$ select a.name, a.ghost, a.member_default::text from public.agents a where a.org_id = (select id from mine) and a.is_main $$,
  $$ values ('Secretaría'::text, 'secretaria'::text, 'talk'::text) $$,
  'the personal space has its main agent too');
select is(
  (select count(*)::int from public.agents a where a.org_id = (select id from mine)),
  1, '... and no other agent');

-- The main agent stays; another agent can go.
create temp table taller on commit drop as select o.id from public.organizations o where o.name = 'Taller';
grant select on taller to authenticated;
select throws_ok(
  $$ select public.delete_agent((select a.id from public.agents a where a.org_id = (select id from taller) and a.is_main)) $$,
  '42501', 'the main agent stays', 'the owner cannot remove the main agent');
select is(
  (select count(*)::int from public.agents a where a.org_id = (select id from taller) and a.is_main),
  1, '... and it is still there');

-- A custom agent drawn as the secretaria ghost is not the main agent.
create temp table otra on commit drop as
  select * from public.create_agent((select id from taller), 'Otra', 'secretaria', 'direccion');
grant select on otra to authenticated;
select is((select is_main from otra), false, 'an agent created with the secretaria ghost is not main');
select is((select member_default::text from otra), 'read', '... and members only read it');
select lives_ok($$ select public.delete_agent((select id from otra)) $$, 'any other agent can be removed');

-- The database allows one main agent per organisation.
reset role;
select throws_ok(
  $$ insert into public.agents (org_id, name, ghost, department, is_main)
     values ((select id from taller), 'Segunda', 'secretaria', 'direccion', true) $$,
  '23505', null, 'a second main agent in the same organisation is refused');

-- ensure_main_agent on organisations the role did not reach.
insert into public.organizations (id, slug, name) values
  ('00000000-0000-0000-0000-0000000000f1', 'vieja', 'Vieja'),
  ('00000000-0000-0000-0000-0000000000f2', 'ordago-like', 'Órdago-like'),
  ('00000000-0000-0000-0000-0000000000f3', 'vacia', 'Vacía');

-- 1. A chat secretaria exists: it becomes the main agent, no new row.
insert into public.agents (id, org_id, name, ghost, department)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', 'Secre', 'secretaria', 'direccion');
select is(
  public.ensure_main_agent('00000000-0000-0000-0000-0000000000f1'),
  '00000000-0000-0000-0000-0000000000a1'::uuid, 'the existing chat secretaria becomes the main agent');
select is(
  (select count(*)::int from public.agents where org_id = '00000000-0000-0000-0000-0000000000f1'),
  1, '... without a new agent');

-- 2. Only a job agent drawn as secretaria (Órdago's Correo): a new chat main agent, Correo untouched.
insert into public.agents (id, org_id, name, ghost, department, slug, runner, task, model, tools, max_turns)
values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f2', 'Correo', 'secretaria', 'direccion',
        'correo', 'ghostaff', 'Lee el correo', 'claude-sonnet-4-5', '{}', 10);
create temp table ordago_main on commit drop as
  select public.ensure_main_agent('00000000-0000-0000-0000-0000000000f2') as id;
select results_eq(
  $$ select a.name, a.runner from public.agents a where a.id = (select id from ordago_main) $$,
  $$ values ('Secretaría'::text, 'chat'::text) $$,
  'an organisation whose only secretaria is a job gets a new chat main agent');
select is(
  (select is_main from public.agents where id = '00000000-0000-0000-0000-0000000000a2'),
  false, '... and the job agent stays non-main');

-- 3. No agents at all (Secretaría was removed): a new main agent.
create temp table vacia_main on commit drop as
  select public.ensure_main_agent('00000000-0000-0000-0000-0000000000f3') as id;
select is(
  (select name from public.agents where id = (select id from vacia_main) and is_main),
  'Secretaría', 'an organisation with no agents gets a main agent');

-- Calling it again returns the same agent and adds nothing.
select is(
  public.ensure_main_agent('00000000-0000-0000-0000-0000000000f2'),
  (select id from ordago_main), 'a second call returns the same main agent');
select is(
  (select count(*)::int from public.agents where org_id = '00000000-0000-0000-0000-0000000000f2'),
  2, '... and adds no row');

-- Only the database's own functions call these.
set local role authenticated;
select throws_ok(
  $$ select public.ensure_main_agent('00000000-0000-0000-0000-0000000000f1') $$,
  '42501', null, 'a signed-in user cannot call ensure_main_agent');
select throws_ok(
  $$ select public.hire_main_agent('00000000-0000-0000-0000-0000000000f1') $$,
  '42501', null, '... nor hire_main_agent');

select * from finish();
rollback;
