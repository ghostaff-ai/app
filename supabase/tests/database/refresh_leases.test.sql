-- One refresh of an account's token at a time across engine instances: the
-- engine takes a lease before refreshing. Only the engine (service role) can
-- take, see or release one; nobody in the app can (invariants 1 and 3).
begin;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com');

insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería');

insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana');

-- As the engine.
select is(public.take_refresh_lease('10000000-0000-0000-0000-000000000001', 'google', 'instance-a', 30), true,
  'a free lease is taken');
select is(public.take_refresh_lease('10000000-0000-0000-0000-000000000001', 'google', 'instance-b', 30), false,
  'another instance cannot take it while it lasts');
select is(public.take_refresh_lease('10000000-0000-0000-0000-000000000001', 'google', 'instance-a', 30), true,
  'its holder can take it again');
select is(public.take_refresh_lease('10000000-0000-0000-0000-000000000001', 'notion', 'instance-b', 30), true,
  'a lease is per account: another provider of the same organisation is free');

update public.refresh_leases set until = now() - interval '1 second'
  where org_id = '10000000-0000-0000-0000-000000000001' and provider = 'google';
select is(public.take_refresh_lease('10000000-0000-0000-0000-000000000001', 'google', 'instance-b', 30), true,
  'an expired lease can be taken by anyone');

select public.release_refresh_lease('10000000-0000-0000-0000-000000000001', 'google', 'instance-a');
select is((select holder from public.refresh_leases where provider = 'google'), 'instance-b',
  'releasing a lease one no longer holds leaves the new holder''s');
select public.release_refresh_lease('10000000-0000-0000-0000-000000000001', 'google', 'instance-b');
select is((select count(*) from public.refresh_leases where provider = 'google'), 0::bigint,
  'its holder releases it');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select throws_ok($$ select * from public.refresh_leases $$, '42501', null,
  'an owner cannot see her organisation''s leases');
select throws_ok(
  $$ select public.take_refresh_lease('10000000-0000-0000-0000-000000000001', 'google', 'me', 30) $$,
  '42501', null, '... nor take one');
select throws_ok(
  $$ select public.release_refresh_lease('10000000-0000-0000-0000-000000000001', 'notion', 'instance-b') $$,
  '42501', null, '... nor release one');

reset role;
select is((select holder from public.refresh_leases where provider = 'notion'), 'instance-b',
  'the engine''s lease is untouched');

select * from finish();
rollback;
