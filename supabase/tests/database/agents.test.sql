-- Agents never leak across organisations, and only an organisation's owners
-- add or remove them, through create_agent and delete_agent (invariant 1).
begin;
select plan(13);

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

insert into public.agents (id, org_id, name, ghost, department) values
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Finanzas', 'finanzas', 'finanzas');

set local role authenticated;

-- Ana, owner of the bakery.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select lives_ok(
  $$ select public.create_agent('10000000-0000-0000-0000-000000000001', '  Lucía ', 'finanzas', 'finanzas') $$,
  'an owner adds an agent');
select is((select name from public.agents), 'Lucía', '... sees only her own, name trimmed');
select throws_ok(
  $$ select public.create_agent('10000000-0000-0000-0000-000000000002', 'Intrusa', 'redes', 'marketing') $$,
  '42501', null, 'an owner cannot add an agent to another organisation');
select throws_ok(
  $$ select public.delete_agent('20000000-0000-0000-0000-000000000002') $$,
  '42501', null, '... nor remove one of its agents');
select throws_ok(
  $$ select public.create_agent('10000000-0000-0000-0000-000000000001', 'X', 'dragon', 'marketing') $$,
  '23514', null, 'only the known ghosts');
select throws_ok(
  $$ select public.create_agent('10000000-0000-0000-0000-000000000001', '   ', 'base', 'marketing') $$,
  '22023', null, 'a name is required');
select throws_ok(
  $$ insert into public.agents (org_id, name, ghost, department)
     values ('10000000-0000-0000-0000-000000000001', 'Directa', 'base', 'marketing') $$,
  '42501', null, 'nobody writes the table directly');

-- Bea, a member of the bakery.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select count(*) from public.agents), 1::bigint, 'a member sees her organisation''s team');
select throws_ok(
  $$ select public.create_agent('10000000-0000-0000-0000-000000000001', 'Bea bot', 'base', 'direccion') $$,
  '42501', null, '... but cannot add an agent');
select throws_ok(
  $$ select public.delete_agent((select id from public.agents limit 1)) $$,
  '42501', null, '... nor remove one');

-- Carla, owner of the workshop.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.agents), 1::bigint, 'another organisation''s owner sees only her own team');
select lives_ok(
  $$ select public.delete_agent('20000000-0000-0000-0000-000000000002') $$,
  'an owner removes her own agent');

reset role;
select is((select count(*) from public.agents where org_id in ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002')), 1::bigint, 'only the bakery''s agent is left');

select * from finish();
rollback;
