-- General, the people's chat (20261128100000_general_chat.sql): one per
-- organisation, made with it; every member reads and writes it, whatever
-- their level on the agents; nobody else sees anything, a voice note's audio
-- included; a person's message notifies the other members, an agent's reply
-- only whoever asked.
begin;
select plan(19);

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

-- Bea sees no agent at all: General is still hers.
insert into public.agents (id, org_id, name, ghost, department, member_default) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Finanzas', 'finanzas', 'finanzas', 'none');

-- Everyone has a phone.
insert into public.device_tokens (user_id, token, platform, bundle_id, time_zone) values
  ('00000000-0000-0000-0000-00000000000a', 'tok-a', 'android', 'ai.ghostaff.app.dev', 'Europe/Madrid'),
  ('00000000-0000-0000-0000-00000000000b', 'tok-b', 'android', 'ai.ghostaff.app.dev', 'Europe/Madrid'),
  ('00000000-0000-0000-0000-00000000000c', 'tok-c', 'android', 'ai.ghostaff.app.dev', 'Europe/Madrid');

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, service_role;
insert into ids select 'general', id from public.threads where org_id = '10000000-0000-0000-0000-000000000001' and kind = 'general';
insert into ids select 'other', id from public.threads where org_id = '10000000-0000-0000-0000-000000000002' and kind = 'general';

-- Made with the organisation, once.
select is((select count(*) from public.threads where kind = 'general' and org_id in ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002')), 2::bigint, 'each organisation is made with its General');
select is(public.general_chat('10000000-0000-0000-0000-000000000001'), (select id from ids where name = 'general'), '... and asking for it again returns the same one');
select is((select title from public.threads where id = (select id from ids where name = 'general')), 'General', '... titled «General»');
select throws_ok(
  $$ insert into public.threads (org_id, kind, title) values ('10000000-0000-0000-0000-000000000001', 'general', 'Otro') $$,
  '23505', null, 'an organisation has one General at most');
select throws_ok(
  $$ insert into public.threads (org_id, kind, agent_id, title) values
     ('10000000-0000-0000-0000-000000000001', 'general', '20000000-0000-0000-0000-000000000001', 'X') $$,
  '23514', null, 'General has no agent');
select throws_ok(
  $$ insert into public.threads (org_id, kind, title) values ('10000000-0000-0000-0000-000000000001', 'agent', 'X') $$,
  '23514', null, 'an agent''s chat has its agent');

set local role authenticated;

-- Bea writes: she may, though she sees no agent.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
insert into ids select 'bea', id from public.post_message((select id from ids where name = 'general'), 'Mañana abrimos a las 7');
select is(public.thread_level((select id from ids where name = 'general')), 'talk', 'a member who sees no agent talks in General');
select results_eq(
  $$ select kind, agent_id, last_author, last_text from public.my_threads('10000000-0000-0000-0000-000000000001') $$,
  $$ values ('general'::text, null::uuid, 'Bea'::text, 'Mañana abrimos a las 7'::text) $$,
  '... and sees it in the list, with its newest word');

-- Ana reads it and answers; marking it read works as in any chat.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select count(*) from public.messages where thread_id = (select id from ids where name = 'general')), 1::bigint, 'another member reads it');
select lives_ok($$ select public.mark_thread_read((select id from ids where name = 'general')) $$, '... and marks it read');
select lives_ok($$ select public.post_message((select id from ids where name = 'general'), 'Vale') $$, '... and answers');

-- Carla, of another organisation, sees nothing.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.threads where id = (select id from ids where name = 'general')), 0::bigint, 'another organisation''s member doesn''t see it');
select is((select count(*) from public.messages where thread_id = (select id from ids where name = 'general')), 0::bigint, '... nor its messages');
select throws_ok(
  $$ select public.post_message((select id from ids where name = 'general'), 'hola') $$,
  '42501', null, '... nor writes in it');
select throws_ok(
  $$ select public.mark_thread_read((select id from ids where name = 'general')) $$,
  'P0002', null, '... nor marks it read');

reset role;

-- A voice note in General: its members hear it, nobody else does.
insert into public.messages (id, thread_id, org_id, author_kind, author_user, author_name, parts)
values ('40000000-0000-0000-0000-000000000001', (select id from ids where name = 'general'), '10000000-0000-0000-0000-000000000001',
        'person', '00000000-0000-0000-0000-00000000000a', 'Ana',
        '[{"type": "voice", "path": "x", "mediaType": "audio/mp4", "durationMs": 38000, "transcription": "pending"}]');
insert into storage.objects (bucket_id, name)
select 'voice-notes', '10000000-0000-0000-0000-000000000001/' || (select id from ids where name = 'general') || '/40000000-0000-0000-0000-000000000001.m4a';

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select count(*) from storage.objects where bucket_id = 'voice-notes'), 1::bigint, 'a member hears a voice note in General');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from storage.objects where bucket_id = 'voice-notes'), 0::bigint, '... another organisation doesn''t');
reset role;

-- Pushes: each person's message goes to the other member, never to its author;
-- the voice note says so, with its length.
select results_eq(
  $$ select user_id, title, body, data->>'route' from public.push_outbox order by user_id, body $$,
  $$ values ('00000000-0000-0000-0000-00000000000a'::uuid, 'Bea'::text, 'Mañana abrimos a las 7'::text, '/general'::text),
            ('00000000-0000-0000-0000-00000000000b'::uuid, 'Ana'::text, 'Nota de voz · 0:38'::text, '/general'::text),
            ('00000000-0000-0000-0000-00000000000b'::uuid, 'Ana'::text, 'Vale'::text, '/general'::text) $$,
  'a person''s message in General notifies the other members');

-- An agent @mentioned by Bea answers: only Bea is notified.
delete from public.push_outbox;
insert into public.messages (id, thread_id, org_id, author_kind, author_agent, author_name, parts, state, reply_to)
values ('40000000-0000-0000-0000-000000000002', (select id from ids where name = 'general'), '10000000-0000-0000-0000-000000000001',
        'agent', '20000000-0000-0000-0000-000000000001', 'Finanzas', '[]', 'working', (select id from ids where name = 'bea'));
update public.messages set state = 'done', parts = '[{"type": "text", "text": "Hecho"}]', finished_at = now()
where id = '40000000-0000-0000-0000-000000000002';
select results_eq(
  $$ select user_id, body from public.push_outbox $$,
  $$ values ('00000000-0000-0000-0000-00000000000b'::uuid, 'Te ha contestado en General'::text) $$,
  'an agent''s reply in General notifies only whoever asked');

select * from finish();
rollback;
