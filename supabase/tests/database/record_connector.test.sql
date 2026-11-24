-- Where an organisation's record lives is read by its members only, and set
-- only by the service role (the sync CLI, the engine): nobody points an
-- organisation at another's record from the app (invariant 1).
begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com');

insert into public.organizations (id, slug, name, record_host, record_repo, record_installation) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería', 'github', 'panaderia/registro', 11),
  ('10000000-0000-0000-0000-000000000002', 'taller', 'Taller', null, null, null);

insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'owner', 'Carla');

select throws_ok(
  $$ update public.organizations set record_host = 'github', record_repo = 'PANADERIA/Registro', record_installation = 12
     where slug = 'taller' $$,
  '23505', null, 'one repo is the record of one organisation only');
select throws_ok(
  $$ update public.organizations set record_installation = null where slug = 'panaderia' $$,
  '23514', null, 'a record has both its repo and its installation');
select throws_ok(
  $$ update public.organizations set record_host = 'ghostaff', record_repo = 'records/taller', record_installation = 3 where slug = 'taller' $$,
  '23514', null, 'a record in our record store has no GitHub installation');
select lives_ok(
  $$ update public.organizations set record_host = 'ghostaff', record_repo = 'records/10000000-0000-0000-0000-000000000002' where slug = 'taller' $$,
  'the engine gives an organisation its record in our record store');
update public.organizations set record_host = null, record_repo = null where slug = 'taller';

set local role authenticated;

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select record_repo from public.organizations where slug = 'panaderia'), 'panaderia/registro',
  'a member reads where her record lives');
update public.organizations set record_repo = 'otra/cosa' where slug = 'panaderia';

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.organizations where slug = 'panaderia'), 0::bigint,
  'another organisation''s owner does not see it');
update public.organizations set record_host = 'github', record_repo = 'panaderia/registro', record_installation = 11 where slug = 'taller';

reset role;
select is((select record_repo from public.organizations where slug = 'panaderia'), 'panaderia/registro',
  'an owner cannot change her record from the app');
select is((select record_repo from public.organizations where slug = 'taller'), null,
  '... nor point hers at another''s');
select is((select count(*) from public.organizations where record_repo is not null), 1::bigint, 'one record');

select * from finish();
rollback;
