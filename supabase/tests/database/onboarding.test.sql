-- The way in: a profile first, then create an organisation or accept an
-- invitation addressed to your own email. Invariant 1 still holds: nobody sees
-- or joins an organisation that did not invite them.
begin;
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com');

set local role authenticated;

-- Ana, new: no profile yet, so she cannot create anything.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';

select throws_ok(
  $$ select public.create_organization('Panadería Ana') $$,
  '42501', 'profile first', 'no organisation before a profile');

select is(
  (select full_name from public.save_profile('  Ana López ', 'Fundadora', '')),
  'Ana López', 'Ana saves her profile, trimmed');
select is((select heard_from from public.profiles), null, '... an empty answer is stored as none');

select is(
  (select slug from public.create_organization('Panadería Ña, S.L.', 'https://ana.example', 'Pan', array['https://ig.example/ana', '  '])),
  'panaderia-na-s-l', 'Ana creates her organisation; its slug comes from the name');
select is((select role from public.memberships), 'owner', '... and is its owner');
select is((select display_name from public.memberships), 'Ana López', '... signing with her profile name');
select is((select links from public.organizations), array['https://ig.example/ana'], '... blank links dropped');

select isnt(
  (select slug from public.create_organization('Panadería Ña, S.L.')),
  'panaderia-na-s-l', 'a second organisation with the same name gets its own slug');

select lives_ok(
  $$ select public.invite_member((select id from public.organizations where slug = 'panaderia-na-s-l'), ' Bea@Example.com ') $$,
  'Ana invites Bea');

-- Carla: signed up, not invited.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select public.save_profile('Carla');

select is((select count(*) from public.organizations), 0::bigint, 'Carla sees no organisation');
select is((select count(*) from public.invitations), 0::bigint, 'Carla sees no invitation that is not hers');
select is((select count(*) from public.my_invitations()), 0::bigint, '... and has none');
select throws_ok(
  $$ select public.accept_invitation((select id from public.invitations limit 1)) $$,
  'P0002', 'invitation not found', 'Carla cannot accept an invitation she cannot see');
select throws_ok(
  $$ select public.invite_member((select id from public.organizations where slug = 'panaderia-na-s-l'), 'carla@example.com') $$,
  '42501', 'only an owner invites', 'Carla cannot invite herself in');

-- Bea, invited.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select public.save_profile('Bea');

select is((select org_name from public.my_invitations()), 'Panadería Ña, S.L.', 'Bea sees who invited her');
select is((select count(*) from public.organizations), 0::bigint, '... but nothing of the organisation before she joins');

select is(
  (select name from public.accept_invitation((select id from public.my_invitations()))),
  'Panadería Ña, S.L.', 'Bea accepts');
select is((select count(*) from public.organizations), 1::bigint, '... and now sees it');
select throws_ok(
  $$ select public.invite_member((select id from public.organizations limit 1), 'carla@example.com') $$,
  '42501', 'only an owner invites', 'a member who is not an owner cannot invite');

select * from finish();
rollback;
