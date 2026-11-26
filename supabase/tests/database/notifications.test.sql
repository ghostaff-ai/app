-- Push notifications (20261126400000_notifications.sql,
-- 20261128700000_group_chat_per_agent.sql): an agent's finished message queues
-- one row per person who sees the agent's chat, follows it and has a phone; the engine claims each row once and drops what was read since;
-- nobody reads the outbox from the app, and a phone is only its person's.
begin;
select plan(48);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'dani@example.com'),
  ('00000000-0000-0000-0000-00000000000e', 'eva@example.com'),
  ('00000000-0000-0000-0000-00000000000f', 'lu@example.com');

insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería');

insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'member', 'Bea'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'member', 'Carla'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 'member', 'Dani'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000e', 'member', 'Eva'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000f', 'member', 'Lu');

insert into public.agents (id, org_id, name, ghost, department, member_default) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Secretaría', 'secretaria', 'direccion', 'talk'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Redes', 'redes', 'marketing', 'read'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Finanzas', 'finanzas', 'finanzas', 'read');

create temporary table ids (name text primary key, id uuid) on commit drop;
create temporary table claimed (id uuid, user_id uuid, message_id uuid) on commit drop;
grant all on ids, claimed to authenticated, service_role;
set local role authenticated;

-- Phones: everyone but Carla.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select public.register_device('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'ios', 'sandbox', 'ai.ghostaff.app.dev', 'Europe/Madrid');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000d", "role": "authenticated"}';
select public.register_device('tok-dani', 'android', null, 'ai.ghostaff.app.dev', 'Europe/Madrid');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000e", "role": "authenticated"}';
select public.register_device('tok-eva', 'android', null, 'ai.ghostaff.app.dev', 'Europe/Madrid');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select public.register_device('tok-bea', 'android', null, 'ai.ghostaff.app.dev', 'America/New_York');
-- Bea writes to Secretaría, opening its chat: so far only she follows it.
insert into ids select 'chat', thread_id from public.chat_with('20000000-0000-0000-0000-000000000001', '¿Qué tengo hoy?');

select results_eq(
  $$ select token, platform from public.device_tokens $$,
  $$ values ('tok-bea', 'android') $$, 'a person reads only their own phones');
select throws_ok(
  $$ insert into public.device_tokens (user_id, token, platform, bundle_id, time_zone)
     values ('00000000-0000-0000-0000-00000000000b', 'tok-x', 'android', 'ai.ghostaff.app.dev', 'Europe/Madrid') $$,
  '42501', null, '... and writes them only through register_device');
select throws_ok(
  $$ select public.register_device('tok-y', 'android', null, 'ai.ghostaff.app.dev', 'Mars/Olympus') $$,
  '22023', null, 'a time zone must be a real one');
select throws_ok(
  $$ select public.register_device('tok-y', 'ios', null, 'ai.ghostaff.app.dev', 'Europe/Madrid') $$,
  '22023', null, 'an iPhone says which APNs environment it uses');
-- A token goes into a URL path (APNs) or a JSON body (FCM): only its platform's characters.
select throws_ok(
  $$ select public.register_device('tok-y', 'ios', 'sandbox', 'ai.ghostaff.app.dev', 'Europe/Madrid') $$,
  '22023', null, 'an iPhone''s token is hex');
select throws_ok(
  $$ select public.register_device(repeat('a', 63), 'ios', 'sandbox', 'ai.ghostaff.app.dev', 'Europe/Madrid') $$,
  '22023', null, '... of at least 64 digits');
select throws_ok(
  $$ select public.register_device(repeat('a', 201), 'ios', 'sandbox', 'ai.ghostaff.app.dev', 'Europe/Madrid') $$,
  '22023', null, '... and at most 200');
select throws_ok(
  $$ select public.register_device(E'tok-y\r\nx: 1', 'android', null, 'ai.ghostaff.app.dev', 'Europe/Madrid') $$,
  '22023', null, 'an Android token has no line breaks');
select throws_ok(
  $$ select public.register_device('tok/../y', 'android', null, 'ai.ghostaff.app.dev', 'Europe/Madrid') $$,
  '22023', null, '... nor slashes or dots');

-- The engine answers Bea in Secretaría's chat.
reset role;
select is((select count(*) from public.push_outbox), 0::bigint, 'a person''s message queues nothing');

insert into public.messages (id, thread_id, org_id, author_kind, author_agent, author_name, parts, state) values
  ('40000000-0000-0000-0000-000000000001', (select id from ids where name = 'chat'), '10000000-0000-0000-0000-000000000001',
   'agent', '20000000-0000-0000-0000-000000000001', 'Secretaría', '[]', 'working');
select is((select count(*) from public.push_outbox), 0::bigint, 'a working agent message queues nothing');

update public.messages set state = 'done', finished_at = clock_timestamp() where id = '40000000-0000-0000-0000-000000000001';
select results_eq(
  $$ select user_id, org_id, kind, thread_id, title, body, data, collapse_id from public.push_outbox $$,
  $$ values ('00000000-0000-0000-0000-00000000000b'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 'reply',
             (select id from ids where name = 'chat'), 'Secretaría', 'Te ha contestado',
             '{"kind": "reply", "orgId": "10000000-0000-0000-0000-000000000001", "route": "/chat/20000000-0000-0000-0000-000000000001"}'::jsonb,
             (select id::text from ids where name = 'chat')) $$,
  'once done, it queues one row for who follows the chat, with names only and the route to the chat');
select is(
  (select count(*) from public.push_outbox where user_id <> '00000000-0000-0000-0000-00000000000b'), 0::bigint,
  '... and none for a member who doesn''t follow it');

update public.messages set state = 'done' where id = '40000000-0000-0000-0000-000000000001';
select is((select count(*) from public.push_outbox), 1::bigint, 'updating done to done again queues nothing');

-- Ana writes in the same chat: she follows it too.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select public.chat_with('20000000-0000-0000-0000-000000000001', 'Y mañana, ¿qué?');
reset role;
insert into public.messages (id, thread_id, org_id, author_kind, author_agent, author_name, parts, state) values
  ('40000000-0000-0000-0000-000000000002', (select id from ids where name = 'chat'), '10000000-0000-0000-0000-000000000001',
   'agent', '20000000-0000-0000-0000-000000000001', 'Secretaría', '[]', 'done');
select results_eq(
  $$ select user_id, body from public.push_outbox where message_id = '40000000-0000-0000-0000-000000000002' order by user_id $$,
  $$ values ('00000000-0000-0000-0000-00000000000a'::uuid, 'Te ha contestado'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'Te ha contestado') $$,
  'an agent message inserted done queues everyone who wrote in the chat');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000d", "role": "authenticated"}';
select public.chat_with('20000000-0000-0000-0000-000000000001', 'Hola');
reset role;

insert into public.messages (id, thread_id, org_id, author_kind, author_agent, author_name, parts, state) values
  ('40000000-0000-0000-0000-000000000003', (select id from ids where name = 'chat'), '10000000-0000-0000-0000-000000000001',
   'agent', '20000000-0000-0000-0000-000000000001', 'Secretaría', '[]', 'failed');
select results_eq(
  $$ select user_id, body from public.push_outbox where message_id = '40000000-0000-0000-0000-000000000003' order by user_id $$,
  $$ values ('00000000-0000-0000-0000-00000000000a'::uuid, 'No ha podido acabar'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'No ha podido acabar'),
            ('00000000-0000-0000-0000-00000000000d'::uuid, 'No ha podido acabar') $$,
  'a failed one says the agent could not finish');

-- Redes' chat, which every member reads: Ana writes in it mentioning Carla
-- and Eva, Bea reads it, Dani never opens it, Eva loses access to the agent.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
insert into ids select 'shared', thread_id from public.chat_with('20000000-0000-0000-0000-000000000002', 'Que lo vean @Carla y @Eva');
select public.set_agent_access('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000e', 'none');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select public.mark_thread_read((select id from ids where name = 'shared'));

reset role;
insert into public.messages (id, thread_id, org_id, author_kind, author_agent, author_name, parts, state, finished_at) values
  ('40000000-0000-0000-0000-000000000004', (select id from ids where name = 'shared'), '10000000-0000-0000-0000-000000000001',
   'agent', '20000000-0000-0000-0000-000000000002', 'Redes', '[]', 'done', clock_timestamp());
select results_eq(
  $$ select user_id from public.push_outbox where message_id = '40000000-0000-0000-0000-000000000004' order by user_id $$,
  $$ values ('00000000-0000-0000-0000-00000000000a'::uuid), ('00000000-0000-0000-0000-00000000000b'::uuid) $$,
  'it queues who wrote in the chat and a follower who can read it');
select is(
  (select count(*) from public.push_outbox where message_id = '40000000-0000-0000-0000-000000000004' and user_id = '00000000-0000-0000-0000-00000000000d'),
  0::bigint, '... not a member who never opened it');
select is(
  (select count(*) from public.push_outbox where message_id = '40000000-0000-0000-0000-000000000004' and user_id = '00000000-0000-0000-0000-00000000000e'),
  0::bigint, '... nor a member mentioned in it who has none on the agent');
select is(
  (select count(*) from public.push_outbox where user_id = '00000000-0000-0000-0000-00000000000c'),
  0::bigint, '... and a member without a phone gets no row, though mentioned');
select is(
  (select data->>'route' from public.push_outbox where message_id = '40000000-0000-0000-0000-000000000004' limit 1),
  '/chat/20000000-0000-0000-0000-000000000002', 'its route is the agent''s chat');

-- Bea writes again; the reply starts while she looks, she closes the app, it
-- finishes after: that one is still unread.
insert into public.messages (id, thread_id, org_id, author_kind, author_agent, author_name, parts, state) values
  ('40000000-0000-0000-0000-000000000005', (select id from ids where name = 'chat'), '10000000-0000-0000-0000-000000000001',
   'agent', '20000000-0000-0000-0000-000000000001', 'Secretaría', '[]', 'working');
set local role authenticated;
select public.mark_thread_read((select id from ids where name = 'chat'));
reset role;
update public.messages set state = 'done', finished_at = clock_timestamp() where id = '40000000-0000-0000-0000-000000000005';
set local role authenticated;
select is(
  (select unread from public.my_threads('10000000-0000-0000-0000-000000000001') where id = (select id from ids where name = 'chat')),
  true, 'a reply finished after the read mark is unread');
select is(
  (select following from public.my_threads('10000000-0000-0000-0000-000000000001') where id = (select id from ids where name = 'shared')),
  true, 'a chat she read is one she follows');

-- Nobody reaches the outbox or the engine's functions from the app.
select throws_ok($$ select * from public.push_outbox $$, '42501', null, 'a person cannot read the outbox');
select throws_ok($$ select * from public.claim_pushes(10) $$, '42501', null, '... nor claim from it');
select throws_ok($$ select * from public.daily_push_candidates() $$, '42501', null, '... nor list who waits');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000d", "role": "authenticated"}';
select is(
  public.follows_thread((select id from ids where name = 'shared'), '00000000-0000-0000-0000-00000000000b'),
  false, '... nor learn someone else''s read marks by asking whether they follow');

-- The engine claims.
set local role service_role;
insert into claimed select id, user_id, message_id from public.claim_pushes(100);
select is(
  (select count(*) from claimed where message_id = '40000000-0000-0000-0000-000000000005' and user_id = '00000000-0000-0000-0000-00000000000b'),
  1::bigint, 'a reply finished after the person''s read mark is claimed');
select is(
  (select count(*) from claimed where message_id = '40000000-0000-0000-0000-000000000001'),
  0::bigint, 'one finished before it is not');
select results_eq(
  $$ select outcome, sent_at is not null from public.push_outbox where message_id = '40000000-0000-0000-0000-000000000001' $$,
  $$ values ('read', true) $$, '... it is marked read');
select is((select count(*) from claimed), 8::bigint, 'everything else unsent is claimed');
select is((select count(*) from public.claim_pushes(100)), 0::bigint, 'a second call returns nothing');
select is((select count(*) from public.push_outbox where claimed_at is null and sent_at is null), 0::bigint, '... as every row is claimed or done');

-- A mention is a whole name: «@Lucía» is not Lu, «@lu,» is.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
insert into ids select 'mentions', thread_id from public.chat_with('20000000-0000-0000-0000-000000000003', 'Pregúntale a @Lucía');
reset role;
select is(public.follows_thread((select id from ids where name = 'mentions'), '00000000-0000-0000-0000-00000000000f'), false,
  'a longer name that starts like hers does not make her a follower');
set local role authenticated;
select public.post_message((select id from ids where name = 'mentions'), '@lu, mira esto');
reset role;
select is(public.follows_thread((select id from ids where name = 'mentions'), '00000000-0000-0000-0000-00000000000f'), true,
  '... her own name does, in any case');

-- In Finanzas' chat Dani reads the agent but never wrote, read or was named
-- there, and Lu, named, has no phone: only Ana hears of a reply.
insert into ids select 'private', id from ids where name = 'mentions';
insert into public.messages (id, thread_id, org_id, author_kind, author_agent, author_name, parts, state) values
  ('40000000-0000-0000-0000-000000000006', (select id from ids where name = 'private'), '10000000-0000-0000-0000-000000000001',
   'agent', '20000000-0000-0000-0000-000000000003', 'Finanzas', '[]', 'done');
select results_eq(
  $$ select user_id from public.push_outbox where message_id = '40000000-0000-0000-0000-000000000006' $$,
  $$ values ('00000000-0000-0000-0000-00000000000a'::uuid) $$,
  'a reply queues only who follows the chat and has a phone, not a member who merely reads the agent');

-- A row a drain claimed a moment ago stays its own, even once read.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select public.mark_thread_read((select id from ids where name = 'shared'));
set local role service_role;
select is((select count(*) from public.claim_pushes(100) where message_id = '40000000-0000-0000-0000-000000000006'), 1::bigint,
  'Finanzas'' reply is claimed');
reset role;
select results_eq(
  $$ select outcome from public.push_outbox where message_id = '40000000-0000-0000-0000-000000000004' and user_id = '00000000-0000-0000-0000-00000000000a' $$,
  $$ values (null::text) $$,
  'a claimed row read since is left to the drain that holds it');

-- A backlog (push was off): a reply queued over an hour ago is closed, not
-- sent; a fresh one, and a daily one of any age, still go out.
insert into public.push_outbox (user_id, org_id, kind, thread_id, message_id, local_day, title, body, created_at) values
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000001', 'reply', (select id from ids where name = 'private'),
   '40000000-0000-0000-0000-000000000006', null, 'Secretaría', 'Te ha contestado', now() - interval '61 minutes'),
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000001', 'reply', (select id from ids where name = 'private'),
   '40000000-0000-0000-0000-000000000005', null, 'Secretaría', 'Te ha contestado', now() - interval '59 minutes'),
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000001', 'daily', null, null, '2026-11-24',
   'Panadería', '1 decisión te espera', now() - interval '1 day');
