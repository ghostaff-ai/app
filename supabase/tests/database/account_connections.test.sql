-- An account connection behaves like an AI one: each organisation sees only
-- its own, nobody writes them from the app. A connect in progress is invisible
-- to everyone but the engine (invariants 1 and 3).
begin;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com');

insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería'),
  ('10000000-0000-0000-0000-000000000002', 'taller', 'Taller');

insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'owner', 'Carla');

-- What the engine writes, as the service role.
insert into public.connections (org_id, kind, provider, method, hint, settings, connected_by, connected_by_name) values
  ('10000000-0000-0000-0000-000000000001', 'account', 'google', 'oauth', 'ana@panaderia.es',
   '{"scopes": ["https://www.googleapis.com/auth/calendar.events"]}', '00000000-0000-0000-0000-00000000000a', 'Ana');
insert into public.connection_attempts (state, org_id, user_id, provider, code_verifier, return_to) values
  (repeat('s', 43), '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'google', repeat('v', 43), 'ghostaff://conexiones');

select throws_ok(
  $$ insert into public.connections (org_id, kind, provider, method, hint, connected_by_name)
     values ('10000000-0000-0000-0000-000000000001', 'account', 'Drop box!', 'oauth', 'x', 'Ana') $$,
  '23514', null, 'an account provider is a plain lowercase id');
select throws_ok(
  $$ insert into public.connections (org_id, kind, provider, method, hint, connected_by_name)
     values ('10000000-0000-0000-0000-000000000001', 'ai', 'notion', 'api_key', 'x', 'Ana') $$,
  '23514', null, '... and an AI provider is one of the known ones');

set local role authenticated;

-- Ana, owner of the bakery.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select hint from public.connections where kind = 'account'), 'ana@panaderia.es', 'an owner sees her organisation''s Google account');
select throws_ok($$ select * from public.connection_attempts $$, '42501', null, '... but not even her own connect in progress');
select throws_ok(
  $$ insert into public.connection_attempts (state, org_id, user_id, provider, code_verifier, return_to)
     values (repeat('x', 43), '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'google', repeat('v', 43), 'ghostaff://') $$,
  '42501', null, '... nor start one from the app');
select throws_ok(
  $$ update public.connections set hint = 'hack' where kind = 'account' $$,
  '42501', null, '... nor change the account connection');

-- Carla, owner of the workshop.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.connections), 0::bigint, 'another organisation''s owner sees no connection of the bakery');
select throws_ok($$ delete from public.connection_attempts $$, '42501', null, '... and cannot touch its connect in progress');

reset role;
select is((select count(*) from public.connection_attempts where org_id = '10000000-0000-0000-0000-000000000001'), 1::bigint, 'the connect in progress is still there');
select is((select count(*) from public.connections where org_id = '10000000-0000-0000-0000-000000000001'), 1::bigint, 'and so is the connection');

select * from finish();
rollback;
