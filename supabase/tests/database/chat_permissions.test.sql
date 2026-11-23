-- Who reads and writes a conversation (20261124200000_conversation_visibility.sql):
-- the opener decides, owner or not; the agent's levels cap everyone, the opener
-- included; only the opener changes it; nothing across organisations.
begin;
select plan(45);

-- Ana and Olga own the bakery. Bea talks to Finanzas, Dani only sees it (its
-- default), Eva doesn't see it. Carla is in another organisation.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'dani@example.com'),
  ('00000000-0000-0000-0000-00000000000e', 'eva@example.com'),
  ('00000000-0000-0000-0000-00000000000f', 'olga@example.com');

insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería'),
  ('10000000-0000-0000-0000-000000000002', 'taller', 'Taller');

insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000f', 'owner', 'Olga'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'member', 'Bea'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 'member', 'Dani'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000e', 'member', 'Eva'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'owner', 'Carla');

insert into public.agents (id, org_id, name, ghost, department, member_default) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Secretaría', 'secretaria', 'direccion', 'talk'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Finanzas', 'finanzas', 'finanzas', 'read');

insert into public.agent_access (agent_id, user_id, org_id, level) values
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', 'talk'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-000000000001', 'none');

set local role authenticated;
create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, service_role;

-- Ana opens three conversations with Finanzas, one of each kind.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
insert into ids select 'sueldos', id from public.start_thread('20000000-0000-0000-0000-000000000002', 'Sueldos 2027', visibility => 'private');
insert into ids select 'informe', id from public.start_thread('20000000-0000-0000-0000-000000000002', 'Informe de octubre', visibility => 'read');
insert into ids select 'cierre', id from public.start_thread('20000000-0000-0000-0000-000000000002', 'Cierre de noviembre', visibility => 'write');
select is((select visibility from public.threads where id = (select id from ids where name = 'sueldos')), 'private', 'the opener chooses the visibility');
select is((select count(*) from public.threads), 3::bigint, 'the opener sees all of hers');
select throws_ok(
  $$ select public.start_thread('20000000-0000-0000-0000-000000000002', 'Hola', visibility => 'everyone') $$,
  '22023', null, 'only private, read or write');

-- Olga, another owner: not the private one.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000f", "role": "authenticated"}';
select is((select count(*) from public.threads where id = (select id from ids where name = 'sueldos')), 0::bigint, 'another owner does not see a private conversation');
select is((select count(*) from public.messages where thread_id = (select id from ids where name = 'sueldos')), 0::bigint, '... nor its messages');
select is((select count(*) from public.threads), 2::bigint, '... but sees the shared ones');

-- Bea, who talks to Finanzas: reads «read», writes in «write».
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select count(*) from public.threads where id = (select id from ids where name = 'sueldos')), 0::bigint, 'a member does not see a private conversation');
select is((select count(*) from public.messages where thread_id = (select id from ids where name = 'informe')), 1::bigint, 'she reads a «read» conversation');
select throws_ok(
  $$ select public.post_message((select id from ids where name = 'informe'), 'Una duda') $$,
  '42501', null, '... and cannot write in it, though she talks to the agent');
select lives_ok(
  $$ select public.post_message((select id from ids where name = 'cierre'), 'Faltan dos facturas') $$,
  'she writes in a «write» conversation');
select throws_ok(
  $$ select public.set_conversation_visibility((select id from ids where name = 'cierre'), 'read') $$,
  '42501', null, 'only the opener changes who sees it');
-- Bea opens her own private one: nobody else sees it, owners included.
insert into ids select 'baja', id from public.start_thread('20000000-0000-0000-0000-000000000002', 'Mi baja', visibility => 'private');

-- Dani only sees Finanzas: reads both shared ones, writes in neither.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000d", "role": "authenticated"}';
select is((select count(*) from public.threads), 2::bigint, 'with «read» on the agent he sees the two shared ones');
select throws_ok(
  $$ select public.post_message((select id from ids where name = 'cierre'), 'Hola') $$,
  '42501', null, '... and his level on the agent caps a «write» conversation');
select results_eq(
  $$ select following from public.my_threads('10000000-0000-0000-0000-000000000001') where id = (select id from ids where name = 'informe') $$,
  $$ values (false) $$, 'a shared conversation he never opened is not followed');
select lives_ok($$ select public.mark_thread_read((select id from ids where name = 'informe')) $$, 'he opens it');
select results_eq(
  $$ select following from public.my_threads('10000000-0000-0000-0000-000000000001') where id = (select id from ids where name = 'informe') $$,
  $$ values (true) $$, '... and is once he has read it');

-- Eva doesn't see Finanzas: no conversation with it.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000e", "role": "authenticated"}';
select is((select count(*) from public.threads) + (select count(*) from public.messages), 0::bigint, 'without access to the agent, no conversation with it');

