-- One chat per person with each agent (20261123200000_personal_chats.sql):
-- only its person sees it, reads its messages or writes in it, an owner
-- included; writing twice keeps one chat; nothing across organisations.
begin;
select plan(13);

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
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Finanzas', 'finanzas', 'finanzas', 'read'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Secretaría', 'secretaria', 'direccion', 'talk');

set local role authenticated;
create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

-- Bea writes to Secretaría twice: one chat, two messages.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
insert into ids select 'bea', thread_id from public.chat_with('20000000-0000-0000-0000-000000000001', 'Hola');
select is(
  (select thread_id from public.chat_with('20000000-0000-0000-0000-000000000001', '¿Sigues ahí?')),
  (select id from ids where name = 'bea'), 'writing again stays in the same chat');
select is((select count(*) from public.messages where thread_id = (select id from ids where name = 'bea')), 2::bigint, '... with both messages');
select results_eq(
  $$ select personal from public.my_threads('10000000-0000-0000-0000-000000000001') $$,
  $$ values (true) $$, 'the list marks it as her chat');
select throws_ok(
  $$ select public.chat_with('20000000-0000-0000-0000-000000000002', 'Hola') $$,
  '42501', null, 'no chat with an agent she may only see');

-- Ana, an owner, writes to Secretaría too: her own chat, and Bea's stays hidden.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
insert into ids select 'ana', thread_id from public.chat_with('20000000-0000-0000-0000-000000000001', 'Buenos días');
select isnt((select id from ids where name = 'ana'), (select id from ids where name = 'bea'), 'each person has their own chat');
select is((select count(*) from public.threads where id = (select id from ids where name = 'bea')), 0::bigint, 'an owner does not see someone else''s chat');
select is((select count(*) from public.messages where thread_id = (select id from ids where name = 'bea')), 0::bigint, '... nor its messages');
select is((select count(*) from public.my_threads('10000000-0000-0000-0000-000000000001')), 1::bigint, '... nor in the list');
select throws_ok(
  $$ select public.post_message((select id from ids where name = 'bea'), 'Hola Bea') $$,
  '42501', null, '... and cannot write in it');
select throws_ok(
  $$ select public.mark_thread_read((select id from ids where name = 'bea')) $$,
  'P0002', null, '... nor mark it read');

-- A shared thread works as before.
insert into ids select 'shared', id from public.start_thread('20000000-0000-0000-0000-000000000001', 'Para todos');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select count(*) from public.my_threads('10000000-0000-0000-0000-000000000001')), 2::bigint, 'Bea sees her chat and the shared thread');

-- Carla: nothing of the bakery, and no chat with its agents.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.threads) + (select count(*) from public.messages), 0::bigint, 'another organisation sees no chat');
select throws_ok(
  $$ select public.chat_with('20000000-0000-0000-0000-000000000001', 'Hola') $$,
  '42501', null, '... and cannot open one with its agents');

select * from finish();
rollback;
