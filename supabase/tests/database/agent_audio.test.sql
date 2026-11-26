-- Audio from an agent (20261127500000_agent_audio.sql): the bucket takes an
-- episode; an agent's audio in its chat is heard by whoever may read the chat,
-- through the voice notes' policy, and nobody else; a run's audio waiting for
-- its report stays with the engine.
begin;
select plan(6);

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

-- La Mesa: Bea may only listen.
insert into public.agents (id, org_id, name, ghost, department, member_default) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'La Mesa', 'productor', 'marketing', 'read');

insert into public.threads (id, org_id, agent_id, title, created_by) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'La Mesa',
   '00000000-0000-0000-0000-00000000000a');
insert into public.messages (id, thread_id, org_id, author_kind, author_agent, author_name, parts, state) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'agent',
   '20000000-0000-0000-0000-000000000001', 'La Mesa',
   '[{"type": "audio", "path": "10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001.mp3", "mediaType": "audio/mpeg", "durationMs": null, "title": "La Mesa (ES)"}]',
   'done');
insert into storage.objects (bucket_id, name) values
  ('voice-notes', '10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001.mp3');

select is((select file_size_limit from storage.buckets where id = 'voice-notes'), 26214400::bigint, 'the bucket takes 25 MB');
select ok(not has_column_privilege('authenticated', 'public.agent_runs', 'audio', 'select'), 'a member can''t read a run''s audio list');
select ok(has_column_privilege('authenticated', 'public.agent_runs', 'state', 'select'), 'a member still reads a run''s state');

set local role authenticated;

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select count(*) from storage.objects where bucket_id = 'voice-notes'), 1::bigint, 'a member who may only read the chat hears the agent''s audio');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select count(*) from storage.objects where bucket_id = 'voice-notes'), 1::bigint, 'an owner hears it');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from storage.objects where bucket_id = 'voice-notes'), 0::bigint, 'another organisation''s member doesn''t');

select * from finish();
rollback;
