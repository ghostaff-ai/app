-- Profile photos (20261128960000_profile_photos.sql): seen by whoever shares
-- an organisation with the person, nobody else; written only by the engine.
begin;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com');
insert into public.profiles (user_id, full_name, avatar_path) values
  ('00000000-0000-0000-0000-00000000000a', 'Ana', '00000000-0000-0000-0000-00000000000a/f1.jpg'),
  ('00000000-0000-0000-0000-00000000000b', 'Bea', null),
  ('00000000-0000-0000-0000-00000000000c', 'Carla', '00000000-0000-0000-0000-00000000000c/f2.jpg');
insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería'),
  ('10000000-0000-0000-0000-000000000002', 'taller', 'Taller');
insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'member', 'Bea'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'owner', 'Carla');
insert into storage.objects (bucket_id, name) values
  ('avatars', '00000000-0000-0000-0000-00000000000a/f1.jpg'),
  ('avatars', '00000000-0000-0000-0000-00000000000c/f2.jpg');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select results_eq($$ select name from storage.objects where bucket_id = 'avatars' $$, $$ values ('00000000-0000-0000-0000-00000000000a/f1.jpg') $$, 'a member sees a colleague''s photo, not a stranger''s');
select results_eq($$ select user_id from public.member_avatars('10000000-0000-0000-0000-000000000001') $$, $$ values ('00000000-0000-0000-0000-00000000000a'::uuid) $$, '... and which of her organisation have one');
select is((select count(*) from public.member_avatars('10000000-0000-0000-0000-000000000002')), 0::bigint, '... nothing of an organisation she isn''t in');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-00000000000b/x.jpg') $$, '42501', null, 'nobody but the engine writes a photo');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select results_eq($$ select name from storage.objects where bucket_id = 'avatars' $$, $$ values ('00000000-0000-0000-0000-00000000000c/f2.jpg') $$, 'a stranger sees only her own');
select is(public.can_see_avatar('../x/y.jpg'), false, 'a malformed path is seen by nobody');

select * from finish();
rollback;
