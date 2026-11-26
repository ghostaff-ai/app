-- One chat per agent, shared like a WhatsApp group
-- (20261128700000_group_chat_per_agent.sql): everyone who may see the agent
-- reads it, everyone who may talk to it writes there, each message signed;
-- what the agent does alone lands once; the level on the agent is the only
-- rule; nothing across organisations.
begin;
select plan(26);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'dani@example.com');

insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería'),
  ('10000000-0000-0000-0000-000000000002', 'taller', 'Taller');

insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'member', 'Bea'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 'member', 'Dani'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'owner', 'Carla');

-- Finanzas: everyone reads it; Bea also talks to it.
insert into public.agents (id, org_id, name, ghost, department, member_default) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Finanzas', 'finanzas', 'finanzas', 'read'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Cuentas', 'finanzas', 'finanzas', 'none');
insert into public.agent_access (agent_id, user_id, org_id, level) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', 'talk');

set local role authenticated;
create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, service_role;

-- Bea and Ana write to Finanzas: the same chat.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
insert into ids select 'chat', thread_id from public.chat_with('20000000-0000-0000-0000-000000000001', 'Hola');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is(
  (select thread_id from public.chat_with('20000000-0000-0000-0000-000000000001', 'Buenos días')),
  (select id from ids where name = 'chat'), 'an owner writes in the same chat as the member');
select is((select count(*) from public.threads where agent_id = '20000000-0000-0000-0000-000000000001'), 1::bigint, '... the agent''s only one');
select is((select title from public.threads where id = (select id from ids where name = 'chat')), 'Finanzas', '... titled with its name');
select results_eq(
  $$ select author_name from public.messages where thread_id = (select id from ids where name = 'chat') order by created_at, author_name desc $$,
  $$ values ('Bea'), ('Ana') $$, '... each message signed by who wrote it');

-- Dani reads Finanzas: he reads everyone's messages and writes nothing.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000d", "role": "authenticated"}';
select is((select count(*) from public.messages), 2::bigint, 'a member who reads the agent reads everyone''s messages');
select results_eq(
  $$ select id, unread, following from public.my_threads('10000000-0000-0000-0000-000000000001') $$,
  $$ values ((select id from ids where name = 'chat'), true, false) $$,
  '... sees the chat in the list, unread, not yet followed');
select throws_ok(
  $$ select public.post_message((select id from ids where name = 'chat'), 'yo también') $$,
  '42501', null, '... but cannot write in it');
select throws_ok(
  $$ select public.chat_with('20000000-0000-0000-0000-000000000001', 'yo también') $$,
  '42501', null, '... nor open it by writing');
select throws_ok(
  $$ select public.chat_with('20000000-0000-0000-0000-000000000002', 'Hola') $$,
  '42501', null, 'nobody without a level writes to an agent');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select results_eq(
  $$ select following from public.my_threads('10000000-0000-0000-0000-000000000001') $$,
  $$ values (true) $$, 'who wrote in the chat follows it');
select lives_ok(
  $$ select public.post_message((select id from ids where name = 'chat'), '¿Cerramos octubre?') $$,
  'a member who talks to the agent writes in its chat');

-- Carla, another organisation: nothing.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.threads), 0::bigint, 'another organisation sees no chat');
select is((select count(*) from public.messages), 0::bigint, '... nor its messages');
select throws_ok(
  $$ select public.post_message((select id from ids where name = 'chat'), 'x') $$,
  '42501', null, '... and cannot write in it');

-- Nobody signed in reaches the engine's functions.
select throws_ok($$ select public.agent_chat('20000000-0000-0000-0000-000000000001') $$, '42501', null, 'only the engine opens a chat by itself');
select throws_ok($$ select public.post_to_agent_chat('20000000-0000-0000-0000-000000000001', 'x') $$, '42501', null, '... or writes as the agent');

-- The engine: what the agent did alone, once.
set local role service_role;
select isnt(public.post_to_agent_chat('20000000-0000-0000-0000-000000000001', 'Cierre de mes listo'), null, 'the agent''s own word goes in its chat');
select is((select count(*) from public.messages where thread_id = (select id from ids where name = 'chat') and author_kind = 'agent'), 1::bigint,
  '... once, for everyone');
select throws_ok(
  $$ select public.post_to_agent_chat('20000000-0000-0000-0000-000000000001', '  ') $$,
  '22023', null, '... and never empty');
insert into ids select 'cuentas', public.agent_chat('20000000-0000-0000-0000-000000000002');
select is((select id from public.threads where agent_id = '20000000-0000-0000-0000-000000000002'), (select id from ids where name = 'cuentas'),
  'the engine opens a chat nobody has written in yet');
select throws_ok(
  $$ insert into public.threads (org_id, agent_id, title) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Otro') $$,
  '23505', null, 'an agent has one chat');

-- What went away.
select hasnt_function('public', 'start_thread', 'titled conversations are gone');
select hasnt_function('public', 'set_conversation_visibility', '... with their visibility');
select hasnt_function('public', 'post_to_personal_chats', '... and the copy per person');
select hasnt_column('public', 'threads', 'personal_of', 'no chat belongs to one person');
select hasnt_column('public', 'agents', 'chat_default', 'an agent has no default visibility');

select * from finish();
rollback;
