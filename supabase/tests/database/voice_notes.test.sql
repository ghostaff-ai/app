-- Voice notes (20261124500000_voice_notes.sql, 20261128700000_group_chat_per_agent.sql):
-- a person hears the notes of the agents' chats they may read, whatever thread
-- the note's folder names (the fold removed some); nothing across organisations;
-- nobody writes but the service role.
begin;
select plan(12);

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

insert into public.agents (id, org_id, name, ghost, department, member_default) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Secretaría', 'secretaria', 'direccion', 'talk'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Finanzas', 'finanzas', 'finanzas', 'none');

-- Secretaría's chat, and Finanzas', which Bea may not see.
insert into public.threads (id, org_id, agent_id, title, created_by) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Secretaría',
   '00000000-0000-0000-0000-00000000000b'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Finanzas',
   '00000000-0000-0000-0000-00000000000a');
insert into public.messages (id, thread_id, org_id, author_kind, author_user, author_name, parts) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'person',
   '00000000-0000-0000-0000-00000000000b', 'Bea', '[]'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'person',
   '00000000-0000-0000-0000-00000000000a', 'Ana', '[]'),
  ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'person',
   '00000000-0000-0000-0000-00000000000a', 'Ana', '[]');

-- What the engine stores with the service role. The third was recorded in a
-- chat the fold removed: its folder names a thread that is gone.
insert into storage.objects (bucket_id, name) values
  ('voice-notes', '10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001.m4a'),
  ('voice-notes', '10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000002/40000000-0000-0000-0000-000000000002.m4a'),
  ('voice-notes', '10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000009/40000000-0000-0000-0000-000000000004.m4a');

select is((select public from storage.buckets where id = 'voice-notes'), false, 'the bucket is private');
-- Storage refuses a delete in SQL whoever asks; through its API, policies decide: none but reading.
select is(
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd <> 'SELECT'
     and (coalesce(qual, '') || coalesce(with_check, '')) like '%voice-notes%'),
  0::bigint, 'no policy lets a person store, change or delete a note');

set local role authenticated;

-- Bea hears Secretaría's notes, hers and Ana's, not the Finanzas one.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select results_eq(
  $$ select split_part(name, '/', 3) from storage.objects where bucket_id = 'voice-notes' order by 1 $$,
  $$ values ('40000000-0000-0000-0000-000000000001.m4a'), ('40000000-0000-0000-0000-000000000004.m4a') $$,
  'a person hears the notes of the chats she may read, whoever recorded them');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values
     ('voice-notes', '10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000003.m4a') $$,
  '42501', null, '... and cannot store a note herself');
select is_empty(
  $$ update storage.objects set name = name || '.x' where bucket_id = 'voice-notes' returning name $$,
  '... nor change one');
select is(public.can_hear_voice_note('../30000000-0000-0000-0000-000000000001/x.m4a'), false, 'a path that is not <org>/<thread>/<file> is heard by nobody');
select is(public.can_hear_voice_note('10000000-0000-0000-0000-000000000001/not-a-uuid/x.m4a'), false, '... nor one with a malformed thread');
select is(public.can_hear_voice_note('10000000-0000-0000-0000-000000000002/30000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001.m4a'),
  false, '... nor a note filed under another organisation than its message''s');

-- Ana, an owner: every note.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select count(*) from storage.objects where bucket_id = 'voice-notes'), 3::bigint, 'an owner hears every chat''s notes');

-- Carla, another organisation: nothing.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from storage.objects where bucket_id = 'voice-notes'), 0::bigint, 'another organisation hears no note');

-- Signed out: nothing, and no way to ask.
reset role;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select is((select count(*) from storage.objects where bucket_id = 'voice-notes'), 0::bigint, 'signed out, no note');
select throws_ok($$ select public.can_hear_voice_note('x') $$, '42501', null, '... and the check is not callable');

select * from finish();
rollback;