-- Back to Ana, an owner: not Bea's private one.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select count(*) from public.threads where id = (select id from ids where name = 'baja')), 0::bigint, 'an owner does not see a member''s private conversation');
select throws_ok(
  $$ select public.set_conversation_visibility((select id from ids where name = 'baja'), 'write') $$,
  'P0002', null, '... nor can make it shared');
select is(public.conversation_readers((select id from ids where name = 'cierre')), 4, 'a «write» conversation is read by everyone who sees the agent');
select is(public.conversation_readers((select id from ids where name = 'sueldos')), 1, 'a private one by its opener alone');

-- Changing it later.
select throws_ok(
  $$ select public.set_conversation_visibility((select id from ids where name = 'cierre'), 'private') $$,
  '55000', null, 'once someone else wrote, it cannot go back to private');
select is((select visibility from public.set_conversation_visibility((select id from ids where name = 'cierre'), 'read')), 'read', '... but it can be closed to reading');
select is((select visibility from public.set_conversation_visibility((select id from ids where name = 'sueldos'), 'read')), 'read', 'a private one can be shared');
select is((select visibility from public.set_conversation_visibility((select id from ids where name = 'sueldos'), 'private')), 'private', '... and made private again while nobody else wrote');
select throws_ok(
  $$ select public.set_conversation_visibility((select id from ids where name = 'sueldos'), 'everyone') $$,
  '22023', null, 'only private, read or write');

-- @Dani in a shared conversation: he follows it.
select lives_ok($$ select public.set_conversation_visibility((select id from ids where name = 'cierre'), 'write') $$, 'reading can be opened to writing again');
select lives_ok($$ select public.post_message((select id from ids where name = 'cierre'), '@Dani, ¿lo miras?') $$, 'Ana mentions Dani');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select throws_ok(
  $$ select public.post_message((select id from ids where name = 'informe'), 'Hola') $$,
  '42501', null, 'a conversation closed to reading stays closed');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000d", "role": "authenticated"}';
select results_eq(
  $$ select following, mine from public.my_threads('10000000-0000-0000-0000-000000000001') where id = (select id from ids where name = 'cierre') $$,
  $$ values (true, false) $$, 'someone @mentioned follows it, and it is not theirs');

-- The agent's default for new conversations, set by an owner.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select throws_ok(
  $$ select public.set_agent_chat_default('20000000-0000-0000-0000-000000000002', 'write') $$,
  '42501', null, 'only an owner sets the default');
insert into ids select 'sin-elegir', id from public.start_thread('20000000-0000-0000-0000-000000000002', 'Una pregunta');
select is((select visibility from public.threads where id = (select id from ids where name = 'sin-elegir')), 'private', 'without a choice, private');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select lives_ok($$ select public.set_agent_chat_default('20000000-0000-0000-0000-000000000002', 'read') $$, 'an owner sets it');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
insert into ids select 'por-defecto', id from public.start_thread('20000000-0000-0000-0000-000000000002', 'Otra pregunta');
select is((select visibility from public.threads where id = (select id from ids where name = 'por-defecto')), 'read', '... then the agent''s default');

-- A person's chat with an agent stays private.
insert into ids select 'chat', thread_id from public.chat_with('20000000-0000-0000-0000-000000000001', 'Hola');
select throws_ok(
  $$ select public.set_conversation_visibility((select id from ids where name = 'chat'), 'write') $$,
  '42501', null, 'a person''s chat with an agent cannot be shared');

-- The agent's levels cap the opener too.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select lives_ok($$ select public.set_agent_access('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'none') $$, 'Ana moves Bea to «none» on Finanzas');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select count(*) from public.threads where id = (select id from ids where name = 'baja')), 0::bigint, 'moved to «none», the opener loses her own conversation');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select lives_ok($$ select public.set_agent_access('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'talk') $$, '... and back to «talk»');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select count(*) from public.threads where id = (select id from ids where name = 'baja')), 1::bigint, '... and has it back with her level');

-- Carla: nothing of the bakery.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.threads) + (select count(*) from public.messages), 0::bigint, 'another organisation sees no conversation');
select throws_ok(
  $$ select public.conversation_readers((select id from ids where name = 'cierre')) $$,
  'P0002', null, '... nor how many read one');
select throws_ok(
  $$ select public.thread_level_for((select id from ids where name = 'cierre'), '00000000-0000-0000-0000-00000000000c') $$,
  '42501', null, 'the engine''s rule is not for the app');

-- The engine (service role) reads the same rule for whoever asked.
reset role;
set local role service_role;
select is(public.thread_level_for((select id from ids where name = 'cierre'), '00000000-0000-0000-0000-00000000000b'), 'talk', 'the engine: Bea talks in «write»');
select is(public.thread_level_for((select id from ids where name = 'informe'), '00000000-0000-0000-0000-00000000000b'), 'read', '... reads in «read»');
select is(public.thread_level_for((select id from ids where name = 'sueldos'), '00000000-0000-0000-0000-00000000000b'), 'none', '... and nothing in someone else''s private one');

select * from finish();
rollback;
