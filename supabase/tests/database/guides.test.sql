-- Guided access (docs/plans/ongoing/guided-access.md): the guide's own row is
-- the engine's alone, and the access it ends in is a connection like any other:
-- a member reads their organisation's, never another's, and it always belongs
-- to an agent.
begin;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'berto@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@example.com');

insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería'),
  ('10000000-0000-0000-0000-000000000002', 'taller', 'Taller');

insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'member', 'Berto'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'owner', 'Carla');

insert into public.agents (id, org_id, name, ghost, department) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Redes', 'redes', 'marketing'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Taller', 'redes', 'marketing');
insert into public.threads (id, org_id, agent_id, title) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Web');
insert into public.messages (id, thread_id, org_id, author_kind, author_agent, author_name, parts) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'agent',
   '20000000-0000-0000-0000-000000000001', 'Redes', '[]');

-- What the engine writes, as the service role.
insert into public.guides (id, org_id, thread_id, message_id, agent_id, app, goal, why, landing, started_by)
values ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
        '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'WordPress', 'Publicar en la web',
        'Redes quiere publicar', '{}', '00000000-0000-0000-0000-00000000000a');
insert into public.connections (org_id, kind, provider, method, hint, settings, agent_id, connected_by, connected_by_name) values
  ('10000000-0000-0000-0000-000000000001', 'guided', 'xwordpress', 'guided', 'ana',
   '{"base": "https://miweb.com", "auth": "basic", "app": "WordPress", "guideId": "50000000-0000-0000-0000-000000000001"}',
   '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Ana');
insert into public.connections (org_id, kind, provider, method, hint, settings, agent_id, connected_by, connected_by_name) values
  ('10000000-0000-0000-0000-000000000002', 'guided', 'xwordpress', 'guided', 'carla', '{}',
   '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'Carla');

select throws_ok(
  $$ insert into public.connections (org_id, kind, provider, method, hint, connected_by_name)
     values ('10000000-0000-0000-0000-000000000001', 'guided', 'xwordpress', 'guided', 'x', 'Ana') $$,
  '23514', null, 'a guided access without an agent is refused');
select throws_ok(
  $$ insert into public.connections (org_id, kind, provider, method, hint, agent_id, connected_by_name)
     values ('10000000-0000-0000-0000-000000000001', 'account', 'notion', 'oauth', 'x', '20000000-0000-0000-0000-000000000001', 'Ana') $$,
  '23514', null, 'an agent on any other kind is refused');
select throws_ok(
  $$ insert into public.connections (org_id, kind, provider, method, hint, agent_id, connected_by_name)
     values ('10000000-0000-0000-0000-000000000001', 'guided', 'wordpress', 'guided', 'x', '20000000-0000-0000-0000-000000000001', 'Ana') $$,
  '23514', null, 'a guided provider starts with x (no catalogue id does)');
select throws_ok(
  $$ insert into public.connections (org_id, kind, provider, method, hint, agent_id, connected_by_name)
     values ('10000000-0000-0000-0000-000000000001', 'guided', 'xwordpress', 'api_key', 'x', '20000000-0000-0000-0000-000000000001', 'Ana') $$,
  '23514', null, 'a guided access connects by the guided method only');
select throws_ok(
  $$ insert into public.connections (org_id, kind, provider, method, hint, agent_id, connected_by_name)
     values ('10000000-0000-0000-0000-000000000001', 'guided', 'xwordpress', 'guided', 'x', '20000000-0000-0000-0000-000000000001', 'Ana') $$,
  '23505', null, 'an agent has one access per app');

set local role authenticated;

-- Berto, a plain member of the bakery.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select hint from public.connections where kind = 'guided'), 'ana', 'a member reads their organisation''s guided access (and only that one)');
select throws_ok($$ select count(*) from public.guides $$, '42501', null, 'a member cannot read the guides');
select throws_ok($$ update public.guides set status = 'done' $$, '42501', null, '... nor change one');
select throws_ok(
  $$ insert into public.guides (org_id, thread_id, message_id, agent_id, app, goal, why, landing)
     values ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
             '20000000-0000-0000-0000-000000000001', 'WordPress', 'x', 'y', '{}') $$,
  '42501', null, '... nor write one');
select throws_ok($$ update public.connections set hint = 'hack' where kind = 'guided' $$, '42501', null, '... nor change the access');

-- Carla, owner of the workshop.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}';
select is((select hint from public.connections where kind = 'guided'), 'carla', 'another organisation sees only its own guided access');
select throws_ok($$ select count(*) from public.guides $$, '42501', null, '... and no guide either');

reset role;
select is((select status from public.guides), 'open', 'the guide is still open');

select * from finish();
rollback;
