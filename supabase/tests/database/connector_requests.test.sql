-- Asking for a connector we lack (docs/plans/ongoing/connectors.md, phase 0,
-- kind C): any member of an organisation can ask, through request_connector
-- only; members see their own organisation's requests, never another's; the
-- same app asked twice by one organisation counts once.
begin;
select plan(11);

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

set local role authenticated;

-- Bea, a member (not an owner) of the bakery.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select lives_ok(
  $$ select public.request_connector('10000000-0000-0000-0000-000000000001', '  Glovo ') $$,
  'a member asks for a connector');
select is((select name from public.connector_requests), 'Glovo', '... it is kept trimmed, with her name on it');
select is((select requested_by_name from public.connector_requests), 'Bea', '... and who asked');
select lives_ok(
  $$ select public.request_connector('10000000-0000-0000-0000-000000000001', 'glovo') $$,
  'asking again for the same app, in other letters, is fine');
select is((select count(*) from public.connector_requests), 1::bigint, '... and it still counts once for her organisation');
select throws_ok(
  $$ select public.request_connector('10000000-0000-0000-0000-000000000001', '   ') $$,
  '22023', null, 'an empty name is refused');
select throws_ok(
  $$ select public.request_connector('10000000-0000-0000-0000-000000000002', 'Glovo') $$,
  '42501', null, 'nobody asks in the name of an organisation they are not in');
select throws_ok(
  $$ insert into public.connector_requests (org_id, requested_by, requested_by_name, name)
     values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Bea', 'Uber') $$,
  '42501', null, 'the table is written only through request_connector');

-- Ana, owner of the bakery, sees it.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select count(*) from public.connector_requests), 1::bigint, 'another member of the bakery sees the request');

-- Carla, owner of the workshop.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.connector_requests), 0::bigint, 'another organisation sees none of the bakery''s requests');

reset role;
select is(
  (select count(distinct org_id) from public.connector_requests where lower(name) = 'glovo'),
  1::bigint, 'we can count how many organisations asked for an app');

select * from finish();
rollback;
