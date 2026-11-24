-- An organisation's Google Cloud identity is the engine's alone: no member,
-- owner or not, reads or changes it from the app, so nobody can point an
-- organisation at another's account (invariant 1).
begin;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com');

insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería'),
  ('10000000-0000-0000-0000-000000000002', 'taller', 'Taller');

insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'owner', 'Carla');

insert into public.cloud_accounts (org_id, email, unique_id) values
  ('10000000-0000-0000-0000-000000000001', 'org-100000000000000000000000@ghostaff-tenants-beta.iam.gserviceaccount.com', '111111111111111111111');

select throws_ok(
  $$ insert into public.cloud_accounts (org_id, email, unique_id) values
     ('10000000-0000-0000-0000-000000000002', 'org-100000000000000000000000@ghostaff-tenants-beta.iam.gserviceaccount.com', '222222222222222222222') $$,
  '23505', null, 'one account belongs to one organisation only');
select throws_ok(
  $$ insert into public.cloud_accounts (org_id, email, unique_id) values
     ('10000000-0000-0000-0000-000000000002', 'engine@ghostaff-beta.iam.gserviceaccount.com', '222222222222222222222') $$,
  '23514', null, 'only an organisation''s own account, never one of the platform''s');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select throws_ok($$ select * from public.cloud_accounts $$, '42501', null, 'an owner does not read it from the app');
select throws_ok(
  $$ update public.cloud_accounts set email = 'org-200000000000000000000000@ghostaff-tenants-beta.iam.gserviceaccount.com' $$,
  '42501', null, '... nor change it');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select throws_ok(
  $$ insert into public.cloud_accounts (org_id, email, unique_id) values
     ('10000000-0000-0000-0000-000000000002', 'org-100000000000000000000000@ghostaff-tenants-beta.iam.gserviceaccount.com', '333333333333333333333') $$,
  '42501', null, 'another organisation''s owner cannot claim it for hers');

reset role;
select is((select count(*) from public.cloud_accounts), 1::bigint, 'one account');

select * from finish();
rollback;
