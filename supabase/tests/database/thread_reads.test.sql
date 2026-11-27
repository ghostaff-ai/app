-- The thread list and read marks (20261118100000_thread_reads.sql): each person
-- sees only the threads their level allows, unread until they open them, and
-- only their own marks; nothing across organisations (invariant 1).
begin;
select plan(11);

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
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Finanzas', 'finanzas', 'finanzas', 'read');

set local role authenticated;
create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

-- Ana writes to each agent, in its chat.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
insert into ids select 'correo', thread_id from public.chat_with('20000000-0000-0000-0000-000000000001', '¿Algo urgente?');
insert into ids select 'cierre', thread_id from public.chat_with('20000000-0000-0000-0000-000000000002', '¿Cerramos octubre?');
select is(
  (select count(*) from public.my_threads('10000000-0000-0000-0000-000000000001') where unread),
  0::bigint, 'what you wrote yourself is not unread');
select results_eq(
  $$ select title from public.my_threads('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002') $$,
  $$ values ('Finanzas') $$,
  'narrowed to one agent');

-- Bea sees both, unread, with the last message.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is(
  (select count(*) from public.my_threads('10000000-0000-0000-0000-000000000001') where unread),
  2::bigint, 'what someone else wrote is unread');
select is(
  (select last_author || ': ' || last_text from public.my_threads('10000000-0000-0000-0000-000000000001') where id = (select id from ids where name = 'cierre')),
  'Ana: ¿Cerramos octubre?', '... with who wrote last and what');
select lives_ok($$ select public.mark_thread_read((select id from ids where name = 'cierre')) $$, 'opening a thread marks it read');
select is(
  (select unread from public.my_threads('10000000-0000-0000-0000-000000000001') where id = (select id from ids where name = 'cierre')),
  false, '... so it is no longer unread');
select lives_ok($$ select public.post_message((select id from ids where name = 'correo'), 'Sí, Hacienda') $$, 'Bea answers in Secretaría''s chat');

-- Ana sees Bea's answer as unread, and hides Finanzas from Bea.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is(
  (select unread from public.my_threads('10000000-0000-0000-0000-000000000001') where id = (select id from ids where name = 'correo')),
  true, 'a reply from someone else makes it unread again');
select public.set_agent_access('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'none');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select count(*) from public.my_threads('10000000-0000-0000-0000-000000000001') where kind = 'agent'), 1::bigint, 'with none, Finanzas'' chat leaves the list');
select throws_ok($$ select public.mark_thread_read((select id from ids where name = 'cierre')) $$, 'P0002', null, '... and cannot be marked');

-- Carla: nothing of the bakery.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is(
  (select count(*) from public.my_threads('10000000-0000-0000-0000-000000000001') where kind = 'agent') + (select count(*) from public.thread_reads),
  0::bigint, 'another organisation sees neither the threads nor anyone''s marks');

select * from finish();
rollback;
