-- Connections never leak across organisations, and nobody writes them from the
-- app: only the engine does, with the service role (invariants 1 and 3).
begin;
select plan(8);

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

-- What the engine writes, as the service role.
insert into public.connections (org_id, kind, provider, method, hint, connected_by, connected_by_name) values
  ('10000000-0000-0000-0000-000000000001', 'ai', 'anthropic', 'api_key', 'a1b2', '00000000-0000-0000-0000-00000000000a', 'Ana'),
  ('10000000-0000-0000-0000-000000000002', 'ai', 'openai', 'api_key', 'z9y8', '00000000-0000-0000-0000-00000000000c', 'Carla');

set local role authenticated;

-- Bea, a member of the bakery.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select count(*) from public.connections), 1::bigint, 'a member sees only her organisation''s connections');
select is((select provider from public.connections), 'anthropic', '... the bakery''s');

-- Carla, owner of the workshop.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.connections), 1::bigint, 'another organisation''s owner sees only her own');
select is((select hint from public.connections), 'z9y8', '... the workshop''s');

-- Ana, owner of the bakery: even an owner cannot write from the app.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select throws_ok(
  $$ insert into public.connections (org_id, kind, provider, method, hint, connected_by_name)
     values ('10000000-0000-0000-0000-000000000001', 'ai', 'openai', 'api_key', 'xxxx', 'Ana') $$,
  '42501', null, 'an owner cannot insert a connection from the app');
select throws_ok(
  $$ update public.connections set hint = 'hack' $$,
  '42501', null, '... nor change one');
select throws_ok(
  $$ delete from public.connections $$,
  '42501', null, '... nor delete one');

reset role;
select is((select count(*) from public.connections where org_id in ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002')), 2::bigint, 'both connections still there');

select * from finish();
rollback;
