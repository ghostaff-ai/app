-- Spaces (welcome-and-spaces.md): a company or your own personal space, each
-- an organisation, each created with Secretaría already hired. One personal
-- space per person, which works like a company: nobody else sees it unless
-- its owner invites them (invariant 1).
begin;
select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'dani@example.com'),
  ('00000000-0000-0000-0000-0000000000d2', 'eva@example.com');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d1", "role": "authenticated"}';

select throws_ok(
  $$ select public.create_personal_space() $$,
  '42501', 'profile first', 'no personal space before a profile');

select lives_ok($$ select public.save_profile('Dani Ruiz') $$, 'Dani saves his profile');

-- A company: kind company, Secretaría hired with it.
select is(
  (select kind from public.create_organization('Taller Dani')),
  'company', 'a company is of kind company');
select is(
  (select count(*)::int from public.agents a join public.organizations o on o.id = a.org_id where o.name = 'Taller Dani'),
  1, '... and starts with one agent');
select results_eq(
  $$ select a.name, a.ghost, a.department, a.member_default::text from public.agents a
     join public.organizations o on o.id = a.org_id where o.name = 'Taller Dani' $$,
  $$ values ('Secretaría'::text, 'secretaria'::text, 'direccion'::text, 'talk'::text) $$,
  '... Secretaría, in Dirección, whom members may talk to');

-- His personal space.
create temp table mine on commit drop as select * from public.create_personal_space();
grant select on mine to authenticated;
select is((select kind from mine), 'personal', 'the personal space is of kind personal');
select is((select name from mine), 'Personal', '... called Personal');
select is(
  (select role::text from public.memberships where org_id = (select id from mine)),
  'owner', '... with Dani as its owner');
select is(
  (select display_name from public.memberships where org_id = (select id from mine)),
  'Dani Ruiz', '... signing with his profile name');
select results_eq(
  $$ select a.ghost from public.agents a where a.org_id = (select id from mine) $$,
  $$ values ('secretaria'::text) $$,
  '... and Secretaría hired');
select is(
  (select id from public.create_personal_space()),
  (select id from mine), 'a second call returns the same space');
select is(
  (select count(*)::int from public.organizations where kind = 'personal'),
  1, '... so there is still only one');

select lives_ok(
  $$ select public.invite_member((select id from mine), 'eva@example.com') $$,
  'a personal space takes invitations, like a company');

reset role;
select throws_ok(
  $$ insert into public.organizations (slug, name, created_by, kind)
     values ('otro-personal', 'Otro', '00000000-0000-0000-0000-0000000000d1', 'personal') $$,
  '23505', null, 'the database refuses a second personal space for the same person');
select throws_ok(
  $$ insert into public.organizations (slug, name, created_by, kind)
     values ('raro', 'Raro', '00000000-0000-0000-0000-0000000000d1', 'equipo') $$,
  '23514', null, 'a kind is personal or company');

-- Eva can't see Dani's personal space or its agents.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d2", "role": "authenticated"}';
select is(
  (select count(*)::int from public.organizations where kind = 'personal'),
  0, 'another person does not see your personal space');
select is(
  (select count(*)::int from public.agents where org_id = (select id from mine)),
  0, '... nor its agents');

-- The ceiling of ten covers personal spaces too.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d2", "role": "authenticated"}';
select public.save_profile('Eva Gil');
select public.create_organization('Eva ' || n) from generate_series(1, 10) as n;
select throws_ok(
  $$ select public.create_personal_space() $$,
  '54000', 'too many organisations', 'an eleventh space is refused, personal included');

select * from finish();
rollback;