set local role service_role;
select results_eq(
  $$ select kind, message_id from public.claim_pushes(100) where user_id = '00000000-0000-0000-0000-00000000000c' order by kind $$,
  $$ values ('daily', null::uuid), ('reply', '40000000-0000-0000-0000-000000000005'::uuid) $$,
  'a reply under an hour old and a daily one are claimed, a reply over an hour old is not');
reset role;
select results_eq(
  $$ select outcome, sent_at is not null from public.push_outbox
     where user_id = '00000000-0000-0000-0000-00000000000c' and message_id = '40000000-0000-0000-0000-000000000006' $$,
  $$ values ('stale', true) $$,
  '... it is closed as stale');

-- The daily one: two open decisions, one answered, one closed; Bea puts one
-- aside; OK cards wait for whoever approves them, where they can see them.
reset role;
insert into public.decisions (id, org_id, record_id, source_path, area, kind, question, context, proposed_by, created_on, answer, answered_by_name, answered_at, closed_at) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'a', 'por-decidir/a.yaml', 'finanzas', 'precio', '¿A?', 'ctx', 'finanzas', '2026-11-25', null, null, null, null),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'b', 'por-decidir/b.yaml', 'finanzas', 'precio', '¿B?', 'ctx', 'finanzas', '2026-11-25', null, null, null, null),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'c', 'por-decidir/c.yaml', 'finanzas', 'precio', '¿C?', 'ctx', 'finanzas', '2026-11-25', 'ok', 'Ana', now(), null),
  ('50000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'd', 'por-decidir/d.yaml', 'finanzas', 'precio', '¿D?', 'ctx', 'finanzas', '2026-11-25', null, null, null, now());
insert into public.agent_actions (org_id, thread_id, message_id, agent_id, tool, input, label, decider, requested_by) values
  ('10000000-0000-0000-0000-000000000001', (select id from ids where name = 'shared'), '40000000-0000-0000-0000-000000000004',
   '20000000-0000-0000-0000-000000000001', 'send_mail', '{}', 'Enviar', 'owner', '00000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-000000000001', (select id from ids where name = 'chat'), '40000000-0000-0000-0000-000000000005',
   '20000000-0000-0000-0000-000000000001', 'send_mail', '{}', 'Enviar', 'owner', '00000000-0000-0000-0000-00000000000b'),
  ('10000000-0000-0000-0000-000000000001', (select id from ids where name = 'chat'), '40000000-0000-0000-0000-000000000005',
   '20000000-0000-0000-0000-000000000001', 'create_routine', '{}', 'Crear rutina', 'requester', '00000000-0000-0000-0000-00000000000b'),
  ('10000000-0000-0000-0000-000000000001', (select id from ids where name = 'shared'), '40000000-0000-0000-0000-000000000004',
   '20000000-0000-0000-0000-000000000001', 'send_mail', '{}', 'Enviado', 'owner', '00000000-0000-0000-0000-00000000000a');
update public.agent_actions set status = 'done' where label = 'Enviado';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select public.snooze_decision('50000000-0000-0000-0000-000000000001', now() + interval '1 day');
-- Her newer phone sets her time zone.
select public.register_device('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'ios', 'production', 'ai.ghostaff.app', 'Europe/Madrid');

set local role service_role;
select results_eq(
  $$ select user_id, time_zone, org_id, org_name, waiting from public.daily_push_candidates() order by user_id $$,
  $$ values
     ('00000000-0000-0000-0000-00000000000a'::uuid, 'Europe/Madrid', '10000000-0000-0000-0000-000000000001'::uuid, 'Panadería', 4),
     ('00000000-0000-0000-0000-00000000000b'::uuid, 'Europe/Madrid', '10000000-0000-0000-0000-000000000001'::uuid, 'Panadería', 2),
     ('00000000-0000-0000-0000-00000000000d'::uuid, 'Europe/Madrid', '10000000-0000-0000-0000-000000000001'::uuid, 'Panadería', 2),
     ('00000000-0000-0000-0000-00000000000e'::uuid, 'Europe/Madrid', '10000000-0000-0000-0000-000000000001'::uuid, 'Panadería', 2) $$,
  'the daily count: open decisions not put aside, plus the OK cards each person approves and can see; Carla has no phone');

reset role;
delete from public.decisions;
delete from public.agent_actions where decider = 'requester';
set local role service_role;
select results_eq(
  $$ select user_id, waiting from public.daily_push_candidates() $$,
  $$ values ('00000000-0000-0000-0000-00000000000a'::uuid, 2) $$,
  'with nothing waiting a person is left out; an owner still has her cards');

-- A phone changes hands; signing out forgets only your own.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select public.register_device('tok-bea', 'android', null, 'ai.ghostaff.app.dev', 'Europe/Madrid');
select results_eq(
  $$ select token from public.device_tokens $$, $$ values ('tok-bea') $$,
  'registering a token another person held moves it to the caller');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select results_eq(
  $$ select token from public.device_tokens $$, $$ values ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') $$, '... and the first person no longer has it');
select public.forget_device('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
reset role;
select is((select count(*) from public.device_tokens where token = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 1::bigint, 'forget_device cannot delete someone else''s phone');
set local role authenticated;
select public.forget_device('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
reset role;
select is((select count(*) from public.device_tokens where token = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'), 0::bigint, '... and deletes your own');

-- Ten phones a person at most: an eleventh pushes out the one registered longest ago.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000e", "role": "authenticated"}';
select public.register_device('eva-' || i, 'android', null, 'ai.ghostaff.app.dev', 'Europe/Madrid') from generate_series(1, 10) i;
select results_eq(
  $$ select count(*), bool_or(token = 'tok-eva'), bool_and(token like 'eva-%') from public.device_tokens $$,
  $$ values (10::bigint, false, true) $$,
  'a person keeps their ten most recent phones');

set local role anon;
select throws_ok(
  $$ select public.register_device('tok-z', 'android', null, 'ai.ghostaff.app.dev', 'Europe/Madrid') $$,
  '42501', null, 'anon cannot register a phone');

select * from finish();
rollback;
