-- Agent replies (20261118200000_agent_replies.sql): only the engine reads anyone's
-- level, and a thread has at most one reply being written at a time.
begin;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.com');
insert into public.organizations (id, slug, name) values ('10000000-0000-0000-0000-000000000001', 'panaderia', 'Panadería');
insert into public.memberships (org_id, user_id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner', 'Ana'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'member', 'Bea');
insert into public.agents (id, org_id, name, ghost, department, member_default) values
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Finanzas', 'finanzas', 'finanzas', 'read');
insert into public.threads (id, org_id, agent_id, title, visibility) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Cierre', 'write');

-- The engine.
set local role service_role;
select is(public.agent_level_for('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a'), 'talk', 'the engine reads an owner''s level');
select is(public.agent_level_for('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b'), 'read', '... and a member''s');
select is(public.agent_level_for('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c'), 'none', '... and none for a stranger');
insert into public.messages (thread_id, org_id, author_kind, author_agent, author_name, parts, state)
values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'agent', '20000000-0000-0000-0000-000000000002', 'Finanzas', '[]', 'working');
select throws_ok(
  $$ insert into public.messages (thread_id, org_id, author_kind, author_agent, author_name, parts, state)
     values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'agent', '20000000-0000-0000-0000-000000000002', 'Finanzas', '[]', 'working') $$,
  '23505', null, 'one reply at a time per thread');

-- A person.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select throws_ok(
  $$ select public.agent_level_for('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'a person cannot read someone else''s level');
select is((select state from public.messages), 'working', 'a member sees the reply being written');

select * from finish();
rollback;
