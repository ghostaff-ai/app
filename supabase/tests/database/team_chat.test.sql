-- Who may see and talk to each agent, and its chat
-- (20261118000000_team_chat.sql, 20261128700000_group_chat_per_agent.sql):
-- levels per agent and person, set only by an owner; nothing crosses
-- organisations (invariant 1).
begin;
select plan(34);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'dani@example.com'),
  ('00000000-0000-0000-0000-00000000000e', 'eva@example.com');

insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería'),
  ('10000000-0000-0000-0000-000000000002', 'taller', 'Taller');

insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'member', 'Bea'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 'member', 'Dani'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'owner', 'Carla');

insert into public.profiles (user_id, full_name) values ('00000000-0000-0000-0000-00000000000e', 'Eva');

insert into public.agents (id, org_id, name, ghost, department) values
  ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', 'Finanzas', 'finanzas', 'finanzas');

-- The bakery's main agent, who talks to everyone by default.
select public.ensure_main_agent('10000000-0000-0000-0000-000000000001');

set local role authenticated;

-- Ana, owner of the bakery, builds her team.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;
insert into ids select 'secretaria', a.id from public.agents a where a.org_id = '10000000-0000-0000-0000-000000000001' and a.is_main;
insert into ids select 'finanzas', id from public.create_agent('10000000-0000-0000-0000-000000000001', 'Finanzas', 'finanzas', 'finanzas');
select is(public.agent_level((select id from ids where name = 'finanzas')), 'talk', 'an owner talks to every agent');
select throws_ok(
  $$ select public.set_agent_access((select id from ids where name = 'finanzas'), '00000000-0000-0000-0000-00000000000a', 'none') $$,
  '22023', null, '... and cannot be lowered');
select throws_ok(
  $$ select public.set_agent_access((select id from ids where name = 'finanzas'), '00000000-0000-0000-0000-00000000000c', 'talk') $$,
  '22023', null, 'levels only for members of the organisation');
select throws_ok(
  $$ select public.set_agent_access((select id from ids where name = 'finanzas'), '00000000-0000-0000-0000-00000000000b', 'admin') $$,
  '22023', null, 'only none, read or talk');
select throws_ok(
  $$ select public.set_agent_access('20000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-00000000000c', 'none') $$,
  '42501', null, 'an owner cannot set levels on another organisation''s agent');
insert into ids select 'hilo', thread_id from public.chat_with((select id from ids where name = 'finanzas'), '  ¿Cerramos   octubre? ');
select isnt((select id from ids where name = 'hilo'), null, 'an owner writes to Finanzas, opening its chat');
select is((select title from public.threads where kind = 'agent'), 'Finanzas', '... titled with the agent''s name');
select is(
  (select parts->0->>'text' from public.messages),
  '¿Cerramos   octubre?',
  '... whose text is kept as written, in the AI SDK''s parts');
select is((select author_name from public.messages), 'Ana', '... signed with her name');

-- Bea, a member: the defaults.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select count(*) from public.agents), 2::bigint, 'a member sees the team');
select is(public.agent_level((select id from ids where name = 'secretaria')), 'talk', '... talks to Secretaría by default');
select is(public.agent_level((select id from ids where name = 'finanzas')), 'read', '... and reads the rest');
select is((select count(*) from public.messages), 1::bigint, '... so she reads the Finanzas chat');
select throws_ok(
  $$ select public.post_message((select id from ids where name = 'hilo'), 'yo también') $$,
  '42501', null, '... but cannot write in it');
select throws_ok(
  $$ select public.chat_with((select id from ids where name = 'finanzas'), 'hola') $$,
  '42501', null, '... nor write to Finanzas');
select lives_ok(
  $$ select public.chat_with((select id from ids where name = 'secretaria'), '¿Algo urgente en el correo?') $$,
  '... but writes to Secretaría');
select throws_ok(
  $$ select public.set_agent_access((select id from ids where name = 'finanzas'), '00000000-0000-0000-0000-00000000000b', 'talk') $$,
  '42501', null, 'a member cannot raise her own level');
select throws_ok(
  $$ select * from public.list_agent_access((select id from ids where name = 'finanzas')) $$,
  '42501', null, '... nor list everyone''s');
select throws_ok(
  $$ insert into public.messages (thread_id, org_id, author_kind, author_name, parts)
     select id, org_id, 'agent', 'Finanzas', '[]' from public.threads where kind = 'agent' limit 1 $$,
  '42501', null, 'nobody writes messages directly');

-- Ana lowers Bea to none on Finanzas and lets Dani talk to it.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select lives_ok(
  $$ select public.set_agent_access((select id from ids where name = 'finanzas'), '00000000-0000-0000-0000-00000000000b', 'none') $$,
  'an owner hides Finanzas from Bea');
select lives_ok(
  $$ select public.set_agent_access((select id from ids where name = 'finanzas'), '00000000-0000-0000-0000-00000000000d', 'talk') $$,
  '... and lets Dani talk to it');
select results_eq(
  $$ select display_name, level, is_default from public.list_agent_access((select id from ids where name = 'finanzas')) $$,
  $$ values ('Ana', 'talk', false), ('Bea', 'none', false), ('Dani', 'talk', false) $$,
  'the owner sees everyone''s level, owners first');
select is((select count(*) from public.threads where kind = 'agent'), 2::bigint, 'an owner reads every agent''s chat');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select count(*) from public.agents), 1::bigint, 'with none, Bea no longer sees Finanzas');
select is((select count(*) from public.threads where kind = 'agent'), 1::bigint, '... nor its chat');
select results_eq(
  $$ select level from public.my_agent_levels('10000000-0000-0000-0000-000000000001') $$,
  $$ values ('talk') $$,
  '... and her levels list only Secretaría');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000d", "role": "authenticated"}';
select lives_ok(
  $$ select public.post_message((select id from ids where name = 'hilo'), 'Faltan dos facturas') $$,
  'with talk, Dani writes in the Finanzas chat');

-- Carla, owner of the workshop: nothing of the bakery.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select count(*) from public.threads where kind = 'agent'), 0::bigint, 'another organisation sees none of its threads');
select is((select count(*) from public.messages), 0::bigint, '... nor its messages');
select is((select count(*) from public.agent_access), 0::bigint, '... nor its levels');
select throws_ok(
  $$ select public.post_message((select id from ids where name = 'hilo'), 'x') $$,
  '42501', null, '... and cannot write in them');

-- Ana invites Eva with a level per agent; Eva gets it when she accepts.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select throws_ok(
  $$ select public.invite_member('10000000-0000-0000-0000-000000000001', 'eva@example.com', 'member',
       jsonb_build_object('20000000-0000-0000-0000-000000000009', 'talk')) $$,
  '22023', null, 'an invitation names only this organisation''s agents');
select lives_ok(
  $$ select public.invite_member('10000000-0000-0000-0000-000000000001', 'eva@example.com', 'member',
       jsonb_build_object((select id from ids where name = 'finanzas')::text, 'talk')) $$,
  'an owner invites Eva to talk to Finanzas');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000e", "role": "authenticated"}';
select public.accept_invitation((select id from public.my_invitations()));
select is(public.agent_level((select id from ids where name = 'finanzas')), 'talk', 'Eva talks to Finanzas once she joins');

select * from finish();
rollback;
